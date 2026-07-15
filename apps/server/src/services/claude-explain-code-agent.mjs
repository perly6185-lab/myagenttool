// #1049 (#912): `claude.explain.code` — a governed, read-only analysis capability
// that explains CODE IN PLACE (a file, a symbol, a line range), where
// `claude.explain.diff` explains a change. Same trust shape as the other Phase 2
// capabilities: the fixed review wrapper in a new `--mode code-explain`,
// `--permission-mode plan` (read-only), actor-owned project/worktree scope, and a
// closed input schema — callers pick a target, never a prompt, argv, cwd, model,
// env, permission mode, or tool configuration.
//
// The target reference is data, not code: the path is confined to the bound
// worktree (validated server-side AND re-checked by the wrapper before Claude
// spawns), and symbol/range are bounded strings/ints that ride discrete argv.

import { isGovernedWrapperAgent } from "./governed-agent.mjs";

export const CLAUDE_EXPLAIN_CODE_TOOL_CONTRACT = {
  name: "claude.explain.code",
  version: "1",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["worktreeId", "path"],
    properties: {
      projectId: { type: "string" },
      worktreeId: { type: "string" },
      // Worktree-relative file path. No absolute paths, no traversal.
      path: { type: "string", maxLength: 512 },
      // Optional narrowing: a named symbol and/or a 1-indexed line range.
      symbol: { type: "string", maxLength: 200 },
      startLine: { type: "integer", minimum: 1 },
      endLine: { type: "integer", minimum: 1 },
      instruction: { type: "string", maxLength: 1200 },
    },
  },
  outputSchema: {
    structuredResult: true,
    // Analysis, not queryable evidence: the explanation rides the invocation
    // result and the generic Application-result lineage (same as explain.diff).
    imports: null,
    explanation: {
      summary: { type: "string" },
      highlights: {
        file: { type: "string" },
        aspect: { type: "string" },
        detail: { type: "string" },
      },
    },
  },
  errorCodes: [
    "invalid_input",
    "unknown_field",
    "project_required",
    "worktree_required",
    "worktree_not_found",
    "path_required",
    "path_too_long",
    "path_invalid",
    "symbol_too_long",
    "line_range_invalid",
    "instruction_too_long",
    "agent_not_available",
  ],
};

export function createClaudeExplainCodeAgentRegistration({
  wrapperScriptPath = "tools/agents/claude-review-wrapper.mjs",
  costOwner = "usr_local",
  currency = "USD",
} = {}) {
  const wrapperPath = String(wrapperScriptPath ?? "").trim();
  if (!wrapperPath) {
    throw new Error("claude explain-code wrapperScriptPath is required.");
  }
  return {
    id: "agt_claude_explain_code",
    type: "cli",
    name: "Claude Code Explain",
    description: "Runs a governed read-only Claude explanation of a file, symbol, or line range in a project worktree.",
    command: "node",
    args: [wrapperPath, "--mode", "code-explain"],
    timeoutSeconds: 180,
    outputFormat: "plain_result",
    toolContract: CLAUDE_EXPLAIN_CODE_TOOL_CONTRACT,
    capabilityName: "code_analysis",
    capabilityDescription: "Explain code in an actor-owned worktree with Claude and return a structured summary.",
    riskLevel: "low",
    riskTags: ["read_only", "read_project", "code_analysis", "local_agent"],
    economicModel: "external_billed",
    pricingDimensions: [],
    currency,
    costOwner,
    unknownCostPolicy: "warn",
    registrationNotes: {
      risk: "Runs a fixed Claude code-explain wrapper in plan mode. The target path is confined to the bound worktree; external callers cannot choose cwd, shell args, permission mode, or edit/apply behavior.",
      data: "Reads the selected file inside the project worktree and returns a structured, read-only explanation.",
      cost: "Claude usage is externally billed by the configured Anthropic/Claude account and may be reported by Claude stream-json result events.",
      cancellation: "The Desktop Bridge attempts to terminate the Claude process tree when cancellation is requested.",
    },
  };
}

export function isGovernedClaudeExplainCodeAgent(agent) {
  return isGovernedWrapperAgent(agent, {
    id: "agt_claude_explain_code",
    toolName: CLAUDE_EXPLAIN_CODE_TOOL_CONTRACT.name,
    capabilityName: "code_analysis",
    wrapper: "claude-review-wrapper.mjs",
    mode: "code-explain",
  });
}

// Worktree-relative and traversal-free: no absolute paths (POSIX or Windows), no
// `..` segments, no NUL/backslash tricks. The wrapper re-checks confinement
// against the real filesystem; this is the server-side shape gate.
export function isSafeWorktreeRelativePath(path) {
  const value = String(path ?? "");
  if (!value || value.length > 512) return false;
  if (value.includes("\0") || value.includes("\\")) return false;
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  return true;
}
