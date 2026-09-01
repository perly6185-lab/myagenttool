import { createHash, randomBytes } from "node:crypto";

import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { summarizeHostOperationsMetrics } from "./host-operations-metrics.mjs";

const TERMINAL_CASE_STATUSES = new Set(["recovered", "unresolved", "needs_help"]);

function teamOf(actor) {
  return actor?.teamId ?? LOCAL_TEAM_ID;
}

function userOf(actor) {
  return actor?.userId ?? "usr_local";
}

function average(values) {
  return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null;
}

function ratio(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

function timestampWithin(value, start, end = null) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) && time >= Date.parse(start) && (!end || time <= Date.parse(end));
}

function casesForSession(state, session) {
  return (state.hostOperationsCases ?? []).filter((item) => item.ownerTeamId === session.ownerTeamId
    && item.createdByUserId === session.createdByUserId
    && item.sshTargetId === session.sshTargetId
    && timestampWithin(item.createdAt, session.startedAt, session.completedAt ?? null));
}

function linkedCases(state, sessions) {
  const byId = new Map();
  for (const session of sessions) {
    for (const item of casesForSession(state, session)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

function linkedPlans(state, cases) {
  const runIds = new Set(cases.map((item) => item.diagnosticRunId).filter(Boolean));
  return (state.hostRemediationPlans ?? []).filter((item) => runIds.has(item.diagnosticRunId));
}

function bottlenecks(cases) {
  const counts = new Map();
  for (const item of cases.filter((candidate) => !TERMINAL_CASE_STATUSES.has(candidate.status))) {
    const key = item.nextStep ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([nextStep, count]) => ({ nextStep, count }))
    .sort((left, right) => right.count - left.count || left.nextStep.localeCompare(right.nextStep));
}

function summaryFor(state, sessions, generatedAt) {
  const cases = linkedCases(state, sessions);
  const plans = linkedPlans(state, cases);
  const completed = sessions.filter((item) => item.status === "completed");
  const clear = completed.filter((item) => item.outcome?.nextStepClear === true).length;
  const ratings = completed.map((item) => item.outcome?.easeRating).filter(Number.isFinite);
  return {
    version: 1,
    generatedAt,
    participation: {
      total: sessions.length,
      active: sessions.filter((item) => item.status === "active").length,
      completed: completed.length,
    },
    experience: {
      nextStepClear: { numerator: clear, denominator: completed.length, rate: ratio(clear, completed.length) },
      averageEaseRating: average(ratings),
    },
    operations: summarizeHostOperationsMetrics({ cases, remediationPlans: plans, generatedAt }),
    bottlenecks: bottlenecks(cases),
    privacy: {
      rawInputCollected: false,
      commandOutputCollected: false,
      addressCollected: false,
      credentialsCollected: false,
      freeTextCollected: false,
      participantIdentityExported: false,
    },
  };
}

function visibleSession(session, state) {
  const cases = casesForSession(state, session);
  const latestCase = cases.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0] ?? null;
  return {
    id: session.id,
    campaignId: session.campaignId,
    sshTargetId: session.sshTargetId,
    status: session.status,
    revision: session.revision,
    startedAt: session.startedAt,
    completedAt: session.completedAt ?? null,
    outcome: session.outcome ?? null,
    latestCase: latestCase ? {
      id: latestCase.id,
      status: latestCase.status,
      nextStep: latestCase.nextStep,
      updatedAt: latestCase.updatedAt,
    } : null,
  };
}

function visibleCampaign(campaign, state, generatedAt) {
  const sessions = (state.hostOperationsPilotSessions ?? []).filter((item) => item.ownerTeamId === campaign.ownerTeamId && item.campaignId === campaign.id);
  const { ownerTeamId: _ownerTeamId, ...visible } = campaign;
  return { ...visible, summary: summaryFor(state, sessions, generatedAt) };
}

function evidenceFor(campaign, state, generatedAt) {
  const sessions = (state.hostOperationsPilotSessions ?? []).filter((item) => item.ownerTeamId === campaign.ownerTeamId && item.campaignId === campaign.id);
  const cases = linkedCases(state, sessions);
  const pseudonym = (kind, value) => `${kind}_${createHash("sha256").update(`${campaign.id}:${value}`).digest("hex").slice(0, 12)}`;
  const payload = {
    schema: "myagenttool.host-operations-pilot-evidence.v1",
    generatedAt,
    campaign: {
      id: campaign.id,
      label: campaign.label,
      status: campaign.status,
      activatedAt: campaign.activatedAt,
      closedAt: campaign.closedAt,
    },
    summary: summaryFor(state, sessions, generatedAt),
    samples: cases.map((item) => ({
      caseRef: pseudonym("case", item.id),
      hostRef: pseudonym("hst", item.sshTargetId),
      intent: item.intent,
      status: item.status,
      nextStep: item.nextStep,
      deviceChanged: item.deviceChanged === true,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      timeline: (item.timeline ?? []).map((entry) => ({ kind: entry.kind, at: entry.at, deviceChanged: entry.deviceChanged === true })),
    })),
  };
  return { payload, sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
}

export function createHostOperationsPilotService({
  state,
  now,
  nextId,
  persistStateSoon = () => {},
  store,
  createInviteCode = () => randomBytes(12).toString("base64url"),
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  state.hostOperationsPilotCampaigns ??= [];
  state.hostOperationsPilotSessions ??= [];

  function listCampaigns(actor) {
    const campaigns = state.hostOperationsPilotCampaigns
      .filter((item) => item.ownerTeamId === teamOf(actor))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .map((item) => visibleCampaign(item, state, now()));
    return { ok: true, status: 200, body: { campaigns, count: campaigns.length } };
  }

  function createCampaign({ label } = {}, actor) {
    const teamId = teamOf(actor);
    if (state.hostOperationsPilotCampaigns.some((item) => item.ownerTeamId === teamId && item.status === "active")) {
      return { ok: false, status: 409, body: { error: "host_operations_pilot_campaign_active" } };
    }
    const normalizedLabel = String(label ?? "").trim();
    if (normalizedLabel.length > 80) return { ok: false, status: 400, body: { error: "host_operations_pilot_label_invalid" } };
    const timestamp = now();
    const campaign = {
      id: nextId("hopc"),
      ownerTeamId: teamId,
      label: normalizedLabel || `Operations pilot ${timestamp.slice(0, 10)}`,
      inviteCode: createInviteCode(),
      status: "active",
      revision: 1,
      createdAt: timestamp,
      activatedAt: timestamp,
      updatedAt: timestamp,
      closedAt: null,
    };
    runTx(() => state.hostOperationsPilotCampaigns.push(campaign));
    return { ok: true, status: 201, body: { campaign: visibleCampaign(campaign, state, now()) } };
  }

  function updateCampaign({ campaignId, expectedRevision, action }, actor) {
    const campaign = state.hostOperationsPilotCampaigns.find((item) => item.id === String(campaignId) && item.ownerTeamId === teamOf(actor));
    if (!campaign) return { ok: false, status: 404, body: { error: "host_operations_pilot_campaign_not_found" } };
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required", currentRevision: campaign.revision } };
    if (campaign.revision !== expectedRevision) return { ok: false, status: 409, body: { error: "host_operations_pilot_revision_conflict", currentRevision: campaign.revision } };
    if (action !== "close") return { ok: false, status: 400, body: { error: "host_operations_pilot_action_invalid" } };
    if (campaign.status !== "active") return { ok: false, status: 409, body: { error: "host_operations_pilot_campaign_closed" } };
    const timestamp = now();
    runTx(() => Object.assign(campaign, { status: "closed", closedAt: timestamp, updatedAt: timestamp, revision: campaign.revision + 1 }));
    return { ok: true, status: 200, body: { campaign: visibleCampaign(campaign, state, now()) } };
  }

  function activeSession({ inviteCode, sshTargetId } = {}, actor) {
    const code = String(inviteCode ?? "").trim();
    const campaign = code
      ? state.hostOperationsPilotCampaigns.find((item) => item.ownerTeamId === teamOf(actor) && item.inviteCode === code) ?? null
      : null;
    const session = state.hostOperationsPilotSessions
      .filter((item) => item.ownerTeamId === teamOf(actor)
        && item.createdByUserId === userOf(actor)
        && (!sshTargetId || item.sshTargetId === String(sshTargetId))
        && (campaign ? item.campaignId === campaign.id : item.status === "active"))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] ?? null;
    return { ok: true, status: 200, body: {
      campaign: campaign ? { id: campaign.id, label: campaign.label, status: campaign.status } : null,
      session: session ? visibleSession(session, state) : null,
    } };
  }

  function startSession({ inviteCode, sshTargetId, consent }, actor) {
    if (consent !== true) return { ok: false, status: 400, body: { error: "host_operations_pilot_consent_required" } };
    const campaign = state.hostOperationsPilotCampaigns.find((item) => item.ownerTeamId === teamOf(actor) && item.inviteCode === String(inviteCode ?? "").trim());
    if (!campaign) return { ok: false, status: 404, body: { error: "host_operations_pilot_campaign_not_found" } };
    if (campaign.status !== "active") return { ok: false, status: 409, body: { error: "host_operations_pilot_campaign_closed" } };
    const targetId = String(sshTargetId ?? "");
    const target = (state.sshTargets ?? []).find((item) => item.id === targetId && item.ownerTeamId === teamOf(actor)
      && (item.createdByUserId ?? userOf(actor)) === userOf(actor));
    if (!target) return { ok: false, status: 404, body: { error: "ssh_target_not_found" } };
    const existing = state.hostOperationsPilotSessions.find((item) => item.ownerTeamId === teamOf(actor) && item.createdByUserId === userOf(actor) && item.status === "active");
    if (existing) return { ok: false, status: 409, body: { error: "host_operations_pilot_session_active", session: visibleSession(existing, state) } };
    const alreadyCompleted = state.hostOperationsPilotSessions.find((item) => item.ownerTeamId === teamOf(actor)
      && item.createdByUserId === userOf(actor) && item.campaignId === campaign.id && item.sshTargetId === targetId && item.status === "completed");
    if (alreadyCompleted) return { ok: false, status: 409, body: { error: "host_operations_pilot_session_finished", session: visibleSession(alreadyCompleted, state) } };
    const timestamp = now();
    const session = {
      id: nextId("hops"),
      ownerTeamId: teamOf(actor),
      createdByUserId: userOf(actor),
      campaignId: campaign.id,
      sshTargetId: targetId,
      status: "active",
      revision: 1,
      outcome: null,
      consentedAt: timestamp,
      startedAt: timestamp,
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    runTx(() => state.hostOperationsPilotSessions.push(session));
    return { ok: true, status: 201, body: { session: visibleSession(session, state) } };
  }

  function completeSession({ sessionId, expectedRevision, caseId, nextStepClear, easeRating }, actor) {
    const session = state.hostOperationsPilotSessions.find((item) => item.id === String(sessionId)
      && item.ownerTeamId === teamOf(actor) && item.createdByUserId === userOf(actor));
    if (!session) return { ok: false, status: 404, body: { error: "host_operations_pilot_session_not_found" } };
    if (session.status !== "active") return { ok: false, status: 409, body: { error: "host_operations_pilot_session_finished" } };
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required", currentRevision: session.revision } };
    if (session.revision !== expectedRevision) return { ok: false, status: 409, body: { error: "host_operations_pilot_revision_conflict", currentRevision: session.revision } };
    if (typeof nextStepClear !== "boolean" || !Number.isInteger(easeRating) || easeRating < 1 || easeRating > 5) {
      return { ok: false, status: 400, body: { error: "host_operations_pilot_outcome_invalid" } };
    }
    const item = casesForSession(state, session).find((candidate) => candidate.id === String(caseId));
    if (!item) return { ok: false, status: 404, body: { error: "host_operations_pilot_case_not_found" } };
    if (!TERMINAL_CASE_STATUSES.has(item.status)) return { ok: false, status: 409, body: { error: "host_operations_pilot_case_active" } };
    const timestamp = now();
    runTx(() => Object.assign(session, {
      status: "completed",
      outcome: { caseId: item.id, nextStepClear, easeRating },
      completedAt: timestamp,
      updatedAt: timestamp,
      revision: session.revision + 1,
    }));
    return { ok: true, status: 200, body: { session: visibleSession(session, state) } };
  }

  function deleteSession({ sessionId }, actor) {
    const index = state.hostOperationsPilotSessions.findIndex((item) => item.id === String(sessionId)
      && item.ownerTeamId === teamOf(actor) && item.createdByUserId === userOf(actor));
    if (index < 0) return { ok: false, status: 404, body: { error: "host_operations_pilot_session_not_found" } };
    runTx(() => state.hostOperationsPilotSessions.splice(index, 1));
    return { ok: true, status: 200, body: { deleted: true, sessionId: String(sessionId) } };
  }

  function getEvidence({ campaignId }, actor) {
    const campaign = state.hostOperationsPilotCampaigns.find((item) => item.id === String(campaignId) && item.ownerTeamId === teamOf(actor));
    if (!campaign) return { ok: false, status: 404, body: { error: "host_operations_pilot_campaign_not_found" } };
    const evidence = evidenceFor(campaign, state, now());
    return { ok: true, status: 200, body: { evidence: evidence.payload, sha256: evidence.sha256 } };
  }

  return { listCampaigns, createCampaign, updateCampaign, activeSession, startSession, completeSession, deleteSession, getEvidence };
}

export { summaryFor as summarizeHostOperationsPilot };
