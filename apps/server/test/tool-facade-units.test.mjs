import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { createCodexReviewImportService } from "../src/services/codex-review-imports.mjs";
import { createCodexPlanImportService } from "../src/services/codex-plan-imports.mjs";
import { createCodexPatchProposalImportService } from "../src/services/codex-patch-proposal-imports.mjs";
import { createCodexPatchApplyImportService } from "../src/services/codex-patch-apply-imports.mjs";
import { createClaudeReviewImportService } from "../src/services/claude-review-imports.mjs";
import { createCcusageImportService } from "../src/services/ccusage-imports.mjs";
import { isGovernedCodexApplyPatchAgent, isGovernedCodexPatchProposalAgent, isGovernedCodexPlanAgent, isGovernedCodexReviewAgent } from "../src/services/codex-agent.mjs";
import { isGovernedClaudeReviewAgent } from "../src/services/claude-agent.mjs";
import { createToolService } from "../src/services/tools.mjs";

const now = () => "2026-07-02T00:00:00.000Z";

// A governed review agent as it appears in state (adapter + toolContract +
// code_review capability + the fixed wrapper argv). Wrapper path is absolute,
// as the real registration resolves it.
function governedReviewAgent({ id, tool, wrapper, args }) {
  return {
    id,
    name: `${id} agent`,
    adapter: {
      type: "cli",
      command: "node",
      args: args ?? [`/opt/myagenttool/tools/agents/${wrapper}`, "--mode", "diff-review"],
      outputFormat: "plain_result",
    },
    toolContract: { name: tool },
    capabilities: [{ name: "code_review" }],
  };
}

function governedPlanAgent({ args } = {}) {
  return {
    id: "agt_codex_plan_change",
    name: "Codex Change Plan agent",
    adapter: {
      type: "cli",
      command: "node",
      args: args ?? ["/opt/myagenttool/tools/agents/codex-plan-wrapper.mjs", "--mode", "change-plan"],
      outputFormat: "plain_result",
    },
    toolContract: { name: "codex.plan.change" },
    capabilities: [{ name: "change_planning" }],
  };
}

function governedPatchProposalAgent({ args } = {}) {
  return {
    id: "agt_codex_propose_patch",
    name: "Codex Patch Proposal agent",
    adapter: {
      type: "cli",
      command: "node",
      args: args ?? ["/opt/myagenttool/tools/agents/codex-patch-proposal-wrapper.mjs", "--mode", "patch-proposal"],
      outputFormat: "plain_result",
    },
    toolContract: { name: "codex.propose.patch" },
    capabilities: [{ name: "patch_proposal" }],
  };
}

function governedApplyPatchAgent({ args, filePolicy = "workspace_write", networkPolicy = "forbidden" } = {}) {
  return {
    id: "agt_codex_apply_patch",
    name: "Codex Apply Patch agent",
    adapter: {
      type: "cli",
      command: "node",
      args: args ?? ["/opt/myagenttool/tools/agents/codex-apply-patch-wrapper.mjs", "--mode", "apply-patch"],
      outputFormat: "plain_result",
      filePolicy,
      networkPolicy,
    },
    toolContract: { name: "codex.apply.patch" },
    capabilities: [{ name: "patch_apply" }],
  };
}

function governedCcusageAgent() {
  return {
    id: "agt_ccusage_daily",
    name: "ccusage Daily Report",
    adapter: {
      type: "cli",
      command: "node",
      args: ["/opt/myagenttool/tools/agents/ccusage-wrapper.mjs", "--report", "daily"],
      outputFormat: "plain_result",
    },
    toolContract: { name: "ccusage.report" },
    capabilities: [{ name: "usage_cost_report" }],
  };
}

function importState() {
  return { codexReviewFindings: [], codexChangePlans: [], codexPatchProposals: [], claudeReviewFindings: [], importedUsageEstimates: [] };
}

function makeCounter(prefix) {
  let n = 0;
  return () => `${prefix}_${(n += 1)}`;
}

function sha256(text) {
  return createHash("sha256").update(String(text).replace(/\r\n/g, "\n").trim(), "utf8").digest("hex");
}

// --- Governed-agent identity (regression for the basename→full-path fix) ---

test("isGovernedCodexReviewAgent rejects a wrapper path outside tools/agents", () => {
  // The pinning fix: a script whose *basename* matches the wrapper but lives
  // at an attacker-controlled path must NOT be treated as governed.
  const evil = governedReviewAgent({
    id: "agt_codex_review_diff",
    tool: "codex.review.diff",
    wrapper: "codex-review-wrapper.mjs",
    args: ["/tmp/evil/codex-review-wrapper.mjs", "--mode", "diff-review"],
  });
  assert.equal(isGovernedCodexReviewAgent(evil), false);
});

test("isGovernedCodexReviewAgent accepts the canonical absolute wrapper path", () => {
  const good = governedReviewAgent({ id: "agt_codex_review_diff", tool: "codex.review.diff", wrapper: "codex-review-wrapper.mjs" });
  assert.equal(isGovernedCodexReviewAgent(good), true);
});

test("isGovernedCodexPlanAgent accepts only the canonical change-plan wrapper", () => {
  assert.equal(isGovernedCodexPlanAgent(governedPlanAgent()), true);
  assert.equal(isGovernedCodexPlanAgent(governedPlanAgent({
    args: ["/tmp/evil/codex-plan-wrapper.mjs", "--mode", "change-plan"],
  })), false);
  assert.equal(isGovernedCodexPlanAgent(governedPlanAgent({
    args: ["/opt/myagenttool/tools/agents/codex-plan-wrapper.mjs", "--mode", "change-plan", "--codex-cli", "evil.mjs"],
  })), false);
});

