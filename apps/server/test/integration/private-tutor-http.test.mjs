process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENT_LOCAL_MODE = "1";
process.env.MYAGENT_SECURE_COOKIES = "0";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";

let server;
let base;
let runtimeState;
const root = join(tmpdir(), `myagenttool-private-tutor-http-${process.pid}`);

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");
  const now = () => new Date().toISOString();

  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-b", "main", root]);
  const { defaultProject, state } = createServerState({ defaultProjectPath: root, now });
  runtimeState = state;
  state.teams.push({ id: "team_family_a" }, { id: "team_family_b" });
  state.users.push(
    { id: "usr_parent_a", teamId: "team_family_a", role: "viewer" },
    { id: "usr_parent_b", teamId: "team_family_b", role: "owner" },
  );
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  state.tokens.push(
    { token: "tok_parent_a", userId: "usr_parent_a", expiresAt },
    { token: "tok_parent_b", userId: "usr_parent_b", expiresAt },
  );

  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: root,
    persistenceEnabled: false,
    stateStorePath: join(root, "unused.json"),
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "test",
    protocolVersion: "0.0.0",
    ...httpDependencies,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  rmSync(root, { recursive: true, force: true });
});

async function call(path, { token = "tok_parent_a", method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

function cookiesFrom(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : String(response.headers.get("set-cookie") ?? "").split(/,\s*(?=[^;,]+=)/);
  return Object.fromEntries(values.map((value) => {
    const [pair] = value.split(";");
    const index = pair.indexOf("=");
    return [pair.slice(0, index), decodeURIComponent(pair.slice(index + 1))];
  }));
}

test("a signed-in parent creates children with isolated learner-scoped snapshots", async () => {
  const first = await call("/api/private-tutor/learners", {
    method: "POST",
    body: { displayName: "小禾", grade: "七年级" },
  });
  const second = await call("/api/private-tutor/learners", {
    method: "POST",
    body: { displayName: "安然", grade: "七年级" },
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.body.learner.id, second.body.learner.id);
  assert.notEqual(first.body.snapshot.learnerId, second.body.snapshot.learnerId);
  assert.equal(first.body.snapshot.knowledge.every((row) => row.level === "unknown"), true);

  const listed = await call("/api/private-tutor/learners");
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.learners.map((row) => row.displayName).sort(), ["安然", "小禾"]);

  const otherFamily = await call("/api/private-tutor/learners", { token: "tok_parent_b" });
  assert.equal(otherFamily.status, 200);
  assert.deepEqual(otherFamily.body.learners, []);

  runtimeState.testPrivateTutorLearnerIds = [first.body.learner.id, second.body.learner.id];
});

test("foreign and missing learners have byte-equivalent not-found responses", async () => {
  const learnerId = runtimeState.testPrivateTutorLearnerIds[0];
  const foreign = await call(`/api/private-tutor/learners/${learnerId}/snapshot`, { token: "tok_parent_b" });
  const missing = await call("/api/private-tutor/learners/lrn_missing/snapshot", { token: "tok_parent_b" });
  assert.equal(foreign.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(foreign.body, missing.body);
});

test("attempt writes are learner-scoped, idempotent, and update explainable mastery once", async () => {
  const learnerId = runtimeState.testPrivateTutorLearnerIds[0];
  const payload = {
    idempotencyKey: "attempt-client-001",
    knowledgeId: "balance",
    questionRevisionId: "demo-balance-001-v1",
    rawAnswer: "x = 5",
    responseKind: "answer",
    independent: true,
    usedHint: false,
    source: "screen",
    durationSeconds: 180,
  };
  const created = await call(`/api/private-tutor/learners/${learnerId}/attempts`, { method: "POST", body: payload });
  assert.equal(created.status, 201);
  assert.equal(created.body.replayed, false);
  assert.equal(created.body.attempt.learnerId, learnerId);
  assert.equal(created.body.snapshot.independentAnswers, 1);
  assert.equal(created.body.snapshot.knowledge.find((row) => row.id === "balance").mastery, 0.62);

  const replayed = await call(`/api/private-tutor/learners/${learnerId}/attempts`, { method: "POST", body: payload });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.attempt.id, created.body.attempt.id);
  assert.equal(replayed.body.snapshot.independentAnswers, 1);
  assert.equal(runtimeState.privateTutorAttempts.filter((row) => row.learnerId === learnerId).length, 1);

  const conflict = await call(`/api/private-tutor/learners/${learnerId}/attempts`, {
    method: "POST",
    body: { ...payload, rawAnswer: "4" },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "private_tutor_idempotency_conflict");
});

test("low-confidence voice never enters grading or mastery evidence", async () => {
  const learnerId = runtimeState.testPrivateTutorLearnerIds[0];
  const beforeAttempts = runtimeState.privateTutorAttempts.length;
  const beforeSnapshot = JSON.stringify(runtimeState.privateTutorSnapshots.find((row) => row.learnerId === learnerId));
  const response = await call(`/api/private-tutor/learners/${learnerId}/attempts`, {
    method: "POST",
    body: {
      idempotencyKey: "voice-low-confidence-001",
      knowledgeId: "balance",
      questionRevisionId: "demo-balance-voice-v1",
      rawAnswer: "4",
      responseKind: "answer",
      independent: true,
      usedHint: false,
      source: "voice_confirmed",
      recognitionConfidence: 0.54,
      durationSeconds: 12,
    },
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, "private_tutor_voice_confirmation_required");
  assert.equal(runtimeState.privateTutorAttempts.length, beforeAttempts);
  assert.equal(JSON.stringify(runtimeState.privateTutorSnapshots.find((row) => row.learnerId === learnerId)), beforeSnapshot);
});

test("the adaptive diagnostic is resumable, server-graded, idempotent, and produces measured results", async () => {
  const learnerId = runtimeState.testPrivateTutorLearnerIds[0];
  const started = await call(`/api/private-tutor/learners/${learnerId}/assessments/start`, { method: "POST", body: {} });
  assert.equal(started.status, 201);
  let assessment = started.body.assessment;
  assert.equal(assessment.status, "active");
  assert.equal(assessment.currentQuestion.knowledgeId, "equation-meaning");
  assert.equal(JSON.stringify(assessment.currentQuestion).includes("expected"), false);

  const answerOracleBlocked = await call(`/api/private-tutor/learners/${learnerId}/attempts`, {
    method: "POST",
    body: {
      idempotencyKey: "diagnostic-answer-oracle",
      knowledgeId: assessment.currentQuestion.knowledgeId,
      questionRevisionId: assessment.currentQuestion.revisionId,
      rawAnswer: "5",
      responseKind: "answer",
      independent: true,
      usedHint: false,
      source: "screen",
      durationSeconds: 1,
    },
  });
  assert.equal(answerOracleBlocked.status, 400);
  assert.equal(answerOracleBlocked.body.error, "invalid_private_tutor_attempt_reference");

  const paused = await call(`/api/private-tutor/learners/${learnerId}/assessments/${assessment.id}/pause`, { method: "POST", body: {} });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.assessment.status, "paused");
  const current = await call(`/api/private-tutor/learners/${learnerId}/assessments/current`);
  assert.equal(current.body.assessment.status, "paused");
  const resumed = await call(`/api/private-tutor/learners/${learnerId}/assessments/${assessment.id}/resume`, { method: "POST", body: {} });
  assert.equal(resumed.status, 200);
  assessment = resumed.body.assessment;

  const attemptsBeforeVoice = runtimeState.privateTutorAttempts.length;
  const lowVoice = await call(`/api/private-tutor/learners/${learnerId}/assessments/${assessment.id}/answers`, {
    method: "POST",
    body: {
      idempotencyKey: "diagnostic-low-voice",
      questionRevisionId: assessment.currentQuestion.revisionId,
      rawAnswer: "5",
      responseKind: "answer",
      source: "voice_confirmed",
      recognitionConfidence: 0.4,
      durationSeconds: 20,
    },
  });
  assert.equal(lowVoice.status, 409);
  assert.equal(runtimeState.privateTutorAttempts.length, attemptsBeforeVoice);

  const answers = {
    "diag-int-01-v1": "-3",
    "diag-int-02-v1": "3",
    "diag-int-03-v1": "13",
    "diag-eqm-01-v1": "b",
    "diag-eqm-02-v1": "x=5",
    "diag-eqm-03-v1": "4",
    "diag-bal-01-v1": "b",
    "diag-bal-02-v1": "10/2",
    "diag-bal-03-v1": "3",
    "diag-word-01-v1": "5",
    "diag-word-02-v1": "4",
    "diag-word-03-v1": "3",
  };
  let firstResponse;
  let index = 0;
  while (assessment.status === "active") {
    const questionRevisionId = assessment.currentQuestion.revisionId;
    const payload = {
      idempotencyKey: `diagnostic-answer-${index}`,
      questionRevisionId,
      rawAnswer: answers[questionRevisionId],
      responseKind: "answer",
      source: "screen",
      durationSeconds: 45,
      correct: false,
    };
    const answered = await call(`/api/private-tutor/learners/${learnerId}/assessments/${assessment.id}/answers`, { method: "POST", body: payload });
    assert.equal(answered.status, 201, questionRevisionId);
    if (index === 0) {
      firstResponse = answered.body;
      const replay = await call(`/api/private-tutor/learners/${learnerId}/assessments/${assessment.id}/answers`, { method: "POST", body: payload });
      assert.equal(replay.status, 200);
      assert.equal(replay.body.replayed, true);
      assert.equal(replay.body.assessment.revision, firstResponse.assessment.revision);
    }
    assessment = answered.body.assessment;
    index += 1;
    assert.ok(index <= 18);
  }

  assert.equal(assessment.status, "completed");
  assert.ok(assessment.answeredCount >= 12 && assessment.answeredCount <= 18);
  assert.equal(assessment.result.knowledge.every((item) => item.level === "mastered"), true);
  const diagnosticAttempts = runtimeState.privateTutorAttempts.filter((row) => row.assessmentId === assessment.id);
  assert.equal(diagnosticAttempts.length, assessment.answeredCount);
  assert.equal(diagnosticAttempts.every((row) => row.correct === true), true);
  const snapshot = await call(`/api/private-tutor/learners/${learnerId}/snapshot`);
  assert.equal(snapshot.body.snapshot.latestAssessmentId, assessment.id);
  assert.equal(snapshot.body.snapshot.knowledge.every((item) => item.level !== "unknown"), true);
  assert.equal(snapshot.body.learnerModel.knowledge.every((item) => item.confidence > 0), true);
  assert.equal(snapshot.body.strategyDecision.targetKnowledgeId, "balance");
  assert.equal(snapshot.body.strategyDecision.strategy, "transfer_challenge");
  assert.equal(snapshot.body.learningPlan.days.length, 7);
  assert.equal(snapshot.body.learningPlan.days.every((day) => day.minutes === 20), true);

  const plan = await call(`/api/private-tutor/learners/${learnerId}/learning-plan`);
  assert.equal(plan.status, 200);
  assert.equal(plan.body.learningPlan.id, snapshot.body.learningPlan.id);
  const carriedKnowledgeId = plan.body.learningPlan.days[0].knowledgeId;
  const rebalanced = await call(`/api/private-tutor/learners/${learnerId}/learning-plan/rebalance`, {
    method: "POST",
    body: { missedDayIndex: 1 },
  });
  assert.equal(rebalanced.status, 200);
  assert.equal(rebalanced.body.learningPlan.revision, plan.body.learningPlan.revision + 1);
  assert.equal(rebalanced.body.learningPlan.reason, "missed_day_rescheduled");
  assert.equal(rebalanced.body.learningPlan.days[0].knowledgeId, carriedKnowledgeId);
  assert.equal(rebalanced.body.learningPlan.studentReason.includes("失败"), false);

  const startedSession = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/start`, {
    method: "POST",
    body: { pace: "standard" },
  });
  assert.equal(startedSession.status, 201);
  let tutoringSession = startedSession.body.session;
  assert.equal(tutoringSession.plannedMinutes, 20);
  assert.deepEqual(tutoringSession.progress.map((item) => item.kind), ["recall", "explain", "guided_practice", "independent_check", "summary"]);
  assert.equal(JSON.stringify(tutoringSession).includes("expectedRational"), false);

  const bypassedSession = await call(`/api/private-tutor/learners/${learnerId}/attempts`, {
    method: "POST",
    body: { idempotencyKey: "session-bypass", knowledgeId: "balance", questionRevisionId: tutoringSession.currentActivity.question.revisionId, rawAnswer: "5", responseKind: "answer", independent: true, usedHint: false, source: "screen", durationSeconds: 1 },
  });
  assert.equal(bypassedSession.status, 400);
  assert.equal(bypassedSession.body.error, "invalid_private_tutor_attempt_reference");

  const recalled = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/${tutoringSession.id}/actions`, {
    method: "POST",
    body: { action: "answer", idempotencyKey: "session-recall-1", questionRevisionId: tutoringSession.currentActivity.question.revisionId, rawAnswer: "5", responseKind: "answer", source: "screen" },
  });
  assert.equal(recalled.status, 201);
  tutoringSession = recalled.body.session;
  assert.equal(tutoringSession.currentActivity.kind, "explain");

  const pausedSession = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/${tutoringSession.id}/pause`, { method: "POST", body: {} });
  assert.equal(pausedSession.status, 200);
  const restoredSession = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/current`);
  assert.equal(restoredSession.body.session.status, "paused");
  assert.equal(restoredSession.body.session.currentActivity.kind, "explain");
  const resumedSession = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/${tutoringSession.id}/resume`, { method: "POST", body: {} });
  assert.equal(resumedSession.status, 200);

  const explained = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/${tutoringSession.id}/actions`, { method: "POST", body: { action: "continue" } });
  tutoringSession = explained.body.session;
  const guidedQuestionId = tutoringSession.currentActivity.question.revisionId;
  for (const [attemptIndex, rawAnswer] of ["4", "6"].entries()) {
    const wrong = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/${tutoringSession.id}/actions`, {
      method: "POST",
      body: { action: "answer", idempotencyKey: `session-guided-wrong-${attemptIndex}`, questionRevisionId: guidedQuestionId, rawAnswer, responseKind: "answer", source: "screen" },
    });
    assert.equal(wrong.status, 201);
    tutoringSession = wrong.body.session;
  }
  assert.equal(tutoringSession.methodSwitchCount, 1);
  assert.equal(tutoringSession.intervention.type, "method_switch");
  const hinted = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/${tutoringSession.id}/actions`, { method: "POST", body: { action: "hint" } });
  assert.equal(hinted.body.session.currentActivity.hintLevel, 1);
  const guided = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/${tutoringSession.id}/actions`, {
    method: "POST",
    body: { action: "answer", idempotencyKey: "session-guided-correct", questionRevisionId: guidedQuestionId, rawAnswer: "5", responseKind: "answer", source: "screen" },
  });
  tutoringSession = guided.body.session;
  const independentQuestionId = tutoringSession.currentActivity.question.revisionId;
  assert.notEqual(independentQuestionId, guidedQuestionId);
  const independentPayload = { action: "answer", idempotencyKey: "session-independent-correct", questionRevisionId: independentQuestionId, rawAnswer: "5", responseKind: "answer", source: "screen" };
  const attemptsBeforeIndependent = runtimeState.privateTutorAttempts.length;
  const independent = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/${tutoringSession.id}/actions`, {
    method: "POST",
    body: independentPayload,
  });
  assert.equal(independent.status, 201);
  assert.equal(independent.body.session.currentActivity.kind, "summary");
  const replayedIndependent = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/${tutoringSession.id}/actions`, { method: "POST", body: independentPayload });
  assert.equal(replayedIndependent.status, 200);
  assert.equal(replayedIndependent.body.replayed, true);
  assert.equal(runtimeState.privateTutorAttempts.length, attemptsBeforeIndependent + 1);
  const completedSession = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/${tutoringSession.id}/actions`, { method: "POST", body: { action: "continue" } });
  assert.equal(completedSession.body.session.status, "completed");
  assert.equal(completedSession.body.session.summary.independentCompleted, true);
  assert.deepEqual(completedSession.body.session.summary.hintedActivities, ["guided_practice"]);
  assert.equal(completedSession.body.snapshot.completedSessions, 1);
  assert.equal(runtimeState.privateTutorSessionEvents.some((row) => row.sessionId === tutoringSession.id && row.type === "session_completed"), true);
});

