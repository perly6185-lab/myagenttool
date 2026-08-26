import { createHash, randomBytes } from "node:crypto";
import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const SCENARIOS = new Set(["first_setup", "content_maintenance", "status_understanding"]);
const MILESTONES = new Set([
  "site_created",
  "content_saved",
  "preview_opened",
  "publication_reviewed",
  "published",
  "go_live_handoff_opened",
  "go_live_handoff_completed",
  "professional_setup_opened",
]);
const STATUS_ANSWERS = new Set(["private", "local", "public", "unsure"]);
const DEFAULT_QUOTAS = Object.freeze({ first_setup: 5, content_maintenance: 5, status_understanding: 5 });
const DEFAULT_THRESHOLDS = Object.freeze({ setupCompletion: 0.8, independentMaintenance: 0.8, statusUnderstanding: 0.8 });
const STATUS_FIXTURES = Object.freeze(["local", "private", "public"]);
const DEFAULT_SANDBOX_TTL_MS = 72 * 60 * 60_000;

function metric(numerator, denominator) {
  return { numerator, denominator, rate: denominator ? numerator / denominator : null };
}

function visibleSession(session) {
  return {
    id: session.id,
    scenario: session.scenario,
    status: session.status,
    milestones: session.milestones,
    outcome: session.outcome,
    revision: session.revision,
    startedAt: session.startedAt,
    completedAt: session.completedAt ?? null,
    abandonedAt: session.abandonedAt ?? null,
  };
}

function normalizedQuotas(value, current = DEFAULT_QUOTAS) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : current;
  const quotas = {};
  for (const scenario of SCENARIOS) {
    const next = Number(source[scenario] ?? current[scenario]);
    if (!Number.isInteger(next) || next < 1 || next > 100) return null;
    quotas[scenario] = next;
  }
  return quotas;
}

function normalizedThresholds(value, current = DEFAULT_THRESHOLDS) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : current;
  const thresholds = {};
  for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
    const next = Number(source[key] ?? current[key]);
    if (!Number.isFinite(next) || next < 0 || next > 1) return null;
    thresholds[key] = next;
  }
  return thresholds;
}

function summaryFor(sessions) {
  const ended = sessions.filter((session) => session.status !== "active");
  const setup = ended.filter((session) => session.scenario === "first_setup");
  const maintenance = ended.filter((session) => session.scenario === "content_maintenance");
  const understanding = ended.filter((session) => session.scenario === "status_understanding");
  return {
    sampleCount: sessions.length,
    activeCount: sessions.filter((session) => session.status === "active").length,
    completedCount: sessions.filter((session) => session.status === "completed").length,
    abandonedCount: sessions.filter((session) => session.status === "abandoned").length,
    metrics: {
      setupCompletion: metric(setup.filter((session) => session.milestones.some((item) => item.key === "site_created")).length, setup.length),
      independentMaintenance: metric(maintenance.filter((session) => session.milestones.some((item) => item.key === "content_saved") && session.outcome?.taskCompleted === true && session.outcome?.independent === true).length, maintenance.length),
      statusUnderstanding: metric(understanding.filter((session) => session.outcome?.statusCorrect === true).length, understanding.length),
    },
    privacy: { contentCollected: false, credentialsCollected: false, freeTextCollected: false, participantIdentityCollected: false },
  };
}

function campaignProgress(campaign, sessions) {
  const summary = summaryFor(sessions);
  const mapping = {
    setupCompletion: "first_setup",
    independentMaintenance: "content_maintenance",
    statusUnderstanding: "status_understanding",
  };
  const readiness = Object.fromEntries(Object.entries(mapping).map(([metricKey, scenario]) => {
    const item = summary.metrics[metricKey];
    const sampleReady = item.denominator >= campaign.quotas[scenario];
    return [metricKey, { sampleReady, thresholdMet: sampleReady && item.rate != null ? item.rate >= campaign.thresholds[metricKey] : null }];
  }));
  const allReady = Object.values(readiness).every((item) => item.sampleReady);
  const allMet = allReady && Object.values(readiness).every((item) => item.thresholdMet === true);
  return { summary, readiness, decision: !allReady ? "collecting" : allMet ? "meets_thresholds" : "needs_improvement" };
}

