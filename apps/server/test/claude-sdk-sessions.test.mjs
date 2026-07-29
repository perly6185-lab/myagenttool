import assert from "node:assert/strict";
import { test } from "node:test";

import { createCodexService } from "../src/services/codex.mjs";

function fixture(claudeSessions = []) {
  const state = {
    agents: [],
    invocations: [],
    claudeSessions,
    codexSessions: [],
    codexWorkspaces: [],
    codexHookEvents: [],
    codexApprovalBrokerRequests: [],
    approvalRequests: [],
  };
  const service = createCodexService({
    state,
    now: () => "2026-07-28T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_1`,
    appendEvent: () => {},
    currentProject: () => null,
    findInvocation: (id) => state.invocations.find((item) => item.id === id) ?? null,
    persistStateSoon: () => {},
    uniqueStrings: (values) => [...new Set(values)],
    worktreeForProject: () => null,
  });
  return { state, service };
}

test("Claude SDK exact resume is scoped to user and repository", () => {
  const { service } = fixture([
    {
      id: "cld_3",
      invocationId: "inv_3",
      claudeSessionId: "123e4567-e89b-42d3-a456-426614174003",
      userId: "usr_b",
      repoPath: "C:\\repo",
    },
    {
      id: "cld_2",
      invocationId: "inv_2",
      claudeSessionId: "123e4567-e89b-42d3-a456-426614174002",
      userId: "usr_a",
      repoPath: "C:\\other",
    },
    {
      id: "cld_1",
      invocationId: "inv_1",
      claudeSessionId: "123e4567-e89b-42d3-a456-426614174001",
      userId: "usr_a",
      repoPath: "C:\\repo",
    },
  ]);
  assert.equal(service.resolveResumeClaudeSessionId({
    repoPath: "C:\\repo",
    userId: "usr_a",
  }), "123e4567-e89b-42d3-a456-426614174001");
  assert.equal(service.resolveResumeClaudeSessionId({
    repoPath: "C:\\repo",
    userId: "usr_a",
    invocationId: "inv_2",
  }), null);
});

test("Claude SDK session lifecycle captures provider id and safe picker metadata", () => {
  const { state, service } = fixture([]);
  const agent = {
    id: "agt_claude_default",
    adapter: { type: "cli", command: "claude", permissionMode: "default" },
    location: { type: "local_device", deviceId: "dev_1" },
  };
  const session = service.createManagedClaudeSession({
    invocationId: "inv_1",
    agent,
    claudeSessionMode: "new",
    requestedBy: "usr_a",
    project: { id: "prj_1", path: "C:\\repo" },
  });
  service.updateClaudeSessionFromEvent({
    invocationId: "inv_1",
    type: "agent_output",
    data: {
      source: "claude_sdk",
      sessionId: "123e4567-e89b-42d3-a456-426614174001",
    },
    createdAt: "2026-07-28T00:01:00.000Z",
  });
  service.closeClaudeSession({
    id: "inv_1",
    result: {},
  }, "succeeded", {
    claudeSessionId: "123e4567-e89b-42d3-a456-426614174001",
  });

  assert.equal(session.status, "completed");
  assert.equal(session.claudeSessionId, "123e4567-e89b-42d3-a456-426614174001");
  const picker = service.resumableClaudeSessions({ repoPath: "C:\\repo", userId: "usr_a" });
  assert.equal(picker.length, 1);
  assert.equal(picker[0].invocationId, "inv_1");
  assert.equal(JSON.stringify(picker).includes(session.claudeSessionId), false);
  assert.equal(state.claudeSessions.length, 1);
});

test("provider-neutral approval broker distinguishes Claude ask and auto modes", () => {
  const { state, service } = fixture([]);
  state.agents.push(
    { id: "agt_ask", adapter: { command: "claude", permissionMode: "default" } },
    { id: "agt_auto", adapter: { command: "claude", permissionMode: "acceptEdits" } },
  );
  state.invocations.push(
    { id: "inv_ask", agentId: "agt_ask", options: { metadata: {} } },
    { id: "inv_auto", agentId: "agt_auto", options: { metadata: {} } },
  );

  const ask = service.recordCodexHookEvent({
    invocationId: "inv_ask",
    provider: "claude",
    eventName: "PermissionRequest",
    toolName: "Bash",
    summary: "Run git status",
  });
  const auto = service.recordCodexHookEvent({
    invocationId: "inv_auto",
    provider: "claude",
    eventName: "PermissionRequest",
    toolName: "Edit",
    summary: "Edit src/index.ts",
  });
  const autoBash = service.recordCodexHookEvent({
    invocationId: "inv_auto",
    provider: "claude",
    eventName: "PermissionRequest",
    toolName: "Bash",
    summary: "Run command — Command: Remove-Item -Recurse C:\\repo",
  });

  assert.equal(ask.brokerRequest.provider, "claude");
  assert.equal(ask.brokerRequest.status, "pending");
  assert.equal(auto.brokerRequest.status, "approved");
  assert.equal(autoBash.brokerRequest.status, "pending");
});

test("actual CLI rollback transport keeps managed Claude session state honest", () => {
  const { service } = fixture([{
    id: "cld_1",
    invocationId: "inv_1",
    claudeSessionId: null,
    status: "registered",
    runtime: "agent_sdk",
    policyProfile: "claude_sdk_native_controls",
  }]);
  service.updateClaudeSessionFromEvent({
    invocationId: "inv_1",
    type: "claude_transport_selected",
    data: { runtime: "cli" },
    createdAt: "2026-07-28T00:01:00.000Z",
  });
  service.updateClaudeSessionFromEvent({
    invocationId: "inv_1",
    type: "agent_output",
    data: {
      source: "claude_jsonl",
      sessionId: "123e4567-e89b-42d3-a456-426614174001",
    },
    createdAt: "2026-07-28T00:02:00.000Z",
  });
  const session = service.resolveResumeClaudeSessionId({ invocationId: "inv_1" });
  assert.equal(session, "123e4567-e89b-42d3-a456-426614174001");
});