test("isGovernedCodexPatchProposalAgent accepts only the canonical patch-proposal wrapper", () => {
  assert.equal(isGovernedCodexPatchProposalAgent(governedPatchProposalAgent()), true);
  assert.equal(isGovernedCodexPatchProposalAgent(governedPatchProposalAgent({
    args: ["/tmp/evil/codex-patch-proposal-wrapper.mjs", "--mode", "patch-proposal"],
  })), false);
  assert.equal(isGovernedCodexPatchProposalAgent(governedPatchProposalAgent({
    args: ["/opt/myagenttool/tools/agents/codex-patch-proposal-wrapper.mjs", "--mode", "patch-proposal", "--codex-cli", "evil.mjs"],
  })), false);
});

test("isGovernedCodexApplyPatchAgent accepts only the canonical apply wrapper with workspace-write policy", () => {
  assert.equal(isGovernedCodexApplyPatchAgent(governedApplyPatchAgent()), true);
  assert.equal(isGovernedCodexApplyPatchAgent(governedApplyPatchAgent({
    args: ["/tmp/evil/codex-apply-patch-wrapper.mjs", "--mode", "apply-patch"],
  })), false);
  assert.equal(isGovernedCodexApplyPatchAgent(governedApplyPatchAgent({
    args: ["/opt/myagenttool/tools/agents/codex-apply-patch-wrapper.mjs", "--mode", "apply-patch", "--patch-file", "/tmp/evil.patch"],
  })), false);
  assert.equal(isGovernedCodexApplyPatchAgent(governedApplyPatchAgent({ filePolicy: "read_only" })), false);
});

test("isGovernedClaudeReviewAgent rejects a wrapper path outside tools/agents", () => {
  const evil = governedReviewAgent({
    id: "agt_claude_review_diff",
    tool: "claude.review.diff",
    wrapper: "claude-review-wrapper.mjs",
    args: ["/tmp/evil/claude-review-wrapper.mjs", "--mode", "diff-review"],
  });
  assert.equal(isGovernedClaudeReviewAgent(evil), false);
});

test("isGovernedCodexReviewAgent rejects extra wrapper args", () => {
  const extra = governedReviewAgent({
    id: "agt_codex_review_diff",
    tool: "codex.review.diff",
    wrapper: "codex-review-wrapper.mjs",
    args: ["/opt/myagenttool/tools/agents/codex-review-wrapper.mjs", "--mode", "diff-review", "--codex-cli", "evil.mjs"],
  });
  assert.equal(isGovernedCodexReviewAgent(extra), false);
});

// --- Tool invocation boundary ---

test("createToolInvocation rejects a foreign project before creating an invocation", () => {
  let createInvocationCalls = 0;
  const state = {
    projects: [
      { id: "projA", ownerTeamId: "team_a" },
      { id: "projB", ownerTeamId: "team_b" },
    ],
    worktrees: [
      { id: "wtA", projectId: "projA", workspaceProjectId: "projA" },
    ],
    agents: [
      governedReviewAgent({ id: "agt_codex_review_diff", tool: "codex.review.diff", wrapper: "codex-review-wrapper.mjs" }),
    ],
    device: { unlinkState: "linked" },
  };
  const { createToolInvocation } = createToolService({
    state,
    now,
    appendEvent: () => {},
    createInvocation: () => {
      createInvocationCalls += 1;
      throw new Error("foreign project must not create an invocation");
    },
    startInvocationIfAllowed: () => {},
    findApplication: () => null,
    findAgent: (id) => state.agents.find((agent) => agent.id === id) ?? null,
    planApplicationWrapperInvocation: () => ({ ok: false, status: 500, body: { error: "unexpected_plan" } }),
  });

  const result = createToolInvocation(
    "codex.review.diff",
    { projectId: "projA", worktreeId: "wtA" },
    { userId: "usr_b", teamId: "team_b" },
  );

  assert.equal(result.status, 404);
  assert.equal(result.body.error, "project_not_found");
  assert.equal(createInvocationCalls, 0);
});

test("createToolInvocation for codex.plan.change requires explicit project scope", () => {
  let createInvocationCalls = 0;
  const state = {
    projects: [{ id: "projA", ownerTeamId: "team_a" }],
    worktrees: [{ id: "wtA", projectId: "projA", workspaceProjectId: "projA" }],
    agents: [governedPlanAgent()],
    device: { unlinkState: "linked" },
  };
  const { createToolInvocation } = createToolService({
    state,
    now,
    appendEvent: () => {},
    createInvocation: () => {
      createInvocationCalls += 1;
      throw new Error("missing project must not create an invocation");
    },
    startInvocationIfAllowed: () => {},
    findApplication: () => null,
    findAgent: (id) => state.agents.find((agent) => agent.id === id) ?? null,
    planApplicationWrapperInvocation: () => ({ ok: false, status: 500, body: { error: "unexpected_plan" } }),
  });

  const result = createToolInvocation(
    "codex.plan.change",
    { worktreeId: "wtA", goal: "Plan a safe change." },
    { userId: "usr_a", teamId: "team_a" },
  );

  assert.equal(result.status, 400);
  assert.equal(result.body.error, "project_required");
  assert.equal(createInvocationCalls, 0);
});

