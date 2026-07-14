import { CLAUDE_REVIEW_TOOL_CONTRACT } from "./claude-agent.mjs";
import { CLAUDE_EXPLAIN_TOOL_CONTRACT } from "./claude-explain-agent.mjs";

export const CLAUDE_APPLICATION_ID = "app_claude";

export function createClaudeApplicationRegistration({ autoOnline = false } = {}) {
  return {
    id: CLAUDE_APPLICATION_ID,
    name: "Claude",
    kind: "binary",
    autoOnline,
    source: {
      type: "binary",
      binary: "claude",
      wrapper: { mode: "metadata-only", commands: [] },
    },
    capabilityFacades: [
      {
        id: "review.diff",
        toolName: CLAUDE_REVIEW_TOOL_CONTRACT.name,
        displayName: "Claude Diff Review",
        description: "Review an actor-owned worktree diff with the governed Claude review tool.",
        riskLevel: "low",
        riskTags: ["read_only", "read_project", "code_review", "local_agent"],
        requiresApproval: false,
        inputSchema: CLAUDE_REVIEW_TOOL_CONTRACT.inputSchema,
        outputCollection: "claudeReviewFindings",
      },
      {
        // Phase 2 (#912): read-only analysis beside the review facade. The
        // explanation is not queryable evidence, so it collects on the invocation
        // itself, not a bespoke findings array.
        id: "explain.diff",
        toolName: CLAUDE_EXPLAIN_TOOL_CONTRACT.name,
        displayName: "Claude Diff Explain",
        description: "Explain an actor-owned worktree diff with the governed Claude analysis tool.",
        riskLevel: "low",
        riskTags: ["read_only", "read_project", "code_analysis", "local_agent"],
        requiresApproval: false,
        inputSchema: CLAUDE_EXPLAIN_TOOL_CONTRACT.inputSchema,
        outputCollection: "invocations",
      },
    ],
  };
}
