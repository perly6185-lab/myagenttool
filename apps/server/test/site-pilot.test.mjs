import assert from "node:assert/strict";
import { test } from "node:test";
import { createSitePilotService } from "../src/services/site-pilot.mjs";

const ACTOR_A = { userId: "usr_a", teamId: "team_a", role: "owner" };
const ACTOR_B = { userId: "usr_b", teamId: "team_b", role: "owner" };

function harness(overrides = {}) {
  let id = 0;
  let code = 0;
  let clock = Date.parse("2026-08-24T00:00:00.000Z");
  const state = { sites: [], sitePilotSessions: [] };
  const service = createSitePilotService({
    state,
    now: () => new Date(clock).toISOString(),
    nextId: (prefix) => `${prefix}_${++id}`,
    createInviteCode: () => `invite_${++code}`,
    ...overrides,
  });
  return { state, service, tick: () => { clock += 1000; }, advance: (milliseconds) => { clock += milliseconds; } };
}

test("site pilot requires explicit consent and stores only allowlisted fields", () => {
  const { state, service } = harness();
  assert.equal(service.startSession({ scenario: "first_setup", consent: false }, ACTOR_A).status, 400);
  const started = service.startSession({
    scenario: "first_setup",
    consent: true,
    pageBody: "must not be stored",
    accessKeySecret: "must not be stored",
    notes: "must not be stored",
  }, ACTOR_A);
  assert.equal(started.status, 201);
  assert.equal(JSON.stringify(state.sitePilotSessions).includes("must not be stored"), false);
  assert.deepEqual(Object.keys(started.body.session).sort(), [
    "abandonedAt", "completedAt", "id", "milestones", "outcome", "revision", "scenario", "startedAt", "status",
  ]);
});

test("site pilot sessions are team scoped, revision gated, and milestones are deduplicated", () => {
  const { service, tick } = harness();
  const session = service.startSession({ scenario: "first_setup", consent: true }, ACTOR_A).body.session;
  assert.equal(service.getActiveSession({}, ACTOR_B).body.session, null);
  assert.equal(service.updateSession({ sessionId: session.id, expectedRevision: 1, milestone: "site_created" }, ACTOR_B).status, 404);
  tick();
  const updated = service.updateSession({ sessionId: session.id, expectedRevision: 1, milestone: "site_created" }, ACTOR_A).body.session;
  assert.equal(updated.revision, 2);
  assert.equal(updated.milestones.length, 1);
  const duplicate = service.updateSession({ sessionId: session.id, expectedRevision: 2, milestone: "site_created" }, ACTOR_A).body.session;
  assert.equal(duplicate.revision, 2);
  assert.equal(duplicate.milestones.length, 1);
  assert.equal(service.updateSession({ sessionId: session.id, expectedRevision: 1, milestone: "preview_opened" }, ACTOR_A).status, 409);
});

test("site pilot computes status understanding from the team site state", () => {
  const { state, service } = harness();
  state.sites.push({ id: "sit_a", ownerTeamId: "team_a", visibility: "private_preview", activePublicationId: "spb_1", publicUrl: null });
  const session = service.startSession({ scenario: "status_understanding", consent: true }, ACTOR_A).body.session;
  const completed = service.updateSession({
    sessionId: session.id,
    expectedRevision: session.revision,
    action: "complete",
    outcome: { statusAnswer: "local", easeRating: 4, statusCorrect: false, notes: "ignored" },
  }, ACTOR_A);
  assert.equal(completed.status, 200);
  assert.equal(completed.body.session.outcome.statusCorrect, true);
  assert.equal(completed.body.session.outcome.statusAnswer, "local");
  assert.equal("notes" in completed.body.session.outcome, false);
});

test("site pilot summary reports explicit denominators and excludes active sessions", () => {
  const { service } = harness();
  const setup = service.startSession({ scenario: "first_setup", consent: true }, ACTOR_A).body.session;
  const setupMarked = service.updateSession({ sessionId: setup.id, expectedRevision: 1, milestone: "site_created" }, ACTOR_A).body.session;
  service.updateSession({ sessionId: setup.id, expectedRevision: setupMarked.revision, action: "complete", outcome: { taskCompleted: true, easeRating: 5 } }, ACTOR_A);

  const maintenance = service.startSession({ scenario: "content_maintenance", consent: true }, ACTOR_A).body.session;
  service.updateSession({ sessionId: maintenance.id, expectedRevision: 1, action: "complete", outcome: { taskCompleted: true, independent: false, easeRating: 3 } }, ACTOR_A);

  const independent = service.startSession({ scenario: "content_maintenance", consent: true }, ACTOR_A).body.session;
  const saved = service.updateSession({ sessionId: independent.id, expectedRevision: 1, milestone: "content_saved" }, ACTOR_A).body.session;
  service.updateSession({ sessionId: independent.id, expectedRevision: saved.revision, action: "complete", outcome: { taskCompleted: true, independent: true, easeRating: 4 } }, ACTOR_A);

  service.startSession({ scenario: "status_understanding", consent: true }, ACTOR_A);
  const summary = service.getSummary(ACTOR_A).body.summary;
  assert.deepEqual(summary.metrics.setupCompletion, { numerator: 1, denominator: 1, rate: 1 });
  assert.deepEqual(summary.metrics.independentMaintenance, { numerator: 1, denominator: 2, rate: 0.5 });
  assert.deepEqual(summary.metrics.statusUnderstanding, { numerator: 0, denominator: 0, rate: null });
  assert.equal(summary.activeCount, 1);
  assert.deepEqual(summary.privacy, { contentCollected: false, credentialsCollected: false, freeTextCollected: false, participantIdentityCollected: false });
});

