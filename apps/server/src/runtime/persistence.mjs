import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";

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
  "projectTargets",
  "invocations",
  "worktrees",
  "autoRuns",
  "compareRuns",
  "worktreeReviews",
  "events",
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
  "ledgerEntries",
  "importedUsageEstimates",
  "codexReviewFindings",
  "claudeReviewFindings",
  "budgets",
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

const persistedObjectKeys = [
  "device",
  // Auto-run config overrides + the circuit-breaker are OBJECTS — they must be
  // in the object list, not persistedArrayKeys, or restore's Array.isArray guard
  // silently drops them and every armed brake (kill switch, breaker, saved
  // knobs) un-arms itself on restart.
  "autoRunSettings",
  "autoRunBreaker",
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

  function restorePersistentState() {
    if (!enabled || !existsSync(stateStorePath)) return;
    let snapshot;
    try {
      snapshot = JSON.parse(readFileSync(stateStorePath, "utf8"));
    } catch {
      return;
    }
    if (snapshot?.schemaVersion !== schemaVersion) {
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
          : snapshot[key];
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
    if (state.device) {
      state.device.status = "offline";
    }
  }

  return {
    persistStateSoon,
    persistStateNow,
    restorePersistentState,
    savePersistentState,
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
