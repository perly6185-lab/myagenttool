process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENT_LOCAL_MODE = "1";
process.env.MYAGENT_SECURE_COOKIES = "0";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";

let server;
let base;
let runtimeState;
let deletionFinalizer;
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
  state.teams.push(
    { id: "team_family_a" },
    { id: "team_family_b" },
    { id: "team_personal" },
    { id: "team_migrate" },
  );
  state.users.push(
    { id: "usr_parent_a", teamId: "team_family_a", role: "viewer" },
    { id: "usr_parent_b", teamId: "team_family_b", role: "owner" },
    { id: "usr_admin", teamId: "team_family_b", role: "admin" },
    { id: "usr_reviewer", teamId: "team_family_b", role: "admin" },
    { id: "usr_tutor_reviewer_a", teamId: "team_personal", role: "admin" },
    { id: "usr_tutor_reviewer_b", teamId: "team_personal", role: "admin" },
    { id: "usr_tutor_reviewer_c", teamId: "team_personal", role: "owner" },
    { id: "usr_parent_c", teamId: "team_family_c", role: "viewer" },
    { id: "usr_personal", teamId: "team_personal", role: "viewer" },
    { id: "usr_personal_race", teamId: "team_personal", role: "viewer" },
    { id: "usr_migrate", teamId: "team_migrate", role: "viewer" },
  );
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  state.tokens.push(
    { token: "tok_parent_a", userId: "usr_parent_a", expiresAt },
    { token: "tok_parent_b", userId: "usr_parent_b", expiresAt },
    { token: "tok_admin", userId: "usr_admin", expiresAt },
    { token: "tok_reviewer", userId: "usr_reviewer", expiresAt },
    { token: "tok_tutor_reviewer_a", userId: "usr_tutor_reviewer_a", expiresAt },
    { token: "tok_tutor_reviewer_b", userId: "usr_tutor_reviewer_b", expiresAt },
    { token: "tok_tutor_reviewer_c", userId: "usr_tutor_reviewer_c", expiresAt },
    { token: "tok_parent_c", userId: "usr_parent_c", expiresAt },
    { token: "tok_personal", userId: "usr_personal", expiresAt },
    { token: "tok_personal_race", userId: "usr_personal_race", expiresAt },
    { token: "tok_migrate", userId: "usr_migrate", expiresAt },
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
  deletionFinalizer = httpDependencies.finalizePrivateTutorLearnerDeletion;
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "test",
    protocolVersion: "0.0.0",
    ...httpDependencies,
    finalizePrivateTutorLearnerDeletion: (input) => deletionFinalizer(input),
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

function releaseEvidenceBody(gate, evidenceTarget, evidence = `owner evidence for ${gate.id}`) {
  return {
    gateId: gate.id,
    targetId: evidenceTarget.id,
    status: "passed",
    evidence,
    evidenceType: evidenceTarget.evidenceType,
    environment: evidenceTarget.environment,
    artifactName: `${gate.id}-${evidenceTarget.id}.json`,
    artifactChecksumSha256: "b".repeat(64),
    executedAt: new Date().toISOString(),
  };
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

test("the personal tutor contract creates at most one profile for the current account", async () => {
  const empty = await call("/api/private-tutor/profile", { token: "tok_personal" });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { profile: null, migrationRequired: false });

  const created = await call("/api/private-tutor/profile", {
    token: "tok_personal",
    method: "POST",
    body: { displayName: "小林", grade: "大学课程", curriculumEditionId: "calculus-v1" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.created, true);
  assert.equal(created.body.profile.displayName, "小林");
  assert.equal(created.body.profile.grade, "大学课程");

  const repeated = await call("/api/private-tutor/profile", {
    token: "tok_personal",
    method: "POST",
    body: { displayName: "不应创建第二份", grade: "职业与专业学习" },
  });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.created, false);
  assert.equal(repeated.body.profile.id, created.body.profile.id);
  assert.equal(runtimeState.privateTutorLearners.filter((row) => row.createdBy === "usr_personal").length, 1);

  const loaded = await call("/api/private-tutor/profile", { token: "tok_personal" });
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.profile.id, created.body.profile.id);
});

test("multiple legacy profiles require an explicit migration instead of implicit selection", async () => {
  const response = await call("/api/private-tutor/profile");
  assert.equal(response.status, 409);
  assert.equal(response.body.error, "private_tutor_profile_migration_required");
  assert.equal(response.body.profileCount, 2);
  assert.equal("profiles" in response.body, false);
});

test("parallel profile creation remains idempotent", async () => {
  const results = await Promise.all([
    call("/api/private-tutor/profile", {
      token: "tok_personal_race",
      method: "POST",
      body: { displayName: "并发学习者", grade: "自主学习" },
    }),
    call("/api/private-tutor/profile", {
      token: "tok_personal_race",
      method: "POST",
      body: { displayName: "不应重复", grade: "大学课程" },
    }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 201]);
  assert.equal(results[0].body.profile.id, results[1].body.profile.id);
  assert.equal(runtimeState.privateTutorLearners.filter((row) => row.createdBy === "usr_personal_race").length, 1);
});

test("profile sub-resources resolve the owned profile and stay account-scoped", async () => {
  const owned = await call("/api/private-tutor/profile", { token: "tok_personal" });
  assert.equal(owned.status, 200);
  assert.equal(owned.body.profile != null, true);
  const profileId = owned.body.profile.id;
  const snapshot = await call("/api/private-tutor/profile/snapshot", { token: "tok_personal" });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.snapshot.learnerId, profileId);
  assert.equal(snapshot.body.profile.id, profileId);

  const foreign = await call("/api/private-tutor/profile/snapshot", { token: "tok_personal_race" });
  assert.equal(foreign.status, 200);
  assert.notEqual(foreign.body.snapshot.learnerId, profileId);

  const payload = {
    idempotencyKey: "profile-attempt-001",
    knowledgeId: "balance",
    questionRevisionId: "demo-balance-001-v1",
    rawAnswer: "5",
    responseKind: "answer",
    independent: true,
    usedHint: false,
    source: "screen",
    durationSeconds: 60,
  };
  const attempt = await call("/api/private-tutor/profile/attempts", { token: "tok_personal", method: "POST", body: payload });
  assert.equal(attempt.status, 201);
  assert.equal(attempt.body.attempt.learnerId, profileId);
  assert.equal(attempt.body.learningPlan != null || attempt.body.learnerModel != null, true);

  const replayed = await call("/api/private-tutor/profile/attempts", { token: "tok_personal", method: "POST", body: payload });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);

  const plan = await call("/api/private-tutor/profile/learning-plan", { token: "tok_personal" });
  assert.equal(plan.status, 200);

  const review = await call("/api/private-tutor/profile/review", { token: "tok_personal" });
  assert.equal(review.status, 200);
  assert.equal("reviewBook" in review.body, true);

  const audit = await call("/api/private-tutor/profile/audit", { token: "tok_personal" });
  assert.equal(audit.status, 200);
  assert.equal(audit.body.audit.some((row) => row.action === "attempt_recorded"), true);

  const foreignAudit = await call("/api/private-tutor/profile/audit", { token: "tok_personal_race" });
  assert.equal(foreignAudit.status, 200);
  assert.equal(foreignAudit.body.audit.every((row) => row.learnerId !== profileId), true);
});

test("learning preferences round-trip through the profile route with audit and isolation", async () => {
  const defaults = await call("/api/private-tutor/profile/preferences", { token: "tok_personal" });
  assert.equal(defaults.status, 200);
  assert.equal(defaults.body.preferences.captions, true);
  assert.equal(defaults.body.preferences.dailyMinutes, 20);
  assert.equal(defaults.body.preferences.teacherStyle, "heuristic_guidance");
  assert.equal(defaults.body.preferences.revision, 0);
  // Reading defaults must not persist a row
  assert.equal(runtimeState.privateTutorLearningPreferences.length, 0);

  const updated = await call("/api/private-tutor/profile/preferences", {
    token: "tok_personal",
    method: "PUT",
    body: { captions: false, dailyMinutes: 45, teacherStyle: "socratic_questioning", explanationDepth: "professional_depth" },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.preferences.captions, false);
  assert.equal(updated.body.preferences.dailyMinutes, 45);
  assert.equal(updated.body.preferences.teacherStyle, "socratic_questioning");
  assert.equal(updated.body.preferences.explanationDepth, "professional_depth");
  assert.equal(updated.body.preferences.revision, 1);

  const reloaded = await call("/api/private-tutor/profile/preferences", { token: "tok_personal" });
  assert.equal(reloaded.status, 200);
  assert.equal(reloaded.body.preferences.captions, false);
  assert.equal(reloaded.body.preferences.revision, 1);

  const audit = await call("/api/private-tutor/profile/audit", { token: "tok_personal" });
  assert.equal(audit.body.audit.some((row) => row.action === "learning_preferences_updated"), true);

  const foreign = await call("/api/private-tutor/profile/preferences", { token: "tok_personal_race" });
  assert.equal(foreign.status, 200);
  assert.equal(foreign.body.preferences.captions, true); // unaffected defaults
});

test("learning preferences reject invalid values and require a profile", async () => {
  const badEnum = await call("/api/private-tutor/profile/preferences", {
    token: "tok_personal",
    method: "PUT",
    body: { teacherStyle: "drill_sergeant" },
  });
  assert.equal(badEnum.status, 400);
  assert.equal(badEnum.body.error, "invalid_teacher_style");

  const badBool = await call("/api/private-tutor/profile/preferences", {
    token: "tok_personal",
    method: "PUT",
    body: { captions: "yes" },
  });
  assert.equal(badBool.status, 400);

  const nested = await call("/api/private-tutor/profile/preferences", {
    token: "tok_personal",
    method: "PUT",
    body: { preferences: { dailyMinutes: 30, planIntensity: "intensive" } },
  });
  assert.equal(nested.status, 200);
  assert.equal(nested.body.preferences.dailyMinutes, 30);
  assert.equal(nested.body.preferences.planIntensity, "intensive");
  assert.equal(nested.body.preferences.captions, false); // preserved from previous test

  const missing = await call("/api/private-tutor/profile/preferences", { token: "tok_parent_c", method: "PUT", body: { captions: true } });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "private_tutor_profile_required");
});

