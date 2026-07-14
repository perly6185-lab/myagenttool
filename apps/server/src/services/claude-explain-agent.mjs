// Claude governance Phase 2 (CLAUDE_TOOL_GOVERNANCE_PLAN.md #912): a governed,
// read-only ANALYSIS capability that sits beside the Phase 1 review tool. Where
// `claude.review.diff` judges a diff, `claude.explain.diff` describes it — what
// each change does and why it matters — so a reviewer can orient before judging.
//
// It reuses the Phase 1 machinery: the same fixed wrapper (a new `--mode
// diff-explain`), the same `--permission-mode plan` (read-only), the same
// tenancy/worktree guard, and the same tool_facade discovery. It is NOT
// write-capable and shares no state with the review findings collection — the
// explanation rides the invocation result and the generic Application-result
// lineage.

import { isGovernedWrapperAgent } from "./governed-agent.mjs";

export const CLAUDE_EXPLAIN_TOOL_CONTRACT = {
  name: "claude.explain.diff",
  version: "1",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["worktreeId"],
    properties: {
      projectId: { type: "string" },
      worktreeId: { type: "string" },
      instruction: { type: "string", maxLength: 1200 },
    },
  },
  outputSchema: {
    structuredResult: true,
    // No bespoke import collection: the explanation is analysis, not queryable
    // evidence like a finding. It lives on the invocation result and the generic
    // Application-result lineage, so nothing here writes to a durable array.
    imports: null,
    explanation: {
      summary: { type: "string" },
      highlights: {
        file: { type: "string" },
        change: { type: "string" },
        impact: { type: "string" },
      },
    },
  },
  errorCodes: [
    "invalid_input",
    "unknown_field",
    "project_required",
    "worktree_required",
    "worktree_not_found",
    "instruction_too_long",
    "agent_not_available",
  ],
};

export function createClaudeExplainAgentRegistration({
  wrapperScriptPath = "tools/agents/claude-review-wrapper.mjs",
  costOwner = "usr_local",
  currency = "USD",
} = {}) {
  const wrapperPath = String(wrapperScriptPath ?? "").trim();
  if (!wrapperPath) {
    throw new Error("claude explain wrapperScriptPath is required.");
  }
  return {
    id: "agt_claude_explain_diff",
    type: "cli",
    name: "Claude Diff Explain",
    description: "Runs a governed read-only Claude explanation over a project worktree diff.",
    command: "node",
    args: [wrapperPath, "--mode", "diff-explain"],
    timeoutSeconds: 180,
    outputFormat: "plain_result",
    toolContract: CLAUDE_EXPLAIN_TOOL_CONTRACT,
    capabilityName: "code_analysis",
    capabilityDescription: "Explain a worktree diff with Claude and return a structured summary.",
    riskLevel: "low",
    riskTags: ["read_only", "read_project", "code_analysis", "local_agent"],
    economicModel: "external_billed",
    pricingDimensions: [],
    currency,
    costOwner,
    unknownCostPolicy: "warn",
    registrationNotes: {
      risk: "Runs a fixed Claude diff-explain wrapper in plan mode. External callers cannot choose cwd, shell args, permission mode, or edit/apply behavior.",
      data: "Reads the selected project worktree diff and returns a structured, read-only explanation.",
      cost: "Claude usage is externally billed by the configured Anthropic/Claude account and may be reported by Claude stream-json result events.",
      cancellation: "The Desktop Bridge attempts to terminate the Claude process tree when cancellation is requested.",
    },
  };
}

export function isGovernedClaudeExplainAgent(agent) {
  return isGovernedWrapperAgent(agent, {
    id: "agt_claude_explain_diff",
    toolName: CLAUDE_EXPLAIN_TOOL_CONTRACT.name,
    capabilityName: "code_analysis",
    wrapper: "claude-review-wrapper.mjs",
    mode: "diff-explain",
  });
}
