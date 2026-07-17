import { applicationInstallPlanMatchesCurrent } from "./application-install-plans.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "timed_out", "refused"]);
const PROGRESS_TYPES = new Set(["spawning", "installing", "probing", "cancelling"]);
const CLASSIFICATIONS_BY_STATUS = {
  succeeded: new Set(["installed_and_ready"]),
  failed: new Set(["spawn_failed", "probe_spawn_failed", "probe_failed", "nonzero_exit"]),
  cancelled: new Set(["cancelled"]),
  timed_out: new Set(["install_timeout", "probe_timeout"]),
  refused: new Set(["plan_not_allowlisted"]),
};

function redactSensitive(value) {
  return String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(token|secret|password|authorization|api[-_]?key)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+|\/Users\/[^/\s]+|\/home\/[^/\s]+/g, "[user-home]");
}

function bounded(value, max = 500) {
  const text = redactSensitive(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export function createApplicationInstallService({ state, now, nextId, appendEvent, persistStateSoon, validateApprovalToken, store }) {
  const runTx = makeRunTx({ store, persistStateSoon });
  function findApplicationInstallRun(id) {
    return (state.applicationInstallRuns ?? []).find((item) => item.id === id) ?? null;
  }

  function queueApplicationInstall({ plan, approvalToken }, { actor, device, projectId = null }) {
    if (!applicationInstallPlanMatchesCurrent(plan, { device, projectId, now })) {
      const error = new Error("Installation plan is stale, modified, or no longer allowlisted.");
      error.code = "application_install_plan_mismatch";
      throw error;
    }
    const approval = validateApprovalToken(approvalToken, {
      action: "application.install",
      targetId: plan.planId,
      actor,
      allowLegacy: false,
    });
    if (!approval.approved) {
      const error = new Error(approval.reason ?? "approval_required");
      error.code = "application_install_approval_required";
      error.approval = approval;
      throw error;
    }
    const createdAt = now();
    const run = {
      id: nextId("air"),
      ownerTeamId: actor?.teamId ?? "team_local",
      requestedBy: actor?.userId ?? "usr_local",
      projectId,
      deviceId: device.id,
      plan,
      planId: plan.planId,
      planFingerprint: plan.fingerprint,
      approvalGrantId: approval.grantId ?? null,
      status: "queued",
      cancelRequestedAt: null,
      startedAt: null,
      completedAt: null,
      result: null,
      rollback: null,
      progress: [{ at: createdAt, type: "queued", summary: "Approved Application installation queued for Desktop Bridge." }],
      createdAt,
      updatedAt: createdAt,
    };
    return runTx(() => {
      state.applicationInstallRuns.unshift(run);
      state.applicationInstallRuns = state.applicationInstallRuns.slice(0, 100);
      appendEvent({
        invocationId: null,
        type: "application_install_queued",
        level: "info",
        message: "Approved Application installation queued for Desktop Bridge.",
        data: { runId: run.id, planId: run.planId, deviceId: run.deviceId, application: run.plan.application.name },
      });
      return run;
    });
  }

  function nextBridgeApplicationInstall(deviceId) {
    const run = (state.applicationInstallRuns ?? []).find((item) => item.status === "queued" && item.deviceId === deviceId) ?? null;
    if (!run) return null;
    return runTx(() => {
      run.status = "running";
      run.startedAt = now();
      run.updatedAt = run.startedAt;
      run.progress.push({ at: run.startedAt, type: "started", summary: "Desktop Bridge accepted the approved installation plan." });
      return run;
    });
  }

  function cancelApplicationInstall(run, actor = null) {
    if (!run || TERMINAL_STATUSES.has(run.status)) return run;
    const at = now();
    return runTx(() => {
      run.cancelRequestedAt = at;
      run.updatedAt = at;
      if (run.status === "queued") {
        run.status = "cancelled";
        run.completedAt = at;
        run.result = { status: "cancelled", classification: "cancelled_before_dispatch", summary: "Installation cancelled before Desktop Bridge dispatch.", exitCode: null };
      } else {
        run.status = "cancelling";
      }
      run.progress.push({ at, type: "cancel_requested", summary: "Application installation cancellation requested." });
      appendEvent({ invocationId: null, type: "application_install_cancel_requested", level: "warn", message: "Application installation cancellation requested.", data: { runId: run.id, requestedBy: actor?.userId ?? "usr_local" } });
      return run;
    });
  }

  function recordApplicationInstallProgress(run, { type = "progress", summary = "Installation progress updated." } = {}) {
    if (!run || !["running", "cancelling"].includes(run.status)) return run;
    const at = now();
    const safeType = PROGRESS_TYPES.has(String(type)) ? String(type) : "installing";
    return runTx(() => {
      run.progress.push({ at, type: safeType, summary: bounded(summary) });
      run.progress = run.progress.slice(-50);
      run.updatedAt = at;
      return run;
    });
  }

  function completeApplicationInstall(run, body = {}) {
    if (!run || !["running", "cancelling"].includes(run.status)) {
      throw new Error("Application installation is not completable.");
    }
    const status = String(body.status ?? "failed");
    if (!TERMINAL_STATUSES.has(status)) {
      throw new Error(`Unsupported Application installation status: ${status}`);
    }
    const classification = String(body.classification ?? "");
    if (!CLASSIFICATIONS_BY_STATUS[status]?.has(classification)) {
      throw new Error(`Unsupported Application installation classification for ${status}.`);
    }
    const completedAt = now();
    return runTx(() => {
      run.status = status;
      run.completedAt = completedAt;
      run.updatedAt = completedAt;
      run.result = {
        status,
        classification,
        summary: bounded(body.summary ?? `Application installation ${status}.`),
        exitCode: Number.isInteger(body.exitCode) ? body.exitCode : null,
        durationMs: Number.isFinite(body.durationMs) ? Math.max(0, Number(body.durationMs)) : null,
      };
      run.rollback = {
        automatic: false,
        status: status === "succeeded" ? "not_required" : "operator_review_required",
        uninstallSupported: false,
        summary: run.plan.rollback.summary,
      };
      run.progress.push({ at: completedAt, type: status, summary: run.result.summary });
      appendEvent({
        invocationId: null,
        type: `application_install_${status}`,
        level: status === "succeeded" ? "info" : "warn",
        message: run.result.summary,
        data: { runId: run.id, planId: run.planId, deviceId: run.deviceId, classification: run.result.classification, exitCode: run.result.exitCode },
      });
      return run;
    });
  }

  return {
    cancelApplicationInstall,
    completeApplicationInstall,
    findApplicationInstallRun,
    nextBridgeApplicationInstall,
    queueApplicationInstall,
    recordApplicationInstallProgress,
  };
}
