const ACTIVE_INSTALL_STATUSES = new Set(["queued", "running", "cancelling"]);
const FAILED_INSTALL_STATUSES = new Set(["failed", "timed_out", "refused"]);

/**
 * Server-owned first-task readiness. This is deliberately a pure read model:
 * it never installs software, writes credentials, registers an external
 * provider, or bypasses an approval. Completed steps are recovered from durable
 * product facts after refresh/restart instead of a browser-only wizard index.
 */
export function deriveGuidedReadiness({
  device = null,
  projects = [],
  projectTargets = [],
  agents = [],
  applications = [],
  applicationInstallRuns = [],
  run = null,
} = {}) {
  const computerReady = device?.status === "online" && device?.unlinkState !== "unlinked";
  const workspaceReady = projectTargets.length > 0
    ? projectTargets.some((target) => target?.state === "ready")
    : projects.length > 0;
  const executionReady = agents.some((agent) =>
    agent?.status !== "disabled"
    && agent?.status !== "unavailable"
    && agent?.health?.status !== "unhealthy");
  const latestInstall = applicationInstallRuns
    .filter((run) => !device?.id || run?.deviceId === device.id)
    .sort((left, right) => String(right?.updatedAt ?? right?.createdAt ?? "")
      .localeCompare(String(left?.updatedAt ?? left?.createdAt ?? "")))[0] ?? null;
  const loginRequired = applications.some((application) => application?.localReadiness?.state === "login_required");
  const approvalRequired = applications.some((application) =>
    ["not_installed", "repair_required"].includes(application?.localReadiness?.state));

  const facts = { computerReady, workspaceReady, executionReady };
  let status = "ready";
  let currentStep = "complete";
  let reason = "ready";
  let action = null;
  let operationRunId = null;

  if (!computerReady) {
    status = "action_required";
    currentStep = "computer";
    reason = "computer_offline";
    action = { kind: "open_section", section: "devices" };
  } else if (!workspaceReady) {
    status = "action_required";
    currentStep = "workspace";
    reason = "workspace_missing";
    action = { kind: "open_section", section: "projects" };
  } else if (!executionReady) {
    currentStep = "execution";
    operationRunId = latestInstall?.id ?? null;
    if (latestInstall && ACTIVE_INSTALL_STATUSES.has(latestInstall.status)) {
      status = "installing";
      reason = latestInstall.status === "queued" ? "install_queued" : "install_in_progress";
      action = { kind: "open_section", section: "applications" };
    } else if (loginRequired) {
      status = "login_required";
      reason = "login_required";
      action = { kind: "open_section", section: "applications" };
    } else if (latestInstall && FAILED_INSTALL_STATUSES.has(latestInstall.status)) {
      status = "failed";
      reason = "install_failed";
      action = { kind: "open_section", section: "applications" };
    } else if (latestInstall?.status === "cancelled") {
      status = "cancelled";
      reason = "install_cancelled";
      action = { kind: "open_section", section: "applications" };
    } else if (approvalRequired) {
      status = "waiting_for_approval";
      reason = "approval_required";
      action = { kind: "open_section", section: "applications" };
    } else {
      status = "action_required";
      reason = "execution_missing";
      action = { kind: "open_section", section: "agents" };
    }
  }

  if (status !== "ready" && run?.status === "cancelled") {
    status = "cancelled";
    reason = "setup_cancelled";
    action = null;
  }

  const steps = ["computer", "workspace", "execution"].map((key) => {
    const ready = facts[`${key}Ready`];
    return {
      key,
      state: ready ? "complete" : key === currentStep
        ? (status === "failed" ? "failed" : status === "cancelled" ? "cancelled" : "current")
        : "pending",
    };
  });

  return {
    version: 1,
    status,
    currentStep,
    reason,
    action,
    runId: run?.id ?? null,
    operationRunId,
    startedAt: run?.createdAt ?? null,
    updatedAt: run?.updatedAt ?? null,
    completedCount: steps.filter((step) => step.state === "complete").length,
    totalCount: steps.length,
    steps,
  };
}
