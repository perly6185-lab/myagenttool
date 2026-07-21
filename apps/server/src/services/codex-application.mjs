import { CODEX_EXEC_TOOL_CONTRACT, CODEX_REVIEW_TOOL_CONTRACT } from "./codex-agent.mjs";

export const CODEX_APPLICATION_ID = "app_codex";

export function createCodexApplicationRegistration({ autoOnline = false } = {}) {
  return {
    id: CODEX_APPLICATION_ID,
    executionScope: "local",
    runtimeRequirements: [{ runtimeId: "runtime_codex", required: true }],
    name: "Codex",
    kind: "binary",
    autoOnline,
    source: {
      type: "binary",
      binary: "codex",
      wrapper: { mode: "metadata-only", commands: [] },
    },
    capabilityFacades: [
      {
        id: "review.diff",
        toolName: CODEX_REVIEW_TOOL_CONTRACT.name,
        displayName: "Codex Diff Review",
        description: "Review an actor-owned worktree diff with the governed Codex review tool.",
        riskLevel: "low",
        riskTags: ["read_only", "read_project", "code_review", "local_agent"],
        requiresApproval: false,
        inputSchema: CODEX_REVIEW_TOOL_CONTRACT.inputSchema,
        outputCollection: "codexReviewFindings",
      },
      {
        id: "exec",
        toolName: CODEX_EXEC_TOOL_CONTRACT.name,
        displayName: "Codex Exec",
        description: "Make governed changes in an actor-owned worktree with Codex; availability remains controlled by the Codex exec feature flag.",
        riskLevel: "high",
        riskTags: ["write_worktree", "code_change", "local_agent"],
        requiresApproval: true,
        inputSchema: CODEX_EXEC_TOOL_CONTRACT.inputSchema,
        outputCollection: "codexExecChanges",
      },
    ],
  };
}
