// Claude governance Phase 3 (CLAUDE_TOOL_GOVERNANCE_PLAN.md #913): a governed
// capability that asks Claude to PROPOSE a change as an immutable patch artifact,
// without granting write access to the worktree. Claude runs in
// `--permission-mode plan` (read-only) and returns a unified diff as TEXT; nothing
// is applied. The proposal rides the durable invocation result + Application-result
// lineage — an inspectable artifact that a later, approval-bound apply (Phase 4)
// consumes by invocation id. This is write-ADJACENT but never write-CAPABLE.

import { isGovernedWrapperAgent } from "./governed-agent.mjs";

export const CLAUDE_PROPOSE_TOOL_CONTRACT = {
  name: "claude.propose.patch",
  version: "1",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["worktreeId", "task"],
    properties: {
      projectId: { type: "string" },
      worktreeId: { type: "string" },
      // What change to propose. Required — a proposal needs a goal.
      task: { type: "string", maxLength: 4000 },
      instruction: { type: "string", maxLength: 1200 },
    },
  },
  outputSchema: {
    structuredResult: true,
    // The artifact is the proposed patch itself. It is not applied and is not a
    // queryable findings collection; it lives on the invocation result.
    imports: null,
    proposal: {
      summary: { type: "string" },
      // A unified diff (git apply format), stored verbatim as the proposal.
      patch: { type: "string" },
      files: {
        path: { type: "string" },
        action: { enum: ["created", "modified", "deleted"] },
      },
    },
  },
  errorCodes: [
    "invalid_input",
    "unknown_field",
    "project_required",
    "worktree_required",
    "worktree_not_found",
    "task_required",
    "task_too_long",
    "instruction_too_long",
    "agent_not_available",
  ],
};

export function createClaudeProposeAgentRegistration({
  wrapperScriptPath = "tools/agents/claude-review-wrapper.mjs",
  costOwner = "usr_local",
  currency = "USD",
} = {}) {
  const wrapperPath = String(wrapperScriptPath ?? "").trim();
  if (!wrapperPath) {
    throw new Error("claude propose wrapperScriptPath is required.");
  }
  return {
    id: "agt_claude_propose_patch",
    type: "cli",
    name: "Claude Patch Proposal",
    description: "Runs a governed read-only Claude session that proposes a change as a patch artifact (never applied).",
    command: "node",
    args: [wrapperPath, "--mode", "propose-patch"],
    timeoutSeconds: 240,
    outputFormat: "plain_result",
    toolContract: CLAUDE_PROPOSE_TOOL_CONTRACT,
    capabilityName: "code_proposal",
    capabilityDescription: "Propose a worktree change with Claude and return an immutable patch artifact.",
    riskLevel: "low",
    riskTags: ["read_only", "read_project", "code_proposal", "local_agent"],
    economicModel: "external_billed",
    pricingDimensions: [],
    currency,
    costOwner,
    unknownCostPolicy: "warn",
    registrationNotes: {
      risk: "Runs a fixed Claude propose wrapper in plan mode. It returns a proposed patch as text and NEVER edits the worktree. External callers cannot choose cwd, shell args, permission mode, or an apply path.",
      data: "Reads the selected project worktree and returns a proposed unified diff plus a summary. No files are written.",
      cost: "Claude usage is externally billed by the configured Anthropic/Claude account and may be reported by Claude stream-json result events.",
      cancellation: "The Desktop Bridge attempts to terminate the Claude process tree when cancellation is requested.",
    },
  };
}

export function isGovernedClaudeProposeAgent(agent) {
  return isGovernedWrapperAgent(agent, {
    id: "agt_claude_propose_patch",
    toolName: CLAUDE_PROPOSE_TOOL_CONTRACT.name,
    capabilityName: "code_proposal",
    wrapper: "claude-review-wrapper.mjs",
    mode: "propose-patch",
  });
}
