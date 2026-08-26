import assert from "node:assert/strict";
import test from "node:test";
import { createServerState } from "../src/runtime/state-factory.mjs";
import {
  acceptPrivateTutorPilotConsent,
  applyPrivateTutorPilotLifecycle,
  currentPrivateTutorPilotConsentDocument,
  privateTutorPilotGuardianStatus,
  privateTutorPilotOperations,
  privateTutorPilotPauseForLearner,
  recordPrivateTutorPilotCheckIn,
  reportPrivateTutorPilotIncident,
  resumePrivateTutorPilotCohort,
  updatePrivateTutorPilotIncident,
  withdrawPrivateTutorPilotParticipation,
} from "../src/services/private-tutor-pilot.mjs";

test("pilot enrollment requires every acknowledgement and pins the immutable consent version", () => {
  const fixture = buildFixture();
  const document = currentPrivateTutorPilotConsentDocument();
  const incomplete = acceptPrivateTutorPilotConsent(fixture.state, fixture.learner, {
    cohortId: fixture.cohort.id, consentDocumentId: document.id, acknowledgements: { guardianAuthority: true },
  }, fixture.context);
  assert.equal(incomplete.error, "private_tutor_pilot_consent_incomplete");

  const accepted = enroll(fixture);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.consent.documentVersion, document.version);
  assert.equal(accepted.consent.documentChecksum, document.checksum);
  assert.equal(accepted.consent.guardianUserId, "parent-a");
  assert.deepEqual(fixture.cohort.enrolledLearnerIds, [fixture.learner.id]);
  const status = privateTutorPilotGuardianStatus(fixture.state, fixture.learner.id);
  assert.equal(status.participation.status, "active");
  assert.equal("enrolledLearnerIds" in status.cohort, false);
});

test("a failed release gate blocks enrollment and prevents a paused cohort from resuming", () => {
  const fixture = buildFixture();
  const blockedEnrollment = enroll(fixture, { releaseReady: false });
  assert.equal(blockedEnrollment.error, "private_tutor_release_gates_blocked");
  assert.equal(fixture.state.privateTutorPilotParticipations.length, 0);
  fixture.cohort.status = "paused";
  const blockedResume = resumePrivateTutorPilotCohort(fixture.state, fixture.cohort.id, { reason: "已经完成安全复核" }, { ...fixture.context, releaseReady: false });
  assert.equal(blockedResume.error, "private_tutor_release_gates_blocked");
  assert.equal(fixture.cohort.status, "paused");
});

test("guardian withdrawal is immediate, can request deletion, and cannot be silently reversed", () => {
  const fixture = buildFixture();
  enroll(fixture);
  const withdrawn = withdrawPrivateTutorPilotParticipation(fixture.state, fixture.learner, {
    reason: "child_choice", deletionRequested: true,
  }, fixture.context);
  assert.equal(withdrawn.ok, true);
  assert.equal(withdrawn.participation.status, "withdrawn");
  assert.equal(withdrawn.deletionRequest.status, "pending_parent_confirmation");
  assert.deepEqual(fixture.cohort.enrolledLearnerIds, []);
  assert.equal(enroll(fixture).error, "private_tutor_pilot_withdrawal_is_final");
});

test("a critical incident escalates and pauses learning until professionals resolve and resume", () => {
  const fixture = buildFixture();
  enroll(fixture);
  const reported = reportPrivateTutorPilotIncident(fixture.state, fixture.learner, {
    category: "child_distress", needsImmediateStop: true, summary: "孩子出现明显不适，需要立即停止试点。",
  }, fixture.context);
  assert.equal(reported.incident.status, "escalated");
  assert.equal(fixture.cohort.status, "paused");
  assert.equal(privateTutorPilotPauseForLearner(fixture.state, fixture.learner.id).cohortId, fixture.cohort.id);
  assert.equal(resumePrivateTutorPilotCohort(fixture.state, fixture.cohort.id, { reason: "准备恢复试点" }, fixture.context).error, "private_tutor_pilot_critical_incident_open");

  const resolved = updatePrivateTutorPilotIncident(fixture.state, reported.incident.id, {
    action: "resolve", resolution: "已联系监护人并完成安全复核。",
  }, fixture.context);
  assert.equal(resolved.incident.status, "resolved");
  const resumed = resumePrivateTutorPilotCohort(fixture.state, fixture.cohort.id, { reason: "安全负责人确认可以恢复" }, fixture.context);
  assert.equal(resumed.ok, true);
  assert.equal(privateTutorPilotPauseForLearner(fixture.state, fixture.learner.id), null);
});

