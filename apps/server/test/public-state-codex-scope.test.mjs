/*
 * Regression tests for cross-team scoping of codex evidence in buildPublicState.
 *
 * Imported-evidence records carry no invocationId, so the invocation-based
 * scoping (invVisible) treated them as globally visible — team A's imported
 * evidence leaked into team B's public state, both directly and via the
 * aggregated evidence center. They now carry an owning teamId and are scoped by
 * it; the evidence center re-applies scoping over its raw aggregate.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPublicState } from "../src/read-models/state.mjs";

const TEAM_A = "team_a";
const TEAM_B = "team_b";

function scenarioState() {
  return {
    projects: [
      { id: "proj_a", ownerTeamId: TEAM_A },
      { id: "proj_b", ownerTeamId: TEAM_B },
    ],
    invocations: [
      { id: "inv_a", projectId: "proj_a", result: { claudeSessionId: "provider-result-secret-a", threadId: "codex-result-thread-a", turnId: "codex-result-turn-a", summary: "done" } },
      { id: "inv_b", projectId: "proj_b" },
    ],
    events: [
      {
        id: "evt_1",
        invocationId: "inv_a",
        type: "agent_output",
        data: { source: "claude_sdk", sessionId: "provider-event-secret-a", model: "claude" },
        createdAt: "2026-07-24T12:00:00.000Z",
      },
      {
        id: "evt_2",
        invocationId: "inv_a",
        type: "agent_output",
        message: "Codex thread started: codex-event-thread-a.",
        data: { source: "codex_jsonl", threadId: "codex-event-thread-a", eventType: "thread.started" },
        createdAt: "2026-07-24T12:00:01.000Z",
      },
    ],
    codexSessions: [
      { id: "cdx_a", invocationId: "inv_a", codexSessionId: "codex-provider-session-a", codexThreadId: "codex-provider-thread-a", status: "completed" },
      { id: "cdx_b", invocationId: "inv_b", codexSessionId: "codex-provider-session-b", codexThreadId: "codex-provider-thread-b", status: "completed" },
    ],
    codexEvidenceRecords: [
      { id: "cdx_ev_a", invocationId: "inv_a", sessionId: "codex-evidence-session-a", threadId: "codex-evidence-thread-a", summary: "done" },
      { id: "cdx_ev_b", invocationId: "inv_b", sessionId: "codex-evidence-session-b", threadId: "codex-evidence-thread-b", summary: "done" },
    ],
    claudeSessions: [
      { id: "cld_a", invocationId: "inv_a", claudeSessionId: "provider-secret-a", status: "completed" },
      { id: "cld_b", invocationId: "inv_b", claudeSessionId: "provider-secret-b", status: "completed" },
    ],
    workItems: [
      { id: "wi_a_open", localRef: "LOCAL-A", title: "Team A customer update", projectId: "proj_a", ownerTeamId: TEAM_A, state: "open", status: "in_progress", executionState: "running", updatedAt: "2026-07-24T10:00:00.000Z", executionBindings: [{ kind: "auto_run", targetId: "aur_a" }] },
      { id: "wi_a_blocked", ownerTeamId: TEAM_A, state: "open", status: "blocked", executionState: "unclaimed", updatedAt: "2026-07-24T11:00:00.000Z" },
      { id: "wi_b", localRef: "LOCAL-B", title: "Team B private follow-up", projectId: "proj_b", ownerTeamId: TEAM_B, state: "closed", status: "done", executionState: "completed", updatedAt: "2026-07-24T12:00:00.000Z" },
    ],
    workItemFollowUpReminders: [
      { id: "wfr_a", workItemId: "wi_a_open", ownerTeamId: TEAM_A, status: "due", scheduledFor: "2026-07-24T09:00:00.000Z", sourceRevision: 1, scheduleRevision: 1, createdAt: "2026-07-24T09:00:00.000Z" },
      { id: "wfr_b", workItemId: "wi_b", ownerTeamId: TEAM_B, status: "due", scheduledFor: "2026-07-24T09:00:00.000Z", sourceRevision: 1, scheduleRevision: 1, createdAt: "2026-07-24T09:00:00.000Z" },
    ],
    alertOutbox: [
      { id: "aob_a", alert: { data: { autoRunId: "aur_a" } }, status: "queued", attempts: 1, lastError: "offline", createdAt: "2026-07-24T10:00:00.000Z", sentAt: null },
      { id: "aob_b", alert: { data: { localIssueId: "wi_b" } }, status: "failed", attempts: 8, lastError: "denied", createdAt: "2026-07-24T11:00:00.000Z", sentAt: null },
    ],
    codexImportedEvidenceRecords: [
      { id: "imp_a", teamId: TEAM_A, summary: "team a secret" },
      { id: "imp_b", teamId: TEAM_B, summary: "team b secret" },
      { id: "imp_legacy", summary: "pre-tenancy row" }, // no teamId → local team
    ],
  };
}

// The evidence center aggregates raw state; model the pieces we scope.
const EVIDENCE_CENTER = [
  { id: "imp_a", type: "imported_evidence", invocationId: null },
  { id: "imp_b", type: "imported_evidence", invocationId: null },
  { id: "ev_a", type: "file_change", invocationId: "inv_a" },
  { id: "ev_b", type: "file_change", invocationId: "inv_b" },
  { id: "term", type: "file_change", invocationId: null }, // device-level manual terminal
];

function build(actor, state = scenarioState()) {
  return buildPublicState({
    namespace: "test",
    protocolVersion: "1",
    state,
    defaultProjectPath: "/tmp",
    currentProject: () => null,
    defaultAgent: () => null,
    loopRoutineReadModel: () => null,
    codexApprovalQueue: () => [
      { id: "appr_a", invocationId: "inv_a" },
      { id: "appr_b", invocationId: "inv_b" },
    ],
    evidenceCenterRecords: () => EVIDENCE_CENTER.map((r) => ({ ...r })),
    ledgerSummary: () => null,
    budgetStatuses: () => [],
    actor,
  });
}

const ids = (rows) => (rows ?? []).map((r) => r.id).sort();

test("imported evidence is scoped to the owning team (direct path)", () => {
  const teamA = build({ teamId: TEAM_A });
  assert.deepEqual(ids(teamA.codexImportedEvidenceRecords), ["imp_a"]);
  assert.ok(
    !teamA.codexImportedEvidenceRecords.some((r) => r.id === "imp_b"),
    "team B's imported evidence must not appear for team A",
  );
});

test("the evidence center no longer leaks foreign imported or invocation evidence", () => {
  const teamA = build({ teamId: TEAM_A });
  // imp_a (own), ev_a (own invocation), term (device-level null) stay; imp_b + ev_b gone.
  assert.deepEqual(ids(teamA.evidenceCenterRecords), ["ev_a", "imp_a", "term"]);
});

test("the codex approval queue is scoped by the request's invocation", () => {
  const teamA = build({ teamId: TEAM_A });
  assert.deepEqual(ids(teamA.codexApprovalQueue), ["appr_a"]);
});

test("public Claude sessions are invocation-scoped and omit provider session ids", () => {
  const teamA = build({ teamId: TEAM_A });
  assert.deepEqual(ids(teamA.claudeSessions), ["cld_a"]);
  assert.equal("claudeSessionId" in teamA.claudeSessions[0], false);
  assert.equal(JSON.stringify(teamA).includes("provider-secret-a"), false);
  assert.equal(JSON.stringify(teamA).includes("provider-result-secret-a"), false);
  assert.equal(JSON.stringify(teamA).includes("provider-event-secret-a"), false);
});

test("public Codex state omits provider thread/session identifiers", () => {
  const teamA = build({ teamId: TEAM_A });
  assert.deepEqual(ids(teamA.codexSessions), ["cdx_a"]);
  assert.deepEqual(ids(teamA.codexEvidenceRecords), ["cdx_ev_a"]);
  const serialized = JSON.stringify(teamA);
  for (const secret of [
    "codex-provider-session-a",
    "codex-provider-thread-a",
    "codex-evidence-session-a",
    "codex-evidence-thread-a",
    "codex-event-thread-a",
    "codex-result-thread-a",
    "codex-result-turn-a",
  ]) {
    assert.equal(serialized.includes(secret), false, `${secret} must not be published`);
  }
});

test("work item summary is bounded and scoped without publishing item details", () => {
  const teamA = build({ teamId: TEAM_A });
  assert.deepEqual(teamA.workItemSummary, {
    total: 2,
    open: 2,
    blocked: 1,
    activeExecutions: 1,
    updatedAt: "2026-07-24T11:00:00.000Z",
    homeWorkbenchUpdatedAt: "2026-07-24T11:00:00.000Z",
  });
  assert.equal(teamA.workItems, undefined);
  assert.deepEqual(teamA.workItemAlertSummary, {
    queued: 1,
    failed: 0,
    sent: 0,
    skipped: 0,
    byLocalIssue: [{
      localIssueId: "wi_a_open",
      status: "queued",
      attempts: 1,
      lastError: "offline",
      createdAt: "2026-07-24T10:00:00.000Z",
      sentAt: null,
    }],
  });
});

test("due follow-up reminders are tenant scoped and publish no reminder internals", () => {
  const teamA = build({ teamId: TEAM_A });
  const reminders = teamA.workBoard.states.follow_up.items.filter((row) => row.kind === "work_item_follow_up_reminder");
  assert.deepEqual(reminders.map((row) => row.id), ["followup:wfr_a"]);
  assert.equal(reminders[0].targetId, "wi_a_open");
  assert.equal(JSON.stringify(teamA).includes("Team B private follow-up"), false);
  assert.equal(JSON.stringify(teamA).includes("wfr_b"), false);
  assert.equal(teamA.workItemFollowUpReminders, undefined);
});

test("home workbench version advances when a bound execution changes", () => {
  const state = scenarioState();
  state.autoRuns = [{
    id: "aur_a",
    projectId: "proj_a",
    status: "running",
    updatedAt: "2026-07-24T13:00:00.000Z",
  }];
  const teamA = build({ teamId: TEAM_A }, state);
  assert.equal(teamA.workItemSummary.updatedAt, "2026-07-24T11:00:00.000Z");
  assert.equal(teamA.workItemSummary.homeWorkbenchUpdatedAt, "2026-07-24T13:00:00.000Z");
});

test("unscoped (no actor / single-team) is a pass-through", () => {
  const all = build(null);
  assert.deepEqual(ids(all.codexImportedEvidenceRecords), ["imp_a", "imp_b", "imp_legacy"]);
  assert.equal(all.evidenceCenterRecords.length, EVIDENCE_CENTER.length);
});

test("a legacy imported row (no teamId) belongs to the local team, not a foreign one", () => {
  const teamA = build({ teamId: TEAM_A });
  assert.ok(
    !teamA.codexImportedEvidenceRecords.some((r) => r.id === "imp_legacy"),
    "legacy local-team rows must not leak to a non-local team",
  );
});
