import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";

import { LOCAL_TEAM_ID, teamOf } from "./auth.mjs";
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

// Exported as the canonical registry of durable ARRAY collections so a
// completeness test (tenancy-persistence.test.mjs) can assert every state key is
// deliberately classified as durable or transient — a new owner-scoped collection
// added to the state factory without landing here would silently be non-durable
// (and, if tenancy-scoped, could restore inconsistently). See #891.
export const persistedArrayKeys = [
  "users",
  "teams",
  "tokens",
  "agents",
  "applications",
  "applicationInstallRuns",
  "applicationRecoveryActions",
  "approvalGrants",
  "applicationDailyStats",
  "refusalDailyStats",
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
  "runTranscripts",
  "ledgerEntries",
  "importedUsageEstimates",
  "codexReviewFindings",
  "claudeReviewFindings",
  "codexExecChanges",
  "codexExecChangeReviews",
  "claudeApplyAuthorizations",
  "applicationResults",
  "budgets",
  "budgetReservations",
  "decisionSoftClaims",
  "issueClaims",
  "issueClaimEvents",
  "workItems",
  "workItemComments",
  "workItemActivities",
  "workItemAttentionOperations",
  "githubWorkItemWebhookDeliveries",
  "githubWorkItemWebhookFailures",
  "workItemOperationalAlerts",
  "alertOutbox",
  "planningProjects",
  "planningProjectItems",
  "dispatchAssignments",
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
  "channels",
  "channelIdentities",
  "canvasScenes",
  "channelEvents",
  "channelConversations",
  "channelDeliveries",
  "channelTaskRequests",
];

// NOTE: `devices` is deliberately absent from both key lists — it restores
// through `restoreDevices` (per-record merge + legacy migration) and saves
// through an explicit dual-write. See those functions.
export const persistedObjectKeys = [
  // Auto-run config overrides + the circuit-breaker are OBJECTS — they must be
  // in the object list, not persistedArrayKeys, or restore's Array.isArray guard
  // silently drops them and every armed brake (kill switch, breaker, saved
  // knobs) un-arms itself on restart.
  "autoRunSettings",
  "autoRunBreaker",
  // O5.2 follow-up: the last-emitted below-target SLO set. Durable so a restart
  // does not re-fire an alert for a breach that was already reported.
  "autoRunSloAlert",
  "approvalTokenLegacyUses",
  "eventHistoryRetention",
  "privateDeploymentConfig",
  "retentionSettings",
  "terminalRuntimeCapability",
  // The scheduled work-report post config (channel + cadence + dedupe cursor).
  "reportSchedule",
  // When refusal recording began (work-report coverage-honesty anchor).
  "refusalStatsMeta",
];

// Collections that carry BOTH a self-stamped owning team AND a project link. The
// public read model scopes these by their PROJECT's team when a projectId is
// present (ignoring the stamp), and falls back to the stamp only when there is no
// project. A restored record whose stamp DISAGREES with its project's team is
// therefore ownership-inconsistent: harmless under today's project-first scoping,
// but a latent leak the moment any path trusts the stamp. We surface it as an
// auditable diagnostic on restore — never delete it, never broaden its visibility.
const OWNER_STAMPED_PROJECT_COLLECTIONS = [
  { key: "applications", owner: "ownerTeamId" },
  { key: "applicationInstallRuns", owner: "ownerTeamId" },
  { key: "applicationResults", owner: "ownerTeamId" },
  // #1152: auto-runs stamp their owning team at creation. Pre-stamp rows have
  // no `teamId` and are skipped by the scan (no stamp → nothing to cross-check).
  { key: "autoRuns", owner: "teamId" },
];

/**
 * Pure integrity scan for ownership-inconsistent persisted records (#891): a row
 * whose self-stamped owning team contradicts the team that owns its linked
 * project. Returns a bounded list of `{collection, id, projectId, stampedTeam,
 * projectTeam}` diagnostics; empty when the snapshot is consistent. Read-only —
 * it classifies, it does not mutate or hide anything.
 */
export function detectOwnershipInconsistencies(state, { limit = 100 } = {}) {
  const projectsById = new Map((state?.projects ?? []).map((project) => [project.id, project]));
  const diagnostics = [];
  for (const { key, owner } of OWNER_STAMPED_PROJECT_COLLECTIONS) {
    for (const row of state?.[key] ?? []) {
      const projectId = row?.projectId;
      const stampedTeam = row?.[owner];
      if (!projectId || !stampedTeam) continue; // no project link, or no stamp → nothing to cross-check
      const project = projectsById.get(projectId);
      if (!project) continue; // dangling projectId is fail-closed in scoped views, not a misattribution
      const projectTeam = teamOf(project);
      // teamOf already applies the LOCAL_TEAM_ID default, so a stamp of
      // LOCAL_TEAM_ID against an unowned project is a match, not a mismatch.
      if (projectTeam !== stampedTeam) {
        diagnostics.push({ collection: key, id: row?.id ?? null, projectId, stampedTeam, projectTeam });
        if (diagnostics.length >= limit) return diagnostics;
      }
    }
  }
  return diagnostics;
}

