/*
 * Claude governance Phase 2 (#912): the read-only `claude.explain.diff` analysis
 * capability. Mirrors the Phase 1 review path but produces an explanation (not
 * findings), takes no severityFloor, and collects on the invocation rather than a
 * bespoke findings array. These tests lock the governed identity gate, the
 * Application facade projection, and the tool discovery + dispatch + validation.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationService } from "../src/services/applications.mjs";
import { CLAUDE_APPLICATION_ID, createClaudeApplicationRegistration } from "../src/services/claude-application.mjs";
import {
  CLAUDE_EXPLAIN_TOOL_CONTRACT,
  createClaudeExplainAgentRegistration,
  isGovernedClaudeExplainAgent,
} from "../src/services/claude-explain-agent.mjs";
import { createToolService } from "../src/services/tools.mjs";

const now = () => "2026-07-14T00:00:00.000Z";

// The governed explain agent as it appears in state: fixed wrapper argv
// (--mode diff-explain), the explain tool contract, and a code_analysis capability.
function governedExplainAgent({ args, status = "available" } = {}) {
  return {
    id: "agt_claude_explain_diff",
    name: "Claude Diff Explain",
    adapter: {
      type: "cli",
      command: "node",
      args: args ?? ["/opt/myagenttool/tools/agents/claude-review-wrapper.mjs", "--mode", "diff-explain"],
      outputFormat: "plain_result",
    },
    toolContract: { name: CLAUDE_EXPLAIN_TOOL_CONTRACT.name },
    capabilities: [{ name: "code_analysis" }],
    status,
    health: { status: "healthy" },
    location: { type: "local_device", deviceId: "dev_local_001" },
  };
}

// --- Governed-agent identity gate ---

test("createClaudeExplainAgentRegistration produces a governed explain agent", () => {
  const registration = createClaudeExplainAgentRegistration();
  // The registration is the flat shape POSTed to /api/agents; project it into the
  // adapter shape the identity gate reads.
  const agent = {
    id: registration.id,
    adapter: { type: "cli", command: registration.command, args: registration.args, outputFormat: registration.outputFormat },
    toolContract: registration.toolContract,
    capabilities: [{ name: registration.capabilityName }],
  };
  assert.equal(registration.id, "agt_claude_explain_diff");
  assert.deepEqual(registration.args, ["tools/agents/claude-review-wrapper.mjs", "--mode", "diff-explain"]);
  assert.equal(isGovernedClaudeExplainAgent(agent), true);
});

test("isGovernedClaudeExplainAgent rejects the review mode, a foreign wrapper path, and a wrong tool", () => {
  assert.equal(isGovernedClaudeExplainAgent(governedExplainAgent({
    args: ["/opt/myagenttool/tools/agents/claude-review-wrapper.mjs", "--mode", "diff-review"],
  })), false, "review mode is not the explain agent");
  assert.equal(isGovernedClaudeExplainAgent(governedExplainAgent({
    args: ["/tmp/evil/claude-review-wrapper.mjs", "--mode", "diff-explain"],
  })), false, "a wrapper outside tools/agents is not governed");
  const wrongTool = governedExplainAgent();
  wrongTool.toolContract = { name: "claude.review.diff" };
  assert.equal(isGovernedClaudeExplainAgent(wrongTool), false, "the review tool contract is not the explain agent");
  const wrongCapability = governedExplainAgent();
  wrongCapability.capabilities = [{ name: "code_review" }];
  assert.equal(isGovernedClaudeExplainAgent(wrongCapability), false, "code_review is not code_analysis");
});

// --- Application facade projection ---

test("app_claude projects the explain.diff facade beside review.diff", () => {
  const state = { applications: [] };
  const service = createApplicationService({
    state,
    now,
    nextId: (prefix) => `${prefix}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });
  const application = service.registerApplication(createClaudeApplicationRegistration({ autoOnline: true }));
  const capability = service.listApplicationCapabilities(application.id)
    .find((item) => item.name === "app.app_claude.explain.diff");
  assert.ok(capability, "explain.diff capability should be projected");
  assert.equal(capability.kind, "tool_facade");
  assert.equal(capability.metadata.execution.toolName, "claude.explain.diff");
  assert.equal(capability.requiresApproval, false);
});

// --- Tool discovery + dispatch + validation ---

function toolServiceWith({ agents = [], projects = [], worktrees = [], apps = [] } = {}) {
  const created = [];
  const state = {
    agents,
    projects,
    worktrees,
    applications: apps,
    currentProjectId: projects[0]?.id ?? null,
    device: { unlinkState: "linked" },
  };
  const service = createToolService({
    state,
    now,
    appendEvent: () => {},
    createInvocation: (task, agent, options) => {
      const invocation = { id: "inv_explain", status: "queued", agentId: agent.id, options, task };
      created.push(invocation);
      return invocation;
    },
    startInvocationIfAllowed: () => {},
    findApplication: (id) => apps.find((app) => app.id === id) ?? null,
    findAgent: (id) => agents.find((agent) => agent.id === id) ?? null,
    planApplicationWrapperInvocation: () => ({ ok: false, status: 500, body: { error: "unexpected_plan" } }),
  });
  return { service, state, created };
}

test("claude.explain.diff is discoverable only when a governed explain agent is present", () => {
  const absent = toolServiceWith({ agents: [] });
  assert.equal(absent.service.getTool("claude.explain.diff"), null);

  const present = toolServiceWith({ agents: [governedExplainAgent()], apps: [{ id: CLAUDE_APPLICATION_ID, status: "active" }] });
  const descriptor = present.service.getTool("claude.explain.diff");
  assert.ok(descriptor, "descriptor should surface once the agent exists");
  assert.equal(descriptor.outputCollection, "invocations");
  assert.equal(descriptor.agents[0].mode, "diff-explain");
  assert.ok(!("severityFloor" in descriptor.inputSchema.properties), "explain takes no severityFloor");
  assert.equal(descriptor.application.capability, "app.app_claude.explain.diff");
});

test("claude.explain.diff rejects severityFloor as an unknown field and requires a worktree", () => {
  const { service } = toolServiceWith({ agents: [governedExplainAgent()] });
  const unknown = service.createToolInvocation("claude.explain.diff", { worktreeId: "wt", severityFloor: "high" });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, "unknown_field");
  assert.deepEqual(unknown.body.fields, ["severityFloor"]);

  const noWorktree = service.createToolInvocation("claude.explain.diff", {});
  assert.equal(noWorktree.status, 400);
  assert.equal(noWorktree.body.error, "worktree_required");
});

test("claude.explain.diff dispatches a governed invocation for an actor-owned worktree", () => {
  const { service, created } = toolServiceWith({
    agents: [governedExplainAgent()],
    apps: [{ id: CLAUDE_APPLICATION_ID, status: "active" }],
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }],
    worktrees: [{ id: "wt_a", projectId: "prj_a" }],
  });
  const result = service.createToolInvocation(
    "claude.explain.diff",
    { projectId: "prj_a", worktreeId: "wt_a", instruction: "Focus on the auth path." },
    { userId: "usr_a", teamId: "team_a" },
  );
  assert.equal(result.status, 201);
  assert.equal(result.body.tool, "claude.explain.diff");
  assert.equal(result.body.outputCollection, "invocations");
  assert.equal(created.length, 1);
  const metadata = created[0].options.metadata;
  assert.equal(metadata.tool, "claude.explain.diff");
  assert.equal(metadata.providerType, "application");
  assert.equal(metadata.applicationId, CLAUDE_APPLICATION_ID);
  assert.equal(metadata.capability, "app.app_claude.explain.diff");
  assert.equal(metadata.applicationAction, "tool:claude.explain.diff");
});

test("claude.explain.diff denies a foreign-team worktree before creating an invocation", () => {
  const { service, created } = toolServiceWith({
    agents: [governedExplainAgent()],
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }],
    worktrees: [{ id: "wt_a", projectId: "prj_a" }],
  });
  const result = service.createToolInvocation(
    "claude.explain.diff",
    { projectId: "prj_a", worktreeId: "wt_a" },
    { userId: "usr_b", teamId: "team_b" },
  );
  assert.equal(result.status, 404);
  assert.equal(result.body.error, "project_not_found");
  assert.equal(created.length, 0);
});
