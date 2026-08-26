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
let localTerminalId;
let testState;

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");

  const { defaultProject, state } = createServerState({ defaultProjectPath: "/tmp", now });
  testState = state;
  localTerminalId = state.device.id;

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
  state.workItems.push(
    {
      id: "lwi_team_a",
      localRef: "LOCAL-A",
      ownerTeamId: TEAM_A,
      terminalId: state.device.id,
      projectId: "projA",
      title: "Team A local schedule item",
      state: "open",
      status: "ready",
      priority: "p1",
      estimatePoints: 2,
      revision: 1,
      assigneeIds: ["usr_a"],
      executionBindings: [],
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: "lwi_team_b",
      localRef: "LOCAL-B",
      ownerTeamId: TEAM_B,
      terminalId: state.device.id,
      projectId: "projB",
      title: "Team B local schedule item",
      state: "open",
      status: "ready",
      priority: "p2",
      estimatePoints: 0,
      revision: 1,
      assigneeIds: ["usr_b"],
      executionBindings: [],
      createdAt: now(),
      updatedAt: now(),
    },
  );
  state.events.push({
    id: "evt_inv_a_created",
    invocationId: "inv_a",
    type: "invocation_created",
    level: "info",
    message: "Team A invocation created.",
    data: null,
    createdAt: now(),
  });
  // Team A ownership signals (for /api/issue-ownership tenancy).
  state.issueClaims = [
    { id: "icl_a", status: "active", mode: "develop", claimedBy: "usr_a", projectId: "projA", issueNumber: 42, leaseExpiresAt: "2099-01-01T00:00:00.000Z" },
  ];
  state.dispatchAssignments = [
    { status: "open", workerId: "worker-a", projectId: "projA", issueNumber: 42, assignedAt: now() },
  ];
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
  state.sshTargets.push({
    id: "ssh_a",
    name: "team-a-ssh",
    createdByUserId: "usr_a",
    ownerTeamId: TEAM_A,
    host: "team-a.internal",
    port: 22,
    user: "deployer",
    authMethod: "ssh_agent",
    credentialRef: "ssh-agent:default",
    credentialStorage: "external_reference_only",
    knownHostPolicy: "pinned_fingerprint",
    knownHostFingerprint: "SHA256:team-a",
    workspaceRoot: "/tmp/a",
    platformHint: "linux",
    agentForwarding: false,
    keySelection: "explicit_key_ref",
    status: "ready_for_manual_test",
    trustStatus: "pinned",
    remoteRelayEnabled: false,
    createdAt: now(),
    updatedAt: now(),
    lastTestId: "ssh_test_a",
  });
  state.sshConnectionTests.push({
    id: "ssh_test_a",
    targetId: "ssh_a",
    ownerTeamId: TEAM_A,
    status: "ready_for_manual_test",
    createdAt: now(),
  });
  state.events.push({
    id: "evt_ssh_scope_a",
    invocationId: null,
    type: "ssh.host_file_scope.created",
    level: "info",
    message: "team a host file scope",
    data: { targetId: "ssh_a", scopeId: "hfs_a" },
    createdAt: now(),
  });
  state.events.push({
    id: "evt_ssh_a",
    invocationId: null,
    type: "ssh.target.registered",
    level: "info",
    message: "SSH runtime target registered for safety preflight.",
    data: { targetId: "ssh_a", host: "team-a.internal", user: "deployer" },
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
  const sshTargetIds = (b.body.sshTargets ?? []).map((target) => target.id);
  assert.ok(!sshTargetIds.includes("ssh_a"), "team B must NOT see team A's SSH target");
  const sshTestIds = (b.body.sshConnectionTests ?? []).map((report) => report.id);
  assert.ok(!sshTestIds.includes("ssh_test_a"), "team B must NOT see team A's SSH preflight report");
  const sshScopeEventIds = (b.body.events ?? []).map((event) => event.id);
  assert.ok(!sshScopeEventIds.includes("evt_ssh_scope_a"), "team B must NOT see team A's SSH file-range event");
  const eventIds = (b.body.events ?? []).map((event) => event.id);
  assert.ok(!eventIds.includes("evt_ssh_a"), "team B must NOT see team A's SSH target events");

  const a = await call("/api/state", { token: "tok_a" });
  assert.ok((a.body.projects ?? []).some((p) => p.id === "projA"), "team A sees its own project");
  assert.ok((a.body.terminalSessions ?? []).some((session) => session.terminalSessionId === "term_a"), "team A sees its own terminal session");
  assert.ok((a.body.sshTargets ?? []).some((target) => target.id === "ssh_a"), "team A sees its own SSH target");
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

test("invocation event detail is readable by its team and existence-hidden from another team", async () => {
  const own = await call("/api/invocations/inv_a/events", { token: "tok_a" });
  assert.equal(own.status, 200);
  assert.equal(own.body.invocationId, "inv_a");
  assert.deepEqual(own.body.events.map((event) => event.id), ["evt_inv_a_created"]);
  assert.equal(own.body.retentionTruncated, false);

  const foreign = await call("/api/invocations/inv_a/events?before=malformed%2Bcursor", { token: "tok_b" });
  const missing = await call("/api/invocations/inv_missing/events", { token: "tok_b" });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.body, missing.body);
  assert.deepEqual(foreign.body, { error: "invocation_not_found" });
});

test("Trace search is paginated through the real HTTP route and team scoped", async () => {
  const own = await call("/api/traces?q=inv_a&limit=1", { token: "tok_a" });
  assert.equal(own.status, 200);
  assert.equal(own.body.total, 1);
  assert.deepEqual(own.body.records.map((record) => record.invocationId), ["inv_a"]);
  assert.equal(own.body.nextCursor, null);

  const foreign = await call("/api/traces?q=inv_a&limit=1", { token: "tok_b" });
  assert.equal(foreign.status, 200);
  assert.equal(foreign.body.total, 0);
  assert.deepEqual(foreign.body.records, []);
});

test("issue-ownership is team-scoped; team B never sees team A's issue owner", async () => {
  const own = await call("/api/issue-ownership", { token: "tok_a" });
  assert.equal(own.status, 200);
  const mine = own.body.issues.find((i) => i.projectId === "projA" && i.issueNumber === 42);
  assert.ok(mine, "team A sees its own issue ownership");
  assert.equal(mine.develop.claimedBy, "usr_a");
  assert.equal(mine.dispatch.workerId, "worker-a");

  const foreign = await call("/api/issue-ownership", { token: "tok_b" });
  assert.equal(foreign.status, 200);
  assert.ok(!foreign.body.issues.some((i) => i.projectId === "projA"), "team B's view excludes team A's issues");
});

test("dispatch-health queue is team-scoped; team B never sees team A's queued invocation", async () => {
  const own = await call("/api/invocation-dispatch-health", { token: "tok_a" });
  assert.equal(own.status, 200);
  assert.ok(own.body.queue.items.some((i) => i.invocationId === "inv_a"), "team A sees its own queued invocation");
  assert.equal(typeof own.body.capacity.maxConcurrency, "number", "device capacity is reported");

  const foreign = await call("/api/invocation-dispatch-health", { token: "tok_b" });
  assert.equal(foreign.status, 200);
  assert.ok(!foreign.body.queue.items.some((i) => i.invocationId === "inv_a"), "team B's queue excludes team A's invocation");
});

test("local schedule capacity is current-terminal-only and personal-work scoped", async () => {
  const teamA = await call("/api/local-schedule/capacity", { token: "tok_a" });
  assert.equal(teamA.status, 200);
  assert.equal(teamA.body.terminal.id, localTerminalId);
  assert.deepEqual(teamA.body.work.items.map((item) => item.workItemId), ["lwi_team_a"]);
  assert.equal(teamA.body.work.items[0].estimate.source, "estimate_points");

  const teamB = await call("/api/local-schedule/capacity", { token: "tok_b" });
  assert.equal(teamB.status, 200);
  assert.deepEqual(teamB.body.work.items.map((item) => item.workItemId), ["lwi_team_b"]);
  assert.ok(!teamB.body.work.items.some((item) => item.workItemId === "lwi_team_a"));
});

test("local schedule preview applies atomically and rejects a stale plan revision", async () => {
  testState.device.timeZone = "Asia/Shanghai";
  const preview = await call("/api/local-schedule/preview", { token: "tok_a" });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.assumptions.timeZone, "Asia/Shanghai");
  assert.ok(preview.body.days.some((day) => day.items.some((item) => item.workItemId === "lwi_team_a")));

  const applied = await call("/api/local-schedule/apply", {
    token: "tok_a",
    method: "POST",
    body: { planRevision: preview.body.planRevision },
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.body.applied, 1);
  assert.equal(applied.body.terminalId, localTerminalId);

  const listed = await call("/api/work-items?assigneeId=mine", { token: "tok_a" });
  const scheduled = listed.body.workItems.find((item) => item.id === "lwi_team_a");
  assert.equal(scheduled.plannedDate, preview.body.horizon.today);

  const stale = await call("/api/local-schedule/apply", {
    token: "tok_a",
    method: "POST",
    body: { planRevision: preview.body.planRevision },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "schedule_plan_stale");
});

test("unbound Auto-run issue work is planned durably and remains tenant scoped", async () => {
  const runtime = {
    id: "aur_schedule_team_a",
    projectId: "projA",
    terminalId: localTerminalId,
    status: "waiting_capacity",
    link: { number: 99, title: "Schedule this unfinished issue" },
    createdAt: now(),
    updatedAt: now(),
  };
  testState.autoRuns.push(runtime);
  try {
    const teamA = await call("/api/local-schedule/capacity", { token: "tok_a" });
    assert.ok(teamA.body.work.items.some((item) => item.workItemId === "autorun:aur_schedule_team_a"));
    const teamB = await call("/api/local-schedule/capacity", { token: "tok_b" });
    assert.ok(!teamB.body.work.items.some((item) => item.workItemId === "autorun:aur_schedule_team_a"));

    const preview = await call("/api/local-schedule/preview", { token: "tok_a" });
    const placement = preview.body.days.flatMap((day) => day.items.map((item) => ({ day, item })))
      .find(({ item }) => item.workItemId === "autorun:aur_schedule_team_a");
    assert.ok(placement);
    assert.equal(placement.item.sourceKind, "auto_run");

    const applied = await call("/api/local-schedule/apply", {
      token: "tok_a",
      method: "POST",
      body: { planRevision: preview.body.planRevision },
    });
    assert.equal(applied.status, 200);
    assert.ok(applied.body.runtimeSchedules.some((row) =>
      row.targetId === runtime.id && row.plannedDate === placement.day.date));

    const publicState = await call("/api/state", { token: "tok_a" });
    const boardRow = publicState.body.workBoard.states.waiting.items.find((item) => item.targetId === runtime.id);
    assert.equal(boardRow.plannedDate, placement.day.date);
    assert.equal(boardRow.schedulePlanSource, "auto_plan");
  } finally {
    testState.autoRuns = testState.autoRuns.filter((row) => row.id !== runtime.id);
    testState.runtimeWorkSchedules = testState.runtimeWorkSchedules.filter((row) => row.targetId !== runtime.id);
  }
});

test("unfinished-work rollover is idempotent and manual pins require explicit confirmation", async () => {
  const schedule = await call("/api/local-schedule/preview", { token: "tok_a" });
  assert.equal(schedule.status, 200);
  const sourceDate = schedule.body.horizon.yesterday;
  const common = {
    ownerTeamId: TEAM_A,
    terminalId: localTerminalId,
    projectId: "projA",
    state: "open",
    priority: "p1",
    estimatePoints: 1,
    assigneeIds: ["usr_a"],
    revision: 1,
    createdAt: now(),
    updatedAt: now(),
  };
  testState.workItems.push(
    {
      ...common,
      id: "lwi_rollover_auto",
      localRef: "LOCAL-ROLLOVER-AUTO",
      title: "Running work from yesterday",
      status: "in_progress",
      plannedDate: sourceDate,
      schedulePlanSource: "auto_plan",
      executionBindings: [{ kind: "auto_run", targetId: "run_preserved", createdAt: now() }],
    },
    {
      ...common,
      id: "lwi_rollover_pinned",
      localRef: "LOCAL-ROLLOVER-PINNED",
      title: "Pinned work from yesterday",
      status: "ready",
      plannedDate: sourceDate,
      schedulePlanSource: "manual",
      executionBindings: [],
    },
  );

  const preview = await call("/api/local-schedule/rollover-preview", { token: "tok_a" });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.moves.map((item) => item.workItemId), ["lwi_rollover_auto"]);
  assert.deepEqual(preview.body.confirmationRequired.map((item) => item.workItemId), ["lwi_rollover_pinned"]);

  const applied = await call("/api/local-schedule/rollover", {
    token: "tok_a",
    method: "POST",
    body: { rolloverRevision: preview.body.rolloverRevision, confirmPinned: false },
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.body.applied, 1);
  const running = testState.workItems.find((item) => item.id === "lwi_rollover_auto");
  assert.equal(running.carriedFromDate, sourceDate);
  assert.equal(running.schedulePlanSource, "rollover");
  assert.equal(running.executionBindings[0].targetId, "run_preserved");

  const replay = await call("/api/local-schedule/rollover", {
    token: "tok_a",
    method: "POST",
    body: { rolloverRevision: preview.body.rolloverRevision, confirmPinned: false },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(running.revision, 2, "idempotent replay does not mutate the task twice");

  const pinnedPreview = await call("/api/local-schedule/rollover-preview", { token: "tok_a" });
  const confirmed = await call("/api/local-schedule/rollover", {
    token: "tok_a",
    method: "POST",
    body: { rolloverRevision: pinnedPreview.body.rolloverRevision, confirmPinned: true },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.confirmedPinned, 1);
  assert.notEqual(testState.workItems.find((item) => item.id === "lwi_rollover_pinned").plannedDate, sourceDate);
});

test("P0 urgent insertion uses the current terminal and is idempotent", async () => {
  testState.device.status = "online";
  testState.device.unlinkState = "linked";
  testState.workItems.push({
    id: "lwi_urgent_http",
    localRef: "LOCAL-URGENT-HTTP",
    ownerTeamId: TEAM_A,
    terminalId: localTerminalId,
    projectId: "projA",
    title: "Urgent HTTP work",
    state: "open",
    status: "ready",
    priority: "p0",
    estimatePoints: 1,
    plannedDate: null,
    schedulePlanSource: null,
    assigneeIds: ["usr_a"],
    executionBindings: [],
    revision: 1,
    archivedAt: null,
    createdAt: now(),
    updatedAt: now(),
  });

  const preview = await call("/api/local-schedule/urgent-preview", { token: "tok_a" });
  assert.equal(preview.status, 200);
  const insertion = preview.body.insertions.find((item) => item.workItemId === "lwi_urgent_http");
  assert.ok(insertion);
  assert.equal(insertion.activation, "immediate");

  const applied = await call("/api/local-schedule/urgent", {
    token: "tok_a",
    method: "POST",
    body: { urgentRevision: preview.body.urgentRevision, confirmPinned: false },
  });
  assert.equal(applied.status, 200);
  assert.ok(applied.body.workItemIds.includes("lwi_urgent_http"));
  const urgent = testState.workItems.find((item) => item.id === "lwi_urgent_http");
  assert.equal(urgent.schedulePlanSource, "urgent_insert");
  assert.equal(urgent.scheduleOrder, -1_000);

  const replay = await call("/api/local-schedule/urgent", {
    token: "tok_a",
    method: "POST",
    body: { urgentRevision: preview.body.urgentRevision, confirmPinned: false },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(urgent.revision, 2);
});

test("decision soft-claim HTTP routes are wired through the composed runtime", async () => {
  const path = "/api/pending-decisions/approval%3Aapr_http/claim";
  const claimed = await call(path, { token: "tok_a", method: "POST" });
  assert.equal(claimed.status, 201);
  assert.equal(claimed.body.claim.decisionId, "approval:apr_http");
  assert.equal(claimed.body.claim.claimedBy, "usr_a");

  const foreignRelease = await call(
    "/api/pending-decisions/approval%3Aapr_http/release",
    { token: "tok_b", method: "POST" },
  );
  assert.equal(foreignRelease.status, 200);
  assert.equal(foreignRelease.body.released, false, "only the holder may release the advisory marker");

  const released = await call(
    "/api/pending-decisions/approval%3Aapr_http/release",
    { token: "tok_a", method: "POST" },
  );
  assert.equal(released.status, 200);
  assert.equal(released.body.released, true);
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

test("write guard: team B cannot test or use team A's SSH target", async () => {
  const beforeA = await call("/api/state", { token: "tok_a" });
  const beforeTestCount = beforeA.body.sshConnectionTests.length;
  const beforeTerminalCount = beforeA.body.terminalSessions.length;

  const foreignTest = await call("/api/ssh-targets/ssh_a/test", { token: "tok_b", method: "POST" });
  assert.equal(foreignTest.status, 404);
  assert.equal(foreignTest.body.error, "ssh_target_not_found");

  const foreignRelay = await call("/api/terminal/sessions", {
    token: "tok_b",
    method: "POST",
    body: { runtimeKind: "remote_ssh_relay", targetId: "ssh_a", cwd: "/tmp/a" },
  });
  assert.equal(foreignRelay.status, 400);
  assert.equal(foreignRelay.body.error, "invalid_terminal_session");

  const afterBlocked = await call("/api/state", { token: "tok_a" });
  assert.equal(afterBlocked.body.sshConnectionTests.length, beforeTestCount, "foreign SSH test must not create a report");
  assert.equal(afterBlocked.body.terminalSessions.length, beforeTerminalCount, "foreign relay must not create a terminal session");

  const ownTest = await call("/api/ssh-targets/ssh_a/test", { token: "tok_a", method: "POST" });
  assert.equal(ownTest.status, 202);
  assert.equal(ownTest.body.report.ownerTeamId, TEAM_A);

  const ownRelay = await call("/api/terminal/sessions", {
    token: "tok_a",
    method: "POST",
    body: { runtimeKind: "remote_ssh_relay", targetId: "ssh_a" },
  });
  assert.equal(ownRelay.status, 201);
  assert.equal(ownRelay.body.session.targetId, "ssh_a");
  assert.equal(ownRelay.body.session.ownerTeamId, TEAM_A);
});

test("SSH target creation ignores caller-supplied ownership", async () => {
  const created = await call("/api/ssh-targets", {
    token: "tok_b",
    method: "POST",
    body: {
      ownerTeamId: TEAM_A,
      createdByUserId: "usr_a",
      host: "team-b.internal",
      port: 22,
      user: "deployer",
      authMethod: "ssh_agent",
      knownHostPolicy: "pinned_fingerprint",
      knownHostFingerprint: "SHA256:team-b",
      workspaceRoot: "/tmp/b",
      keySelection: "explicit_key_ref",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.target.ownerTeamId, TEAM_B);
  assert.equal(created.body.target.createdByUserId, "usr_b");
});

test("My hosts API reuses SSH identity while keeping file-transfer hosts team scoped", async () => {
  const created = await call("/api/hosts", {
    token: "tok_b",
    method: "POST",
    body: {
      name: "Team B website host",
      host: "website.example",
      port: 22,
      user: "deployer",
      authMethod: "private_key_ref",
      purposes: ["file_transfer", "site_publish"],
      networkPolicy: "public_only",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.target.workspaceRoot, null);
  assert.deepEqual(created.body.target.purposes, ["file_transfer", "site_publish"]);
  assert.equal(created.body.target.ownerTeamId, TEAM_B);
  assert.equal(created.body.target.revision, 1);
  assert.equal(created.body.target.credentialRef, `credential://ssh/${created.body.target.id}`);

  const hostId = created.body.target.id;
  const own = await call(`/api/hosts/${hostId}`, { token: "tok_b" });
  assert.equal(own.status, 200);
  assert.equal(own.body.host.id, hostId);
  const foreign = await call(`/api/hosts/${hostId}`, { token: "tok_a" });
  assert.equal(foreign.status, 404);

  const foreignUpdate = await call(`/api/hosts/${hostId}`, {
    token: "tok_a", method: "PATCH", body: { expectedRevision: 1, networkPolicy: "allow_private_network" },
  });
  assert.equal(foreignUpdate.status, 404);
  const updated = await call(`/api/hosts/${hostId}`, {
    token: "tok_b", method: "PATCH", body: { expectedRevision: 1, networkPolicy: "allow_private_network" },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.host.id, hostId);
  assert.equal(updated.body.host.credentialRef, `credential://ssh/${hostId}`);
  assert.equal(updated.body.host.networkPolicy, "allow_private_network");
  assert.equal(updated.body.host.revision, 2);

  const list = await call("/api/hosts", { token: "tok_b" });
  assert.equal(list.status, 200);
  assert.ok(list.body.hosts.some((host) => host.id === hostId));
  assert.ok(list.body.hosts.every((host) => host.ownerTeamId === TEAM_B));

  const scopes = await call(`/api/hosts/${hostId}/file-scopes`, { token: "tok_b" });
  assert.equal(scopes.status, 200);
  assert.deepEqual(scopes.body.scopes, []);
  const foreignScopes = await call(`/api/hosts/${hostId}/file-scopes`, { token: "tok_a" });
  assert.equal(foreignScopes.status, 404);
  const transfers = await call(`/api/hosts/${hostId}/file-transfers`, { token: "tok_b" });
  assert.equal(transfers.status, 200);
  assert.deepEqual(transfers.body.transfers, []);
  const foreignTransfers = await call(`/api/hosts/${hostId}/file-transfers`, { token: "tok_a" });
  assert.equal(foreignTransfers.status, 404);
  const unverifiedScope = await call(`/api/hosts/${hostId}/file-scopes`, {
    token: "tok_b", method: "POST", body: { label: "Website files", purpose: "site_publish", rootPath: "/srv/www/example" },
  });
  assert.equal(unverifiedScope.status, 409);
  assert.equal(unverifiedScope.body.error, "ssh_host_not_ready");

  testState.hostFileScopes.push(
    { id: "hfs_team_b", ownerTeamId: TEAM_B, sshTargetId: hostId, label: "Website files", purpose: "site_publish", rootPath: "/srv/www/example", resolvedRootPath: "/srv/www/example", permissions: ["list", "upload", "download"], status: "ready", revision: 1, lastVerifiedAt: now() },
    { id: "hfs_team_a", ownerTeamId: TEAM_A, sshTargetId: "ssh_a", label: "Team A secret site", purpose: "site_publish", rootPath: "/srv/www/secret", resolvedRootPath: "/srv/www/secret", permissions: ["list", "upload", "download"], status: "ready", revision: 1, lastVerifiedAt: now() },
  );
  const publishScopes = await call("/api/host-file-scopes?purpose=site_publish", { token: "tok_b" });
  assert.equal(publishScopes.status, 200);
  assert.deepEqual(publishScopes.body.scopes.map((scope) => scope.id), ["hfs_team_b"]);
  assert.equal(publishScopes.body.scopes[0].host.id, hostId);
  assert.equal("credentialRef" in publishScopes.body.scopes[0].host, false);

  const unobservedConfirmation = await call(`/api/hosts/${hostId}/confirm-fingerprint`, {
    token: "tok_b", method: "POST", body: { expectedRevision: 2, fingerprint: "SHA256:AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/ab" },
  });
  assert.equal(unobservedConfirmation.status, 400);
  assert.equal(unobservedConfirmation.body.error, "ssh_host_fingerprint_confirmation_invalid");
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
