/*
 * End-to-end tenancy integration test.
 *
 * Boots the REAL http server (the same composition as src/index.mjs) with
 * MYAGENT_REQUIRE_AUTH=1 and a hand-seeded second team, then drives it over
 * actual HTTP as team B against team A's resources. This is the check the unit
 * tests can't give: it proves the guards and read-scoping hold through the whole
 * dispatch stack, catching any route that skips them.
 *
 * Multi-tenancy isn't reachable as a product flow yet (teams/users are seed-only,
 * there's no create-team API, and the web console doesn't send tokens), so the
 * second team is injected into state directly. Run:
 *   MYAGENT_REQUIRE_AUTH=1 node --test test/integration/
 * (wired as `pnpm --filter @myagenttool/server test:integration`).
 */

// Must be set before the server modules load (auth.mjs reads REQUIRE_AUTH at
// import time); persistence off so the test never touches a real state file.
process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const TEAM_A = "team_a";
const TEAM_B = "team_b";
const now = () => new Date().toISOString();

let server;
let base; // http://127.0.0.1:<port>

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");

  const { defaultProject, state } = createServerState({ defaultProjectPath: "/tmp", now });

  // A second tenant that the platform can't create through the API yet.
  state.teams.push({ id: TEAM_A, name: "Team A" }, { id: TEAM_B, name: "Team B" });
  state.users.push(
    { id: "usr_a", name: "A", teamId: TEAM_A },
    { id: "usr_b", name: "B", teamId: TEAM_B },
  );
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  state.tokens.push(
    { token: "tok_a", userId: "usr_a", expiresAt },
    { token: "tok_b", userId: "usr_b", expiresAt },
  );
  state.projects.push(
    { id: "projA", name: "Project A", ownerTeamId: TEAM_A, path: "/tmp/a", createdAt: now() },
    { id: "projB", name: "Project B", ownerTeamId: TEAM_B, path: "/tmp/b", createdAt: now() },
  );
  // Team A owned resources to attack from team B.
  state.automations.push({
    id: "auto_a",
    projectId: "projA",
    name: "team a nightly",
    prompt: "secret prompt",
    agentId: "agt_x",
    enabled: true,
    schedule: { kind: "manual" },
    createdBy: "usr_a",
  });
  state.codexImportedEvidenceRecords.push({
    id: "imp_a",
    teamId: TEAM_A,
    userId: "usr_a",
    summary: "team a private evidence",
    createdAt: now(),
  });
  state.invocations.push({
    id: "inv_a",
    projectId: "projA",
    agentId: "agt_x",
    status: "queued",
    requestedBy: "usr_a",
    createdAt: now(),
  });
  state.codexApprovalBrokerRequests.push({
    id: "cdx_appr_a",
    invocationId: "inv_a",
    status: "pending",
  });
  state.terminalSessions.push({
    terminalSessionId: "term_a",
    ownerInvocationId: "manual_terminal_surface",
    ownerCodexSessionId: null,
    deviceId: "dev_local_001",
    userId: "usr_a",
    ownerTeamId: TEAM_A,
    repoPath: "/tmp/a",
    cwd: "/tmp/a",
    shell: "bash",
    runtimeKind: "local_pty",
    targetId: "local",
    status: "attached",
    evidenceIds: ["tev_a"],
    startedAt: now(),
    lastSeenAt: now(),
  });
  state.terminalEvidenceRecords.push({
    id: "tev_a",
    terminalSessionId: "term_a",
    ownerInvocationId: "manual_terminal_surface",
    ownerCodexSessionId: null,
    type: "terminal_output_chunk",
    source: "managed_terminal_runtime",
    redactionState: "summary_only",
    marker: "managed_terminal",
    repoPath: "/tmp/a",
    summary: "team a terminal output",
    detail: "team a terminal output",
    createdAt: now(),
  });
  state.terminalBridgeActions.push({
    id: "term_act_a",
    terminalSessionId: "term_a",
    actionType: "input",
    payload: { input: "team a secret command" },
    status: "queued",
    createdAt: now(),
  });

  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: "/tmp",
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });

  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

