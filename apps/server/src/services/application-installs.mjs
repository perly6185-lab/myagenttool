import { applicationInstallPlanMatchesCurrent } from "./application-install-plans.mjs";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "timed_out", "refused"]);

function bounded(value, max = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export function createApplicationInstallService({ state, now, nextId, appendEvent, persistStateSoon, validateApprovalToken }) {
  function findApplicationInstallRun(id) {
    return (state.applicationInstallRuns ?? []).find((item) => item.id === id) ?? null;
  }

  function queueApplicationInstall({ plan, approvalToken }, { actor, device, projectId = null }) {
    if (!applicationInstallPlanMatchesCurrent(plan, { device, projectId })) {
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
      progress: [{ at: createdAt, type: "queued", summary: "Approved Application installation queued for Desktop Bridge." }],
      createdAt,
      updatedAt: createdAt,
    };
    state.applicationInstallRuns.unshift(run);
    state.applicationInstallRuns = state.applicationInstallRuns.slice(0, 100);
    appendEvent({
      invocationId: null,
      type: "application_install_queued",
      level: "info",
      message: "Approved Application installation queued for Desktop Bridge.",
      data: { runId: run.id, planId: run.planId, deviceId: run.deviceId, application: run.plan.application.name },
    });
    persistStateSoon();
    return run;
  }

  function nextBridgeApplicationInstall(deviceId) {
    const run = (state.applicationInstallRuns ?? []).find((item) => item.status === "queued" && item.deviceId === deviceId) ?? null;
    if (!run) return null;
    run.status = "running";
    run.startedAt = now();
    run.updatedAt = run.startedAt;
    run.progress.push({ at: run.startedAt, type: "started", summary: "Desktop Bridge accepted the approved installation plan." });
    persistStateSoon();
    return run;
  }

  function cancelApplicationInstall(run, actor = null) {
    if (!run || TERMINAL_STATUSES.has(run.status)) return run;
    const at = now();
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
    persistStateSoon();
    return run;
  }

  function recordApplicationInstallProgress(run, { type = "progress", summary = "Installation progress updated." } = {}) {
    if (!run || !["running", "cancelling"].includes(run.status)) return run;
    const at = now();
    run.progress.push({ at, type: bounded(type, 40), summary: bounded(summary) });
    run.progress = run.progress.slice(-50);
    run.updatedAt = at;
    persistStateSoon();
    return run;
  }

  function completeApplicationInstall(run, body = {}) {
    if (!run || !["running", "cancelling"].includes(run.status)) {
      throw new Error("Application installation is not completable.");
    }
    const status = String(body.status ?? "failed");
    if (!TERMINAL_STATUSES.has(status)) {
      throw new Error(`Unsupported Application installation status: ${status}`);
    }
    const completedAt = now();
    run.status = status;
    run.completedAt = completedAt;
    run.updatedAt = completedAt;
    run.result = {
      status,
      classification: bounded(body.classification ?? status, 80),
      summary: bounded(body.summary ?? `Application installation ${status}.`),
      exitCode: Number.isInteger(body.exitCode) ? body.exitCode : null,
      durationMs: Number.isFinite(body.durationMs) ? Math.max(0, Number(body.durationMs)) : null,
    };
    run.progress.push({ at: completedAt, type: status, summary: run.result.summary });
    appendEvent({
      invocationId: null,
      type: `application_install_${status}`,
      level: status === "succeeded" ? "info" : "warn",
      message: run.result.summary,
      data: { runId: run.id, planId: run.planId, deviceId: run.deviceId, classification: run.result.classification, exitCode: run.result.exitCode },
    });
    persistStateSoon();
    return run;
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
