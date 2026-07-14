import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";

import { listDevices } from "./device.mjs";

// Durable atomic snapshot write. `writeFileSync` truncates the target in place
// and does not fsync, so a crash mid-write left a torn file — and restore's
// JSON.parse then threw and silently discarded ALL state (total loss, worse
// than losing the last debounce window). Here: write a temp file, fsync it to
// disk, then rename over the target (rename is atomic on POSIX), then fsync the
// parent directory so the rename itself survives a power loss. The target is
// therefore always either the previous complete snapshot or the new one.
function durableWriteFileSync(path, data) {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  let dirFd;
  try {
    dirFd = openSync(dirname(path), "r");
    fsyncSync(dirFd);
  } catch {
    // Some platforms (notably Windows) disallow fsync on a directory handle;
    // the rename is still atomic, so this only weakens power-loss durability.
  } finally {
    if (dirFd !== undefined) closeSync(dirFd);
  }
}

const persistedArrayKeys = [
  "users",
  "teams",
  "tokens",
  "agents",
  "applications",
  "applicationRecoveryActions",
  "approvalGrants",
  "applicationDailyStats",
  "projectTargets",
  "invocations",
  "worktrees",
  "autoRuns",
  "deployments",
  "compareRuns",
  "worktreeReviews",
  "events",
  "refusals",
  "traces",
  "spans",
  "auditSummaries",
  "healthChecks",
  "lifecycleAuditRecords",
  "lifecycleRecipes",
  "lifecyclePolicyDecisions",
  "lifecycleLocalApprovals",
  "lifecycleQueuedActions",
  "lifecycleRollbackRequests",
  "discoveryRuns",
  "integrationArtifacts",
  "integrationProbeRuns",
  "privateCatalogEntries",
  "signedBundleManifests",
  "quotaDecisionRecords",
  "quotaPolicies",
  "aiUsageRecords",
  "invocationRounds",
  "toolInvocationRecords",
  "ledgerEntries",
  "importedUsageEstimates",
  "codexReviewFindings",
  "claudeReviewFindings",
  "codexExecChanges",
  "codexExecChangeReviews",
  "applicationResults",
  "budgets",
  "budgetReservations",
  "automations",
  "agentSkills",
  "auditExportRequests",
  "approvalRequests",
  "policyDecisionRecords",
  "troubleshootingReports",
  "agentUsageSummaries",
  "codexSessions",
  "codexWorkspaces",
  "codexEvidenceRecords",
  "codexChangeReviews",
  "codexHookEvents",
  "codexApprovalBrokerRequests",
  "codexImportedEvidenceRecords",
  "terminalSessions",
  "terminalEvidenceRecords",
  "terminalBridgeActions",
  "sshTargets",
  "sshConnectionTests",
];

// NOTE: `devices` is deliberately absent from both key lists — it restores
// through `restoreDevices` (per-record merge + legacy migration) and saves
// through an explicit dual-write. See those functions.
const persistedObjectKeys = [
  // Auto-run config overrides + the circuit-breaker are OBJECTS — they must be
  // in the object list, not persistedArrayKeys, or restore's Array.isArray guard
  // silently drops them and every armed brake (kill switch, breaker, saved
  // knobs) un-arms itself on restart.
  "autoRunSettings",
  "autoRunBreaker",
  "approvalTokenLegacyUses",
  "privateDeploymentConfig",
  "retentionSettings",
  "terminalRuntimeCapability",
];