/** Fetch as a given token (or none). Returns { status, body }. */
async function call(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

test("auth gate: a request with no token is rejected (401)", async () => {
  const r = await call("/api/state");
  assert.equal(r.status, 401);
  assert.equal(r.body.error, "unauthenticated");
});

test("read scoping: team B's /api/state hides team A's projects and evidence", async () => {
  const b = await call("/api/state", { token: "tok_b" });
  assert.equal(b.status, 200);
  const projectIds = (b.body.projects ?? []).map((p) => p.id);
  assert.ok(projectIds.includes("projB"), "team B sees its own project");
  assert.ok(!projectIds.includes("projA"), "team B must NOT see team A's project");
  const evidenceIds = (b.body.codexImportedEvidenceRecords ?? []).map((e) => e.id);
  assert.ok(!evidenceIds.includes("imp_a"), "team B must NOT see team A's imported evidence");
  const terminalIds = (b.body.terminalSessions ?? []).map((session) => session.terminalSessionId);
  assert.ok(!terminalIds.includes("term_a"), "team B must NOT see team A's terminal session");
  const terminalEvidenceIds = (b.body.terminalEvidenceRecords ?? []).map((evidence) => evidence.id);
  assert.ok(!terminalEvidenceIds.includes("tev_a"), "team B must NOT see team A's terminal evidence");
  const terminalActionIds = (b.body.terminalBridgeActions ?? []).map((action) => action.id);
  assert.ok(!terminalActionIds.includes("term_act_a"), "team B must NOT see team A's terminal bridge actions");
  const evidenceCenterIds = (b.body.evidenceCenterRecords ?? []).map((record) => record.id);
  assert.ok(!evidenceCenterIds.includes("tev_a"), "team B must NOT see team A's terminal evidence center row");

  const a = await call("/api/state", { token: "tok_a" });
  assert.ok((a.body.projects ?? []).some((p) => p.id === "projA"), "team A sees its own project");
  assert.ok((a.body.terminalSessions ?? []).some((session) => session.terminalSessionId === "term_a"), "team A sees its own terminal session");
});

test("write guard: team B cannot delete or repoint team A's automation (404)", async () => {
  const del = await call("/api/automations/auto_a", { token: "tok_b", method: "DELETE" });
  assert.equal(del.status, 404);
  const patch = await call("/api/automations/auto_a", {
    token: "tok_b",
    method: "PATCH",
    body: { prompt: "attacker", enabled: false },
  });
  assert.equal(patch.status, 404);

  // The owning team can, proving it's a tenancy block and not a broken route.
  const own = await call("/api/automations/auto_a", {
    token: "tok_a",
    method: "PATCH",
    body: { prompt: "legit update" },
  });
  assert.equal(own.status, 200);
});

test("write guard: team B cannot bill team A's project via m3 ai-usage (404)", async () => {
  const r = await call("/api/m3/ai-usage", {
    token: "tok_b",
    method: "POST",
    body: { projectId: "projA", provider: "openai", model: "gpt", estimatedCost: "1.00" },
  });
  assert.equal(r.status, 404);
});

test("write guard: team B cannot set a budget on team A's project (404)", async () => {
  const r = await call("/api/budgets", {
    token: "tok_b",
    method: "PUT",
    body: { projectId: "projA", limitUsd: "100" },
  });
  assert.equal(r.status, 404);
});

test("write guard: team B cannot cancel or troubleshoot team A's invocation (404)", async () => {
  const cancel = await call("/api/invocations/inv_a/cancel", { token: "tok_b", method: "POST" });
  assert.equal(cancel.status, 404);
  const troubleshoot = await call("/api/invocations/inv_a/troubleshoot", { token: "tok_b", method: "POST" });
  assert.equal(troubleshoot.status, 404);
});

test("write guard: team B cannot control team A's terminal session (404)", async () => {
  const beforeActions = (await call("/api/state", { token: "tok_a" })).body.terminalBridgeActions.length;
  const input = await call("/api/terminal/sessions/term_a/input", {
    token: "tok_b",
    method: "POST",
    body: { input: "attacker" },
  });
  assert.equal(input.status, 404);
  assert.equal(input.body.error, "terminal_session_not_found");

  const resize = await call("/api/terminal/sessions/term_a/resize", {
    token: "tok_b",
    method: "POST",
    body: { cols: 120, rows: 40 },
  });
  assert.equal(resize.status, 404);
  assert.equal(resize.body.error, "terminal_session_not_found");

  const close = await call("/api/terminal/sessions/term_a/close", { token: "tok_b", method: "POST" });
  assert.equal(close.status, 404);
  assert.equal(close.body.error, "terminal_session_not_found");

  const afterBlockedActions = (await call("/api/state", { token: "tok_a" })).body.terminalBridgeActions.length;
  assert.equal(afterBlockedActions, beforeActions, "foreign terminal writes must not enqueue bridge actions");

  const own = await call("/api/terminal/sessions/term_a/input", {
    token: "tok_a",
    method: "POST",
    body: { input: "legit" },
  });
  assert.equal(own.status, 202);
});

test("terminal session creation ignores caller-supplied userId", async () => {
  const created = await call("/api/terminal/sessions", {
    token: "tok_b",
    method: "POST",
    body: { userId: "usr_a", cwd: "/tmp/b" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.session.userId, "usr_b");
  assert.equal(created.body.session.ownerTeamId, TEAM_B);
});

test("write guard: team B cannot resolve team A's codex approval request (404)", async () => {
  const r = await call("/api/codex/approval-broker/cdx_appr_a/approve", { token: "tok_b", method: "POST" });
  assert.equal(r.status, 404);
});

test("an unknown projectId is rejected too (not silently accepted)", async () => {
  const r = await call("/api/m3/ai-usage", {
    token: "tok_b",
    method: "POST",
    body: { projectId: "does_not_exist", provider: "openai", model: "gpt", estimatedCost: "1" },
  });
  assert.equal(r.status, 404);
});
