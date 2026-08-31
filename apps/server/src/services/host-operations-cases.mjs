import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { hostDiagnosticRunPlanForInput } from "./host-diagnostic-run.mjs";

const MAX_CASES_PER_USER_HOST = 30;
const MAX_TIMELINE_ITEMS = 20;
const ACTIVE_STATUSES = new Set(["checking", "diagnosed", "awaiting_confirmation", "changing"]);

export function createHostOperationsCaseService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon,
  runSshHostDiagnosticRun,
  store,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  state.hostOperationsCases ??= [];

  function listCases(target, actor) {
    const ownership = ownerKey(target, actor);
    return state.hostOperationsCases
      .filter((item) => owned(item, ownership))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, 20)
      .map(publicCase);
  }

  function findCase(target, caseId, actor) {
    const ownership = ownerKey(target, actor);
    const item = state.hostOperationsCases.find((candidate) => candidate.id === caseId && owned(candidate, ownership));
    return item ? publicCase(item) : null;
  }

  function syncRemediation(target, plan, actor) {
    const ownership = ownerKey(target, actor);
    const item = state.hostOperationsCases.find((candidate) => owned(candidate, ownership) && candidate.diagnosticRunId === plan?.diagnosticRunId);
    if (!item) return null;
    const mapped = remediationState(plan);
    runTx(() => {
      const changed = item.remediationPlanId !== plan.id || item.status !== mapped.status || item.deviceChanged !== mapped.deviceChanged;
      item.remediationPlanId = plan.id;
      item.status = mapped.status;
      item.nextStep = mapped.nextStep;
      item.deviceChanged = mapped.deviceChanged;
      item.updatedAt = now();
      if (changed) pushTimeline(item, { kind: mapped.timelineKind, at: item.updatedAt, deviceChanged: mapped.deviceChanged, remediationPlanId: plan.id });
    });
    return publicCase(item);
  }

  async function continueCase(target, body, actor) {
    const diagnosticPlan = hostDiagnosticRunPlanForInput(body?.input);
    if (!diagnosticPlan) return { ok: false, status: 422, error: "ssh_diagnostic_intent_unsupported" };
    const ownership = ownerKey(target, actor);
    const incident = resolveIncident(body?.incidentId, ownership);
    if (body?.incidentId && !incident) return { ok: false, status: 404, error: "host_health_incident_not_found" };
    const intentKey = stableIntentKey(diagnosticPlan);
    const targetRevision = Number(target.revision ?? 1);
    let item = findReusableCase(ownership, incident?.id ?? null, intentKey);

    if (item && item.targetRevision !== targetRevision) {
      runTx(() => {
        item.status = "needs_help";
        item.nextStep = "recheck_device_identity";
        item.updatedAt = now();
        pushTimeline(item, { kind: "device_changed", at: item.updatedAt, deviceChanged: false });
      });
      item = null;
    }

    if (item?.diagnosticRunId || item?.status === "checking") {
      return { ok: true, case: publicCase(item), run: latestRun(item), reused: true };
    }

    if (!item) {
      const timestamp = now();
      item = {
        id: nextId("hoc"),
        ...ownership,
        version: 1,
        incidentId: incident?.id ?? null,
        intent: diagnosticPlan.intent,
        intentKey,
        understanding: diagnosticPlan.understanding,
        status: "checking",
        nextStep: "wait_for_diagnosis",
        diagnosticRunId: null,
        remediationPlanId: null,
        targetRevision,
        deviceChanged: false,
        lastError: null,
        timeline: [{ kind: "case_opened", at: timestamp, deviceChanged: false }],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      runTx(() => {
        state.hostOperationsCases.push(item);
        trimOwnedCases(ownership);
        appendEvent({
          invocationId: null,
          type: "ssh.host_operations_case.opened",
          level: "info",
          message: "A host operations case started with a fixed read-only diagnosis.",
          data: { targetId: target.id, caseId: item.id, incidentId: item.incidentId, intent: item.intent, understanding: item.understanding },
        });
      });
    }

    const diagnosis = await runSshHostDiagnosticRun(target, body.input, actor);
    if (!diagnosis.ok) {
      runTx(() => {
        item.status = "needs_help";
        item.nextStep = nextStepForFailure(diagnosis.error);
        item.lastError = diagnosis.error;
        item.updatedAt = now();
        pushTimeline(item, { kind: "diagnosis_incomplete", at: item.updatedAt, deviceChanged: false, error: diagnosis.error });
      });
      return { ...diagnosis, case: publicCase(item) };
    }

    runTx(() => {
      item.status = "diagnosed";
      item.nextStep = nextStepForDiagnosis(diagnosis.run);
      item.diagnosticRunId = diagnosis.run.id;
      item.targetRevision = diagnosis.run.targetRevision;
      item.lastError = null;
      item.updatedAt = now();
      pushTimeline(item, {
        kind: "diagnosis_completed",
        at: item.updatedAt,
        deviceChanged: false,
        diagnosticRunId: diagnosis.run.id,
        severity: diagnosis.run.summary.severity,
      });
      appendEvent({
        invocationId: null,
        type: "ssh.host_operations_case.diagnosed",
        level: ["critical", "warning"].includes(diagnosis.run.summary.severity) ? "warning" : "info",
        message: "A host operations case completed its read-only diagnosis.",
        data: { targetId: target.id, caseId: item.id, diagnosticRunId: diagnosis.run.id, nextStep: item.nextStep, deviceChanged: false },
      });
    });
    return { ok: true, case: publicCase(item), run: diagnosis.run, reused: false };
  }

  function resolveIncident(incidentId, ownership) {
    if (!incidentId) return null;
    return (state.hostHealthIncidents ?? []).find((item) => item.id === String(incidentId) && owned(item, ownership)) ?? null;
  }

  function findReusableCase(ownership, incidentId, intentKey) {
    return state.hostOperationsCases
      .filter((item) => owned(item, ownership) && ACTIVE_STATUSES.has(item.status))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .find((item) => (incidentId && item.incidentId === incidentId) || item.intentKey === intentKey) ?? null;
  }

  function publicCase(item) {
    return {
      id: item.id,
      sshTargetId: item.sshTargetId,
      incidentId: item.incidentId,
      version: item.version,
      intent: item.intent,
      understanding: item.understanding,
      status: item.status,
      nextStep: item.nextStep,
      diagnosticRunId: item.diagnosticRunId,
      remediationPlanId: item.remediationPlanId,
      targetRevision: item.targetRevision,
      deviceChanged: item.deviceChanged === true,
      lastError: item.lastError,
      timeline: item.timeline.slice(-MAX_TIMELINE_ITEMS),
      latestRun: latestRun(item),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  function latestRun(item) {
    if (!item.diagnosticRunId) return null;
    return (state.hostDiagnosticRuns ?? []).find((run) => run.id === item.diagnosticRunId
      && run.ownerTeamId === item.ownerTeamId
      && run.createdByUserId === item.createdByUserId
      && run.sshTargetId === item.sshTargetId) ?? null;
  }

  function trimOwnedCases(ownership) {
    const finished = state.hostOperationsCases
      .filter((item) => owned(item, ownership) && !ACTIVE_STATUSES.has(item.status))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    const retired = new Set(finished.slice(MAX_CASES_PER_USER_HOST).map((item) => item.id));
    for (let index = state.hostOperationsCases.length - 1; index >= 0; index -= 1) {
      if (retired.has(state.hostOperationsCases[index].id)) state.hostOperationsCases.splice(index, 1);
    }
  }

  return { continueCase, findCase, listCases, syncRemediation };
}

function ownerKey(target, actor) {
  return {
    ownerTeamId: target.ownerTeamId ?? actor?.teamId ?? "team_local",
    createdByUserId: actor?.userId ?? target.createdByUserId ?? "usr_local",
    sshTargetId: target.id,
  };
}

function owned(item, ownership) {
  return item.ownerTeamId === ownership.ownerTeamId
    && item.createdByUserId === ownership.createdByUserId
    && item.sshTargetId === ownership.sshTargetId;
}

function stableIntentKey(plan) {
  const understanding = plan.understanding ?? {};
  return [
    plan.intent,
    understanding.goal,
    understanding.domain,
    understanding.symptom,
    understanding.desiredOutcome,
    understanding.requestedChange,
    understanding.handling,
  ].join(":");
}

function nextStepForDiagnosis(run) {
  const severity = run.summary?.severity;
  if (run.intent === "website" && ["critical", "warning", "unknown"].includes(severity)) return "check_managed_website";
  if (run.understanding?.requestedChange && run.understanding.requestedChange !== "none") return "review_supported_action";
  if (severity === "healthy") return "describe_remaining_symptom";
  if (severity === "unknown") return "review_incomplete_checks";
  return "review_findings";
}

function nextStepForFailure(error) {
  if (["ssh_authentication_failed", "ssh_credential_unavailable", "ssh_credential_invalid", "ssh_agent_unavailable"].includes(error)) return "update_sign_in";
  if (["ssh_host_fingerprint_required", "ssh_host_fingerprint_changed"].includes(error)) return "confirm_device_identity";
  if (["ssh_connection_failed", "ssh_connection_refused", "ssh_host_unreachable", "ssh_host_unresolvable", "ssh_connection_timeout"].includes(error)) return "restore_connection";
  return "try_another_check";
}

function remediationState(plan) {
  if (plan.status === "planned") return { status: "awaiting_confirmation", nextStep: "confirm_governed_action", deviceChanged: false, timelineKind: "remediation_planned" };
  if (plan.status === "running") return { status: "changing", nextStep: "wait_for_verification", deviceChanged: plan.result?.changeAttempted === true, timelineKind: "remediation_started" };
  if (["completed", "not_needed"].includes(plan.status) || plan.lastRecheckedHealth?.status === "healthy") {
    return { status: "recovered", nextStep: "case_complete", deviceChanged: plan.result?.changeAttempted === true, timelineKind: "remediation_completed" };
  }
  if (["completed_unresolved", "outcome_unknown"].includes(plan.status)) {
    return { status: "unresolved", nextStep: "recheck_outcome", deviceChanged: plan.result?.changeAttempted === true, timelineKind: "remediation_incomplete" };
  }
  return { status: "needs_help", nextStep: "review_manual_handoff", deviceChanged: plan.result?.changeAttempted === true, timelineKind: "remediation_incomplete" };
}

function pushTimeline(item, entry) {
  item.timeline ??= [];
  item.timeline.push(entry);
  if (item.timeline.length > MAX_TIMELINE_ITEMS) item.timeline.splice(0, item.timeline.length - MAX_TIMELINE_ITEMS);
}
