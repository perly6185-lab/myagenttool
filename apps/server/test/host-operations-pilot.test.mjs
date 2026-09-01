import assert from "node:assert/strict";
import test from "node:test";

import { createHostOperationsPilotService } from "../src/services/host-operations-pilot.mjs";

function harness() {
  let tick = 0;
  let id = 0;
  const state = {
    sshTargets: [{ id: "host_1", ownerTeamId: "team_1", createdByUserId: "user_1" }],
    hostOperationsCases: [],
    hostRemediationPlans: [],
    hostOperationsPilotCampaigns: [],
    hostOperationsPilotSessions: [],
  };
  const now = () => new Date(Date.parse("2026-09-01T00:00:00.000Z") + tick++ * 1000).toISOString();
  const service = createHostOperationsPilotService({
    state,
    now,
    nextId: (prefix) => `${prefix}_${++id}`,
    createInviteCode: () => "anonymous-round-code",
    persistStateSoon: () => {},
  });
  return { state, service, actor: { teamId: "team_1", userId: "user_1" }, now };
}

test("runs an explicitly consented operations pilot from campaign to anonymous evidence", () => {
  const h = harness();
  const campaign = h.service.createCampaign({ label: "September operations pilot" }, h.actor).body.campaign;
  assert.equal(campaign.status, "active");
  assert.equal(campaign.summary.participation.total, 0);

  const rejected = h.service.startSession({ inviteCode: campaign.inviteCode, sshTargetId: "host_1", consent: false }, h.actor);
  assert.equal(rejected.status, 400);

  const started = h.service.startSession({ inviteCode: campaign.inviteCode, sshTargetId: "host_1", consent: true }, h.actor);
  assert.equal(started.status, 201);
  const session = started.body.session;
  h.state.hostOperationsCases.push({
    id: "case_secret_id",
    ownerTeamId: "team_1",
    createdByUserId: "user_1",
    sshTargetId: "host_1",
    diagnosticRunId: "run_1",
    intent: "website",
    status: "recovered",
    nextStep: "case_complete",
    deviceChanged: true,
    rawInput: "网站打不开，地址 10.0.0.8",
    createdAt: h.now(),
    updatedAt: h.now(),
    timeline: [{ kind: "case_opened", at: h.now(), deviceChanged: false }, { kind: "remediation_completed", at: h.now(), deviceChanged: true }],
  });
  h.state.hostRemediationPlans.push({ diagnosticRunId: "run_1", status: "completed", result: { changeAttempted: true, command: "docker kill" } });

  const completed = h.service.completeSession({
    sessionId: session.id,
    expectedRevision: session.revision,
    caseId: "case_secret_id",
    nextStepClear: true,
    easeRating: 4,
  }, h.actor);
  assert.equal(completed.status, 200);

  const listed = h.service.listCampaigns(h.actor).body.campaigns[0];
  assert.deepEqual(listed.summary.participation, { total: 1, active: 0, completed: 1 });
  assert.deepEqual(listed.summary.experience.nextStepClear, { numerator: 1, denominator: 1, rate: 1 });
  assert.equal(listed.summary.experience.averageEaseRating, 4);
  assert.equal(listed.summary.operations.cases.recovered, 1);

  const exported = h.service.getEvidence({ campaignId: campaign.id }, h.actor).body;
  assert.match(exported.sha256, /^[a-f0-9]{64}$/);
  assert.equal(exported.evidence.samples[0].caseRef.startsWith("case_"), true);
  assert.equal(exported.evidence.samples[0].hostRef.startsWith("hst_"), true);
  const serialized = JSON.stringify(exported);
  for (const secret of ["case_secret_id", "host_1", "user_1", "10.0.0.8", "docker kill", "网站打不开"]) {
    assert.equal(serialized.includes(secret), false, `must not export ${secret}`);
  }

  const closed = h.service.updateCampaign({ campaignId: campaign.id, expectedRevision: campaign.revision, action: "close" }, h.actor);
  assert.equal(closed.body.campaign.status, "closed");
});

test("reports the unique next-step bottleneck while a consented session is active", () => {
  const h = harness();
  const campaign = h.service.createCampaign({}, h.actor).body.campaign;
  h.service.startSession({ inviteCode: campaign.inviteCode, sshTargetId: "host_1", consent: true }, h.actor);
  h.state.hostOperationsCases.push({
    id: "case_1", ownerTeamId: "team_1", createdByUserId: "user_1", sshTargetId: "host_1",
    intent: "website", status: "diagnosed", nextStep: "check_managed_website", deviceChanged: false,
    createdAt: h.now(), updatedAt: h.now(), timeline: [],
  });
  const summary = h.service.listCampaigns(h.actor).body.campaigns[0].summary;
  assert.deepEqual(summary.bottlenecks, [{ nextStep: "check_managed_website", count: 1 }]);
  assert.equal(summary.operations.cases.active, 1);
});

test("requires a terminal owned case and supports complete consent withdrawal", () => {
  const h = harness();
  const campaign = h.service.createCampaign({}, h.actor).body.campaign;
  const session = h.service.startSession({ inviteCode: campaign.inviteCode, sshTargetId: "host_1", consent: true }, h.actor).body.session;
  h.state.hostOperationsCases.push({
    id: "case_active", ownerTeamId: "team_1", createdByUserId: "user_1", sshTargetId: "host_1",
    intent: "website", status: "diagnosed", nextStep: "check_managed_website", createdAt: h.now(), updatedAt: h.now(), timeline: [],
  });
  const premature = h.service.completeSession({ sessionId: session.id, expectedRevision: 1, caseId: "case_active", nextStepClear: true, easeRating: 5 }, h.actor);
  assert.equal(premature.status, 409);
  assert.equal(h.service.deleteSession({ sessionId: session.id }, h.actor).status, 200);
  assert.equal(h.state.hostOperationsPilotSessions.length, 0);
});