test("profile migration report-first merges legacy profiles with rollback check", async () => {
  const seed = await call("/api/private-tutor/profile", {
    token: "tok_migrate",
    method: "POST",
    body: { displayName: "迁移保留档案", grade: "七年级" },
  });
  assert.equal(seed.status, 201);
  const seededKeepId = seed.body.profile.id;

  // The seeded profile must stay the recommended keep candidate, so give the
  // injected legacy profile a strictly older timestamp (sub-ms clock
  // resolution can otherwise tie the two createdAt values).
  const legacyCreatedAt = new Date(Date.parse(seed.body.profile.createdAt) - 60_000).toISOString();
  const legacy = {
    id: "lrn_legacy_merge",
    ownerTeamId: "team_migrate",
    displayName: "旧档案",
    grade: "七年级",
    curriculumEditionId: null,
    status: "active",
    createdAt: legacyCreatedAt,
    createdBy: "usr_migrate",
    updatedAt: legacyCreatedAt,
  };
  runtimeState.privateTutorLearners.unshift(legacy);

  const gated = await call("/api/private-tutor/profile", { token: "tok_migrate" });
  assert.equal(gated.status, 409);
  assert.equal(gated.body.error, "private_tutor_profile_migration_required");
  const gatedSnapshot = await call("/api/private-tutor/profile/snapshot", { token: "tok_migrate" });
  assert.equal(gatedSnapshot.status, 409);
  assert.equal(gatedSnapshot.body.error, "private_tutor_profile_migration_required");

  const report = await call("/api/private-tutor/profile/migration", { token: "tok_migrate" });
  assert.equal(report.status, 200);
  assert.equal(report.body.migrationRequired, true);
  assert.equal(report.body.candidates.length, 2);
  const keepLearnerId = report.body.recommendedKeepLearnerId;
  assert.equal(typeof keepLearnerId, "string");
  assert.equal(keepLearnerId, seededKeepId);
  const discardLearnerId = report.body.candidates.find((row) => row.learnerId !== keepLearnerId)?.learnerId;
  assert.equal(typeof discardLearnerId, "string");

  const dryRun = await call("/api/private-tutor/profile/migration", {
    token: "tok_migrate",
    method: "POST",
    body: { keepLearnerId, discardLearnerIds: [discardLearnerId], dryRun: true },
  });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.merged, false);
  assert.equal(dryRun.body.dryRun, true);
  assert.equal(runtimeState.privateTutorLearners.some((row) => row.id === discardLearnerId && row.status === "active"), true);

  const invalid = await call("/api/private-tutor/profile/migration", {
    token: "tok_migrate",
    method: "POST",
    body: { keepLearnerId, discardLearnerIds: [keepLearnerId] },
  });
  assert.equal(invalid.status, 400);

  const foreignMerge = await call("/api/private-tutor/profile/migration", {
    token: "tok_parent_b",
    method: "POST",
    body: { keepLearnerId, discardLearnerIds: [discardLearnerId] },
  });
  assert.equal(foreignMerge.status, 404);

  const merged = await call("/api/private-tutor/profile/migration", {
    token: "tok_migrate",
    method: "POST",
    body: { keepLearnerId, discardLearnerIds: [discardLearnerId] },
  });
  assert.equal(merged.status, 200);
  assert.equal(merged.body.merged, true);
  assert.equal("rollbackSnapshot" in merged.body, false);
  assert.equal(typeof merged.body.rollbackReceipt.id, "string");
  assert.equal(
    merged.body.rollbackReceipt.rollbackCheck.residualDiscardReferences,
    merged.body.rollbackReceipt.rollbackCheck.expectedResidualDiscardReferences,
  );
  assert.equal(runtimeState.privateTutorAttempts.every((row) => row.learnerId !== discardLearnerId), true);
  const discarded = runtimeState.privateTutorLearners.find((row) => row.id === discardLearnerId);
  assert.equal(discarded.status, "merged");
  assert.equal(discarded.mergedIntoLearnerId, keepLearnerId);
  assert.equal(runtimeState.privateTutorAuditEvents.some((row) => row.action === "private_tutor_profile_merged" && row.learnerId === keepLearnerId), true);

  const resolved = await call("/api/private-tutor/profile", { token: "tok_migrate" });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.profile.id, keepLearnerId);
  const reportAfter = await call("/api/private-tutor/profile/migration", { token: "tok_migrate" });
  assert.equal(reportAfter.body.migrationRequired, false);
});

test("profile deletion removes the owned profile and unlocks recreation", async () => {
  const preview = await call("/api/private-tutor/profile/guardian/deletion-preview", { token: "tok_personal" });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.preview.totalRecords > 0, true);

  const rejected = await call("/api/private-tutor/profile", {
    token: "tok_personal",
    method: "DELETE",
    body: { confirmDisplayName: "错误名字" },
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error, "private_tutor_delete_confirmation_required");

  const deleted = await call("/api/private-tutor/profile", {
    token: "tok_personal",
    method: "DELETE",
    body: { confirmDisplayName: "小林" },
  });
  assert.equal(deleted.status, 200);
  assert.equal(typeof deleted.body.deletedId, "string");
  assert.equal(deleted.body.deletionReport.liveStateResidualCount, 0);
  assert.equal(deleted.body.deletionReport.durableVerification.ok, true);

  const missing = await call("/api/private-tutor/profile/snapshot", { token: "tok_personal" });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "private_tutor_profile_required");

  const recreated = await call("/api/private-tutor/profile", {
    token: "tok_personal",
    method: "POST",
    body: { displayName: "小林", grade: "大学课程" },
  });
  assert.equal(recreated.status, 201);
  assert.equal(recreated.body.created, true);
});

