// #1050 (#912): `claude.analyze.issue` — governed, read-only issue analysis.
// Unlike the other Phase 2 capabilities, its primary input is ATTACKER-ADJACENT
// external text: an issue body is written by whoever filed the issue (and, via
// the mail intake path, by anyone who can email the intake address). Same threat
// model as ADR 0011, and it composes the same controls:
//
//   - the caller supplies only an issue NUMBER — never issue text. The server
//     resolves title/body through the governed gh path (repo-scoped by the
//     actor-owned project), bounds the size, fences it with `untrustedBodyBlock`
//     (data, never instruction), and records `detectPromptInjection` markers as
//     evidence (flag, never block — the B1a posture).
//   - the capability carries the shared UNTRUSTED_INPUT_TAG so the taint is
//     visible in discovery, not just in code.
//   - the wrapper runs the fixed prompt in `--permission-mode plan` (read-only)
//     and embeds the pre-fenced block verbatim.

import { isGovernedWrapperAgent } from "./governed-agent.mjs";
import { UNTRUSTED_INPUT_TAG } from "@myagenttool/protocol/issue-prompt";

export const CLAUDE_ANALYZE_ISSUE_TOOL_CONTRACT = {
  name: "claude.analyze.issue",
  version: "1",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["worktreeId", "issueNumber"],
    properties: {
      projectId: { type: "string" },
      worktreeId: { type: "string" },
      // The repo-scoped issue number. The server resolves the content — callers
      // can never inline issue text into the analysis.
      issueNumber: { type: "integer", minimum: 1 },
      instruction: { type: "string", maxLength: 1200 },
    },
  },
  outputSchema: {
    structuredResult: true,
    imports: null,
    analysis: {
      summary: { type: "string" },
      problem: { type: "string" },
      affectedAreas: { area: { type: "string" }, reason: { type: "string" } },
      suggestedAcceptance: { type: "string[]" },
      risks: { type: "string[]" },
    },
  },
  errorCodes: [
    "invalid_input",
    "unknown_field",
    "project_required",
    "worktree_required",
    "worktree_not_found",
    "issue_number_required",
    "issue_number_invalid",
    "instruction_too_long",
    "agent_not_available",
    "issue_fetch_failed",
  ],
};

export function createClaudeAnalyzeIssueAgentRegistration({
  wrapperScriptPath = "tools/agents/claude-review-wrapper.mjs",
  costOwner = "usr_local",
  currency = "USD",
} = {}) {
  const wrapperPath = String(wrapperScriptPath ?? "").trim();
  if (!wrapperPath) {
    throw new Error("claude analyze-issue wrapperScriptPath is required.");
  }
  return {
    id: "agt_claude_analyze_issue",
    type: "cli",
    name: "Claude Issue Analysis",
    description: "Runs a governed read-only Claude analysis of a repo issue against the worktree, treating the issue body as untrusted data.",
    command: "node",
    args: [wrapperPath, "--mode", "issue-analyze"],
    timeoutSeconds: 240,
    outputFormat: "plain_result",
    toolContract: CLAUDE_ANALYZE_ISSUE_TOOL_CONTRACT,
    capabilityName: "code_analysis",
    capabilityDescription: "Analyze a repo issue with Claude — problem, affected areas, suggested acceptance — with the issue body fenced as untrusted data.",
    riskLevel: "low",
    riskTags: ["read_only", "read_project", "code_analysis", "local_agent", UNTRUSTED_INPUT_TAG],
    economicModel: "external_billed",
    pricingDimensions: [],
    currency,
    costOwner,
    unknownCostPolicy: "warn",
    registrationNotes: {
      risk: "Runs a fixed Claude issue-analysis wrapper in plan mode. The issue body is server-resolved, size-bounded, and fenced as untrusted DATA (ADR 0011); injection markers are recorded as evidence, never silently scrubbed. External callers cannot supply issue text, cwd, shell args, or permission mode.",
      data: "Reads the referenced issue via the governed gh path plus the selected worktree, and returns a structured, read-only analysis.",
      cost: "Claude usage is externally billed by the configured Anthropic/Claude account and may be reported by Claude stream-json result events.",
      cancellation: "The Desktop Bridge attempts to terminate the Claude process tree when cancellation is requested.",
    },
  };
}

export function isGovernedClaudeAnalyzeIssueAgent(agent) {
  return isGovernedWrapperAgent(agent, {
    id: "agt_claude_analyze_issue",
    toolName: CLAUDE_ANALYZE_ISSUE_TOOL_CONTRACT.name,
    capabilityName: "code_analysis",
    wrapper: "claude-review-wrapper.mjs",
    mode: "issue-analyze",
  });
}