test("a participant can withdraw and delete their pilot session", () => {
  const { state, service } = harness();
  const session = service.startSession({ scenario: "content_maintenance", consent: true }, ACTOR_A).body.session;
  assert.equal(service.deleteSession({ sessionId: session.id }, ACTOR_B).status, 404);
  assert.equal(service.deleteSession({ sessionId: session.id }, ACTOR_A).status, 200);
  assert.equal(state.sitePilotSessions.length, 0);
});

test("pilot campaigns issue anonymous task links and report quota readiness", () => {
  const { state, service } = harness();
  state.sites.push({ id: "sit_a", ownerTeamId: "team_a", visibility: "private_preview", activePublicationId: "spb_1", publicUrl: null });
  const created = service.createCampaign({
    label: "第一轮",
    quotas: { first_setup: 1, content_maintenance: 1, status_understanding: 1 },
    thresholds: { setupCompletion: 0.8, independentMaintenance: 0.8, statusUnderstanding: 0.8 },
  }, ACTOR_A);
  assert.equal(created.status, 201);
  assert.equal(created.body.campaign.inviteCode, "invite_1");
  assert.equal(service.listCampaigns(ACTOR_B).body.count, 0);
  assert.equal(service.createCampaign({}, ACTOR_A).status, 409);
  const setupInvite = service.createInvitation({ campaignId: created.body.campaign.id, scenario: "first_setup" }, ACTOR_A).body.invitation;
  const maintenanceInvite = service.createInvitation({ campaignId: created.body.campaign.id, scenario: "content_maintenance" }, ACTOR_A).body.invitation;
  const statusInvite = service.createInvitation({ campaignId: created.body.campaign.id, scenario: "status_understanding" }, ACTOR_A).body.invitation;
  assert.equal(JSON.stringify(state.sitePilotInvitations).includes(setupInvite.inviteCode), false);
  assert.equal(state.sitePilotInvitations.every((invitation) => /^[a-f0-9]{64}$/.test(invitation.inviteCodeHash)), true);
  assert.equal(service.startSession({ scenario: "first_setup", consent: true, campaignCode: setupInvite.inviteCode }, ACTOR_B).status, 404);

  const setup = service.startSession({ scenario: "first_setup", consent: true, campaignCode: setupInvite.inviteCode }, ACTOR_A).body.session;
  assert.equal(service.getActiveSession({ invitationCode: setupInvite.inviteCode }, ACTOR_A).body.session.id, setup.id);
  assert.equal(service.startSession({ scenario: "first_setup", consent: true, campaignCode: setupInvite.inviteCode }, ACTOR_A).status, 409);
  const setupSaved = service.updateSession({ sessionId: setup.id, expectedRevision: 1, milestone: "site_created" }, ACTOR_A).body.session;
  service.updateSession({ sessionId: setup.id, expectedRevision: setupSaved.revision, action: "complete", outcome: { taskCompleted: true, easeRating: 5 } }, ACTOR_A);
  const maintenance = service.startSession({ scenario: "content_maintenance", consent: true, campaignCode: maintenanceInvite.inviteCode }, ACTOR_A).body.session;
  const contentSaved = service.updateSession({ sessionId: maintenance.id, expectedRevision: 1, milestone: "content_saved" }, ACTOR_A).body.session;
  service.updateSession({ sessionId: maintenance.id, expectedRevision: contentSaved.revision, action: "complete", outcome: { taskCompleted: true, independent: true, easeRating: 4 } }, ACTOR_A);
  const understanding = service.startSession({ scenario: "status_understanding", consent: true, campaignCode: statusInvite.inviteCode }, ACTOR_A).body.session;
  service.updateSession({ sessionId: understanding.id, expectedRevision: 1, action: "complete", outcome: { statusAnswer: "local", easeRating: 4 } }, ACTOR_A);

  const campaign = service.listCampaigns(ACTOR_A).body.campaigns[0];
  assert.equal(campaign.decision, "meets_thresholds");
  assert.deepEqual(campaign.readiness.setupCompletion, { sampleReady: true, thresholdMet: true });
  assert.equal(campaign.invitationCounts.first_setup.completed, 1);
  assert.equal(state.sitePilotSessions.some((session) => Object.hasOwn(session, "createdBy")), false);
  const closed = service.updateCampaign({ campaignId: campaign.id, expectedRevision: campaign.revision, action: "close" }, ACTOR_A);
  assert.equal(closed.body.campaign.status, "closed");
  const unused = service.createInvitation({ campaignId: campaign.id, scenario: "first_setup" }, ACTOR_A);
  assert.equal(unused.status, 409);
  assert.equal(service.deleteCampaign({ campaignId: campaign.id }, ACTOR_A).status, 200);
  assert.equal(state.sitePilotSessions.length, 0);
  assert.equal(state.sitePilotInvitations.length, 0);
  assert.equal(state.sitePilotSandboxes.length, 0);
});