// A snapshot carrying two records under one id is CORRUPT (#832): `find` by id then
// returns an arbitrary one, so the record an operator reads and the one the
// scheduler acts on can differ. Records are unshifted (newest first), so the FIRST
// occurrence is the newest — keep it, drop the rest, and be loud. Pure: returns the
// deduped array + how many were dropped (the caller accumulates for the forensic copy).
function dedupeById(key, records) {
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
    console.error(
      `[server] state snapshot had ${dropped} duplicate-id record(s) in "${key}" — kept the newest of each id and dropped the rest. This is corruption (see #832).`,
    );
  }
  return { kept, dropped };
}

// Merge loaded devices onto the seeded defaults (so a NEW default device introduced
// in a version upgrade survives), then keep the defaults when nothing was loaded —
// mirrors the old restoreDevices semantics but over already-loaded `state.devices`.
function mergeDevicesWithDefaults(state, seededDevices) {
  const persisted = Array.isArray(state.devices) && state.devices.length ? state.devices : null;
  if (!persisted) {
    state.devices = seededDevices;
    return;
  }
  const restored = persisted.filter(isPlainObject).map((device) => {
    const base = seededDevices.find((seeded) => seeded.id === device.id);
    return base ? { ...base, ...device } : device;
  });
  state.devices = restored.length ? restored : seededDevices;
}

/**
 * Snapshot the fresh, seeded state's mergeable defaults BEFORE any restore/hydrate
 * overwrites them — the bases normalizeLoadedState merges new defaults from. Must be
 * captured at boot entry, off the createServerState output.
 */
export function captureSeededDefaults(state) {
  const arrays = {};
  for (const key of persistedArrayKeys) {
    arrays[key] = Array.isArray(state[key]) ? [...state[key]] : [];
  }
  const objects = {};
  for (const key of persistedObjectKeys) {
    if (isPlainObject(state[key])) objects[key] = { ...state[key] };
  }
  const devices = Array.isArray(state.devices) ? [...state.devices] : [];
  return { arrays, objects, devices };
}

/**
 * Shared post-load normalization for BOTH restore paths (#1003). The JSON restore and
 * the SQLite hydrate each load raw records into `state`; this then makes the state
 * WHOLE, identically, so the SQLite backing fails closed exactly like the JSON one:
 *   - drop path-missing projects + guarantee the default project + valid currentProjectId,
 *   - merge new seeded defaults into agents / object singletons / devices (version upgrades),
 *   - repair duplicate ids, force every device offline (a restart implies no liveness),
 *   - surface ownership-inconsistent records as an auditable diagnostic.
 * Operates in place; returns { duplicateIdsRepaired, ownershipInconsistencies }.
 */
export function normalizeLoadedState(state, { seededDefaults, defaultProject, sameProjectPath }) {
  const same = typeof sameProjectPath === "function" ? sameProjectPath : (a, b) => a === b;
  const seededArrays = seededDefaults?.arrays ?? {};
  const seededObjects = seededDefaults?.objects ?? {};

  // Projects: fail-closed path filter, default-project guarantee, currentProjectId.
  let projects = Array.isArray(state.projects)
    ? state.projects.filter((project) => project?.id && project?.path && existsSync(project.path))
    : [];
  projects = projects.filter((project) => project.id !== defaultProject.id || same(project.path, defaultProject.path));
  let defaultPathProject = projects.find((project) => same(project.path, defaultProject.path));
  if (!defaultPathProject) {
    projects.unshift(defaultProject);
    defaultPathProject = defaultProject;
  }
  state.projects = projects;
  state.currentProjectId = projects.some((project) => project.id === state.currentProjectId)
    ? state.currentProjectId
    : defaultPathProject.id;

  // Arrays: agents merge with the seeded defaults (new demo agents survive an
  // upgrade); every other collection is duplicate-id repaired.
  let duplicateIdsRepaired = 0;
  for (const key of persistedArrayKeys) {
    if (!Array.isArray(state[key])) continue;
    if (key === "agents") {
      state.agents = mergeRecordsById(seededArrays.agents ?? [], state.agents);
    } else {
      const { kept, dropped } = dedupeById(key, state[key]);
      state[key] = kept;
      duplicateIdsRepaired += dropped;
    }
  }

  // Object singletons: a new default field added in an upgrade merges UNDER the
  // restored values (restored wins on conflict).
  for (const key of persistedObjectKeys) {
    if (isPlainObject(state[key])) {
      state[key] = { ...(isPlainObject(seededObjects[key]) ? seededObjects[key] : {}), ...state[key] };
    }
  }

  // Devices: dedupe + merge defaults + force offline.
  if (Array.isArray(state.devices)) {
    const { kept, dropped } = dedupeById("devices", state.devices);
    state.devices = kept;
    duplicateIdsRepaired += dropped;
  }
  mergeDevicesWithDefaults(state, seededDefaults?.devices ?? []);
  for (const device of listDevices(state)) {
    if (device) device.status = "offline";
  }

  const ownershipInconsistencies = detectOwnershipInconsistencies(state);
  return { duplicateIdsRepaired, ownershipInconsistencies };
}