test("createToolInvocation for codex.propose.patch validates base plan scope before invocation", () => {
  let createInvocationCalls = 0;
  const state = {
    projects: [{ id: "projA", ownerTeamId: "team_a" }],
    worktrees: [{ id: "wtA", projectId: "projA", workspaceProjectId: "projA" }],
    codexChangePlans: [{ id: "cpl_other", projectId: "projA", worktreeId: "wtOther" }],
    agents: [governedPatchProposalAgent()],
    device: { unlinkState: "linked" },
  };
  const { createToolInvocation } = createToolService({
    state,
    now,
    appendEvent: () => {},
    createInvocation: () => {
      createInvocationCalls += 1;
      throw new Error("invalid base plan must not create an invocation");
    },
    startInvocationIfAllowed: () => {},
    findApplication: () => null,
    findAgent: (id) => state.agents.find((agent) => agent.id === id) ?? null,
    planApplicationWrapperInvocation: () => ({ ok: false, status: 500, body: { error: "unexpected_plan" } }),
  });

  const mismatch = createToolInvocation(
    "codex.propose.patch",
    { projectId: "projA", worktreeId: "wtA", goal: "Propose.", basePlanId: "cpl_other" },
    { userId: "usr_a", teamId: "team_a" },
  );
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.error, "base_plan_scope_mismatch");

  const large = createToolInvocation(
    "codex.propose.patch",
    { projectId: "projA", worktreeId: "wtA", goal: "Propose.", maxFiles: 16 },
    { userId: "usr_a", teamId: "team_a" },
  );
  assert.equal(large.status, 409);
  assert.equal(large.body.error, "approval_required");
  assert.equal(createInvocationCalls, 0);
});

test("createToolInvocation for codex.apply.patch requires approved proposal, hash, and approval token before applying", () => {
  const diff = "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new";
  const patchSha256 = sha256(diff);
  const state = {
    projects: [{ id: "projA", ownerTeamId: "team_a" }],
    worktrees: [{ id: "wtA", projectId: "projA", workspaceProjectId: "projA" }],
    codexPatchProposals: [{
      id: "cpp_apply",
      projectId: "projA",
      worktreeId: "wtA",
      patchSha256,
      reviewState: "approved",
      raw: { diff },
    }],
    invocations: [],
    approvalRequests: [],
    agents: [
      governedApplyPatchAgent(),
      { id: "agt_platform_application_control", name: "Application Control", adapter: { type: "platform" }, capabilities: [{ name: "application_control" }], status: "available" },
    ],
    device: { unlinkState: "linked" },
  };
  let seq = 0;
  const events = [];
  const { createToolInvocation } = createToolService({
    state,
    now,
    appendEvent: (event) => events.push(event),
    createInvocation: (task, agent, options = {}) => {
      seq += 1;
      const approvalRequestId = options.requireLocalApproval ? `apr_${seq}` : null;
      const invocation = {
        id: `inv_${seq}`,
        task,
        agentId: agent.id,
        projectId: options.metadata?.projectId ?? null,
        worktreeId: options.metadata?.worktreeId ?? null,
        status: options.requireLocalApproval ? "waiting_for_local_approval" : "queued",
        approvalRequestId,
        options: { metadata: options.metadata ?? {} },
      };
      state.invocations.unshift(invocation);
      if (approvalRequestId) {
        state.approvalRequests.unshift({ id: approvalRequestId, invocationId: invocation.id, status: "pending" });
      }
      return invocation;
    },
    startInvocationIfAllowed: () => {},
    findApplication: () => null,
    findAgent: (id) => state.agents.find((agent) => agent.id === id) ?? null,
    findApprovalRequest: (id) => state.approvalRequests.find((approval) => approval.id === id) ?? null,
    findInvocation: (id) => state.invocations.find((invocation) => invocation.id === id) ?? null,
    planApplicationWrapperInvocation: () => ({ ok: false, status: 500, body: { error: "unexpected_plan" } }),
  });

  const unreviewed = createToolInvocation(
    "codex.apply.patch",
    { projectId: "projA", worktreeId: "wtA", proposalId: "cpp_apply", patchSha256: "b".repeat(64) },
    { userId: "usr_a", teamId: "team_a" },
  );
  assert.equal(unreviewed.status, 409);
  assert.equal(unreviewed.body.error, "patch_hash_mismatch");

  const approvalRequired = createToolInvocation(
    "codex.apply.patch",
    { projectId: "projA", worktreeId: "wtA", proposalId: "cpp_apply", patchSha256 },
    { userId: "usr_a", teamId: "team_a" },
  );
  assert.equal(approvalRequired.status, 202);
  assert.equal(approvalRequired.body.agentId, "agt_platform_application_control");
  assert.equal(approvalRequired.body.approvalRequestRequired, true);
  assert.equal(state.invocations[0].options.metadata.toolApproval.type, "codex_apply_patch");
  assert.equal(state.invocations.filter((item) => item.agentId === "agt_codex_apply_patch").length, 0);

  const approval = state.approvalRequests.find((item) => item.id === approvalRequired.body.approvalRequestId);
  approval.status = "approved";
  const applied = createToolInvocation(
    "codex.apply.patch",
    { projectId: "projA", worktreeId: "wtA", proposalId: "cpp_apply", patchSha256, approvalRequestId: approval.id },
    { userId: "usr_a", teamId: "team_a" },
  );
  assert.equal(applied.status, 201);
  assert.equal(applied.body.agentId, "agt_codex_apply_patch");
  assert.equal(applied.body.outputCollection, "codexPatchProposals");
  const invocation = state.invocations.find((item) => item.id === applied.body.invocationId);
  assert.equal(invocation.options.metadata.tool, "codex.apply.patch");
  assert.equal(invocation.options.metadata.proposalId, "cpp_apply");
  assert.equal(invocation.options.metadata.patchSha256, patchSha256);
  assert.equal(existsSync(invocation.options.metadata.patchFilePath), true);
  assert.ok(events.some((event) => event.type === "tool_invocation_created" && event.data?.tool === "codex.apply.patch"));
});