test("one-time invitations allow parallel anonymous sessions and cannot be reused", () => {
  const { service } = harness();
  const campaign = service.createCampaign({}, ACTOR_A).body.campaign;
  const first = service.createInvitation({ campaignId: campaign.id, scenario: "content_maintenance" }, ACTOR_A).body.invitation;
  const second = service.createInvitation({ campaignId: campaign.id, scenario: "status_understanding" }, ACTOR_A).body.invitation;
  const firstSession = service.startSession({ scenario: first.scenario, consent: true, campaignCode: first.inviteCode }, ACTOR_A);
  const secondSession = service.startSession({ scenario: second.scenario, consent: true, campaignCode: second.inviteCode }, ACTOR_A);
  assert.equal(firstSession.status, 201);
  assert.equal(secondSession.status, 201);
  assert.notEqual(firstSession.body.session.id, secondSession.body.session.id);
  assert.equal(service.startSession({ scenario: first.scenario, consent: true, campaignCode: first.inviteCode }, ACTOR_A).body.error, "site_pilot_invitation_used");
  assert.equal(service.getActiveSession({ invitationCode: second.inviteCode }, ACTOR_A).body.session.id, secondSession.body.session.id);
});

test("pilot invitation workspaces are isolated, lazily provisioned, and expire", async () => {
  const provisioned = [];
  const purged = [];
  const { state, service, advance } = harness({
    sandboxTtlMs: 60_000,
    provisionSandbox: async (fixture, actor) => {
      provisioned.push({ fixture, actor });
      return { ok: true, status: 200, body: { site: null } };
    },
    purgeSandbox: (actor) => {
      purged.push(actor);
      return { ok: true, status: 200, body: { deleted: true } };
    },
  });
  const campaign = service.createCampaign({}, ACTOR_A).body.campaign;
  const first = service.createInvitation({ campaignId: campaign.id, scenario: "first_setup" }, ACTOR_A).body.invitation;
  const second = service.createInvitation({ campaignId: campaign.id, scenario: "first_setup" }, ACTOR_A).body.invitation;
  const firstWorkspace = await service.resolveWorkspace({ invitationCode: first.inviteCode }, ACTOR_A);
  const secondWorkspace = await service.resolveWorkspace({ invitationCode: second.inviteCode }, ACTOR_A);
  assert.equal(firstWorkspace.status, 200);
  assert.equal(secondWorkspace.status, 200);
  assert.notEqual(firstWorkspace.body.actor.teamId, secondWorkspace.body.actor.teamId);
  assert.equal(firstWorkspace.body.actor.userId, "pilot-participant");
  assert.equal(provisioned.length, 2);
  assert.equal(state.sitePilotSandboxes.every((sandbox) => sandbox.status === "ready"), true);
  const session = service.startSession({ scenario: "first_setup", consent: true, campaignCode: first.inviteCode }, ACTOR_A).body.session;

  advance(60_001);
  const expired = await service.resolveWorkspace({ invitationCode: first.inviteCode }, ACTOR_A);
  assert.equal(expired.status, 410);
  assert.equal(expired.body.error, "site_pilot_sandbox_expired");
  assert.equal(purged.length, 1);
  assert.equal(state.sitePilotSandboxes.length, 1);
  assert.equal(state.sitePilotSessions.find((candidate) => candidate.id === session.id).status, "abandoned");
  assert.equal(service.updateSession({ sessionId: session.id, expectedRevision: session.revision, action: "complete", outcome: { taskCompleted: true, easeRating: 4 } }, ACTOR_A).status, 409);
  service.listCampaigns(ACTOR_A);
  assert.equal(purged.length, 2);
  assert.equal(state.sitePilotSandboxes.length, 0);
});
