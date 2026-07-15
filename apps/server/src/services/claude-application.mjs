import { CLAUDE_REVIEW_TOOL_CONTRACT } from "./claude-agent.mjs";
import { CLAUDE_EXPLAIN_TOOL_CONTRACT } from "./claude-explain-agent.mjs";
import { CLAUDE_EXPLAIN_CODE_TOOL_CONTRACT } from "./claude-explain-code-agent.mjs";
import { CLAUDE_PROPOSE_TOOL_CONTRACT } from "./claude-propose-agent.mjs";

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
      {
        // #1049 (#912): read-only code-in-place analysis beside the diff explain.
        // Same posture: collects on the invocation; the target path is confined
        // to the bound worktree (server shape gate + wrapper filesystem check).
        id: "explain.code",
        toolName: CLAUDE_EXPLAIN_CODE_TOOL_CONTRACT.name,
        displayName: "Claude Code Explain",
        description: "Explain a file, symbol, or line range in an actor-owned worktree with the governed Claude analysis tool.",
        riskLevel: "low",
        riskTags: ["read_only", "read_project", "code_analysis", "local_agent"],
        requiresApproval: false,
        inputSchema: CLAUDE_EXPLAIN_CODE_TOOL_CONTRACT.inputSchema,
        outputCollection: "invocations",
      },
      {
        // Phase 3 (#913): propose a change as an immutable patch artifact. The
        // proposal is read-only (Claude never writes the worktree), so it needs no
        // approval to GENERATE; the approval gate lives on the Phase 4 apply. The
        // patch rides the durable invocation result, not a bespoke collection.
        id: "propose.patch",
        toolName: CLAUDE_PROPOSE_TOOL_CONTRACT.name,
        displayName: "Claude Patch Proposal",
        description: "Propose a change to an actor-owned worktree as an immutable patch artifact (never applied).",
        riskLevel: "low",
        riskTags: ["read_only", "read_project", "code_proposal", "local_agent"],
        requiresApproval: false,
        inputSchema: CLAUDE_PROPOSE_TOOL_CONTRACT.inputSchema,
        outputCollection: "invocations",
      },
    ],
  };
}