test("reviewCodexPatchProposal approves or rejects actor-visible proposals only", () => {
  const state = {
    projects: [
      { id: "projA", ownerTeamId: "team_a" },
      { id: "projB", ownerTeamId: "team_b" },
    ],
    codexPatchProposals: [{
      id: "cpp_review",
      projectId: "projA",
      worktreeId: "wtA",
      reviewState: "generated",
      invocationId: "inv_review",
    }, {
      id: "cpp_foreign",
      projectId: "projB",
      worktreeId: "wtB",
      reviewState: "generated",
      invocationId: "inv_foreign",
    }],
  };
  const events = [];
  let persisted = 0;
  const { reviewCodexPatchProposal } = createToolService({
    state,
    now,
    appendEvent: (event) => events.push(event),
    createInvocation: () => {
      throw new Error("review should not create an invocation");
    },
    startInvocationIfAllowed: () => {},
    findApplication: () => null,
    findAgent: () => null,
    planApplicationWrapperInvocation: () => ({ ok: false, status: 500, body: { error: "unexpected_plan" } }),
    persistStateSoon: () => {
      persisted += 1;
    },
  });

  const approved = reviewCodexPatchProposal("cpp_review", { action: "approve", reason: "Looks good" }, { userId: "usr_a", teamId: "team_a" });
  assert.equal(approved.status, 200);
  assert.equal(state.codexPatchProposals[0].reviewState, "approved");
  assert.equal(state.codexPatchProposals[0].reviewedBy, "usr_a");
  assert.equal(state.codexPatchProposals[0].reviewReason, "Looks good");

  const rejected = reviewCodexPatchProposal("cpp_review", { action: "reject" }, { userId: "usr_a", teamId: "team_a" });
  assert.equal(rejected.status, 200);
  assert.equal(state.codexPatchProposals[0].reviewState, "rejected");
  assert.equal(state.codexPatchProposals[0].reviewReason, null);

  const foreign = reviewCodexPatchProposal("cpp_foreign", { action: "approve" }, { userId: "usr_a", teamId: "team_a" });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, "proposal_not_found");
  assert.equal(persisted, 2);
  assert.ok(events.some((event) => event.type === "codex_patch_proposal_reviewed" && event.data?.proposalId === "cpp_review"));
});

test("reviewCodexPatchProposal rejects invalid transitions and applied proposals", () => {
  const state = {
    projects: [{ id: "projA", ownerTeamId: "team_a" }],
    codexPatchProposals: [{
      id: "cpp_rejected",
      projectId: "projA",
      worktreeId: "wtA",
      reviewState: "rejected",
      invocationId: "inv_rejected",
    }, {
      id: "cpp_applied",
      projectId: "projA",
      worktreeId: "wtA",
      reviewState: "applied",
      invocationId: "inv_applied",
    }],
  };
  const { reviewCodexPatchProposal } = createToolService({
    state,
    now,
    appendEvent: () => {},
    createInvocation: () => {
      throw new Error("review should not create an invocation");
    },
    startInvocationIfAllowed: () => {},
    findApplication: () => null,
    findAgent: () => null,
    planApplicationWrapperInvocation: () => ({ ok: false, status: 500, body: { error: "unexpected_plan" } }),
  });

  const invalidAction = reviewCodexPatchProposal("cpp_rejected", { action: "review" }, { userId: "usr_a", teamId: "team_a" });
  assert.equal(invalidAction.status, 400);
  assert.equal(invalidAction.body.error, "invalid_review_action");

  const invalidTransition = reviewCodexPatchProposal("cpp_rejected", { action: "approve" }, { userId: "usr_a", teamId: "team_a" });
  assert.equal(invalidTransition.status, 409);
  assert.equal(invalidTransition.body.error, "invalid_proposal_review_transition");

  const applied = reviewCodexPatchProposal("cpp_applied", { action: "reject" }, { userId: "usr_a", teamId: "team_a" });
  assert.equal(applied.status, 409);
  assert.equal(applied.body.error, "proposal_already_applied");
});

