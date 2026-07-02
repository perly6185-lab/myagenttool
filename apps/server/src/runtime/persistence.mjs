import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const persistedArrayKeys = [
  "users",
  "teams",
  "tokens",
  "projectTargets",
  "invocations",
  "worktrees",
  "compareRuns",
  "events",
  "traces",
  "spans",
  "auditSummaries",
  "lifecycleRecipes",
  "lifecyclePolicyDecisions",
  "lifecycleLocalApprovals",
  "lifecycleQueuedActions",
  "lifecycleRollbackRequests",
  "privateCatalogEntries",
  "signedBundleManifests",
  "quotaDecisionRecords",
  "quotaPolicies",
  "aiUsageRecords",
  "ledgerEntries",
  "importedUsageEstimates",
  "codexReviewFindings",
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
    snapshot.privateDeploymentConfig = state.privateDeploymentConfig;
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
      state.currentProjectId = defaultPathProject.id;
    }
    for (const key of persistedArrayKeys) {
      if (Array.isArray(snapshot[key])) {
        state[key] = snapshot[key];
      }
    }
    if (snapshot.privateDeploymentConfig) {
      state.privateDeploymentConfig = snapshot.privateDeploymentConfig;
    }
  }

  return {
    persistStateSoon,
    restorePersistentState,
    savePersistentState,
  };
}
