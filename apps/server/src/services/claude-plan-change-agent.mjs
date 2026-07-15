// #1051 (#912): `claude.plan.change` — the bridge between analysis (P2) and
// proposal (P3). A governed, read-only capability that turns a bounded goal into
// a reviewable, structured change plan WITHOUT mutation; the plan's invocation id
// is the provenance a later `claude.propose.patch` run can reference.
//
// Two provenance-preserving choices:
//   - the optional analysis context is a LINK (`analysisInvocationId` to a prior
//     succeeded claude.analyze.issue run in the same project), never free text —
//     and because that analysis derives from attacker-adjacent issue text, its
//     content re-enters the prompt FENCED as untrusted data (the ADR-0011 taint
//     propagates through derivation, it does not wash off).
//   - every plan field is server-capped at completion (claude-plan-imports.mjs),
//     so the public read model can never carry an unbounded plan whatever the
//     wrapper returned — same posture as the proposal patch preview bound.

import { isGovernedWrapperAgent } from "./governed-agent.mjs";

export const CLAUDE_PLAN_CHANGE_TOOL_CONTRACT = {
  name: "claude.plan.change",
  version: "1",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["worktreeId", "goal"],
    properties: {
      projectId: { type: "string" },
      worktreeId: { type: "string" },
      // What to plan. Required and bounded — a plan needs a goal.
      goal: { type: "string", maxLength: 4000 },
      // Optional link to a prior succeeded claude.analyze.issue invocation in
      // the same project; its analysis re-enters the prompt fenced as untrusted
      // context. Never free text.
      analysisInvocationId: { type: "string" },
      instruction: { type: "string", maxLength: 1200 },
    },
  },
  outputSchema: {
    structuredResult: true,
    imports: null,
    plan: {
      summary: { type: "string" },
      steps: { title: { type: "string" }, detail: { type: "string" } },
      affectedFiles: { type: "string[]" },
      risks: { type: "string[]" },
      testStrategy: { type: "string" },
      outOfScope: { type: "string[]" },
    },
  },
  errorCodes: [
    "invalid_input",
    "unknown_field",
    "project_required",
    "worktree_required",
    "worktree_not_found",
    "goal_required",
    "goal_too_long",
    "analysis_not_applicable",
    "instruction_too_long",
    "agent_not_available",
  ],
};

export function createClaudePlanChangeAgentRegistration({
  wrapperScriptPath = "tools/agents/claude-review-wrapper.mjs",
  costOwner = "usr_local",
  currency = "USD",
} = {}) {
  const wrapperPath = String(wrapperScriptPath ?? "").trim();
  if (!wrapperPath) {
    throw new Error("claude plan-change wrapperScriptPath is required.");
  }
  return {
    id: "agt_claude_plan_change",
    type: "cli",
    name: "Claude Change Planning",
    description: "Runs a governed read-only Claude session that turns a bounded goal into a structured change plan (never implemented).",
    command: "node",
    args: [wrapperPath, "--mode", "change-plan"],
    timeoutSeconds: 240,
    outputFormat: "plain_result",
    toolContract: CLAUDE_PLAN_CHANGE_TOOL_CONTRACT,
    capabilityName: "change_planning",
    capabilityDescription: "Plan a worktree change with Claude and return a structured, capped plan a later propose.patch can reference.",
    riskLevel: "low",
    riskTags: ["read_only", "read_project", "change_planning", "local_agent"],
    economicModel: "external_billed",
    pricingDimensions: [],
    currency,
    costOwner,
    unknownCostPolicy: "warn",
    registrationNotes: {
      risk: "Runs a fixed Claude change-planning wrapper in plan mode. It returns a structured plan as text and NEVER edits the worktree. External callers cannot choose cwd, shell args, permission mode, or an implementation path.",
      data: "Reads the selected project worktree (plus, optionally, a fenced prior analysis) and returns a structured, server-capped change plan. No files are written.",
      cost: "Claude usage is externally billed by the configured Anthropic/Claude account and may be reported by Claude stream-json result events.",
      cancellation: "The Desktop Bridge attempts to terminate the Claude process tree when cancellation is requested.",
    },
  };
}

export function isGovernedClaudePlanChangeAgent(agent) {
  return isGovernedWrapperAgent(agent, {
    id: "agt_claude_plan_change",
    toolName: CLAUDE_PLAN_CHANGE_TOOL_CONTRACT.name,
    capabilityName: "change_planning",
    wrapper: "claude-review-wrapper.mjs",
    mode: "change-plan",
  });
}