test("child mode stays blocked from every profile route", async () => {
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
    body: JSON.stringify({ displayName: "小满二号", grade: "六年级" }),
  });
  assert.equal(created.status, 201);
  const learnerId = (await created.json()).learner.id;

  const entered = await fetch(`${base}/api/private-tutor/child-mode`, {
    method: "POST",
    headers,
    body: JSON.stringify({ learnerId, exitPin: "618520" }),
  });
  assert.equal(entered.status, 201);

  for (const [method, path] of [
    ["GET", "/api/private-tutor/profile"],
    ["GET", "/api/private-tutor/profile/snapshot"],
    ["GET", "/api/private-tutor/profile/learning-plan"],
    ["GET", "/api/private-tutor/profile/review"],
    ["GET", "/api/private-tutor/profile/audit"],
    ["GET", "/api/private-tutor/profile/migration"],
    ["POST", "/api/private-tutor/profile/migration"],
  ]) {
    const blocked = await fetch(`${base}${path}`, { method, headers, body: method === "POST" ? "{}" : undefined });
    assert.equal(blocked.status, 403, path);
    assert.equal((await blocked.json()).error, "private_tutor_child_mode_restricted", path);
  }

  const exited = await fetch(`${base}/api/private-tutor/child-mode/exit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ exitPin: "618520" }),
  });
  assert.equal(exited.status, 200);
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
  assert.equal(tutoringSession.currentActivity.visualScene.template, "equation_balance");
  assert.equal(tutoringSession.currentActivity.visualScene.publication.mathValidated, true);
  assert.equal(JSON.stringify(tutoringSession).includes("expectedRational"), false);

  const bypassedSession = await call(`/api/private-tutor/learners/${learnerId}/attempts`, {
    method: "POST",
    body: { idempotencyKey: "session-bypass", knowledgeId: "balance", questionRevisionId: tutoringSession.currentActivity.question.revisionId, rawAnswer: "5", responseKind: "answer", independent: true, usedHint: false, source: "screen", durationSeconds: 1 },
  });
  assert.equal(bypassedSession.status, 400);
  assert.equal(bypassedSession.body.error, "invalid_private_tutor_attempt_reference");

  const recalled = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/${tutoringSession.id}/actions`, {
    method: "POST",
    body: { action: "answer", idempotencyKey: "session-recall-1", questionRevisionId: tutoringSession.currentActivity.question.revisionId, rawAnswer: "5", responseKind: "answer", source: "visual" },
  });
  assert.equal(recalled.status, 201);
  assert.equal(runtimeState.privateTutorAttempts[0].source, "visual");
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
  const rejectedAudio = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/${tutoringSession.id}/voice-turns`, {
    method: "POST",
    body: { clientTurnId: "voice-raw-audio", transcript: "五", confidence: 0.9, audioBase64: "not-accepted" },
  });
  assert.equal(rejectedAudio.status, 400);
  assert.equal(rejectedAudio.body.error, "private_tutor_raw_audio_not_accepted");

  const attemptsBeforeSessionVoice = runtimeState.privateTutorAttempts.length;
  const snapshotBeforeSessionVoice = JSON.stringify(runtimeState.privateTutorSnapshots.find((row) => row.learnerId === learnerId));
  const normalizedVoice = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/${tutoringSession.id}/voice-turns`, {
    method: "POST",
    body: {
      clientTurnId: "voice-guided-low-confidence",
      transcript: "x 等于 五",
      confidence: 0.54,
      alternatives: ["x 等于 四"],
      mode: "push_to_talk",
      provider: "browser_web_speech",
    },
  });
  assert.equal(normalizedVoice.status, 201);
  assert.equal(normalizedVoice.body.voiceTurn.normalizedExpression, "x=5");
  assert.equal(normalizedVoice.body.voiceTurn.status, "confirmation_required");
  assert.deepEqual(normalizedVoice.body.voiceTurn.reasonCodes, ["low_confidence", "alternative_mismatch"]);
  assert.equal(runtimeState.privateTutorAttempts.length, attemptsBeforeSessionVoice);
  assert.equal(JSON.stringify(runtimeState.privateTutorSnapshots.find((row) => row.learnerId === learnerId)), snapshotBeforeSessionVoice);

  const voiceConfirmPayload = {
    action: "answer",
    idempotencyKey: "session-guided-correct",
    voiceTurnId: normalizedVoice.body.voiceTurn.id,
    responseKind: "answer",
  };
  const guided = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/${tutoringSession.id}/actions`, {
    method: "POST",
    body: voiceConfirmPayload,
  });
  assert.equal(guided.status, 201);
  assert.equal(guided.body.answer.correct, true);
  assert.equal(guided.body.voiceTurn.status, "confirmed");
  assert.equal(guided.body.voiceTurn.attemptId, runtimeState.privateTutorAttempts[0].id);
  const replayedVoice = await call(`/api/private-tutor/learners/${learnerId}/tutoring-sessions/${tutoringSession.id}/actions`, { method: "POST", body: voiceConfirmPayload });
  assert.equal(replayedVoice.status, 200);
  assert.equal(replayedVoice.body.replayed, true);
  assert.equal(runtimeState.privateTutorAttempts.length, attemptsBeforeSessionVoice + 1);
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

test("review and family routes preserve learner isolation and low-pressure defaults", async () => {
  const learnerId = runtimeState.testPrivateTutorLearnerIds[0];
  const review = await call(`/api/private-tutor/learners/${learnerId}/review`);
  assert.equal(review.status, 200);
  assert.equal(review.body.reviewBook.counts.challengeToday >= 1, true);
  const theme = review.body.reviewBook.themes.find((row) => row.schedule?.due);
  assert.ok(theme);
  assert.equal(theme.schedule.phase, "correction");

  const corrected = await call(`/api/private-tutor/learners/${learnerId}/review/themes/${theme.id}/diagnosis`, {
    method: "POST",
    body: { correction: "方法会了，这一次是计算失误。" },
  });
  assert.equal(corrected.status, 200);
  assert.equal(corrected.body.reviewBook.themes.find((row) => row.id === theme.id).learnerDiagnosisCorrection, "方法会了，这一次是计算失误。");

  const answerPayload = {
    idempotencyKey: "review-correction-001",
    questionRevisionId: theme.schedule.question.revisionId,
    rawAnswer: "5",
    responseKind: "answer",
    source: "screen",
  };
  const answered = await call(`/api/private-tutor/learners/${learnerId}/review/schedules/${theme.schedule.id}/answers`, { method: "POST", body: answerPayload });
  assert.equal(answered.status, 201);
  assert.equal(answered.body.attempt.context, "review");
  assert.equal(answered.body.schedule.phase, "similar");
  assert.equal(answered.body.reviewBook.themes.find((row) => row.id === theme.id).status, "challenge_today");
  const replayed = await call(`/api/private-tutor/learners/${learnerId}/review/schedules/${theme.schedule.id}/answers`, { method: "POST", body: answerPayload });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);

  const report = await call(`/api/private-tutor/learners/${learnerId}/guardian/weekly-report`);
  assert.equal(report.status, 200);
  assert.deepEqual(report.body.report.pressureSafety, { rankingShown: false, dailyErrorAlertEnabled: false, comparisonWithOthers: false });
  const defaults = await call(`/api/private-tutor/learners/${learnerId}/guardian/preferences`);
  assert.equal(defaults.body.preferences.notificationFrequency, "weekly");
  const rejectedAlerts = await call(`/api/private-tutor/learners/${learnerId}/guardian/preferences`, { method: "PUT", body: { notificationFrequency: "weekly", dailyErrorAlerts: true } });
  assert.equal(rejectedAlerts.status, 400);
  const saved = await call(`/api/private-tutor/learners/${learnerId}/guardian/preferences`, { method: "PUT", body: { notificationFrequency: "off", weeklyProgressSummary: false, quietHours: { enabled: true, start: "21:00", end: "07:30" } } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.preferences.dailyErrorAlerts, false);
  assert.equal(saved.body.preferences.quietHours.start, "21:00");

  const foreignReview = await call(`/api/private-tutor/learners/${learnerId}/review`, { token: "tok_parent_b" });
  const foreignReport = await call(`/api/private-tutor/learners/${learnerId}/guardian/weekly-report`, { token: "tok_parent_b" });
  assert.equal(foreignReview.status, 404);
  assert.equal(foreignReport.status, 404);
});

test("only professional roles can clear every release gate before starting one bounded pilot", async () => {
  const forbidden = await call("/api/private-tutor/release-readiness");
  assert.equal(forbidden.status, 403);

  const initial = await call("/api/private-tutor/release-readiness", { token: "tok_parent_b" });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.readiness.ready, false);
  assert.equal(initial.body.readiness.gates.length, 8);
  const invalidArtifact = await call("/api/private-tutor/release-readiness/evaluations", {
    token: "tok_parent_b",
    method: "POST",
    body: { ...releaseEvidenceBody(initial.body.readiness.gates[0], initial.body.readiness.gates[0].targets[0]), artifactChecksumSha256: "unsafe" },
  });
  assert.equal(invalidArtifact.status, 400);
  for (const gate of initial.body.readiness.gates) {
    for (const evidenceTarget of gate.targets) {
      const evaluated = await call("/api/private-tutor/release-readiness/evaluations", {
        token: "tok_parent_b",
        method: "POST",
        body: releaseEvidenceBody(gate, evidenceTarget),
      });
      assert.equal(evaluated.status, 201);
      assert.equal(evaluated.body.evaluation.contractVersion, 2);
      assert.equal(evaluated.body.evaluation.reviewerId, "usr_parent_b");
    }
  }
  const oneReviewerShort = await call("/api/private-tutor/release-readiness", { token: "tok_parent_b" });
  assert.equal(oneReviewerShort.body.readiness.ready, false);
  assert.equal(oneReviewerShort.body.readiness.gates.find((gate) => gate.id === "math_content").passedReviewers, 1);
  const blockedPilot = await call("/api/private-tutor/pilot", { token: "tok_parent_b", method: "POST", body: { participantTarget: 50, responseOwner: "安全负责人" } });
  assert.equal(blockedPilot.status, 409);

  const secondReview = await call("/api/private-tutor/release-readiness/evaluations", {
    token: "tok_admin",
    method: "POST",
    body: releaseEvidenceBody(
      initial.body.readiness.gates.find((gate) => gate.id === "math_content"),
      initial.body.readiness.gates.find((gate) => gate.id === "math_content").targets[0],
      "second independent math review",
    ),
  });
  assert.equal(secondReview.status, 201);
  assert.equal(secondReview.body.evaluation.reviewerId, "usr_admin");
  assert.equal(secondReview.body.readiness.ready, true);
  assert.equal(secondReview.body.readiness.gates.find((gate) => gate.id === "math_content").passedReviewers, 2);

  const started = await call("/api/private-tutor/pilot", { token: "tok_parent_b", method: "POST", body: { participantTarget: 50, responseOwner: "安全负责人" } });
  assert.equal(started.status, 201);
  assert.equal(started.body.cohort.durationDays, 7);
  assert.equal(started.body.cohort.participantTarget, 50);
  assert.equal(started.body.cohort.exitPolicy, "guardian_can_withdraw_and_request_deletion");
  const duplicate = await call("/api/private-tutor/pilot", { token: "tok_admin", method: "POST", body: { participantTarget: 30, responseOwner: "备用负责人" } });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, "private_tutor_pilot_already_active");
});

test("pilot participation requires versioned consent and supports check-in, escalation, pause, resume, and withdrawal", async () => {
  const learnerId = runtimeState.testPrivateTutorLearnerIds[0];
  const initial = await call(`/api/private-tutor/learners/${learnerId}/guardian/pilot`);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.pilot.canJoin, true);
  assert.match(initial.body.pilot.consentDocument.version, /^2026-08-21/);
  assert.equal("enrolledLearnerIds" in initial.body.pilot.cohort, false);

  const incomplete = await call(`/api/private-tutor/learners/${learnerId}/guardian/pilot/consent`, {
    method: "POST",
    body: { cohortId: initial.body.pilot.cohort.id, consentDocumentId: initial.body.pilot.consentDocument.id, acknowledgements: { guardianAuthority: true } },
  });
  assert.equal(incomplete.status, 400);
  assert.equal(incomplete.body.error, "private_tutor_pilot_consent_incomplete");

  const accepted = await call(`/api/private-tutor/learners/${learnerId}/guardian/pilot/consent`, {
    method: "POST",
    body: {
      cohortId: initial.body.pilot.cohort.id,
      consentDocumentId: initial.body.pilot.consentDocument.id,
      acknowledgements: {
        guardianAuthority: true, scopeUnderstood: true, dataUseUnderstood: true,
        voluntaryParticipation: true, withdrawalUnderstood: true, childWillingnessDiscussed: true,
      },
    },
  });
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.consent.documentChecksum, initial.body.pilot.consentDocument.checksum);

  const checkedIn = await call(`/api/private-tutor/learners/${learnerId}/guardian/pilot/check-ins`, {
    method: "POST", body: { guardianPressure: "manageable", childWillingToReturn: "yes" },
  });
  assert.equal(checkedIn.status, 200);

  const incident = await call(`/api/private-tutor/learners/${learnerId}/guardian/pilot/incidents`, {
    method: "POST", body: { category: "child_distress", needsImmediateStop: true, summary: "孩子出现明显不适，请立即停止试点。" },
  });
  assert.equal(incident.status, 200);
  assert.equal(incident.body.incident.status, "escalated");
  assert.equal(incident.body.cohort.status, "paused");
  const pausedLearning = await call(`/api/private-tutor/learners/${learnerId}/attempts`, { method: "POST", body: {} });
  assert.equal(pausedLearning.status, 423);
  assert.equal(pausedLearning.body.error, "private_tutor_pilot_paused");
  assert.match(pausedLearning.body.message, /今天先休息一下/);
  assert.deepEqual(Object.keys(pausedLearning.body.pause), ["pausedAt"]);
  const pausedAssessment = await call(`/api/private-tutor/learners/${learnerId}/assessments/start`, { method: "POST", body: {} });
  assert.equal(pausedAssessment.status, 423);
  assert.equal(pausedAssessment.body.error, "private_tutor_pilot_paused");
  const foreignPausedWrite = await call(`/api/private-tutor/learners/${learnerId}/attempts`, { token: "tok_parent_b", method: "POST", body: {} });
  assert.equal(foreignPausedWrite.status, 404);
  assert.deepEqual(foreignPausedWrite.body, { error: "private_tutor_learner_not_found" });

  const forbiddenOperations = await call("/api/private-tutor/pilot/operations");
  assert.equal(forbiddenOperations.status, 403);
  const operations = await call("/api/private-tutor/pilot/operations", { token: "tok_admin" });
  assert.equal(operations.status, 200);
  assert.equal(operations.body.operations.metrics[0].enrollment.active, 1);
  assert.equal(operations.body.operations.metrics[0].experience.guardianPressure.manageable, 1);
  assert.equal(JSON.stringify(operations.body.operations.metrics).includes(learnerId), false);

  const blockedResume = await call(`/api/private-tutor/pilot/cohorts/${initial.body.pilot.cohort.id}/resume`, {
    token: "tok_admin", method: "POST", body: { reason: "准备恢复试点" },
  });
  assert.equal(blockedResume.status, 409);
  assert.equal(blockedResume.body.error, "private_tutor_pilot_critical_incident_open");
  const resolved = await call(`/api/private-tutor/pilot/incidents/${incident.body.incident.id}`, {
    token: "tok_admin", method: "POST", body: { action: "resolve", resolution: "已联系监护人并完成安全复核。" },
  });
  assert.equal(resolved.status, 200);
  const resumed = await call(`/api/private-tutor/pilot/cohorts/${initial.body.pilot.cohort.id}/resume`, {
    token: "tok_admin", method: "POST", body: { reason: "安全负责人确认可以恢复" },
  });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.cohort.status, "active");

  const withdrawn = await call(`/api/private-tutor/learners/${learnerId}/guardian/pilot/withdraw`, {
    method: "POST", body: { reason: "child_choice", deletionRequested: true },
  });
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.participation.status, "withdrawn");
  assert.equal(withdrawn.body.deletionRequest.status, "pending_parent_confirmation");
});

test("professional content API requires two independent reviews and gates runtime use by release state", async () => {
  const forbidden = await call("/api/private-tutor/content/questions");
  assert.equal(forbidden.status, 403);

  const created = await call("/api/private-tutor/content/questions", {
    token: "tok_parent_b",
    method: "POST",
    body: {
      questionId: "demo-balance-001",
      context: "practice",
      knowledgeId: "balance",
      difficulty: 2,
      kind: "numeric",
      prompt: "x + 6 = 14，x 是多少？",
      expectedAnswer: "8",
      allowVariableAssignment: true,
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.revision.version, 2);
  const revisionId = created.body.revision.id;

  const learnerId = runtimeState.testPrivateTutorLearnerIds[0];
  const draftAttempt = await call(`/api/private-tutor/learners/${learnerId}/attempts`, {
    method: "POST",
    body: { idempotencyKey: "draft-content-blocked", knowledgeId: "balance", questionRevisionId: revisionId, rawAnswer: "8", responseKind: "answer", source: "screen" },
  });
  assert.equal(draftAttempt.status, 400);

  assert.equal((await call(`/api/private-tutor/content/questions/${revisionId}/submit`, { token: "tok_parent_b", method: "POST", body: {} })).status, 200);
  const selfReview = await call(`/api/private-tutor/content/questions/${revisionId}/reviews`, {
    token: "tok_parent_b", method: "POST", body: { decision: "approved", evidence: "作者自审" },
  });
  assert.equal(selfReview.status, 409);
  for (const [token, evidence] of [["tok_admin", "第一位独立审核验算通过"], ["tok_reviewer", "第二位独立审核复核通过"]]) {
    const reviewed = await call(`/api/private-tutor/content/questions/${revisionId}/reviews`, {
      token, method: "POST", body: { decision: "approved", evidence },
    });
    assert.equal(reviewed.status, 200);
  }
  const published = await call(`/api/private-tutor/content/questions/${revisionId}/publish`, { token: "tok_parent_b", method: "POST", body: {} });
  assert.equal(published.status, 200);
  assert.equal(published.body.revision.active, true);
  const governedCohort = runtimeState.privateTutorPilotCohorts[0];
  assert.equal(governedCohort.status, "paused");
  assert.match(governedCohort.pauseReason, /release_gates_blocked/);
  const releaseBlockedResume = await call(`/api/private-tutor/pilot/cohorts/${governedCohort.id}/resume`, {
    token: "tok_admin", method: "POST", body: { reason: "尝试在未重新验证时恢复" },
  });
  assert.equal(releaseBlockedResume.status, 409);
  assert.equal(releaseBlockedResume.body.error, "private_tutor_release_gates_blocked");

  const releasedAttempt = await call(`/api/private-tutor/learners/${learnerId}/attempts`, {
    method: "POST",
    body: { idempotencyKey: "released-content-accepted", knowledgeId: "balance", questionRevisionId: revisionId, rawAnswer: "x=8", responseKind: "answer", source: "screen" },
  });
  assert.equal(releasedAttempt.status, 201);
  assert.equal(releasedAttempt.body.attempt.correct, true);

  const disabled = await call(`/api/private-tutor/content/questions/${revisionId}/disable`, {
    token: "tok_admin", method: "POST", body: { reason: "试运行发现题干需要复查" },
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.activeRevisionId, null);
  const disabledAttempt = await call(`/api/private-tutor/learners/${learnerId}/attempts`, {
    method: "POST",
    body: { idempotencyKey: "disabled-content-blocked", knowledgeId: "balance", questionRevisionId: revisionId, rawAnswer: "8", responseKind: "answer", source: "screen" },
  });
  assert.equal(disabledAttempt.status, 400);

  const rollback = await call("/api/private-tutor/content/questions/demo-balance-001/rollback", {
    token: "tok_admin", method: "POST", body: { revisionId: "demo-balance-001-v1", reason: "恢复已验证的演示版本" },
  });
  assert.equal(rollback.status, 200);
  assert.equal(rollback.body.activeRevisionId, "demo-balance-001-v1");
  const listed = await call("/api/private-tutor/content/questions", { token: "tok_admin" });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.revisions.find((row) => row.id === revisionId).status, "disabled");
  assert.equal(listed.body.revisions.find((row) => row.id === "demo-balance-001-v1").active, true);
});

test("guardian invitation, export, retention policy, and deletion preview stay learner-scoped", async () => {
  const learnerId = runtimeState.testPrivateTutorLearnerIds[0];
  const siblingId = runtimeState.testPrivateTutorLearnerIds[1];
  const created = await call(`/api/private-tutor/learners/${learnerId}/guardian/invitations`, {
    method: "POST",
    body: { inviteeLabel: "另一位监护人", permissions: ["read", "write", "manage"] },
  });
  assert.equal(created.status, 201);
  assert.equal(typeof created.body.invitationToken, "string");
  assert.equal("tokenHash" in created.body.invitation, false);
  const invitationToken = created.body.invitationToken;
  const storedInvitation = runtimeState.privateTutorGuardianInvitations.find((row) => row.id === created.body.invitation.id);
  assert.equal(storedInvitation.tokenHash.includes(invitationToken), false);

  const listed = await call(`/api/private-tutor/learners/${learnerId}/guardian/invitations`);
  assert.equal(listed.status, 200);
  assert.equal(JSON.stringify(listed.body).includes(storedInvitation.tokenHash), false);
  const accepted = await call("/api/private-tutor/guardian-invitations/accept", {
    token: "tok_parent_c", method: "POST", body: { invitationToken },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.guardianLink.guardianUserId, "usr_parent_c");
  assert.equal((await call(`/api/private-tutor/learners/${learnerId}/snapshot`, { token: "tok_parent_c" })).status, 200);
  assert.equal((await call(`/api/private-tutor/learners/${siblingId}/snapshot`, { token: "tok_parent_c" })).status, 404);
  const acceptedLink = runtimeState.privateTutorGuardianLinks.find((row) => row.id === accepted.body.guardianLink.id);
  acceptedLink.permissions = ["read"];
  assert.equal((await call(`/api/private-tutor/learners/${learnerId}/guardian/data-policy`, { token: "tok_parent_c" })).status, 404);
  assert.equal((await call(`/api/private-tutor/learners/${learnerId}/attempts`, {
    token: "tok_parent_c", method: "POST",
    body: { idempotencyKey: "read-only-write-blocked", knowledgeId: "balance", questionRevisionId: "demo-balance-001-v1", rawAnswer: "5", responseKind: "answer", source: "screen" },
  })).status, 404);
  acceptedLink.permissions = ["read", "write", "manage"];

  const dataExport = await call(`/api/private-tutor/learners/${learnerId}/guardian/data-export`, { token: "tok_parent_c" });
  assert.equal(dataExport.status, 200);
  const serializedExport = JSON.stringify(dataExport.body.bundle);
  assert.equal(serializedExport.includes(invitationToken), false);
  assert.equal(serializedExport.includes(storedInvitation.tokenHash), false);
  assert.equal(serializedExport.includes(siblingId), false);

  const rejectedPolicy = await call(`/api/private-tutor/learners/${learnerId}/guardian/data-policy`, {
    token: "tok_parent_c", method: "PUT",
    body: { rawAudioDays: 7, voiceTranscriptDays: 30, derivedProfileHistoryDays: 365, learningEvidenceRetention: "until_learner_deletion" },
  });
  assert.equal(rejectedPolicy.status, 400);
  const savedPolicy = await call(`/api/private-tutor/learners/${learnerId}/guardian/data-policy`, {
    token: "tok_parent_c", method: "PUT",
    body: { rawAudioDays: 0, voiceTranscriptDays: 7, derivedProfileHistoryDays: 180, learningEvidenceRetention: "until_learner_deletion" },
  });
  assert.equal(savedPolicy.status, 200);
  assert.equal(savedPolicy.body.policy.rawAudioDays, 0);
  assert.equal(savedPolicy.body.policy.voiceTranscriptDays, 7);

  const preview = await call(`/api/private-tutor/learners/${learnerId}/guardian/deletion-preview`, { token: "tok_parent_c" });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.preview.totalRecords > 0, true);
  assert.equal(preview.body.preview.requiresExactDisplayName, true);
});

test("parent-confirmed deletion removes every child data collection and leaves an audit tombstone", async () => {
  const learnerId = runtimeState.testPrivateTutorLearnerIds[1];
  runtimeState.privateTutorSessions.push({ id: "ptsess_delete", learnerId, ownerTeamId: "team_family_a" });
  runtimeState.privateTutorSessionEvents.push({ id: "ptse_delete", learnerId, sessionId: "ptsess_delete", ownerTeamId: "team_family_a" });
  runtimeState.privateTutorVoiceTurns.push({ id: "ptvt_delete", learnerId, sessionId: "ptsess_delete", ownerTeamId: "team_family_a" });
  runtimeState.privateTutorVoiceEvents.push({ id: "ptve_delete", learnerId, sessionId: "ptsess_delete", ownerTeamId: "team_family_a" });
  runtimeState.privateTutorErrorCases.push({ id: "ptec_delete", learnerId, ownerTeamId: "team_family_a" });
  runtimeState.privateTutorErrorThemes.push({ id: "ptet_delete", learnerId, ownerTeamId: "team_family_a" });
  runtimeState.privateTutorReviewSchedules.push({ id: "ptrs_delete", learnerId, ownerTeamId: "team_family_a" });
  runtimeState.privateTutorGuardianPreferences.push({ id: "ptgp_delete", learnerId, guardianUserId: "usr_parent_a" });
  runtimeState.privateTutorGuardianInvitations.push({ id: "ptgi_delete", learnerId, ownerTeamId: "team_family_a", tokenHash: "secret-hash" });
  runtimeState.privateTutorDataPolicies.push({ id: "ptdp_delete", learnerId, ownerTeamId: "team_family_a" });
  const cohortId = runtimeState.privateTutorPilotCohorts[0].id;
  runtimeState.privateTutorPilotCohorts[0].enrolledLearnerIds.push(learnerId);
  runtimeState.privateTutorPilotParticipations.push({ id: "ptpp_delete", cohortId, learnerId, ownerTeamId: "team_family_a" });
  runtimeState.privateTutorPilotConsents.push({ id: "ptcn_delete", cohortId, learnerId, ownerTeamId: "team_family_a" });
  runtimeState.privateTutorPilotIncidents.push({ id: "ptin_delete", cohortId, learnerId, ownerTeamId: "team_family_a" });
  runtimeState.privateTutorPilotCheckIns.push({ id: "ptci_delete", cohortId, learnerId, ownerTeamId: "team_family_a" });
  runtimeState.privateTutorPilotDeletionRequests.push({ id: "ptpd_delete", cohortId, learnerId, ownerTeamId: "team_family_a" });
  const boundSession = { id: "idsess_delete", userId: "usr_local", teamId: "team_local", createdAt: "2026-08-21T00:00:00.000Z" };
  runtimeState.identitySessions.push(boundSession);
  boundSession.privateTutorChildMode = { learnerId, verifiedAt: "2026-08-21T00:00:00.000Z" };
  const preview = await call(`/api/private-tutor/learners/${learnerId}/guardian/deletion-preview`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.preview.collectionCounts.privateTutorChildModeSessions, 1);
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
    "privateTutorVoiceTurns",
    "privateTutorVoiceEvents",
    "privateTutorIdempotencyRecords",
    "privateTutorErrorCases",
    "privateTutorErrorThemes",
    "privateTutorReviewSchedules",
    "privateTutorGuardianPreferences",
    "privateTutorGuardianInvitations",
    "privateTutorDataPolicies",
    "privateTutorPilotParticipations",
    "privateTutorPilotConsents",
    "privateTutorPilotIncidents",
    "privateTutorPilotCheckIns",
    "privateTutorPilotDeletionRequests",
  ]) {
    assert.equal(runtimeState[key].some((row) => row.id === learnerId || row.learnerId === learnerId), false, key);
  }
  assert.equal(runtimeState.privateTutorPilotCohorts[0].enrolledLearnerIds.includes(learnerId), false);
  assert.equal(boundSession.privateTutorChildMode, undefined);
  assert.equal(runtimeState.privateTutorAuditEvents.some((row) => row.learnerId?.startsWith("deleted:") && row.action === "learner_deleted"), true);
  assert.equal(deleted.body.deletionReport.liveStateResidualCount, 0);
  assert.equal(deleted.body.deletionReport.durableVerification.backing, "memory");
  assert.equal(deleted.body.deletionReport.durableVerification.durableResidualCount, 0);
  assert.equal(deleted.body.deletionReport.durableVerification.ok, true);
});

test("deletion never returns success when durable verification fails", async () => {
  const created = await call("/api/private-tutor/learners", { method: "POST", body: { displayName: "待验证", grade: "六年级" } });
  assert.equal(created.status, 201);
  const originalFinalizer = deletionFinalizer;
  deletionFinalizer = () => ({
    backing: "sqlite", durableResidualCount: 1, secureDelete: false, walCheckpointed: false,
    checkpointBusy: 1, remainingLogFrames: 1, logicalPersistenceSucceeded: false,
    jsonRollbackArtifactUpdated: false, reportPersisted: false, compactionError: "injected failure", ok: false,
  });
  let reportId;
  try {
    const failed = await call(`/api/private-tutor/learners/${created.body.learner.id}`, {
      method: "DELETE", body: { confirmDisplayName: "待验证" },
    });
    assert.equal(failed.status, 503);
    assert.equal(failed.body.error, "private_tutor_deletion_verification_failed");
    assert.equal(failed.body.deletionReport.durableVerification.ok, false);
    reportId = failed.body.deletionReport.id;
  } finally {
    deletionFinalizer = originalFinalizer;
  }
  const pending = await call("/api/private-tutor/deletions");
  assert.equal(pending.status, 200);
  assert.deepEqual(pending.body.deletions.map((row) => row.reportId), [reportId]);
  assert.equal("subjectId" in pending.body.deletions[0], false);
  const retried = await call(`/api/private-tutor/deletions/${reportId}/retry`, { method: "POST" });
  assert.equal(retried.status, 200);
  assert.equal(retried.body.deletionReport.status, "completed");
  const job = runtimeState.privateTutorDeletionJobs.find((row) => row.reportId === reportId);
  assert.equal(job.status, "completed");
  assert.equal(job.subjectId, null);
  const completed = await call("/api/private-tutor/deletions");
  assert.deepEqual(completed.body.deletions, []);
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

test("supports material upload, draft generation, editing, and publishing into a custom content package", async () => {
  const markdownText = `# Section 1: Algorithms