test("MCP allowed tools project as governed tools without exposing adapter argv", () => {
  const state = {
    projects: [{ id: "projA", ownerTeamId: "team_a" }],
    worktrees: [],
    agents: [{
      id: "agt_doocs_md_mcp",
      name: "doocs/md MCP",
      status: "available",
      health: { status: "unknown" },
      location: { type: "local_device", deviceId: "dev_1" },
      adapter: {
        type: "mcp",
        kind: "mcp",
        transport: "stdio",
        command: "D:/private/doocs-md-mcp.cmd",
        args: ["--private"],
        allowedTools: ["render_markdown", "list_themes"],
        timeoutMs: 60_000,
      },
      capabilities: [{ name: "mcp_tool_call", riskLevel: "medium", riskTags: ["local_execution", "markdown_rendering"] }],
    }],
    device: { id: "dev_1", unlinkState: "linked" },
  };
  const { listTools } = createToolService({
    state,
    now,
    appendEvent: () => {},
    createInvocation: () => {
      throw new Error("descriptor discovery must not create an invocation");
    },
    startInvocationIfAllowed: () => {},
    findApplication: () => null,
    findAgent: (id) => state.agents.find((agent) => agent.id === id) ?? null,
    planApplicationWrapperInvocation: () => ({ ok: false, status: 500, body: { error: "unexpected_plan" } }),
  });

  const render = listTools().find((tool) => tool.name === "doocs_md.render_markdown");
  assert.equal(render?.source, "mcp_agent");
  assert.equal(render?.mcp?.agentId, "agt_doocs_md_mcp");
  assert.equal(render?.mcp?.toolName, "render_markdown");
  assert.equal(render?.outputCollection, "applicationRenderResults");
  assert.equal(render?.metadata?.resultPath?.resultImport?.importer, "application_render_html");
  const listThemes = listTools().find((tool) => tool.name === "doocs_md.list_themes");
  assert.equal(listThemes?.outputCollection, "applicationResultArtifacts");
  assert.equal(listThemes?.metadata?.resultPath?.resultImport?.importer, "application_option_catalog");
  assert.equal(JSON.stringify(render).includes("doocs-md-mcp.cmd"), false);
  assert.equal(JSON.stringify(render).includes("--private"), false);
});

test("MCP shared tool names are stable within the actor-visible application scope", () => {
  const state = {
    applications: [
      { id: "app_team_a", name: "doocs/md", ownerTeamId: "team_a" },
      { id: "app_team_b", name: "doocs/md", ownerTeamId: "team_b" },
    ],
    agents: ["a", "b"].map((suffix) => ({
      id: `agt_doocs_${suffix}_mcp`,
      name: `doocs/md MCP ${suffix}`,
      status: "available",
      health: { status: "unknown" },
      location: { type: "local_device", deviceId: "dev_1" },
      sourceApplicationId: suffix === "a" ? "app_team_a" : "app_team_b",
      toolNamespace: "doocs_md",
      adapter: {
        type: "mcp",
        kind: "mcp",
        transport: "stdio",
        command: "D:/private/doocs-md-mcp.cmd",
        allowedTools: ["render_markdown"],
        timeoutMs: 60_000,
      },
      capabilities: [{ name: "mcp_tool_call", riskLevel: "medium", riskTags: ["local_execution"] }],
    })),
    device: { id: "dev_1", unlinkState: "linked" },
  };
  const { getTool, listTools } = createToolService({
    state,
    now,
    appendEvent: () => {},
    createInvocation: () => {
      throw new Error("descriptor discovery must not create an invocation");
    },
    startInvocationIfAllowed: () => {},
    findApplication: () => null,
    findAgent: (id) => state.agents.find((agent) => agent.id === id) ?? null,
    planApplicationWrapperInvocation: () => ({ ok: false, status: 500, body: { error: "unexpected_plan" } }),
  });

  const teamBTools = listTools({ userId: "usr_b", teamId: "team_b" }).map((tool) => tool.name);
  assert.deepEqual(teamBTools.filter((name) => name.startsWith("doocs_md.")), ["doocs_md.render_markdown"]);
  assert.equal(getTool("doocs_md.render_markdown", { userId: "usr_b", teamId: "team_b" })?.mcp?.agentId, "agt_doocs_b_mcp");
});

test("MCP governed tool invocation preserves tool arguments for bridge execution", () => {
  const events = [];
  let started = null;
  let created = null;
  const state = {
    projects: [{ id: "projA", ownerTeamId: "team_a" }],
    worktrees: [],
    agents: [{
      id: "agt_doocs_md_mcp",
      name: "doocs/md MCP",
      status: "available",
      health: { status: "unknown" },
      location: { type: "local_device", deviceId: "dev_1" },
      adapter: {
        type: "mcp",
        kind: "mcp",
        transport: "stdio",
        command: "D:/private/doocs-md-mcp.cmd",
        args: ["--private"],
        allowedTools: ["render_markdown"],
        timeoutMs: 60_000,
      },
      capabilities: [{ name: "mcp_tool_call", riskLevel: "medium", riskTags: ["local_execution"] }],
    }],
    device: { id: "dev_1", unlinkState: "linked" },
  };
  const { createToolInvocation } = createToolService({
    state,
    now,
    appendEvent: (event) => events.push(event),
    createInvocation: (task, agent, options) => {
      created = { task, agent, options };
      return { id: "inv_mcp", agentId: agent.id, status: "queued", input: { task }, options };
    },
    startInvocationIfAllowed: (invocation, agent) => {
      started = { invocation, agent };
    },
    findApplication: () => null,
    findAgent: (id) => state.agents.find((agent) => agent.id === id) ?? null,
    planApplicationWrapperInvocation: () => ({ ok: false, status: 500, body: { error: "unexpected_plan" } }),
  });

  const result = createToolInvocation(
    "doocs_md.render_markdown",
    { projectId: "projA", markdown: "# Hello", theme: "default" },
    { userId: "usr_a", teamId: "team_a" },
  );

  assert.equal(result.status, 201);
  assert.equal(result.body.tool, "doocs_md.render_markdown");
  assert.equal(result.body.agentId, "agt_doocs_md_mcp");
  assert.equal(created.options.toolName, "render_markdown");
  assert.deepEqual(created.options.toolArguments, { markdown: "# Hello", theme: "default" });
  assert.equal(created.options.metadata.providerType, "mcp");
  assert.equal(created.options.metadata.projectId, "projA");
  assert.equal(created.options.metadata.mcpToolName, "render_markdown");
  assert.equal(started.invocation.id, "inv_mcp");
  assert.equal(events.at(-1).type, "tool_invocation_created");
  assert.equal(JSON.stringify(result.body).includes("doocs-md-mcp.cmd"), false);
});