function invitationCounts(invitations) {
  const empty = () => ({ generated: 0, available: 0, active: 0, completed: 0, abandoned: 0, expired: 0 });
  const byScenario = { first_setup: empty(), content_maintenance: empty(), status_understanding: empty() };
  for (const invitation of invitations) {
    const counts = byScenario[invitation.scenario];
    if (!counts) continue;
    counts.generated += 1;
    if (Object.hasOwn(counts, invitation.status)) counts[invitation.status] += 1;
  }
  return byScenario;
}

function visibleCampaign(campaign, sessions, invitations = []) {
  const { ownerTeamId: _ownerTeamId, ...visible } = campaign;
  return { ...visible, ...campaignProgress(campaign, sessions), invitationCounts: invitationCounts(invitations) };
}

function invitationCodeHash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function visibleInvitation(invitation, sandbox = null, inviteCode = null) {
  const {
    ownerTeamId: _ownerTeamId,
    sandboxId: _sandboxId,
    inviteCode: legacyInviteCode,
    inviteCodeHash: _inviteCodeHash,
    ...visible
  } = invitation;
  return {
    ...visible,
    ...(inviteCode || legacyInviteCode ? { inviteCode: inviteCode ?? legacyInviteCode } : {}),
    workspace: sandbox ? { isolated: true, expiresAt: sandbox.expiresAt, status: sandbox.status } : null,
  };
}