test("parent-confirmed deletion removes every child data collection and leaves an audit tombstone", async () => {
  const learnerId = runtimeState.testPrivateTutorLearnerIds[1];
  runtimeState.privateTutorSessions.push({ id: "ptsess_delete", learnerId, ownerTeamId: "team_family_a" });
  runtimeState.privateTutorSessionEvents.push({ id: "ptse_delete", learnerId, sessionId: "ptsess_delete", ownerTeamId: "team_family_a" });
  const rejected = await call(`/api/private-tutor/learners/${learnerId}`, {
    method: "DELETE",
    body: { confirmDisplayName: "错误名字" },
  });
  assert.equal(rejected.status, 409);

  const deleted = await call(`/api/private-tutor/learners/${learnerId}`, {
    method: "DELETE",
    body: { confirmDisplayName: "安然" },
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deletedId, learnerId);
  for (const key of [
    "privateTutorLearners",
    "privateTutorGuardianLinks",
    "privateTutorSnapshots",
    "privateTutorAttempts",
    "privateTutorAssessments",
    "privateTutorLearnerModels",
    "privateTutorStrategyDecisions",
    "privateTutorLearningPlans",
    "privateTutorSessions",
    "privateTutorSessionEvents",
    "privateTutorIdempotencyRecords",
  ]) {
    assert.equal(runtimeState[key].some((row) => row.id === learnerId || row.learnerId === learnerId), false, key);
  }
  assert.equal(runtimeState.privateTutorAuditEvents.some((row) => row.learnerId === learnerId && row.action === "learner_deleted"), true);
});

test("a parent starts a learner-bound child mode that blocks the rest of the signed-in account", async () => {
  const login = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "local" }),
  });
  assert.equal(login.status, 200);
  const cookies = cookiesFrom(login);
  const cookieHeader = Object.entries(cookies).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("; ");
  const headers = {
    cookie: cookieHeader,
    "content-type": "application/json",
    "x-csrf-token": cookies.myagenttool_csrf,
  };

  const created = await fetch(`${base}/api/private-tutor/learners`, {
    method: "POST",
    headers,
    body: JSON.stringify({ displayName: "小满", grade: "六年级" }),
  });
  assert.equal(created.status, 201);
  const learnerId = (await created.json()).learner.id;

  const siblingCreated = await fetch(`${base}/api/private-tutor/learners`, {
    method: "POST",
    headers,
    body: JSON.stringify({ displayName: "小树", grade: "八年级" }),
  });
  assert.equal(siblingCreated.status, 201);
  const siblingLearnerId = (await siblingCreated.json()).learner.id;

  const entered = await fetch(`${base}/api/private-tutor/child-mode`, {
    method: "POST",
    headers,
    body: JSON.stringify({ learnerId, exitPin: "618520" }),
  });
  assert.equal(entered.status, 201);
  const childModeRecord = runtimeState.identitySessions.find((row) => row.privateTutorChildMode?.learnerId === learnerId)?.privateTutorChildMode;
  assert.match(childModeRecord.exitPinHash, /^scrypt\$/);
  assert.equal(childModeRecord.exitPinHash.includes("618520"), false);

  const currentSession = await fetch(`${base}/api/session`, { headers: { cookie: cookieHeader } });
  assert.equal(currentSession.status, 200);
  assert.equal((await currentSession.json()).user.privateTutorChildMode.learnerId, learnerId);

  const blockedState = await fetch(`${base}/api/state`, { headers: { cookie: cookieHeader } });
  assert.equal(blockedState.status, 403);
  assert.equal((await blockedState.json()).error, "private_tutor_child_mode_restricted");

  const childVisibleLearners = await fetch(`${base}/api/private-tutor/learners`, { headers: { cookie: cookieHeader } });
  assert.equal(childVisibleLearners.status, 200);
  assert.deepEqual((await childVisibleLearners.json()).learners.map((row) => row.id), [learnerId]);

  const blockedSibling = await fetch(`${base}/api/private-tutor/learners/${siblingLearnerId}/snapshot`, { headers: { cookie: cookieHeader } });
  assert.equal(blockedSibling.status, 404);
  const blockedSiblingSession = await fetch(`${base}/api/private-tutor/learners/${siblingLearnerId}/tutoring-sessions/current`, { headers: { cookie: cookieHeader } });
  assert.equal(blockedSiblingSession.status, 404);

  const blockedDelete = await fetch(`${base}/api/private-tutor/learners/${learnerId}`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ confirmDisplayName: "小满" }),
  });
  assert.equal(blockedDelete.status, 403);

  const wrongPin = await fetch(`${base}/api/private-tutor/child-mode/exit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ exitPin: "000000" }),
  });
  assert.equal(wrongPin.status, 401);
  assert.equal((await wrongPin.json()).error, "private_tutor_parent_reverification_failed");

  const exited = await fetch(`${base}/api/private-tutor/child-mode/exit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ exitPin: "618520" }),
  });
  assert.equal(exited.status, 200);
  assert.equal((await exited.json()).active, false);

  const restoredState = await fetch(`${base}/api/state`, { headers: { cookie: cookieHeader } });
  assert.equal(restoredState.status, 200);
});
