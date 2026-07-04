import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
    mkdirSync(dirname(stateStorePath), { recursive: true });
    writeFileSync(stateStorePath, `${JSON.stringify(snapshot, null, 2)}\n`);
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