// --- Codex review import service ---

test("recordCodexReviewFindings imports and normalizes findings, keeping raw server-side", () => {
  const state = importState();
  const { recordCodexReviewFindings } = createCodexReviewImportService({ state, now, nextId: makeCounter("crf"), appendEvent: () => {} });
  const agent = governedReviewAgent({ id: "agt_codex_review_diff", tool: "codex.review.diff", wrapper: "codex-review-wrapper.mjs" });
  const records = recordCodexReviewFindings({
    invocation: { id: "inv_1", projectId: "projA", worktreeId: "wtA", requestedBy: "usr_a", agentId: "agt_codex_review_diff" },
    result: { output: { source: "codex", tool: "codex.review.diff", mode: "diff-review", severityFloor: "medium", summary: "1 issue", findings: [
      { severity: "high", file: "a.ts", line: 3, message: "bug", suggestion: "fix", confidence: "bogus" },
      { severity: "HIGH", file: "b.ts", message: "case-mismatch enum, still kept but normalized" },
      { severity: "high", file: "", message: "no file" },       // dropped: empty file
      { severity: "high", message: "missing file field" },       // dropped: missing file
      "not-an-object",                                            // dropped: not object
    ] } },
    agent,
  });
  assert.equal(records.length, 2);
  assert.equal(state.codexReviewFindings.length, 2);
  const rec = records[0];
  assert.equal(rec.projectId, "projA");
  assert.equal(rec.severity, "high");        // valid enum kept
  assert.equal(rec.confidence, "medium");    // invalid enum -> fallback medium
  assert.equal(rec.file, "a.ts");
  assert.equal(rec.line, 3);
  assert.ok(rec.raw, "raw payload retained on the server-side record");
  assert.equal(records[1].severity, "medium"); // "HIGH" is not an allowed value -> fallback medium (enum is case-sensitive)
});

test("recordCodexReviewFindings derives projectId from options.metadata when top-level is absent", () => {
  const state = importState();
  const { recordCodexReviewFindings } = createCodexReviewImportService({ state, now, nextId: makeCounter("crf"), appendEvent: () => {} });
  const agent = governedReviewAgent({ id: "agt_codex_review_diff", tool: "codex.review.diff", wrapper: "codex-review-wrapper.mjs" });
  const [rec] = recordCodexReviewFindings({
    invocation: { id: "inv_2", options: { metadata: { projectId: "projMeta", worktreeId: "wtMeta" } } },
    result: { output: { source: "codex", tool: "codex.review.diff", findings: [{ severity: "low", file: "x.ts", message: "m" }] } },
    agent,
  });
  assert.equal(rec.projectId, "projMeta");
  assert.equal(rec.worktreeId, "wtMeta");
});

test("recordCodexReviewFindings ignores a non-governed agent", () => {
  const state = importState();
  const { recordCodexReviewFindings } = createCodexReviewImportService({ state, now, nextId: makeCounter("crf"), appendEvent: () => {} });
  const evil = governedReviewAgent({
    id: "agt_codex_review_diff", tool: "codex.review.diff", wrapper: "codex-review-wrapper.mjs",
    args: ["/tmp/evil/codex-review-wrapper.mjs", "--mode", "diff-review"],
  });
  const records = recordCodexReviewFindings({
    invocation: { id: "inv_3", projectId: "projA" },
    result: { output: { source: "codex", tool: "codex.review.diff", findings: [{ severity: "high", file: "a.ts", message: "m" }] } },
    agent: evil,
  });
  assert.deepEqual(records, []);
  assert.equal(state.codexReviewFindings.length, 0);
});

test("recordCodexReviewFindings ignores an errored or foreign result", () => {
  const state = importState();
  const { recordCodexReviewFindings } = createCodexReviewImportService({ state, now, nextId: makeCounter("crf"), appendEvent: () => {} });
  const agent = governedReviewAgent({ id: "agt_codex_review_diff", tool: "codex.review.diff", wrapper: "codex-review-wrapper.mjs" });
  assert.deepEqual(recordCodexReviewFindings({ invocation: { id: "i" }, result: { output: { source: "codex", tool: "codex.review.diff", error: "boom", findings: [{ severity: "high", file: "a", message: "m" }] } }, agent }), []);
  assert.deepEqual(recordCodexReviewFindings({ invocation: { id: "i" }, result: { output: { source: "claude", tool: "claude.review.diff", findings: [{ severity: "high", file: "a", message: "m" }] } }, agent }), []);
});

test("recordCodexReviewFindings caps findings per review and reports the dropped count", () => {
  const state = importState();
  const events = [];
  const { recordCodexReviewFindings } = createCodexReviewImportService({ state, now, nextId: makeCounter("crf"), appendEvent: (e) => events.push(e) });
  const agent = governedReviewAgent({ id: "agt_codex_review_diff", tool: "codex.review.diff", wrapper: "codex-review-wrapper.mjs" });
  const findings = Array.from({ length: 1005 }, (_, i) => ({ severity: "low", file: `f${i}.ts`, message: `m${i}` }));
  const records = recordCodexReviewFindings({
    invocation: { id: "inv_cap", projectId: "projA" },
    result: { output: { source: "codex", tool: "codex.review.diff", findings } },
    agent,
  });
  assert.equal(records.length, 1000);
  assert.equal(state.codexReviewFindings.length, 1000);
  assert.equal(events.at(-1).data.droppedFindingCount, 5);
});

