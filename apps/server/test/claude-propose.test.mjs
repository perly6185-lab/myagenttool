/*
 * Claude governance Phase 3 (#913): the write-ADJACENT `claude.propose.patch`
 * capability. Claude proposes a change as an immutable patch artifact and NEVER
 * writes the worktree (plan mode, diff-as-text). The proposal rides the durable
 * invocation result; a later approval-bound apply (Phase 4) consumes it. These
 * tests lock the governed identity gate, the facade projection, and tool
 * discovery + dispatch + validation (task required, no severityFloor).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationService } from "../src/services/applications.mjs";
import { CLAUDE_APPLICATION_ID, createClaudeApplicationRegistration } from "../src/services/claude-application.mjs";
import {
  CLAUDE_PROPOSE_TOOL_CONTRACT,
  createClaudeProposeAgentRegistration,
  isGovernedClaudeProposeAgent,
} from "../src/services/claude-propose-agent.mjs";
import { createToolService } from "../src/services/tools.mjs";

const now = () => "2026-07-14T00:00:00.000Z";

function governedProposeAgent({ args, status = "available" } = {}) {
  return {
    id: "agt_claude_propose_patch",
    name: "Claude Patch Proposal",
    adapter: {
      type: "cli",
      command: "node",
      args: args ?? ["/opt/myagenttool/tools/agents/claude-review-wrapper.mjs", "--mode", "propose-patch"],
      outputFormat: "plain_result",
    },
    toolContract: { name: CLAUDE_PROPOSE_TOOL_CONTRACT.name },
    capabilities: [{ name: "code_proposal" }],
    status,
    health: { status: "healthy" },
    location: { type: "local_device", deviceId: "dev_local_001" },
  };
}

// --- Governed-agent identity gate ---

test("createClaudeProposeAgentRegistration produces a governed propose agent", () => {
  const registration = createClaudeProposeAgentRegistration();
  const agent = {
    id: registration.id,
    adapter: { type: "cli", command: registration.command, args: registration.args, outputFormat: registration.outputFormat },
    toolContract: registration.toolContract,
    capabilities: [{ name: registration.capabilityName }],
  };
  assert.equal(registration.id, "agt_claude_propose_patch");
  assert.deepEqual(registration.args, ["tools/agents/claude-review-wrapper.mjs", "--mode", "propose-patch"]);
  assert.equal(isGovernedClaudeProposeAgent(agent), true);
});

test("isGovernedClaudeProposeAgent rejects other modes, a foreign path, and a wrong capability", () => {
  assert.equal(isGovernedClaudeProposeAgent(governedProposeAgent({
    args: ["/opt/myagenttool/tools/agents/claude-review-wrapper.mjs", "--mode", "diff-review"],
  })), false, "review mode is not the propose agent");
  assert.equal(isGovernedClaudeProposeAgent(governedProposeAgent({
    args: ["/tmp/evil/claude-review-wrapper.mjs", "--mode", "propose-patch"],
  })), false, "a wrapper outside tools/agents is not governed");
  const wrongCapability = governedProposeAgent();
  wrongCapability.capabilities = [{ name: "code_analysis" }];
  assert.equal(isGovernedClaudeProposeAgent(wrongCapability), false, "code_analysis is not code_proposal");
});

// --- Application facade projection ---

test("app_claude projects the propose.patch facade with requiresApproval false (read-only proposal)", () => {
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
    .find((item) => item.name === "app.app_claude.propose.patch");
  assert.ok(capability, "propose.patch capability should be projected");
  assert.equal(capability.kind, "tool_facade");
  assert.equal(capability.metadata.execution.toolName, "claude.propose.patch");
  assert.equal(capability.requiresApproval, false, "generating a proposal is read-only");
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
      const invocation = { id: "inv_propose", status: "queued", agentId: agent.id, options, task };
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

test("claude.propose.patch is discoverable only when a governed propose agent is present", () => {
  assert.equal(toolServiceWith({ agents: [] }).service.getTool("claude.propose.patch"), null);

  const present = toolServiceWith({ agents: [governedProposeAgent()], apps: [{ id: CLAUDE_APPLICATION_ID, status: "active" }] });
  const descriptor = present.service.getTool("claude.propose.patch");
  assert.ok(descriptor, "descriptor should surface once the agent exists");
  assert.equal(descriptor.agents[0].mode, "propose-patch");
  assert.equal(descriptor.approvalPolicy.applyPatch, "approval_required", "apply is gated even though propose is not");
  assert.equal(descriptor.application.capability, "app.app_claude.propose.patch");
});

test("claude.propose.patch requires a task and rejects severityFloor as an unknown field", () => {
  const { service } = toolServiceWith({ agents: [governedProposeAgent()] });
  const noTask = service.createToolInvocation("claude.propose.patch", { worktreeId: "wt" });
  assert.equal(noTask.status, 400);
  assert.equal(noTask.body.error, "task_required");

  const unknown = service.createToolInvocation("claude.propose.patch", { worktreeId: "wt", task: "do it", severityFloor: "high" });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, "unknown_field");
  assert.deepEqual(unknown.body.fields, ["severityFloor"]);
});

test("claude.propose.patch dispatches a governed invocation carrying the task in metadata", () => {
  const { service, created } = toolServiceWith({
    agents: [governedProposeAgent()],
    apps: [{ id: CLAUDE_APPLICATION_ID, status: "active" }],
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }],
    worktrees: [{ id: "wt_a", projectId: "prj_a" }],
  });
  const result = service.createToolInvocation(
    "claude.propose.patch",
    { projectId: "prj_a", worktreeId: "wt_a", task: "Add a null guard to the parser." },
    { userId: "usr_a", teamId: "team_a" },
  );
  assert.equal(result.status, 201);
  assert.equal(result.body.tool, "claude.propose.patch");
  assert.equal(created.length, 1);
  const metadata = created[0].options.metadata;
  assert.equal(metadata.tool, "claude.propose.patch");
  assert.equal(metadata.task, "Add a null guard to the parser.", "the bridge injects --task from this");
  assert.equal(metadata.providerType, "application");
  assert.equal(metadata.capability, "app.app_claude.propose.patch");
  // #913: the descriptor revision is stamped at creation so the completed artifact
  // is bound to the exact contract it was generated under (defaults to 1 when the
  // application record predates revisions).
  assert.equal(metadata.descriptorRevision, 1);
});

test("claude.propose.patch stamps the application's current descriptor revision into metadata", () => {
  const { service, created } = toolServiceWith({
    agents: [governedProposeAgent()],
    apps: [{ id: CLAUDE_APPLICATION_ID, status: "active", descriptorRevision: 3 }],
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }],
    worktrees: [{ id: "wt_a", projectId: "prj_a" }],
  });
  const result = service.createToolInvocation(
    "claude.propose.patch",
    { projectId: "prj_a", worktreeId: "wt_a", task: "Rename the flag." },
    { userId: "usr_a", teamId: "team_a" },
  );
  assert.equal(result.status, 201);
  assert.equal(created[0].options.metadata.descriptorRevision, 3);
});

test("claude.propose.patch denies a foreign-team worktree before creating an invocation", () => {
  const { service, created } = toolServiceWith({
    agents: [governedProposeAgent()],
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }],
    worktrees: [{ id: "wt_a", projectId: "prj_a" }],
  });
  const result = service.createToolInvocation(
    "claude.propose.patch",
    { projectId: "prj_a", worktreeId: "wt_a", task: "x" },
    { userId: "usr_b", teamId: "team_b" },
  );
  assert.equal(result.status, 404);
  assert.equal(result.body.error, "project_not_found");
  assert.equal(created.length, 0);
});
