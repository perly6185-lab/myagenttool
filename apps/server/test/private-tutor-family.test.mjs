import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrivateTutorWeeklyReport,
  createPrivateTutorPilotCohort,
  enforcePrivateTutorReleaseGates,
  privateTutorReleaseReadiness,
  recordPrivateTutorReleaseEvaluation,
  updatePrivateTutorGuardianPreferences,
} from "../src/services/private-tutor-family.mjs";

test("guardian preferences default to weekly and reject anxiety-producing daily error alerts", () => {
  const state = { privateTutorGuardianPreferences: [] };
  const learner = { id: "learner-a", ownerTeamId: "family-a" };
  const context = { at: "2026-08-20T00:00:00.000Z", nextId: () => "ptgp_1" };
  const rejected = updatePrivateTutorGuardianPreferences(state, learner, "parent-a", { notificationFrequency: "weekly", dailyErrorAlerts: true, quietHours: { start: "20:00", end: "07:00" } }, context);
  assert.equal(rejected.ok, false);
  const accepted = updatePrivateTutorGuardianPreferences(state, learner, "parent-a", { notificationFrequency: "off", quietHours: { enabled: true, start: "21:00", end: "07:30" } }, context);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.preferences.id, "ptgp_1");
  assert.equal(accepted.preferences.ownerTeamId, "family-a");
  assert.equal(accepted.preferences.dailyErrorAlerts, false);
});

test("the weekly report avoids rankings and gives one light family suggestion", () => {
  const report = buildPrivateTutorWeeklyReport({
    learner: { id: "learner-a", displayName: "小禾" },
    snapshot: { knowledge: [{ id: "balance", mastery: 0.72 }] },
    attempts: [{ learnerId: "learner-a", correct: true, independent: true, usedHint: false, createdAt: "2026-08-19T00:00:00.000Z" }],
    themes: [], sessions: [], now: () => "2026-08-20T00:00:00.000Z",
  });
  assert.equal(report.progress.independentCorrect, 1);
  assert.equal(report.pressureSafety.rankingShown, false);
  assert.match(report.familySuggestion, /可以问一句/);
});

test("release registry requires current build, target matrix, durable artifacts, and independent math reviewers", () => {
  let id = 0;
  const state = { privateTutorReleaseEvaluations: [], privateTutorPilotCohorts: [] };
  const nextId = (prefix) => `${prefix}_${++id}`;
  const buildId = "artifact:build-a";
  assert.equal(privateTutorReleaseReadiness(state, buildId).ready, false);
  const blocked = createPrivateTutorPilotCohort(state, { participantTarget: 30, responseOwner: "安全负责人" }, { actor: { userId: "owner" }, now: () => "2026-08-20T00:00:00.000Z", nextId, buildId });
  assert.equal(blocked.error, "private_tutor_release_gates_blocked");

  const initial = privateTutorReleaseReadiness(state, buildId, "2026-08-20T00:00:00.000Z");
  const voiceGate = initial.gates.find((gate) => gate.id === "voice_confidence");
  const firstVoiceTarget = voiceGate.targets[0];
  const partialVoice = recordPrivateTutorReleaseEvaluation(state, evidenceInput(voiceGate, firstVoiceTarget, "reviewer-a", nextId, buildId));
  assert.equal(partialVoice.contractVersion, 2);
  assert.equal(partialVoice.artifact.checksumSha256.length, 64);
  assert.equal(privateTutorReleaseReadiness(state, buildId, "2026-08-20T01:00:00.000Z").gates.find((gate) => gate.id === "voice_confidence").status, "incomplete");
  assert.equal(recordPrivateTutorReleaseEvaluation(state, { ...evidenceInput(voiceGate, voiceGate.targets[1], "reviewer-a", nextId, buildId), artifactChecksumSha256: "not-a-sha" }), null);

  for (const releaseGate of initial.gates) {
    for (const evidenceTarget of releaseGate.targets) {
      if (releaseGate.id === "voice_confidence" && evidenceTarget.id === firstVoiceTarget.id) continue;
      recordPrivateTutorReleaseEvaluation(state, evidenceInput(releaseGate, evidenceTarget, "reviewer-a", nextId, buildId));
    }
  }
  assert.equal(privateTutorReleaseReadiness(state, buildId, "2026-08-20T01:00:00.000Z").ready, false);
  const mathGate = initial.gates.find((gate) => gate.id === "math_content");
  recordPrivateTutorReleaseEvaluation(state, evidenceInput(mathGate, mathGate.targets[0], "reviewer-b", nextId, buildId, "第二位教研复核通过"));
  assert.equal(privateTutorReleaseReadiness(state, buildId, "2026-08-20T02:00:00.000Z").ready, true);
  assert.equal(privateTutorReleaseReadiness(state, "artifact:build-b", "2026-08-20T02:00:00.000Z").ready, false);
  const started = createPrivateTutorPilotCohort(state, { participantTarget: 50, responseOwner: "安全负责人" }, { actor: { userId: "owner" }, now: () => "2026-08-20T02:00:00.000Z", nextId, buildId });
  assert.equal(started.ok, true);
  assert.equal(started.cohort.durationDays, 7);
  state.privateTutorQuestionRevisions = [{ id: "revision-new", questionId: "q-new", version: 1, contentChecksum: "changed-content", status: "published", active: true }];
  assert.equal(started.cohort.releaseBuildId, buildId);
  const invalidated = privateTutorReleaseReadiness(state, buildId);
  assert.equal(invalidated.ready, false);
  assert.equal(enforcePrivateTutorReleaseGates(state, invalidated, "2026-08-20T03:00:00.000Z").paused, 1);
  assert.equal(started.cohort.status, "paused");
  assert.match(started.cohort.pauseReason, /release_gates_blocked/);
});

test("expired release evidence blocks the pilot and reports the expired target", () => {
  let id = 0;
  const state = { privateTutorReleaseEvaluations: [] };
  const buildId = "artifact:expiry";
  const readiness = privateTutorReleaseReadiness(state, buildId, "2026-01-01T00:00:00.000Z");
  const ownerGate = readiness.gates.find((gate) => gate.id === "pilot_owner");
  recordPrivateTutorReleaseEvaluation(state, evidenceInput(ownerGate, ownerGate.targets[0], "reviewer-a", (prefix) => `${prefix}_${++id}`, buildId, "演练完成", "2026-01-01T00:00:00.000Z"));
  const expired = privateTutorReleaseReadiness(state, buildId, "2026-02-01T00:00:01.000Z").gates.find((gate) => gate.id === "pilot_owner");
  assert.equal(expired.status, "expired");
  assert.deepEqual(expired.missingTargetIds, ["operations-drill"]);
  assert.equal(expired.expiredEvidenceCount, 1);
});

function evidenceInput(gate, evidenceTarget, reviewerId, nextId, buildId, evidence = "已附审计证据", executedAt = "2026-08-20T00:00:00.000Z") {
  return {
    gateId: gate.id,
    targetId: evidenceTarget.id,
    status: "passed",
    evidence,
    evidenceType: evidenceTarget.evidenceType,
    environment: evidenceTarget.environment,
    artifactName: `${gate.id}-${evidenceTarget.id}.json`,
    artifactChecksumSha256: "a".repeat(64),
    executedAt,
    reviewerId,
    at: executedAt,
    nextId,
    buildId,
  };
}