Introduction to sorting algorithms.
## Topic 1.1: Bubble Sort
Details on bubble sort.
### Concept: Swapping
- 目标: Understand element swaps.
- 问题: Why do we swap elements?
`;

  // 1. Upload Material
  const uploadRes = await call("/api/private-tutor/materials", {
    token: "tok_personal",
    method: "POST",
    body: {
      fileName: "algo.md",
      fileType: "markdown",
      fileContent: markdownText,
    },
  });
  assert.equal(uploadRes.status, 201);
  assert.ok(uploadRes.body.material.id);
  const materialId = uploadRes.body.material.id;

  // 2. List Materials
  const listRes = await call("/api/private-tutor/materials", { token: "tok_personal" });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.materials.length, 1);
  assert.equal(listRes.body.materials[0].id, materialId);

  // 3. Generate Draft
  const draftRes = await call(`/api/private-tutor/materials/${materialId}/generate-draft`, {
    token: "tok_personal",
    method: "POST",
    body: {
      packageName: "Custom Algorithms Package",
      subjectId: "computer_science",
      domain: "algorithms",
    },
  });
  assert.equal(draftRes.status, 201);
  assert.ok(draftRes.body.draft.id);
  const draftId = draftRes.body.draft.id;
  assert.equal(draftRes.body.draft.status, "in_review");

  // 4. Update Draft
  const updateRes = await call(`/api/private-tutor/knowledge-map-drafts/${draftId}`, {
    token: "tok_personal",
    method: "PUT",
    body: {
      packageName: "Algorithms 101",
    },
  });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.draft.packageName, "Algorithms 101");

  // 5. Publish Draft
  const publishRes = await call(`/api/private-tutor/knowledge-map-drafts/${draftId}/publish`, {
    token: "tok_personal",
    method: "POST",
  });
  assert.equal(publishRes.status, 200);
  assert.equal(publishRes.body.success, true);
  const publishedPackageId = publishRes.body.packageId;

  // 6. Verify Content Package Registered
  const packageRes = await call(`/api/private-tutor/content-packages/${publishedPackageId}`, {
    token: "tok_personal",
  });
  assert.equal(packageRes.status, 200);
  assert.equal(packageRes.body.package.name, "Algorithms 101");
  assert.equal(packageRes.body.package.sourceType, "user_material");
  assert.equal(packageRes.body.package.evaluationCapabilities.deterministicGrading, false);

  // 7. Delete Material
  const deleteRes = await call(`/api/private-tutor/materials/${materialId}`, {
    token: "tok_personal",
    method: "DELETE",
  });
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.deleted, true);
});

test("accepts preserved PDF bytes and exposes page-grounded extraction metadata", async () => {
  const bytes = readFileSync(new URL("../../../../docs/Loop-Engineering-IEEE-中文版-优化版.pdf", import.meta.url));
  const uploaded = await call("/api/private-tutor/materials", {
    token: "tok_personal",
    method: "POST",
    body: {
      fileName: "loop-engineering.pdf",
      fileType: "pdf",
      fileContent: bytes.toString("base64"),
      fileEncoding: "base64",
      fileSize: bytes.length,
    },
  });

  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.material.status, "parsed");
  assert.equal(uploaded.body.material.extraction.pageCount, 16);
  assert.equal(uploaded.body.material.extraction.textPageCount, 16);
  assert.equal(uploaded.body.material.extraction.method, "pdf_text");
  assert.match(uploaded.body.material.pages[0].text, /循环工程/);
  assert.equal(uploaded.body.material.pages.some((page) => /%PDF-|endstream|xref/.test(page.text)), false);
  assert.equal("rawText" in uploaded.body.material, false);

  const materialId = uploaded.body.material.id;
  const otherAccount = await call(`/api/private-tutor/materials/${materialId}`, { token: "tok_migrate" });
  assert.equal(otherAccount.status, 404);

  const replayed = await call("/api/private-tutor/materials", {
    token: "tok_personal",
    method: "POST",
    body: {
      fileName: "loop-engineering.pdf",
      fileType: "pdf",
      fileContent: bytes.toString("base64"),
      fileEncoding: "base64",
      fileSize: bytes.length,
    },
  });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.material.id, materialId);

  const decodedAsText = await call("/api/private-tutor/materials", {
    token: "tok_personal",
    method: "POST",
    body: {
      fileName: "broken.pdf",
      fileType: "pdf",
      fileContent: "%PDF-1.4 binary decoded as text",
      fileEncoding: "utf8",
      fileSize: 31,
    },
  });
  assert.equal(decodedAsText.status, 400);
  assert.equal(decodedAsText.body.error, "pdf_binary_required");

  const removed = await call(`/api/private-tutor/materials/${materialId}`, {
    token: "tok_personal",
    method: "DELETE",
  });
  assert.equal(removed.status, 200);
});

test("math and computer-science packages share the learning runtime without contaminating mastery", async () => {
  const token = "tok_personal";
  const mathEvidence = await call("/api/private-tutor/profile/attempts", {
    token,
    method: "POST",
    body: {
      idempotencyKey: "m5-math-evidence-1",
      knowledgeId: "balance",
      questionRevisionId: "demo-balance-001-v1",
      rawAnswer: "5",
      responseKind: "answer",
      independent: true,
      usedHint: false,
      source: "screen",
      durationSeconds: 30,
    },
  });
  assert.equal(mathEvidence.status, 201);
  const mathKnowledgeBefore = structuredClone(mathEvidence.body.snapshot.knowledge);

  const switched = await call("/api/private-tutor/profile/content-package", {
    token,
    method: "PUT",
    body: { packageId: "cs-logic-foundations-v1" },
  });
  assert.equal(switched.status, 200);
  assert.equal(switched.body.activePackage.subjectId, "computer_science");
  assert.equal(switched.body.snapshot.contentPackageId, "cs-logic-foundations-v1");
  assert.deepEqual(switched.body.snapshot.knowledge.map((item) => item.id), ["proposition", "logic-connectives"]);
  assert.equal(switched.body.snapshot.knowledge.every((item) => item.mastery === null), true);

  let assessment = await call("/api/private-tutor/profile/assessments/start", { token, method: "POST", body: {} });
  assert.equal(assessment.status, 201);
  assert.equal(assessment.body.assessment.subjectId, "computer_science");
  assert.equal(assessment.body.assessment.maxQuestions, 4);
  const diagnosticAnswers = {
    "diag-prop-01-v1": "b",
    "diag-prop-02-v1": "b",
    "diag-conn-01-v1": "b",
    "diag-conn-02-v1": "a",
  };
  let answerIndex = 0;
  while (assessment.body.assessment.status !== "completed") {
    const question = assessment.body.assessment.currentQuestion;
    assert.equal(question.subjectId, "computer_science");
    assert.equal(Object.hasOwn(question, "expectedChoice"), false);
    const answer = await call(`/api/private-tutor/profile/assessments/${assessment.body.assessment.id}/answers`, {
      token,
      method: "POST",
      body: {
        idempotencyKey: `m5-cs-diagnostic-${answerIndex}`,
        questionRevisionId: question.revisionId,
        rawAnswer: diagnosticAnswers[question.revisionId],
        responseKind: "answer",
        source: "screen",
        durationSeconds: 8,
      },
    });
    assert.equal(answer.status, 201);
    assessment = answer;
    answerIndex += 1;
    assert.ok(answerIndex <= 4);
  }
  assert.deepEqual(
    assessment.body.assessment.result.knowledge.map((item) => item.knowledgeId),
    ["proposition", "logic-connectives"],
  );

  const plan = await call("/api/private-tutor/profile/learning-plan", { token });
  assert.equal(plan.status, 200);
  assert.equal(plan.body.learningPlan.contentPackageId, "cs-logic-foundations-v1");
  assert.equal(plan.body.learningPlan.days.every((day) => ["proposition", "logic-connectives"].includes(day.knowledgeId)), true);

  let session = await call("/api/private-tutor/profile/tutoring-sessions/start", {
    token,
    method: "POST",
    body: { pace: "standard" },
  });
  assert.equal(session.status, 201);
  assert.equal(session.body.session.subjectId, "computer_science");
  assert.equal(session.body.session.subjectCapabilities.visualInteractions, false);
  const tutoringAnswers = {
    "tutor-prop-recall-001-v1": "b",
    "tutor-prop-guided-001-v1": "b",
    "tutor-prop-transfer-001-v1": "b",
    "tutor-conn-recall-001-v1": "a",
    "tutor-conn-guided-001-v1": "b",
    "tutor-conn-transfer-001-v1": "a",
  };
  let actionIndex = 0;
  let recordedCsError = false;
  while (session.body.session.status !== "completed") {
    const activity = session.body.session.currentActivity;
    const correctAnswer = activity.question ? tutoringAnswers[activity.question.revisionId] : null;
    const submittedAnswer = activity.question && !recordedCsError
      ? (correctAnswer === "a" ? "b" : "a")
      : correctAnswer;
    const body = activity.question
      ? {
          action: "answer",
          idempotencyKey: `m5-cs-session-${actionIndex}`,
          questionRevisionId: activity.question.revisionId,
          rawAnswer: submittedAnswer,
          responseKind: "answer",
          source: "screen",
        }
      : { action: "continue" };
    session = await call(`/api/private-tutor/profile/tutoring-sessions/${session.body.session.id}/actions`, {
      token,
      method: "POST",
      body,
    });
    assert.equal([200, 201].includes(session.status), true);
    if (activity.question && !recordedCsError) recordedCsError = true;
    actionIndex += 1;
    assert.ok(actionIndex <= 6);
  }

  const csReview = await call("/api/private-tutor/profile/review", { token });
  assert.equal(csReview.status, 200);
  assert.equal(csReview.body.reviewBook.themes.length > 0, true);
  assert.equal(csReview.body.reviewBook.themes[0].contentPackageId, "cs-logic-foundations-v1");
  assert.equal(csReview.body.reviewBook.themes[0].schedule.question.subjectId, "computer_science");

  const backToMath = await call("/api/private-tutor/profile/content-package", {
    token,
    method: "PUT",
    body: { packageId: "demo-math-foundations-v1" },
  });
  assert.equal(backToMath.status, 200);
  assert.deepEqual(backToMath.body.snapshot.knowledge, mathKnowledgeBefore);

  const backToCs = await call("/api/private-tutor/profile/content-package", {
    token,
    method: "PUT",
    body: { packageId: "cs-logic-foundations-v1" },
  });
  assert.equal(backToCs.status, 200);
  assert.equal(backToCs.body.snapshot.knowledge.every((item) => item.mastery !== null), true);

  const unsupportedPackage = {
    id: "m5-unsupported-subject-v1",
    name: "M5 unsupported subject fixture",
    subjectId: "unsupported_subject",
    domain: "testing",
    sourceType: "professional_skill",
    version: "1.0.0",
    license: "internal-test",
    targetAudience: {},
    evaluationCapabilities: { deterministicGrading: true },
    modules: [],
    knowledgeComponents: [{
      id: "unsupported-kc",
      name: "Unsupported knowledge",
      prerequisiteKnowledgeIds: [],
      diagnosticQuestions: [{
        id: "unsupported-diagnostic-v1",
        questionId: "unsupported-diagnostic",
        knowledgeId: "unsupported-kc",
        difficulty: 1,
        kind: "choice",
        prompt: "This question has no subject plugin",
        options: [{ id: "a", label: "A" }],
        expectedChoice: "a",
      }],
    }],
  };
  runtimeState.privateTutorContentPackages.push(unsupportedPackage);
  const attemptsBeforeUnsupportedStart = runtimeState.privateTutorAttempts.length;
  const unsupportedSwitch = await call("/api/private-tutor/profile/content-package", {
    token,
    method: "PUT",
    body: { packageId: unsupportedPackage.id },
  });
  assert.equal(unsupportedSwitch.status, 200);
  const unsupportedAssessment = await call("/api/private-tutor/profile/assessments/start", {
    token,
    method: "POST",
    body: {},
  });
  assert.equal(unsupportedAssessment.status, 409);
  assert.equal(unsupportedAssessment.body.error, "private_tutor_published_diagnostic_content_required");
  assert.equal(runtimeState.privateTutorAttempts.length, attemptsBeforeUnsupportedStart);
  assert.equal(unsupportedSwitch.body.snapshot.knowledge.every((item) => item.mastery === null), true);

  await call("/api/private-tutor/profile/content-package", {
    token,
    method: "PUT",
    body: { packageId: "cs-logic-foundations-v1" },
  });
});

test("M6 advanced subject evaluators expose versioned feedback while only eligible evidence updates mastery", async () => {
  const token = "tok_personal";
  const switchPackage = async (packageId) => call("/api/private-tutor/profile/content-package", {
    token,
    method: "PUT",
    body: { packageId },
  });
  const practice = async (body) => call("/api/private-tutor/profile/attempts", { token, method: "POST", body });

  const mathSwitch = await switchPackage("demo-math-foundations-v1");
  const mathBefore = mathSwitch.body.snapshot.knowledge.find((item) => item.id === "balance").evidenceCount;
  const math = await practice({
    idempotencyKey: "m6-advanced-math-steps",
    knowledgeId: "balance",
    questionRevisionId: "practice-balance-steps-001-v1",
    rawAnswer: "x = 8 - 3\nx = 5",
    responseKind: "answer",
    independent: true,
    usedHint: false,
    source: "screen",
    durationSeconds: 40,
  });
  assert.equal(math.status, 201);
  assert.equal(math.body.attempt.correct, true);
  assert.equal(math.body.attempt.evidenceTier, "deterministic_math_steps_v2");
  assert.equal(math.body.attempt.evaluation.passedCount, 2);
  assert.equal(math.body.attempt.evaluation.schemaVersion, 1);
  assert.equal(math.body.attempt.evaluation.evaluatorId, "private-tutor:math");
  assert.equal(math.body.attempt.evaluation.evaluatorVersion, "2.0.0");
  assert.equal(math.body.attempt.evaluation.profile, "linear-equation-v2");
  assert.equal(math.body.attempt.evaluation.confidence, 1);
  assert.equal(math.body.attempt.evaluation.reviewStatus, "not_required");
  assert.match(math.body.attempt.evaluation.decisionFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(math.body.snapshot.knowledge.find((item) => item.id === "balance").evidenceCount, mathBefore + 1);

  const invalidMath = await practice({
    idempotencyKey: "m6-advanced-math-invalid",
    knowledgeId: "balance",
    questionRevisionId: "practice-balance-steps-001-v1",
    rawAnswer: "x + 3 = 5\nx = 2",
    responseKind: "answer",
    independent: true,
    usedHint: false,
    source: "screen",
    durationSeconds: 25,
  });
  assert.equal(invalidMath.status, 201);
  assert.equal(invalidMath.body.attempt.correct, false);
  assert.equal(invalidMath.body.attempt.evidenceEligible, true);
  assert.equal(invalidMath.body.attempt.evaluation.firstIncorrectStep, 0);
  assert.equal(invalidMath.body.attempt.evaluation.steps[0].classification, "single_side_change");
  assert.match(invalidMath.body.attempt.evaluation.explanation, /等式两边|两边必须/);
  assert.equal(invalidMath.body.snapshot.knowledge.find((item) => item.id === "balance").evidenceCount, mathBefore + 2);

  await switchPackage("language-causal-explanations-v1");
  const languageModelsBefore = runtimeState.privateTutorLearnerModels.filter((item) => item.contentPackageId === "language-causal-explanations-v1").length;
  const languageLowConfidence = await practice({
    idempotencyKey: "m6-language-low-confidence",
    knowledgeId: "language-cause-effect",
    questionRevisionId: "practice-language-cause-001-v2",
    rawAnswer: "Plants grow because sunlight supplies energy.",
    responseKind: "answer",
    independent: true,
    usedHint: false,
    source: "voice_confirmed",
    recognitionConfidence: 0.8,
    durationSeconds: 20,
  });
  assert.equal(languageLowConfidence.status, 201);
  assert.equal(languageLowConfidence.body.attempt.correct, true);
  assert.equal(languageLowConfidence.body.attempt.evidenceEligible, false);
  assert.equal(languageLowConfidence.body.attempt.evidenceTier, "practice_only");
  assert.equal(languageLowConfidence.body.attempt.evaluation.evaluatorVersion, "2.0.0");
  assert.equal(languageLowConfidence.body.attempt.evaluation.contentPackageVersion, "2.0.0");
  assert.equal(languageLowConfidence.body.attempt.evaluation.contentRevisionId, "practice-language-cause-001-v2");
  assert.equal(languageLowConfidence.body.attempt.evaluation.rubricVersion, "2.0.0");
  assert.equal(languageLowConfidence.body.attempt.evaluation.semanticStatus, "complete_review_required");
  assert.equal(languageLowConfidence.body.attempt.evaluation.confidence, 0.8);
  assert.equal(languageLowConfidence.body.attempt.evaluation.reviewStatus, "required");
  assert.equal(languageLowConfidence.body.snapshot.knowledge[0].mastery, null);
  assert.equal(languageLowConfidence.body.snapshot.knowledge[0].evidenceCount, 0);
  assert.equal(runtimeState.privateTutorLearnerModels.filter((item) => item.contentPackageId === "language-causal-explanations-v1").length, languageModelsBefore);

  const reversedLanguage = await practice({
    idempotencyKey: "m6-language-reversed-causality",
    knowledgeId: "language-cause-effect",
    questionRevisionId: "practice-language-cause-001-v2",
    rawAnswer: "Sunlight supplies energy because plants grow.",
    responseKind: "answer",
    independent: true,
    usedHint: false,
    source: "screen",
    durationSeconds: 20,
  });
  assert.equal(reversedLanguage.status, 201);
  assert.equal(reversedLanguage.body.attempt.correct, false);
  assert.equal(reversedLanguage.body.attempt.evidenceEligible, false);
  assert.equal(reversedLanguage.body.attempt.evaluation.semanticStatus, "causal_direction_reversed");
  assert.equal(reversedLanguage.body.attempt.evaluation.reviewStatus, "not_required");
  assert.match(reversedLanguage.body.attempt.evaluation.explanation, /因果方向写反/);
  assert.equal(reversedLanguage.body.snapshot.knowledge[0].evidenceCount, 0);

  const languageConfirmed = await practice({
    idempotencyKey: "m6-language-confirmed",
    knowledgeId: "language-cause-effect",
    questionRevisionId: "practice-language-cause-001-v2",
    rawAnswer: "Plants grow because sunlight supplies energy.",
    responseKind: "answer",
    independent: true,
    usedHint: false,
    source: "screen",
    durationSeconds: 20,
  });
  assert.equal(languageConfirmed.status, 201);
  assert.equal(languageConfirmed.body.attempt.evidenceEligible, true);
  assert.equal(languageConfirmed.body.attempt.evidenceTier, "rubric_calibrated");
  assert.equal(languageConfirmed.body.attempt.evaluation.semanticStatus, "complete_high_confidence");
  assert.equal(languageConfirmed.body.attempt.evaluation.confidence, 1);
  assert.equal(languageConfirmed.body.attempt.evaluation.reviewStatus, "not_required");
  assert.equal(languageConfirmed.body.snapshot.knowledge[0].evidenceCount, 1);

  await switchPackage("programming-functions-v1");
  const attemptsBeforeRejectedCode = runtimeState.privateTutorAttempts.length;
  const rejectedCode = await practice({
    idempotencyKey: "m5-advanced-code-rejected",
    knowledgeId: "pure-function-return",
    questionRevisionId: "practice-code-double-001-v1",
    rawAnswer: "return process.exit();",
    responseKind: "answer",
    independent: true,
    usedHint: false,
    source: "screen",
  });
  assert.equal(rejectedCode.status, 422);
  assert.equal(rejectedCode.body.error, "private_tutor_code_sandbox_rejected");
  assert.equal(runtimeState.privateTutorAttempts.length, attemptsBeforeRejectedCode);
  const code = await practice({
    idempotencyKey: "m5-advanced-code-pass",
    knowledgeId: "pure-function-return",
    questionRevisionId: "practice-code-double-001-v1",
    rawAnswer: "function double(n) { return n * 2; }",
    responseKind: "answer",
    independent: true,
    usedHint: false,
    source: "screen",
  });
  assert.equal(code.status, 201);
  assert.equal(code.body.attempt.evaluation.passedCount, 3);
  assert.equal(code.body.attempt.evidenceTier, "deterministic_sandbox");

  await switchPackage("conceptual-source-reasoning-v1");
  const conceptModelsBefore = runtimeState.privateTutorLearnerModels.filter((item) => item.contentPackageId === "conceptual-source-reasoning-v1").length;
  const conceptWithoutSource = await practice({
    idempotencyKey: "m6-anchored-concept-no-source",
    knowledgeId: "source-grounded-explanation",
    questionRevisionId: "practice-concept-source-001-v2",
    rawAnswer: "形成性反馈可以发现差距并及时纠正，从而调整学习策略。",
    responseKind: "answer",
    independent: true,
    usedHint: false,
    source: "screen",
  });
  assert.equal(conceptWithoutSource.status, 201);
  assert.equal(conceptWithoutSource.body.attempt.evidenceEligible, false);
  assert.equal(conceptWithoutSource.body.attempt.evaluation.evaluatorVersion, "2.0.0");
  assert.equal(conceptWithoutSource.body.attempt.evaluation.rubricVersion, "2.0.0");
  assert.equal(conceptWithoutSource.body.attempt.evaluation.contentPackageVersion, "2.0.0");
  assert.equal(conceptWithoutSource.body.attempt.evaluation.score, 0.85);
  assert.equal(conceptWithoutSource.body.attempt.evaluation.scoreBand, "developing");
  assert.equal(conceptWithoutSource.body.attempt.evaluation.anchorId, "anchor-developing-v1");
  assert.equal(conceptWithoutSource.body.attempt.evaluation.reviewStatus, "required");
  assert.equal(conceptWithoutSource.body.attempt.evaluation.reviewReason, "missing_required_source");
  assert.deepEqual(conceptWithoutSource.body.attempt.evaluation.missingSourceRefs, ["chapter-1"]);
  assert.equal(conceptWithoutSource.body.snapshot.knowledge[0].mastery, null);
  assert.equal(runtimeState.privateTutorLearnerModels.filter((item) => item.contentPackageId === "conceptual-source-reasoning-v1").length, conceptModelsBefore);
  const conceptBoundary = await practice({
    idempotencyKey: "m6-anchored-concept-boundary",
    knowledgeId: "source-grounded-explanation",
    questionRevisionId: "practice-concept-source-001-v2",
    rawAnswer: "[ref:chapter-1] 形成性反馈可以发现差距。",
    responseKind: "answer",
    independent: true,
    usedHint: false,
    source: "screen",
  });
  assert.equal(conceptBoundary.status, 201);
  assert.equal(conceptBoundary.body.attempt.correct, false);
  assert.equal(conceptBoundary.body.attempt.evidenceEligible, false);
  assert.equal(conceptBoundary.body.attempt.evaluation.score, 0.75);
  assert.equal(conceptBoundary.body.attempt.evaluation.reviewStatus, "required");
  assert.equal(conceptBoundary.body.attempt.evaluation.reviewReason, "score_near_proficiency_boundary");
  const groundedConcept = await practice({
    idempotencyKey: "m6-anchored-concept-grounded",
    knowledgeId: "source-grounded-explanation",
    questionRevisionId: "practice-concept-source-001-v2",
    rawAnswer: "[ref:chapter-1] 形成性反馈可以发现差距并及时纠正，从而调整学习策略。",
    responseKind: "answer",
    independent: true,
    usedHint: false,
    source: "screen",
  });
  assert.equal(groundedConcept.status, 201);
  assert.equal(groundedConcept.body.attempt.evidenceEligible, true);
  assert.equal(groundedConcept.body.attempt.evidenceTier, "rubric_anchored");
  assert.equal(groundedConcept.body.attempt.evaluation.score, 1);
  assert.equal(groundedConcept.body.attempt.evaluation.scoreBand, "proficient");
  assert.equal(groundedConcept.body.attempt.evaluation.anchorId, "anchor-proficient-v1");
  assert.equal(groundedConcept.body.attempt.evaluation.reviewStatus, "not_required");
  assert.equal(groundedConcept.body.snapshot.knowledge[0].evidenceCount, 1);

  const learnerQueueForbidden = await call("/api/private-tutor/evaluation-reviews");
  assert.equal(learnerQueueForbidden.status, 403);
  const otherTeamQueue = await call("/api/private-tutor/evaluation-reviews", { token: "tok_admin" });
  assert.equal(otherTeamQueue.status, 200);
  assert.equal(otherTeamQueue.body.queue.some((item) => item.attemptId === conceptBoundary.body.attempt.id), false);
  const queue = await call("/api/private-tutor/evaluation-reviews", { token: "tok_tutor_reviewer_a" });
  assert.equal(queue.status, 200);
  const boundaryItem = queue.body.queue.find((item) => item.attemptId === conceptBoundary.body.attempt.id);
  assert.ok(boundaryItem);
  assert.equal(boundaryItem.evaluation.reviewStatus, "required");
  assert.equal(boundaryItem.automatedCorrect, false);

  const staleReview = await call(`/api/private-tutor/evaluation-reviews/${conceptBoundary.body.attempt.id}`, {
    token: "tok_tutor_reviewer_a",
    method: "POST",
    body: {
      idempotencyKey: "concept-boundary-stale",
      decisionFingerprint: "f".repeat(64),
      decision: "confirmed_correct",
      reasonCode: "rubric_interpretation",
    },
  });
  assert.equal(staleReview.status, 409);
  assert.equal(staleReview.body.error, "private_tutor_evaluation_review_stale_decision");

  const reviewBody = {
    idempotencyKey: "concept-boundary-review-once",
    decisionFingerprint: boundaryItem.evaluation.decisionFingerprint,
    decision: "confirmed_correct",
    reasonCode: "rubric_interpretation",
    note: "The cited response satisfies the proficiency boundary after independent rubric review.",
  };
  const reviewed = await call(`/api/private-tutor/evaluation-reviews/${conceptBoundary.body.attempt.id}`, {
    token: "tok_tutor_reviewer_a",
    method: "POST",
    body: reviewBody,
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.replayed, false);
  assert.equal(reviewed.body.review.finalCorrect, true);
  assert.equal(reviewed.body.review.finalEvidenceEligible, true);
  assert.equal(reviewed.body.item.evaluation.reviewStatus, "completed");
  assert.equal(reviewed.body.item.evaluation.decisionFingerprint, boundaryItem.evaluation.decisionFingerprint);
  assert.equal(reviewed.body.snapshot.knowledge[0].mastery, 0.74);
  assert.equal(reviewed.body.snapshot.knowledge[0].evidenceCount, 2);
  assert.equal(reviewed.body.learnerModel.reason, "human_evaluation_review_completed");
  assert.equal(reviewed.body.learnerModel.knowledge[0].evidenceCount, 2);

  const replayedReview = await call(`/api/private-tutor/evaluation-reviews/${conceptBoundary.body.attempt.id}`, {
    token: "tok_tutor_reviewer_a",
    method: "POST",
    body: reviewBody,
  });
  assert.equal(replayedReview.status, 200);
  assert.equal(replayedReview.body.replayed, true);
  assert.equal(replayedReview.body.snapshot.knowledge[0].evidenceCount, 2);
  assert.equal(runtimeState.privateTutorEvaluationReviews.filter((item) => item.attemptId === conceptBoundary.body.attempt.id).length, 1);
  assert.equal(runtimeState.privateTutorAuditEvents.some((item) => item.action === "evaluation_review_completed" && item.details.attemptId === conceptBoundary.body.attempt.id), true);

  assert.equal((await call("/api/private-tutor/golden-candidates")).status, 403);
  const otherTeamCandidates = await call("/api/private-tutor/golden-candidates", { token: "tok_admin" });
  assert.equal(otherTeamCandidates.status, 200);
  assert.equal(otherTeamCandidates.body.candidates.length, 0);
  const rejectedIdentifier = await call("/api/private-tutor/golden-candidates", {
    token: "tok_tutor_reviewer_a",
    method: "POST",
    body: {
      evaluationReviewId: reviewed.body.review.id,
      classification: "content_defect",
      deidentifiedAnswer: "Contact learner@example.com about usr_personal.",
      rationale: "This intentionally contains identifiers and must be rejected.",
    },
  });
  assert.equal(rejectedIdentifier.status, 422);
  assert.equal(rejectedIdentifier.body.error, "private_tutor_golden_candidate_not_deidentified");
  assert.deepEqual(rejectedIdentifier.body.detected.sort(), ["account_identifier", "email"]);

  const migrationBlocked = await call("/api/private-tutor/golden-candidates", {
    token: "tok_tutor_reviewer_a",
    method: "POST",
    body: {
      evaluationReviewId: reviewed.body.review.id,
      classification: "rubric_defect",
      deidentifiedAnswer: "[ref:chapter-1] 形成性反馈能发现差距。",
      rationale: "The proficiency boundary needs a future versioned rubric correction.",
      expectedScore: 0.75,
      expectedScoreBand: "developing",
    },
  });
  assert.equal(migrationBlocked.status, 201, JSON.stringify(migrationBlocked.body));
  assert.equal(migrationBlocked.body.candidate.status, "migration_required");
  const blockedApproval = await call(`/api/private-tutor/golden-candidates/${migrationBlocked.body.candidate.id}/reviews`, {
    token: "tok_tutor_reviewer_b",
    method: "POST",
    body: { decision: "approved", evidence: "The classification is valid but still requires a migration." },
  });
  assert.equal(blockedApproval.status, 409);
  assert.equal(blockedApproval.body.error, "private_tutor_golden_candidate_migration_required");

  const candidateCreated = await call("/api/private-tutor/golden-candidates", {
    token: "tok_tutor_reviewer_a",
    method: "POST",
    body: {
      evaluationReviewId: reviewed.body.review.id,
      classification: "content_defect",
      deidentifiedAnswer: "[ref:chapter-1] 形成性反馈能发现差距。",
      rationale: "The reviewed boundary response should become a deidentified content regression candidate.",
      expectedScore: 0.75,
      expectedScoreBand: "developing",
    },
  });
  assert.equal(candidateCreated.status, 201);
  assert.equal(candidateCreated.body.candidate.status, "in_review");
  assert.equal(candidateCreated.body.candidate.goldenArtifact.expected.correct, true);
  assert.equal("learnerId" in candidateCreated.body.candidate, false);
  assert.equal(JSON.stringify(candidateCreated.body.candidate.goldenArtifact).includes(reviewed.body.item.learnerId), false);
  const candidateId = candidateCreated.body.candidate.id;
  const candidateSelfReview = await call(`/api/private-tutor/golden-candidates/${candidateId}/reviews`, {
    token: "tok_tutor_reviewer_a",
    method: "POST",
    body: { decision: "approved", evidence: "The creator must not approve this candidate." },
  });
  assert.equal(candidateSelfReview.status, 409);
  assert.equal(candidateSelfReview.body.error, "private_tutor_golden_candidate_self_review_forbidden");

  const firstCandidateReview = await call(`/api/private-tutor/golden-candidates/${candidateId}/reviews`, {
    token: "tok_tutor_reviewer_b",
    method: "POST",
    body: { decision: "approved", evidence: "First independent review confirms the redaction and expected label." },
  });
  assert.equal(firstCandidateReview.status, 200);
  assert.equal(firstCandidateReview.body.candidate.status, "in_review");
  assert.equal(firstCandidateReview.body.candidate.approvals, 1);
  const secondCandidateReview = await call(`/api/private-tutor/golden-candidates/${candidateId}/reviews`, {
    token: "tok_tutor_reviewer_c",
    method: "POST",
    body: { decision: "approved", evidence: "Second independent review confirms the candidate without promoting it automatically." },
  });
  assert.equal(secondCandidateReview.status, 200);
  assert.equal(secondCandidateReview.body.candidate.status, "approved");
  assert.equal(secondCandidateReview.body.candidate.approvals, 2);
  const approvedCandidates = await call("/api/private-tutor/golden-candidates?status=approved", { token: "tok_tutor_reviewer_b" });
  assert.deepEqual(approvedCandidates.body.candidates.map((item) => item.id), [candidateId]);
  assert.equal(runtimeState.privateTutorGoldenCandidateReviews.filter((item) => item.candidateId === candidateId).length, 2);
  assert.equal(runtimeState.privateTutorAuditEvents.some((item) => item.action === "golden_candidate_created" && item.details.candidateId === candidateId), true);
  assert.equal(runtimeState.privateTutorAuditEvents.filter((item) => item.action === "golden_candidate_reviewed" && item.details.candidateId === candidateId).length, 2);
});