export function createSitePilotService({
  state,
  now,
  nextId,
  persistStateSoon = () => {},
  store,
  createInviteCode = () => randomBytes(12).toString("base64url"),
  sandboxTtlMs = DEFAULT_SANDBOX_TTL_MS,
  provisionSandbox = async () => ({ ok: true, status: 200, body: { site: null } }),
  purgeSandbox = () => ({ ok: true, status: 200, body: { deleted: true } }),
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  state.sitePilotSessions ??= [];
  state.sitePilotCampaigns ??= [];
  state.sitePilotInvitations ??= [];
  state.sitePilotSandboxes ??= [];
  state.sites ??= [];
  const teamOf = (actor) => actor?.teamId ?? LOCAL_TEAM_ID;
  const legacyIdentitySessions = state.sitePilotSessions.filter((session) => Object.hasOwn(session, "createdBy"));
  if (legacyIdentitySessions.length) runTx(() => legacyIdentitySessions.forEach((session) => { delete session.createdBy; }));

  function findSession(sessionId, actor) {
    return state.sitePilotSessions.find((session) => session.id === String(sessionId) && session.ownerTeamId === teamOf(actor)) ?? null;
  }

  function actorForSandbox(actor, sandbox) {
    return {
      ...actor,
      userId: "pilot-participant",
      teamId: sandbox.sandboxTeamId,
      role: "member",
      pilotSandboxId: sandbox.id,
      pilotScenario: sandbox.scenario,
    };
  }

  function sandboxForInvitation(invitation) {
    return invitation?.sandboxId
      ? state.sitePilotSandboxes.find((sandbox) => sandbox.id === invitation.sandboxId && sandbox.invitationId === invitation.id) ?? null
      : null;
  }

  function invitationForCode(code, actor) {
    const normalizedCode = String(code ?? "").trim();
    if (!normalizedCode) return null;
    const digest = invitationCodeHash(normalizedCode);
    return state.sitePilotInvitations.find((candidate) => candidate.ownerTeamId === teamOf(actor)
      && (candidate.inviteCodeHash === digest || candidate.inviteCode === normalizedCode)) ?? null;
  }

  function fixtureFor(campaignId, scenario) {
    if (scenario !== "status_understanding") return scenario === "content_maintenance" ? "maintenance" : "blank";
    const index = state.sitePilotInvitations.filter((invitation) => invitation.campaignId === campaignId && invitation.scenario === scenario).length;
    return STATUS_FIXTURES[index % STATUS_FIXTURES.length];
  }

  function purgeSandboxData(sandbox) {
    if (!sandbox) return;
    purgeSandbox(actorForSandbox(null, sandbox));
  }

  function expireSandbox(sandbox) {
    purgeSandboxData(sandbox);
    const timestamp = now();
    runTx(() => {
      const invitation = state.sitePilotInvitations.find((candidate) => candidate.id === sandbox.invitationId) ?? null;
      const session = invitation?.sessionId ? state.sitePilotSessions.find((candidate) => candidate.id === invitation.sessionId) ?? null : null;
      if (session?.status === "active") Object.assign(session, { status: "abandoned", abandonedAt: timestamp, updatedAt: timestamp, revision: session.revision + 1 });
      if (invitation?.status === "active") Object.assign(invitation, { status: "abandoned", finishedAt: timestamp, updatedAt: timestamp, revision: invitation.revision + 1 });
      else if (invitation?.status === "available") Object.assign(invitation, { status: "expired", finishedAt: timestamp, updatedAt: timestamp, revision: invitation.revision + 1 });
      state.sitePilotSandboxes = state.sitePilotSandboxes.filter((candidate) => candidate.id !== sandbox.id);
    });
  }

  function sweepExpiredSandboxes() {
    const timestamp = now();
    const expired = state.sitePilotSandboxes.filter((sandbox) => Date.parse(sandbox.expiresAt) <= Date.parse(timestamp));
    if (!expired.length) return 0;
    expired.forEach(purgeSandboxData);
    const ids = new Set(expired.map((sandbox) => sandbox.id));
    const invitationIds = new Set(expired.map((sandbox) => sandbox.invitationId));
    runTx(() => {
      for (const invitation of state.sitePilotInvitations.filter((candidate) => invitationIds.has(candidate.id))) {
        const session = invitation.sessionId ? state.sitePilotSessions.find((candidate) => candidate.id === invitation.sessionId) ?? null : null;
        if (session?.status === "active") Object.assign(session, { status: "abandoned", abandonedAt: timestamp, updatedAt: timestamp, revision: session.revision + 1 });
        if (invitation.status === "active") Object.assign(invitation, { status: "abandoned", finishedAt: timestamp, updatedAt: timestamp, revision: invitation.revision + 1 });
        else if (invitation.status === "available") Object.assign(invitation, { status: "expired", finishedAt: timestamp, updatedAt: timestamp, revision: invitation.revision + 1 });
      }
      state.sitePilotSandboxes = state.sitePilotSandboxes.filter((sandbox) => !ids.has(sandbox.id));
    });
    return expired.length;
  }

  async function resolveWorkspace({ invitationCode }, actor) {
    const normalizedCode = String(invitationCode ?? "").trim();
    const invitation = invitationForCode(normalizedCode, actor);
    if (!invitation) return { ok: false, status: 404, body: { error: "site_pilot_invitation_not_found" } };
    const campaign = state.sitePilotCampaigns.find((candidate) => candidate.id === invitation.campaignId && candidate.ownerTeamId === invitation.ownerTeamId) ?? null;
    if (!campaign) return { ok: false, status: 404, body: { error: "site_pilot_campaign_not_found" } };
    if (campaign.status !== "active") return { ok: false, status: 409, body: { error: "site_pilot_campaign_closed" } };
    const sandbox = sandboxForInvitation(invitation);
    if (!sandbox) return { ok: false, status: 409, body: { error: "site_pilot_sandbox_not_found" } };
    if (Date.parse(sandbox.expiresAt) <= Date.parse(now())) {
      expireSandbox(sandbox);
      return { ok: false, status: 410, body: { error: "site_pilot_sandbox_expired" } };
    }
    const sandboxActor = actorForSandbox(actor, sandbox);
    if (sandbox.status === "unprovisioned") {
      const provisioned = await provisionSandbox({ scenario: sandbox.scenario, fixtureStatus: sandbox.fixtureStatus }, sandboxActor);
      if (!provisioned?.ok) return provisioned;
      const timestamp = now();
      runTx(() => Object.assign(sandbox, {
        status: "ready",
        siteId: provisioned.body?.site?.id ?? null,
        provisionedAt: timestamp,
        updatedAt: timestamp,
      }));
    }
    return {
      ok: true,
      status: 200,
      body: {
        actor: sandboxActor,
        workspace: { isolated: true, expiresAt: sandbox.expiresAt, status: sandbox.status },
      },
    };
  }

  function startSession({ scenario, consent, campaignCode }, actor) {
    if (consent !== true) return { ok: false, status: 400, body: { error: "site_pilot_consent_required" } };
    if (!SCENARIOS.has(scenario)) return { ok: false, status: 400, body: { error: "site_pilot_scenario_invalid" } };
    const normalizedCampaignCode = String(campaignCode ?? "").trim();
    const invitation = invitationForCode(normalizedCampaignCode, actor);
    const campaign = invitation
      ? state.sitePilotCampaigns.find((candidate) => candidate.id === invitation.campaignId && candidate.ownerTeamId === teamOf(actor)) ?? null
      : normalizedCampaignCode
        ? state.sitePilotCampaigns.find((candidate) => candidate.ownerTeamId === teamOf(actor) && candidate.inviteCode === normalizedCampaignCode) ?? null
        : null;
    if (normalizedCampaignCode && !campaign) return { ok: false, status: 404, body: { error: "site_pilot_invitation_not_found" } };
    if (campaign && campaign.status !== "active") return { ok: false, status: 409, body: { error: "site_pilot_campaign_closed" } };
    if (invitation?.scenario !== undefined && invitation.scenario !== scenario) return { ok: false, status: 400, body: { error: "site_pilot_invitation_scenario_mismatch" } };
    if (invitation?.status === "expired") return { ok: false, status: 410, body: { error: "site_pilot_sandbox_expired" } };
    if (invitation && invitation.status !== "available") return { ok: false, status: 409, body: { error: "site_pilot_invitation_used" } };
    const invitationSandbox = sandboxForInvitation(invitation);
    if (invitation && !invitationSandbox) return { ok: false, status: 410, body: { error: "site_pilot_sandbox_expired" } };
    if (invitationSandbox && Date.parse(invitationSandbox.expiresAt) <= Date.parse(now())) {
      expireSandbox(invitationSandbox);
      return { ok: false, status: 410, body: { error: "site_pilot_sandbox_expired" } };
    }
    const active = !invitation ? state.sitePilotSessions.find((session) => session.ownerTeamId === teamOf(actor) && session.status === "active" && !session.invitationId) : null;
    if (active) return { ok: false, status: 409, body: { error: "site_pilot_session_active", session: visibleSession(active) } };
    const timestamp = now();
    const session = {
      id: nextId("sps"),
      ownerTeamId: teamOf(actor),
      campaignId: campaign?.id ?? null,
      invitationId: invitation?.id ?? null,
      scenario,
      status: "active",
      consentedAt: timestamp,
      milestones: [],
      outcome: null,
      revision: 1,
      startedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    runTx(() => {
      state.sitePilotSessions.push(session);
      if (invitation) Object.assign(invitation, { status: "active", sessionId: session.id, startedAt: timestamp, updatedAt: timestamp, revision: invitation.revision + 1 });
    });
    return { ok: true, status: 201, body: { session: visibleSession(session) } };
  }

  function getActiveSession({ invitationCode } = {}, actor) {
    const normalizedCode = String(invitationCode ?? "").trim();
    const invitation = invitationForCode(normalizedCode, actor);
    const session = invitation
      ? state.sitePilotSessions.find((candidate) => candidate.id === invitation.sessionId && candidate.ownerTeamId === teamOf(actor) && candidate.status === "active") ?? null
      : state.sitePilotSessions.find((candidate) => candidate.ownerTeamId === teamOf(actor) && candidate.status === "active" && !candidate.invitationId) ?? null;
    const sandbox = sandboxForInvitation(invitation);
    return { ok: true, status: 200, body: {
      session: session ? visibleSession(session) : null,
      invitationStatus: invitation?.status ?? null,
      assignedScenario: invitation?.scenario ?? null,
      workspace: sandbox ? { isolated: true, expiresAt: sandbox.expiresAt, status: sandbox.status } : null,
    } };
  }

  function updateSession({ sessionId, expectedRevision, milestone, action, outcome }, actor) {
    const session = findSession(sessionId, actor);
    if (!session) return { ok: false, status: 404, body: { error: "site_pilot_session_not_found" } };
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required", currentRevision: session.revision } };
    if (session.revision !== expectedRevision) return { ok: false, status: 409, body: { error: "site_pilot_revision_conflict", currentRevision: session.revision } };
    if (session.status !== "active") return { ok: false, status: 409, body: { error: "site_pilot_session_finished" } };
    const timestamp = now();
    const invitation = session.invitationId ? state.sitePilotInvitations.find((candidate) => candidate.id === session.invitationId && candidate.ownerTeamId === session.ownerTeamId) ?? null : null;
    const invitationSandbox = sandboxForInvitation(invitation);
    if (invitation?.sandboxId && !invitationSandbox) return { ok: false, status: 410, body: { error: "site_pilot_sandbox_expired" } };
    if (invitationSandbox && Date.parse(invitationSandbox.expiresAt) <= Date.parse(now())) {
      expireSandbox(invitationSandbox);
      return { ok: false, status: 410, body: { error: "site_pilot_sandbox_expired" } };
    }

    if (milestone !== undefined) {
      if (!MILESTONES.has(milestone)) return { ok: false, status: 400, body: { error: "site_pilot_milestone_invalid" } };
      if (session.milestones.some((item) => item.key === milestone)) return { ok: true, status: 200, body: { session: visibleSession(session) } };
      runTx(() => {
        session.milestones.push({ key: milestone, at: timestamp });
        session.revision += 1;
        session.updatedAt = timestamp;
      });
      return { ok: true, status: 200, body: { session: visibleSession(session) } };
    }

    if (action === "abandon") {
      runTx(() => {
        Object.assign(session, { status: "abandoned", abandonedAt: timestamp, updatedAt: timestamp, revision: session.revision + 1 });
        if (invitation) Object.assign(invitation, { status: "abandoned", finishedAt: timestamp, updatedAt: timestamp, revision: invitation.revision + 1 });
      });
      return { ok: true, status: 200, body: { session: visibleSession(session) } };
    }

    if (action !== "complete" || !outcome || typeof outcome !== "object" || Array.isArray(outcome)) {
      return { ok: false, status: 400, body: { error: "site_pilot_update_invalid" } };
    }
    const easeRating = Number(outcome.easeRating);
    if (!Number.isInteger(easeRating) || easeRating < 1 || easeRating > 5) {
      return { ok: false, status: 400, body: { error: "site_pilot_ease_rating_invalid" } };
    }
    if (session.scenario !== "status_understanding" && typeof outcome.taskCompleted !== "boolean") {
      return { ok: false, status: 400, body: { error: "site_pilot_task_outcome_required" } };
    }
    if (session.scenario === "content_maintenance" && typeof outcome.independent !== "boolean") {
      return { ok: false, status: 400, body: { error: "site_pilot_independence_required" } };
    }
    if (session.scenario === "status_understanding" && !STATUS_ANSWERS.has(outcome.statusAnswer)) {
      return { ok: false, status: 400, body: { error: "site_pilot_status_answer_required" } };
    }
    const sandbox = sandboxForInvitation(invitation);
    const site = state.sites.find((candidate) => candidate.ownerTeamId === (sandbox?.sandboxTeamId ?? teamOf(actor))) ?? null;
    const expectedStatus = sandbox?.scenario === "status_understanding" && STATUS_ANSWERS.has(sandbox.fixtureStatus)
      ? sandbox.fixtureStatus
      : site?.visibility === "public" && site.publicUrl
        ? "public"
        : site?.activePublicationId
          ? "local"
          : "private";
    const normalizedOutcome = {
      taskCompleted: session.scenario === "status_understanding" ? null : outcome.taskCompleted,
      independent: session.scenario === "content_maintenance" ? outcome.independent : null,
      statusAnswer: session.scenario === "status_understanding" ? outcome.statusAnswer : null,
      statusCorrect: session.scenario === "status_understanding" ? outcome.statusAnswer === expectedStatus : null,
      easeRating,
    };
    runTx(() => {
      Object.assign(session, {
        status: "completed",
        outcome: normalizedOutcome,
        completedAt: timestamp,
        updatedAt: timestamp,
        revision: session.revision + 1,
      });
      if (invitation) Object.assign(invitation, { status: "completed", finishedAt: timestamp, updatedAt: timestamp, revision: invitation.revision + 1 });
    });
    return { ok: true, status: 200, body: { session: visibleSession(session) } };
  }

  function deleteSession({ sessionId }, actor) {
    const index = state.sitePilotSessions.findIndex((session) => session.id === String(sessionId) && session.ownerTeamId === teamOf(actor));
    if (index < 0) return { ok: false, status: 404, body: { error: "site_pilot_session_not_found" } };
    const invitationId = state.sitePilotSessions[index].invitationId;
    const invitation = invitationId ? state.sitePilotInvitations.find((candidate) => candidate.id === invitationId) ?? null : null;
    const sandbox = sandboxForInvitation(invitation);
    purgeSandboxData(sandbox);
    runTx(() => {
      state.sitePilotSessions.splice(index, 1);
      if (invitationId) state.sitePilotInvitations = state.sitePilotInvitations.filter((invitation) => !(invitation.id === invitationId && invitation.ownerTeamId === teamOf(actor)));
      if (sandbox) state.sitePilotSandboxes = state.sitePilotSandboxes.filter((candidate) => candidate.id !== sandbox.id);
    });
    return { ok: true, status: 200, body: { deleted: true, sessionId: String(sessionId) } };
  }

  function getSummary(actor) {
    sweepExpiredSandboxes();
    const sessions = state.sitePilotSessions.filter((session) => session.ownerTeamId === teamOf(actor));
    return {
      ok: true,
      status: 200,
      body: { summary: summaryFor(sessions) },
    };
  }

  function listCampaigns(actor) {
    sweepExpiredSandboxes();
    const teamId = teamOf(actor);
    const campaigns = state.sitePilotCampaigns.filter((campaign) => campaign.ownerTeamId === teamId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((campaign) => visibleCampaign(
        campaign,
        state.sitePilotSessions.filter((session) => session.ownerTeamId === teamId && session.campaignId === campaign.id),
        state.sitePilotInvitations.filter((invitation) => invitation.ownerTeamId === teamId && invitation.campaignId === campaign.id),
      ));
    return { ok: true, status: 200, body: { campaigns, count: campaigns.length } };
  }

  function createCampaign({ label, quotas, thresholds } = {}, actor) {
    const teamId = teamOf(actor);
    if (state.sitePilotCampaigns.some((campaign) => campaign.ownerTeamId === teamId && campaign.status === "active")) {
      return { ok: false, status: 409, body: { error: "site_pilot_campaign_active" } };
    }
    const normalizedLabel = String(label ?? "").trim();
    if (normalizedLabel.length > 80) return { ok: false, status: 400, body: { error: "site_pilot_campaign_label_invalid" } };
    const nextQuotas = normalizedQuotas(quotas);
    const nextThresholds = normalizedThresholds(thresholds);
    if (!nextQuotas || !nextThresholds) return { ok: false, status: 400, body: { error: "site_pilot_campaign_targets_invalid" } };
    const timestamp = now();
    const campaign = {
      id: nextId("spc"),
      ownerTeamId: teamId,
      label: normalizedLabel || `Pilot ${timestamp.slice(0, 10)}`,
      status: "active",
      inviteCode: createInviteCode(),
      quotas: nextQuotas,
      thresholds: nextThresholds,
      revision: 1,
      createdAt: timestamp,
      activatedAt: timestamp,
      updatedAt: timestamp,
      closedAt: null,
    };
    runTx(() => state.sitePilotCampaigns.push(campaign));
    return { ok: true, status: 201, body: { campaign: visibleCampaign(campaign, [], []) } };
  }

  function updateCampaign({ campaignId, expectedRevision, action, label, quotas, thresholds }, actor) {
    const campaign = state.sitePilotCampaigns.find((candidate) => candidate.id === String(campaignId) && candidate.ownerTeamId === teamOf(actor));
    if (!campaign) return { ok: false, status: 404, body: { error: "site_pilot_campaign_not_found" } };
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required", currentRevision: campaign.revision } };
    if (campaign.revision !== expectedRevision) return { ok: false, status: 409, body: { error: "site_pilot_campaign_revision_conflict", currentRevision: campaign.revision } };
    const timestamp = now();
    if (action === "close") {
      if (campaign.status !== "active") return { ok: false, status: 409, body: { error: "site_pilot_campaign_closed" } };
      runTx(() => Object.assign(campaign, { status: "closed", closedAt: timestamp, updatedAt: timestamp, revision: campaign.revision + 1 }));
    } else {
      const normalizedLabel = label === undefined ? campaign.label : String(label).trim();
      const nextQuotas = normalizedQuotas(quotas, campaign.quotas);
      const nextThresholds = normalizedThresholds(thresholds, campaign.thresholds);
      if (!normalizedLabel || normalizedLabel.length > 80 || !nextQuotas || !nextThresholds) {
        return { ok: false, status: 400, body: { error: "site_pilot_campaign_targets_invalid" } };
      }
      runTx(() => Object.assign(campaign, { label: normalizedLabel, quotas: nextQuotas, thresholds: nextThresholds, updatedAt: timestamp, revision: campaign.revision + 1 }));
    }
    const sessions = state.sitePilotSessions.filter((session) => session.ownerTeamId === campaign.ownerTeamId && session.campaignId === campaign.id);
    const invitations = state.sitePilotInvitations.filter((invitation) => invitation.ownerTeamId === campaign.ownerTeamId && invitation.campaignId === campaign.id);
    return { ok: true, status: 200, body: { campaign: visibleCampaign(campaign, sessions, invitations) } };
  }

  function createInvitation({ campaignId, scenario }, actor) {
    sweepExpiredSandboxes();
    const campaign = state.sitePilotCampaigns.find((candidate) => candidate.id === String(campaignId) && candidate.ownerTeamId === teamOf(actor));
    if (!campaign) return { ok: false, status: 404, body: { error: "site_pilot_campaign_not_found" } };
    if (campaign.status !== "active") return { ok: false, status: 409, body: { error: "site_pilot_campaign_closed" } };
    if (!SCENARIOS.has(scenario)) return { ok: false, status: 400, body: { error: "site_pilot_scenario_invalid" } };
    const timestamp = now();
    const sandboxId = nextId("spsb");
    const inviteCode = createInviteCode();
    const invitation = {
      id: nextId("spi"),
      ownerTeamId: teamOf(actor),
      campaignId: campaign.id,
      scenario,
      inviteCodeHash: invitationCodeHash(inviteCode),
      sandboxId,
      status: "available",
      sessionId: null,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
    };
    const sandbox = {
      id: sandboxId,
      ownerTeamId: teamOf(actor),
      campaignId: campaign.id,
      invitationId: invitation.id,
      sandboxTeamId: `pilot_sandbox_${sandboxId}`,
      scenario,
      fixtureStatus: fixtureFor(campaign.id, scenario),
      status: "unprovisioned",
      siteId: null,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      provisionedAt: null,
      expiresAt: new Date(Date.parse(timestamp) + sandboxTtlMs).toISOString(),
    };
    runTx(() => {
      state.sitePilotInvitations.push(invitation);
      state.sitePilotSandboxes.push(sandbox);
    });
    return { ok: true, status: 201, body: { invitation: visibleInvitation(invitation, sandbox, inviteCode) } };
  }

  function deleteCampaign({ campaignId }, actor) {
    const index = state.sitePilotCampaigns.findIndex((campaign) => campaign.id === String(campaignId) && campaign.ownerTeamId === teamOf(actor));
    if (index < 0) return { ok: false, status: 404, body: { error: "site_pilot_campaign_not_found" } };
    const campaign = state.sitePilotCampaigns[index];
    const sandboxes = state.sitePilotSandboxes.filter((sandbox) => sandbox.ownerTeamId === campaign.ownerTeamId && sandbox.campaignId === campaign.id);
    sandboxes.forEach(purgeSandboxData);
    runTx(() => {
      state.sitePilotCampaigns.splice(index, 1);
      state.sitePilotSessions = state.sitePilotSessions.filter((session) => !(session.ownerTeamId === campaign.ownerTeamId && session.campaignId === campaign.id));
      state.sitePilotInvitations = state.sitePilotInvitations.filter((invitation) => !(invitation.ownerTeamId === campaign.ownerTeamId && invitation.campaignId === campaign.id));
      state.sitePilotSandboxes = state.sitePilotSandboxes.filter((sandbox) => !(sandbox.ownerTeamId === campaign.ownerTeamId && sandbox.campaignId === campaign.id));
    });
    return { ok: true, status: 200, body: { deleted: true, campaignId: campaign.id } };
  }

  return { startSession, getActiveSession, updateSession, deleteSession, getSummary, listCampaigns, createCampaign, updateCampaign, deleteCampaign, createInvitation, resolveWorkspace };
}
