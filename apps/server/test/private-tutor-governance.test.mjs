import assert from "node:assert/strict";
import test from "node:test";
import { createServerState } from "../src/runtime/state-factory.mjs";
import {
  PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS,
  acceptPrivateTutorGuardianInvitation,
  applyPrivateTutorDataRetention,
  buildPrivateTutorLearnerExport,
  createPrivateTutorGuardianInvitation,
  deletePrivateTutorLearnerData,
  updatePrivateTutorDataPolicy,
} from "../src/services/private-tutor-governance.mjs";

test("a guardian invitation stores only a hash and grants explicit cross-account access on acceptance", () => {
  const fixture = buildFixture();
  const invitation = createPrivateTutorGuardianInvitation(fixture.state, fixture.learner, { inviteeLabel: "另一位监护人" }, {
    actorId: "parent-a", now: fixture.now, nextId: fixture.nextId,
  });
  assert.equal(invitation.ok, true);
  assert.equal(invitation.invitation.inviteeLabel, "另一位监护人");
  assert.equal("tokenHash" in invitation.invitation, false);
  assert.equal(fixture.state.privateTutorGuardianInvitations[0].tokenHash.includes(invitation.invitationToken), false);

  const accepted = acceptPrivateTutorGuardianInvitation(fixture.state, invitation.invitationToken, {
    actor: { userId: "parent-b", teamId: "different-team" }, now: fixture.now, nextId: fixture.nextId,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.guardianLink.guardianUserId, "parent-b");
  assert.equal(accepted.guardianLink.ownerTeamId, fixture.learner.ownerTeamId);
  assert.equal(acceptPrivateTutorGuardianInvitation(fixture.state, invitation.invitationToken, {
    actor: { userId: "parent-c" }, now: fixture.now, nextId: fixture.nextId,
  }).status, 404, "an invitation is single use");
});

test("learner export contains every learner-scoped category but no invitation secret or sibling data", () => {
  const fixture = buildFixture();
  const invitation = createPrivateTutorGuardianInvitation(fixture.state, fixture.learner, {}, {
    actorId: "parent-a", now: fixture.now, nextId: fixture.nextId,
  });
  fixture.state.privateTutorAttempts.push({ id: "attempt-a", learnerId: fixture.learner.id, normalizedAnswer: "5" });
  fixture.state.privateTutorAttempts.push({ id: "attempt-sibling", learnerId: "learner-sibling", normalizedAnswer: "9" });
  const bundle = buildPrivateTutorLearnerExport(fixture.state, fixture.learner, fixture.now());
  const serialized = JSON.stringify(bundle);
  assert.equal(bundle.schemaVersion, 1);
  assert.deepEqual(bundle.collections.privateTutorAttempts.map((row) => row.id), ["attempt-a"]);
  assert.equal(serialized.includes(invitation.invitationToken), false);
  assert.equal(serialized.includes(fixture.state.privateTutorGuardianInvitations[0].tokenHash), false);
  assert.equal(serialized.includes("attempt-sibling"), false);
});

test("data policy keeps raw audio disabled and reaps expired transcript and unreferenced model history", () => {
  const fixture = buildFixture();
  const rejected = updatePrivateTutorDataPolicy(fixture.state, fixture.learner, "parent-a", {
    rawAudioDays: 7, voiceTranscriptDays: 30, derivedProfileHistoryDays: 365,
    learningEvidenceRetention: "until_learner_deletion",
  }, { now: fixture.now, nextId: fixture.nextId });
  assert.equal(rejected.ok, false);
  const saved = updatePrivateTutorDataPolicy(fixture.state, fixture.learner, "parent-a", {
    rawAudioDays: 0, voiceTranscriptDays: 7, derivedProfileHistoryDays: 180,
    learningEvidenceRetention: "until_learner_deletion",
  }, { now: fixture.now, nextId: fixture.nextId });
  assert.equal(saved.ok, true);
  assert.equal(saved.policy.rawAudioDays, 0);
  fixture.state.privateTutorVoiceTurns.push(
    { id: "voice-old", learnerId: fixture.learner.id, createdAt: "2025-01-01T00:00:00.000Z" },
    { id: "voice-new", learnerId: fixture.learner.id, createdAt: "2026-08-20T00:00:00.000Z" },
  );
  fixture.state.privateTutorLearnerModels.push(
    { id: "model-new", learnerId: fixture.learner.id, updatedAt: "2026-08-20T00:00:00.000Z" },
    { id: "model-old", learnerId: fixture.learner.id, updatedAt: "2025-01-01T00:00:00.000Z" },
  );
  const result = applyPrivateTutorDataRetention(fixture.state, { now: fixture.now, nextId: fixture.nextId });
  assert.equal(result.reaped, 2);
  assert.deepEqual(fixture.state.privateTutorVoiceTurns.map((row) => row.id), ["voice-new"]);
  assert.deepEqual(fixture.state.privateTutorLearnerModels.map((row) => row.id), ["model-new"]);
});

test("learner deletion clears every scoped collection and retains only a PII-scrubbed report", () => {
  const fixture = buildFixture();
  for (const key of PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS) {
    if (["privateTutorLearners", "privateTutorGuardianLinks"].includes(key)) continue;
    fixture.state[key].push({ id: `${key}-row`, learnerId: fixture.learner.id });
  }
  const report = deletePrivateTutorLearnerData(fixture.state, fixture.learner, {
    actorId: "parent-a", now: fixture.now, nextId: fixture.nextId,
  });
  assert.equal(report.liveStateResidualCount, 0);
  assert.equal(report.deletedRecordCount >= PRIVATE_TUTOR_LEARNER_COLLECTION_KEYS.length, true);
  assert.equal(JSON.stringify(report).includes(fixture.learner.displayName), false);
  assert.equal(fixture.state.privateTutorDeletionReports[0].subjectHash.length, 64);
  assert.equal(fixture.state.privateTutorDeletionJobs[0].subjectId, fixture.learner.id);
  assert.equal(fixture.state.privateTutorDeletionJobs[0].status, "pending_erasure");
  assert.equal(fixture.state.privateTutorAuditEvents.some((row) => row.action === "learner_deletion_requested" && row.learnerId.startsWith("deleted:")), true);
});

function buildFixture() {
  let sequence = 0;
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 7, 21, 12, 0, tick++)).toISOString();
  const nextId = (prefix) => `${prefix}_${++sequence}`;
  const { state } = createServerState({ defaultProjectPath: process.cwd(), now });
  const learner = { id: "learner-a", ownerTeamId: "family-a", displayName: "小禾", grade: "七年级", status: "active", createdAt: now(), updatedAt: now() };
  state.privateTutorLearners.push(learner);
  state.privateTutorGuardianLinks.push({ id: "guardian-a", ownerTeamId: "family-a", learnerId: learner.id, guardianUserId: "parent-a", verifiedAt: now(), permissions: ["read", "write", "manage"] });
  return { state, learner, now, nextId };
}