export function createPersistenceRuntime({
  state,
  enabled,
  stateStorePath,
  schemaVersion,
  now,
  defaultProject,
  sameProjectPath,
  // #1041: called after every durable flush (persistStateNow AND the debounced
  // persistStateSoon). The SQLite backing hooks here to mirror the state on EVERY
  // write path — invocation accept/completion (runStateTransaction), route-level
  // persistStateSoon, and the runtime helpers — not only store.transaction commits,
  // so SQLite never lags the JSON snapshot (and the last writes before shutdown are
  // captured). No-op by default (JSON-only backing).
  afterFlush = () => {},
  // #1042: when false, a per-commit flush writes ONLY the durable backing (SQLite via
  // afterFlush), not the JSON snapshot — JSON is retired AS the backing and becomes
  // an explicit export (exportJsonSnapshot: shutdown + on-demand rollback artifact).
  // Stays true on the MYAGENTTOOL_STORE=memory path and the Node<22.13 degradation,
  // where JSON IS the backing.
  jsonBacking = true,
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

  // The actual JSON snapshot write. Called per-commit only when JSON is the backing
  // (jsonBacking); otherwise it's the explicit export (exportJsonSnapshot).
  function writeSnapshotFile() {
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

  function savePersistentState() {
    if (!enabled) return;
    // JSON is written per-commit only when it is the backing (#1042). On the SQLite
    // backing this is a no-op — the durable write is the mirror below.
    if (jsonBacking) writeSnapshotFile();
    // Mirror the same state into the durable backing (SQLite) on the SAME flush, so
    // every write path stays in sync. Best-effort: a mirror failure must not crash
    // the control plane.
    try {
      afterFlush();
    } catch (error) {
      console.error(`[server] durable backing sync failed: ${error?.message ?? error}`);
    }
  }

  // #1042: explicit JSON export — a rollback/backup artifact, independent of the
  // backing. Written at shutdown and on demand even when SQLite is the backing.
  function exportJsonSnapshot() {
    if (!enabled) return;
    writeSnapshotFile();
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

  function restorePersistentState() {
    if (!enabled || !existsSync(stateStorePath)) return;
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
    // Capture the fresh seeded defaults BEFORE loading the snapshot over them, then
    // load the raw records (present keys only — an absent key keeps its default) and
    // hand off to the SHARED normalization (identical to the SQLite hydrate path).
    const seededDefaults = captureSeededDefaults(state);
    if (Array.isArray(snapshot.projects)) state.projects = snapshot.projects;
    state.currentProjectId = snapshot.currentProjectId;
    for (const key of persistedArrayKeys) {
      if (Array.isArray(snapshot[key])) state[key] = snapshot[key];
    }
    for (const key of persistedObjectKeys) {
      if (isPlainObject(snapshot[key])) state[key] = snapshot[key];
    }
    // `devices` has its own snapshot key (+ a legacy `device` singular that older
    // snapshots wrote); load either form, the shared normalization does the rest.
    if (Array.isArray(snapshot.devices)) state.devices = snapshot.devices;
    else if (isPlainObject(snapshot.device)) state.devices = [snapshot.device];
    if (Number.isFinite(snapshot.idCounter)) state.idCounter = snapshot.idCounter;

    const { duplicateIdsRepaired, ownershipInconsistencies } = normalizeLoadedState(state, {
      seededDefaults,
      defaultProject,
      sameProjectPath,
    });

    // Keep the evidence before anything overwrites it — the same forensic move
    // quarantineSnapshot makes. The repaired snapshot is NOT written back here: the
    // id counter is not settled yet (the composer raises it right after this
    // returns), and persisting a counter behind its own records is the exact bug
    // this is fixing. The caller writes it once the state is whole.
    if (duplicateIdsRepaired > 0) {
      const preservedPath = `${stateStorePath}.duplicate-ids-${Date.now()}`;
      try {
        copyFileSync(stateStorePath, preservedPath);
        console.error(`[server] pre-repair snapshot preserved at ${preservedPath}`);
      } catch (error) {
        console.error(`[server] could not preserve the pre-repair snapshot: ${error?.message ?? error}`);
      }
    }
    // #891: surface any ownership-inconsistent restored record as an auditable
    // diagnostic — loud-not-silent (the record is neither deleted nor made more
    // visible; scoped views already attribute it by its project's team).
    if (ownershipInconsistencies.length > 0) {
      const preview = ownershipInconsistencies
        .slice(0, 10)
        .map((d) => `${d.collection}#${d.id} stamped ${d.stampedTeam} but project ${d.projectId} owned by ${d.projectTeam}`)
        .join("; ");
      console.error(
        `[server] restore found ${ownershipInconsistencies.length} ownership-inconsistent record(s); ` +
          `kept and scoped by project (visibility unchanged): ${preview}`,
      );
    }

    return { duplicateIdsRepaired, ownershipInconsistencies };
  }

  return {
    persistStateSoon,
    persistStateNow,
    restorePersistentState,
    savePersistentState,
    exportJsonSnapshot,
  };
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