export function createPersistenceRuntime({
  state,
  enabled,
  stateStorePath,
  schemaVersion,
  now,
  defaultProject,
  sameProjectPath,
}) {
  let saveStateTimer = null;

  function persistStateSoon() {
    if (!enabled) return;
    if (saveStateTimer) return;
    saveStateTimer = setTimeout(() => {
      saveStateTimer = null;
      savePersistentState();
    }, 20);
  }

  // Synchronous durable barrier: flush now instead of after the 20ms debounce,
  // so a crash cannot lose the write. Call at commit points where the record
  // has no other recovery path — notably an accepted invocation, which (unlike a
  // dispatched one) has no lease to re-queue it. Cancels the pending debounce so
  // the timer doesn't re-write redundantly.
  function persistStateNow() {
    if (!enabled) return;
    if (saveStateTimer) {
      clearTimeout(saveStateTimer);
      saveStateTimer = null;
    }
    savePersistentState();
  }

  function savePersistentState() {
    if (!enabled) return;
    const snapshot = {
      schemaVersion,
      savedAt: now(),
      projects: state.projects,
      currentProjectId: state.currentProjectId,
      worktrees: state.worktrees,
      // The device fleet, plus a mirror of the primary under the pre-fleet key.
      // The mirror is what makes a rollback to a single-device build survivable:
      // that build reads `device` and would otherwise come up with no paired
      // bridge credential, locking the bridge out until someone hand-edited the
      // snapshot. Drop the mirror once no deployed build reads it.
      devices: listDevices(state),
      device: state.device,
      // The id counter travels WITH the state it minted ids for (#832). It used to
      // be recovered on boot by regex-scanning every string in the state for the
      // largest `_NNNN` suffix — a primary key that is only correct because a scan
      // happened to find the biggest number is not a primary key, and it silently
      // lowers itself the day a collection holds ids the scan does not reach.
      idCounter: Number.isFinite(state.idCounter) ? state.idCounter : null,
    };
    for (const key of persistedArrayKeys) {
      snapshot[key] = state[key];
    }
    for (const key of persistedObjectKeys) {
      snapshot[key] = state[key];
    }
    // A persistence write failure (state dir removed, disk full, permissions)
    // must NOT crash the control plane — the in-memory state is intact and a
    // later write can succeed. The atomic rename means a failed write also never
    // corrupts the existing snapshot. Log and continue.
    try {
      mkdirSync(dirname(stateStorePath), { recursive: true });
      durableWriteFileSync(stateStorePath, `${JSON.stringify(snapshot, null, 2)}\n`);
    } catch (error) {
      console.error(`[server] failed to persist state: ${error?.message ?? error}`);
    }
  }

  // A snapshot we refuse to load must be MOVED ASIDE, not left in place: the
  // server continues with fresh state and the next debounced save would
  // overwrite the only copy of the old data. Renaming preserves a forensic
  // copy for recovery/migration and makes the loss loud instead of silent.
  function quarantineSnapshot(reason) {
    const quarantinePath = `${stateStorePath}.${reason}-${Date.now()}`;
    try {
      renameSync(stateStorePath, quarantinePath);
      console.error(`[server] state snapshot not loadable (${reason}); preserved at ${quarantinePath} and starting fresh`);
    } catch (error) {
      console.error(`[server] state snapshot not loadable (${reason}) and could not be preserved: ${error?.message ?? error}`);
    }
  }

  // Set by repairDuplicateIds; consumed at the end of restore. The repair is
  // useless if it only ever lives in memory — the next process would read the same
  // corrupt file and log the same alarm forever.
  let duplicateIdsRepaired = 0;

  function restorePersistentState() {
    if (!enabled || !existsSync(stateStorePath)) return;
    duplicateIdsRepaired = 0;
    let snapshot;
    try {
      snapshot = JSON.parse(readFileSync(stateStorePath, "utf8"));
    } catch {
      quarantineSnapshot("corrupt");
      return;
    }
    if (snapshot?.schemaVersion !== schemaVersion) {
      quarantineSnapshot(`schema-${snapshot?.schemaVersion ?? "unknown"}`);
      return;
    }
    let restoredProjects = Array.isArray(snapshot.projects)
      ? snapshot.projects.filter((project) => project?.id && project?.path && existsSync(project.path))
      : [];
    restoredProjects = restoredProjects.filter((project) => project.id !== defaultProject.id || sameProjectPath(project.path, defaultProject.path));
    let defaultPathProject = restoredProjects.find((project) => sameProjectPath(project.path, defaultProject.path));
    if (!defaultPathProject) {
      restoredProjects.unshift(defaultProject);
      defaultPathProject = defaultProject;
    }
    if (restoredProjects.length) {
      state.projects = restoredProjects;
      state.currentProjectId = restoredProjects.some((project) => project.id === snapshot.currentProjectId)
        ? snapshot.currentProjectId
        : defaultPathProject.id;
    }
    const defaultArrays = {};
    for (const key of persistedArrayKeys) {
      defaultArrays[key] = Array.isArray(state[key]) ? state[key] : [];
    }
    for (const key of persistedArrayKeys) {
      if (Array.isArray(snapshot[key])) {
        state[key] = key === "agents"
          ? mergeRecordsById(defaultArrays[key], snapshot[key])
          : repairDuplicateIds(key, snapshot[key]);
      }
    }
    for (const key of persistedObjectKeys) {
      if (isPlainObject(snapshot[key])) {
        state[key] = {
          ...(isPlainObject(state[key]) ? state[key] : {}),
          ...snapshot[key],
        };
      }
    }
    // `devices` restores through its own path (per-record merge + legacy
    // migration), so it would otherwise sail past the duplicate-id repair every
    // other collection gets. It is the NEWEST collection, which is exactly the
    // case #832 warns about: a guard that only covers the arrays someone
    // remembered to route through it is not a guard. Repair it here, on the
    // snapshot, so restoreDevices sees a fleet with unique ids.
    if (Array.isArray(snapshot.devices)) {
      snapshot.devices = repairDuplicateIds("devices", snapshot.devices);
    }
    restoreDevices(state, snapshot);
    if (Number.isFinite(snapshot.idCounter)) {
      state.idCounter = snapshot.idCounter;
    }
    // Every device is offline until its own bridge re-registers — a restart
    // tells us nothing about which machines are still up.
    for (const device of listDevices(state)) {
      device.status = "offline";
    }
    // Keep the evidence before anything overwrites it — the same forensic move
    // quarantineSnapshot makes. Otherwise the next ordinary save silently destroys
    // the only copy of what went wrong.
    //
    // The repaired snapshot is NOT written here: the id counter is not settled yet
    // (the composer raises it right after this returns), and persisting a counter
    // that is behind its own records is the exact bug this is fixing. The caller
    // writes it once the state is whole.
    if (duplicateIdsRepaired > 0) {
      const preservedPath = `${stateStorePath}.duplicate-ids-${Date.now()}`;
      try {
        copyFileSync(stateStorePath, preservedPath);
        console.error(`[server] pre-repair snapshot preserved at ${preservedPath}`);
      } catch (error) {
        console.error(`[server] could not preserve the pre-repair snapshot: ${error?.message ?? error}`);
      }
    }
    return { duplicateIdsRepaired };
  }

  /**
   * A snapshot carrying two records under one id is CORRUPT (#832): `find` by id
   * then returns an arbitrary one of them, so the record an operator reads and the
   * record the scheduler acts on can be different objects. That is exactly how a
   * ghost invocation — stuck `running`, unreachable by its own id — wedged a
   * device's dispatch for three weeks while every read of it said `cancelled`.
   *
   * Repair rather than quarantine: the whole snapshot is not junk, and an operator
   * needs a way back that is not "throw the state away". Records are unshifted
   * (newest first), so the FIRST occurrence is the newest — keep it, drop the rest,
   * and be loud about what was dropped. Loading it silently is what let this hide.
   */
  function repairDuplicateIds(key, records) {
    const seen = new Set();
    const kept = [];
    let dropped = 0;
    for (const record of records) {
      const id = record?.id;
      if (typeof id !== "string" || !id) {
        kept.push(record);
        continue;
      }
      if (seen.has(id)) {
        dropped += 1;
        continue;
      }
      seen.add(id);
      kept.push(record);
    }
    if (dropped > 0) {
      duplicateIdsRepaired += dropped;
      console.error(
        `[server] state snapshot had ${dropped} duplicate-id record(s) in "${key}" — kept the newest of each id and dropped the rest. This is corruption (see #832).`,
      );
    }
    return kept;
  }

  return {
    persistStateSoon,
    persistStateNow,
    restorePersistentState,
    savePersistentState,
  };
}