// --- Codex plan import service ---

test("recordCodexChangePlan imports and normalizes plans, keeping raw server-side", () => {
  const state = importState();
  const events = [];
  const { recordCodexChangePlan } = createCodexPlanImportService({ state, now, nextId: makeCounter("cpl"), appendEvent: (e) => events.push(e) });
  const [rec] = recordCodexChangePlan({
    invocation: {
      id: "inv_plan",
      projectId: "projA",
      worktreeId: "wtA",
      requestedBy: "usr_a",
      agentId: "agt_codex_plan_change",
      options: { metadata: { goal: "Add plan tests.", constraints: "No writes." } },
    },
    result: { output: {
      source: "codex",
      tool: "codex.plan.change",
      mode: "change-plan",
      severityFloor: "medium",
      summary: "Plan ready.",
      steps: [
        { title: "Add descriptor tests", rationale: "Prove discovery.", files: ["apps/server/src/services/tools.mjs"], risk: "high" },
        { title: "", rationale: "Dropped because title is empty.", files: ["x.ts"], risk: "low" },
        "bad",
      ],
      openQuestions: ["Should projectId be required?"],
      verification: ["node --test"],
    } },
    agent: governedPlanAgent(),
  });

  assert.equal(state.codexChangePlans.length, 1);
  assert.equal(rec.projectId, "projA");
  assert.equal(rec.worktreeId, "wtA");
  assert.equal(rec.goal, "Add plan tests.");
  assert.equal(rec.constraints, "No writes.");
  assert.equal(rec.steps.length, 1);
  assert.equal(rec.steps[0].risk, "high");
  assert.ok(rec.raw, "raw payload retained on the server-side record");
  assert.equal(events.at(-1).type, "codex_change_plan_recorded");
});

test("recordCodexChangePlan ignores non-governed agents and caps step count", () => {
  const state = importState();
  const events = [];
  const { recordCodexChangePlan } = createCodexPlanImportService({ state, now, nextId: makeCounter("cpl"), appendEvent: (e) => events.push(e) });
  const result = { output: {
    source: "codex",
    tool: "codex.plan.change",
    steps: Array.from({ length: 105 }, (_, i) => ({ title: `Step ${i}`, files: [`f${i}.ts`], risk: "bogus" })),
  } };

  assert.deepEqual(recordCodexChangePlan({
    invocation: { id: "inv_bad" },
    result,
    agent: governedPlanAgent({ args: ["/tmp/evil/codex-plan-wrapper.mjs", "--mode", "change-plan"] }),
  }), []);

  const records = recordCodexChangePlan({
    invocation: { id: "inv_cap", projectId: "projA" },
    result,
    agent: governedPlanAgent(),
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].steps.length, 100);
  assert.equal(records[0].steps[0].risk, "medium");
  assert.equal(events.at(-1).data.droppedStepCount, 5);
});

// --- Codex patch proposal import service ---

test("recordCodexPatchProposal imports immutable proposals, keeping full diff server-side", () => {
  const state = importState();
  const events = [];
  const { recordCodexPatchProposal } = createCodexPatchProposalImportService({ state, now, nextId: makeCounter("cpp"), appendEvent: (e) => events.push(e) });
  const diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
  const [rec] = recordCodexPatchProposal({
    invocation: {
      id: "inv_patch",
      projectId: "projA",
      worktreeId: "wtA",
      requestedBy: "usr_a",
      agentId: "agt_codex_propose_patch",
      options: { metadata: { goal: "Generate patch.", constraints: "No writes.", basePlanId: "cpl_1", maxFiles: 3 } },
    },
    result: { output: {
      source: "codex",
      tool: "codex.propose.patch",
      mode: "patch-proposal",
      summary: "Patch ready.",
      files: [
        { path: "a.ts", changeType: "modify", risk: "high" },
        { path: "", changeType: "add", risk: "low" },
      ],
      diff,
      verification: ["node --test"],
    } },
    agent: governedPatchProposalAgent(),
  });

  assert.equal(state.codexPatchProposals.length, 1);
  assert.equal(rec.projectId, "projA");
  assert.equal(rec.basePlanId, "cpl_1");
  assert.equal(rec.immutable, true);
  assert.equal(rec.reviewState, "generated");
  assert.equal(rec.files.length, 1);
  assert.equal(rec.files[0].risk, "high");
  assert.equal(rec.diffPreview, diff.trim());
  assert.equal(rec.patchSha256.length, 64);
  assert.equal(rec.raw.diff, diff.trim());
  assert.equal(events.at(-1).type, "codex_patch_proposal_recorded");
});

test("recordCodexPatchProposal ignores non-governed agents, errored results, and empty diffs", () => {
  const state = importState();
  const { recordCodexPatchProposal } = createCodexPatchProposalImportService({ state, now, nextId: makeCounter("cpp"), appendEvent: () => {} });
  const goodResult = { output: { source: "codex", tool: "codex.propose.patch", diff: "diff --git a/a b/a\n" } };
  assert.deepEqual(recordCodexPatchProposal({
    invocation: { id: "inv_bad" },
    result: goodResult,
    agent: governedPatchProposalAgent({ args: ["/tmp/evil/codex-patch-proposal-wrapper.mjs", "--mode", "patch-proposal"] }),
  }), []);
  assert.deepEqual(recordCodexPatchProposal({
    invocation: { id: "inv_error" },
    result: { output: { source: "codex", tool: "codex.propose.patch", error: "boom", diff: "diff" } },
    agent: governedPatchProposalAgent(),
  }), []);
  assert.deepEqual(recordCodexPatchProposal({
    invocation: { id: "inv_empty" },
    result: { output: { source: "codex", tool: "codex.propose.patch", diff: "" } },
    agent: governedPatchProposalAgent(),
  }), []);
  assert.equal(state.codexPatchProposals.length, 0);
});

