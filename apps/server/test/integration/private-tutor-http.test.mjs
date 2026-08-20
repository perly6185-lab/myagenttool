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
    correct: true,
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
    body: { ...payload, correct: false },
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
      correct: false,
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

test("parent-confirmed deletion removes every child data collection and leaves an audit tombstone", async () => {
  const learnerId = runtimeState.testPrivateTutorLearnerIds[1];
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