/**
 * Restore the device fleet, accepting both shapes:
 *   - `devices: [...]`  — current.
 *   - `device: {...}`   — pre-fleet snapshot, migrated by wrapping it in a list.
 *
 * A restored device is merged OVER its seeded default (matched by id) rather
 * than replacing it, which is what the old single-object restore did: a field
 * introduced by a code upgrade is absent from an older snapshot, and the merge
 * is what lets it pick up its default instead of coming back `undefined`. A
 * device with no seeded counterpart (an enrolled machine) has no defaults to
 * inherit and is taken as-is.
 *
 * An empty or unusable list leaves the seeded defaults in place: `state.device`
 * aliases devices[0], so an empty fleet would make the alias null and every
 * singleton read in the services throw.
 */
function restoreDevices(state, snapshot) {
  const defaults = listDevices(state);
  const persisted = Array.isArray(snapshot.devices) && snapshot.devices.length
    ? snapshot.devices
    : isPlainObject(snapshot.device)
      ? [snapshot.device]
      : null;
  if (!persisted) return;
  const restored = persisted.filter(isPlainObject).map((device) => {
    const base = defaults.find((seeded) => seeded.id === device.id);
    return base ? { ...base, ...device } : device;
  });
  if (restored.length) {
    state.devices = restored;
  }
}

function mergeRecordsById(defaultRecords, restoredRecords) {
  const merged = [];
  const seen = new Set();
  for (const record of restoredRecords) {
    if (!record || typeof record.id !== "string") continue;
    merged.push(record);
    seen.add(record.id);
  }
  for (const record of defaultRecords) {
    if (!record || typeof record.id !== "string" || seen.has(record.id)) continue;
    merged.push(record);
  }
  return merged;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