test("recordCodexPatchApply marks the matching approved proposal as applied", () => {
  const state = importState();
  const events = [];
  state.codexPatchProposals.push({
    id: "cpp_apply_import",
    projectId: "projA",
    worktreeId: "wtA",
    patchSha256: "a".repeat(64),
    reviewState: "approved",
  });
  const { recordCodexPatchApply } = createCodexPatchApplyImportService({ state, now, appendEvent: (e) => events.push(e) });
  const records = recordCodexPatchApply({
    invocation: { id: "inv_apply", options: { metadata: { proposalId: "cpp_apply_import", patchSha256: "a".repeat(64) } } },
    result: { output: {
      source: "codex",
      tool: "codex.apply.patch",
      proposalId: "cpp_apply_import",
      patchSha256: "a".repeat(64),
      applied: true,
      files: ["README.md"],
    } },
    agent: governedApplyPatchAgent(),
  });
  assert.equal(records.length, 1);
  assert.equal(state.codexPatchProposals[0].reviewState, "applied");
  assert.equal(state.codexPatchProposals[0].appliedInvocationId, "inv_apply");
  assert.equal(state.codexPatchProposals[0].applyResult.files[0], "README.md");
  assert.equal(events.at(-1).type, "codex_patch_proposal_applied");
});

// --- Claude review import service (parallel behavior) ---

test("recordClaudeReviewFindings imports governed Claude findings", () => {
  const state = importState();
  const { recordClaudeReviewFindings } = createClaudeReviewImportService({ state, now, nextId: makeCounter("clf"), appendEvent: () => {} });
  const agent = governedReviewAgent({ id: "agt_claude_review_diff", tool: "claude.review.diff", wrapper: "claude-review-wrapper.mjs" });
  const records = recordClaudeReviewFindings({
    invocation: { id: "inv_c", projectId: "projB" },
    result: { output: { source: "claude", tool: "claude.review.diff", findings: [{ severity: "medium", file: "b.ts", line: 9, message: "issue" }] } },
    agent,
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "claude");
  assert.equal(records[0].projectId, "projB");
});

test("recordClaudeReviewFindings ignores a Codex result", () => {
  const state = importState();
  const { recordClaudeReviewFindings } = createClaudeReviewImportService({ state, now, nextId: makeCounter("clf"), appendEvent: () => {} });
  const agent = governedReviewAgent({ id: "agt_claude_review_diff", tool: "claude.review.diff", wrapper: "claude-review-wrapper.mjs" });
  assert.deepEqual(recordClaudeReviewFindings({ invocation: { id: "i" }, result: { output: { source: "codex", tool: "codex.review.diff", findings: [{ severity: "high", file: "a", message: "m" }] } }, agent }), []);
});

// --- ccusage import service (regression for the options.metadata projectId fix) ---

test("recordCcusageImportedEstimates derives projectId from options.metadata, not input.metadata", () => {
  const state = importState();
  const { recordCcusageImportedEstimates } = createCcusageImportService({ state, now, nextId: makeCounter("ccu"), appendEvent: () => {} });
  const records = recordCcusageImportedEstimates({
    invocation: {
      id: "inv_ccu",
      // input.metadata must be ignored; only options.metadata is authoritative.
      input: { metadata: { projectId: "projWrong", worktreeId: "wtWrong" } },
      options: { metadata: { projectId: "projRight", worktreeId: "wtRight" } },
    },
    result: { output: { source: "ccusage", reportId: "daily", report: [{ provider: "codex", model: "gpt", totalCostUsd: 1.5, inputTokens: 10, outputTokens: 20 }] } },
    agent: governedCcusageAgent(),
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].projectId, "projRight");
  assert.equal(records[0].worktreeId, "wtRight");
});

test("recordCcusageImportedEstimates ignores an errored or non-ccusage result", () => {
  const state = importState();
  const { recordCcusageImportedEstimates } = createCcusageImportService({ state, now, nextId: makeCounter("ccu"), appendEvent: () => {} });
  assert.deepEqual(recordCcusageImportedEstimates({ invocation: { id: "i", options: {} }, result: { output: { source: "ccusage", error: "boom", report: [{ provider: "x" }] } }, agent: governedCcusageAgent() }), []);
  assert.deepEqual(recordCcusageImportedEstimates({ invocation: { id: "i", options: {} }, result: { output: { source: "other", report: [{ provider: "x" }] } }, agent: governedCcusageAgent() }), []);
});

test("recordCcusageImportedEstimates caps imported estimate rows", () => {
  const state = importState();
  const { recordCcusageImportedEstimates } = createCcusageImportService({ state, now, nextId: makeCounter("ccu"), appendEvent: () => {} });
  const report = Array.from({ length: 1002 }, (_, i) => ({ provider: `p${i}`, totalCostUsd: i }));
  recordCcusageImportedEstimates({
    invocation: { id: "inv_big", options: { metadata: { projectId: "projA" } } },
    result: { output: { source: "ccusage", reportId: "daily", report } },
    agent: governedCcusageAgent(),
  });
  assert.equal(state.importedUsageEstimates.length, 1000);
});