test("guardian reports express urgency while the server owns operational severity", () => {
  const fixture = buildFixture();
  enroll(fixture);
  const reported = reportPrivateTutorPilotIncident(fixture.state, fixture.learner, {
    category: "content_error", severity: "critical", needsImmediateStop: false,
    summary: "这道题的讲解和题目条件对不上。",
  }, fixture.context);
  assert.equal(reported.incident.severity, "moderate");
  assert.equal(fixture.cohort.status, "active");
});

test("pilot metrics contain only cohort aggregates and explicit low-pressure check-ins", () => {
  const fixture = buildFixture();
  enroll(fixture);
  const checkIn = recordPrivateTutorPilotCheckIn(fixture.state, fixture.learner, {
    guardianPressure: "manageable", childWillingToReturn: "yes",
  }, fixture.context);
  assert.equal(checkIn.ok, true);
  fixture.state.privateTutorSessions.push({ learnerId: fixture.learner.id, status: "completed", plannedMinutes: 20, completedAt: "2026-08-21T12:10:00.000Z" });
  fixture.state.privateTutorAttempts.push({ learnerId: fixture.learner.id, correct: true, independent: true, usedHint: false, createdAt: "2026-08-21T12:05:00.000Z", normalizedAnswer: "sensitive-answer" });
  const operations = privateTutorPilotOperations(fixture.state, fixture.now());
  const metrics = operations.metrics[0];
  assert.equal(metrics.enrollment.active, 1);
  assert.equal(metrics.engagement.learningMinutes, 20);
  assert.equal(metrics.engagement.independentCorrectRate, 1);
  assert.equal(metrics.experience.guardianPressure.manageable, 1);
  const serialized = JSON.stringify(metrics);
  assert.equal(serialized.includes(fixture.learner.id), false);
  assert.equal(serialized.includes("sensitive-answer"), false);
});

test("a seven-day cohort completes automatically instead of remaining enrollable forever", () => {
  const fixture = buildFixture();
  enroll(fixture);
  const result = applyPrivateTutorPilotLifecycle(fixture.state, "2026-08-29T00:00:00.000Z");
  assert.equal(result.completed, 1);
  assert.equal(fixture.cohort.status, "completed");
  assert.equal(fixture.state.privateTutorPilotParticipations[0].status, "completed");
  assert.equal(privateTutorPilotGuardianStatus(fixture.state, fixture.learner.id).canJoin, false);
});

function enroll(fixture, contextOverrides = {}) {
  const document = currentPrivateTutorPilotConsentDocument();
  return acceptPrivateTutorPilotConsent(fixture.state, fixture.learner, {
    cohortId: fixture.cohort.id,
    consentDocumentId: document.id,
    acknowledgements: {
      guardianAuthority: true,
      scopeUnderstood: true,
      dataUseUnderstood: true,
      voluntaryParticipation: true,
      withdrawalUnderstood: true,
      childWillingnessDiscussed: true,
    },
  }, { ...fixture.context, ...contextOverrides });
}

function buildFixture() {
  let sequence = 0;
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 7, 21, 12, 0, tick++)).toISOString();
  const nextId = (prefix) => `${prefix}_${++sequence}`;
  const { state } = createServerState({ defaultProjectPath: process.cwd(), now });
  const document = currentPrivateTutorPilotConsentDocument();
  const learner = { id: "learner-a", ownerTeamId: "family-a", displayName: "小禾", grade: "七年级", status: "active", createdAt: now(), updatedAt: now() };
  const cohort = {
    id: "cohort-a", status: "active", participantTarget: 30, durationDays: 7, responseOwner: "安全负责人",
    consentDocumentId: document.id, consentDocumentVersion: document.version, consentDocumentChecksum: document.checksum,
    exitPolicy: "guardian_can_withdraw_and_request_deletion", createdBy: "owner-a", startedAt: now(), endsAt: "2026-08-28T12:00:00.000Z",
    enrolledLearnerIds: [], pausedAt: null, pausedBy: null, pauseReason: null,
  };
  state.privateTutorLearners.push(learner);
  state.privateTutorPilotCohorts.push(cohort);
  const context = { actor: { userId: "parent-a", role: "viewer" }, now, nextId };
  return { state, learner, cohort, now, nextId, context };
}
