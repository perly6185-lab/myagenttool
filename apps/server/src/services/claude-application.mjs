import { CLAUDE_REVIEW_TOOL_CONTRACT } from "./claude-agent.mjs";

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
    ],
  };
}
