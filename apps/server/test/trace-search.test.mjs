import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { searchTraceRecords } from "../src/read-models/trace-search.mjs";

const state = {
  projects: [{ id: "p_a", ownerTeamId: "team_a" }, { id: "p_b", ownerTeamId: "team_b" }],
  users: [],
  invocations: [
    { id: "inv_a2", projectId: "p_a", agentId: "agent_writer", status: "done", input: { task: "Create quarterly deck", secret: "never-index-this" }, traceId: "trace_a2", createdAt: "2026-07-25T02:00:00Z", options: { metadata: { applicationId: "powerpoint" } } },
    { id: "inv_a1", projectId: "p_a", agentId: "agent_sheet", status: "done", input: { task: "Reconcile budget" }, createdAt: "2026-07-25T01:00:00Z" },
    { id: "inv_b", projectId: "p_b", agentId: "agent_foreign", status: "done", input: { task: "Foreign secret" }, createdAt: "2026-07-25T03:00:00Z" },
  ],
  events: [{ id: "evt_1", invocationId: "inv_a2", type: "application.completed", message: "raw secret must not be indexed" }],
  evidenceLedger: [{ id: "ev_1", invocationId: "inv_a2", summary: "private payload" }],
  applicationResults: [],
  channelDeliveries: [{ id: "delivery_1", invocationId: "inv_a2", channelId: "slack_ops" }],
};

describe("searchTraceRecords", () => {
  it("searches bounded fields and hides foreign-team runs", () => {
    assert.equal(searchTraceRecords({ state, actor: { teamId: "team_a" }, query: "quarterly application.completed" }).records[0].invocationId, "inv_a2");
    assert.equal(searchTraceRecords({ state, actor: { teamId: "team_a" }, query: "foreign" }).total, 0);
    assert.equal(searchTraceRecords({ state, actor: { teamId: "team_a" }, query: "never-index-this" }).total, 0);
    assert.equal(searchTraceRecords({ state, actor: { teamId: "team_a" }, query: "raw secret" }).total, 0);
  });

  it("returns stable cursor pagination", () => {
    const first = searchTraceRecords({ state, actor: { teamId: "team_a" }, limit: 1 });
    const second = searchTraceRecords({ state, actor: { teamId: "team_a" }, limit: 1, cursor: first.nextCursor });
    assert.equal(first.records[0].invocationId, "inv_a2");
    assert.equal(second.records[0].invocationId, "inv_a1");
    assert.equal(second.nextCursor, null);
    const rebound = searchTraceRecords({ state, actor: { teamId: "team_a" }, query: "budget", limit: 1, cursor: first.nextCursor });
    assert.equal(rebound.records[0].invocationId, "inv_a1");
  });
});
