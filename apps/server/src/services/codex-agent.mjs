import { isGovernedWrapperAgent } from "./governed-agent.mjs";

export const CODEX_REVIEW_TOOL_CONTRACT = {
  name: "codex.review.diff",
  version: "1",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["worktreeId"],
    properties: {
      projectId: { type: "string" },
      worktreeId: { type: "string" },
      instruction: { type: "string", maxLength: 1200 },
      severityFloor: { enum: ["low", "medium", "high"] },
    },
  },
  outputSchema: {
    structuredResult: true,
    imports: {
      collection: "codexReviewFindings",
      authoritative: false,
    },
    finding: {
      severity: { enum: ["low", "medium", "high"] },
      file: { type: "string" },
      line: { type: "number" },
      message: { type: "string" },
      suggestion: { type: "string" },
      confidence: { enum: ["low", "medium", "high"] },
    },
  },
  errorCodes: [
    "invalid_input",
    "unknown_field",
    "project_required",
    "worktree_required",
    "worktree_not_found",
    "invalid_severity_floor",
    "instruction_too_long",
    "agent_not_available",
  ],
};

export function createCodexReviewAgentRegistration({
  wrapperScriptPath = "tools/agents/codex-review-wrapper.mjs",
  costOwner = "usr_local",
  currency = "USD",
} = {}) {
  const wrapperPath = String(wrapperScriptPath ?? "").trim();
  if (!wrapperPath) {
    throw new Error("codex review wrapperScriptPath is required.");
  }
  return {
    id: "agt_codex_review_diff",
    type: "cli",
    name: "Codex Diff Review",
    description: "Runs a governed read-only Codex review over a project worktree diff.",
    command: "node",
    args: [wrapperPath, "--mode", "diff-review"],
    timeoutSeconds: 120,
    outputFormat: "plain_result",
    toolContract: CODEX_REVIEW_TOOL_CONTRACT,
    capabilityName: "code_review",
    capabilityDescription: "Review a worktree diff and return structured findings.",
    riskLevel: "low",
    riskTags: ["read_only", "read_project", "code_review", "local_agent"],
    economicModel: "external_billed",
    pricingDimensions: [],
    currency,
    costOwner,
    unknownCostPolicy: "warn",
    registrationNotes: {
      risk: "Runs a fixed Codex diff-review wrapper. External callers cannot choose cwd, shell args, sandbox, or permission flags.",
      data: "Reads the selected project worktree diff and stores structured review findings.",
      cost: "Codex usage is externally billed by the configured Codex/OpenAI account and should be reported separately from platform charges.",
      cancellation: "The Desktop Bridge attempts to terminate the Codex review process tree when cancellation is requested.",
    },
  };
}

export function isGovernedCodexReviewAgent(agent) {
  return isGovernedWrapperAgent(agent, {
    id: "agt_codex_review_diff",
    toolName: CODEX_REVIEW_TOOL_CONTRACT.name,
    capabilityName: "code_review",
    wrapper: "codex-review-wrapper.mjs",
    mode: "diff-review",
  });
}

// --- codex.exec (write-capable) — see docs/engineering/CODEX_EXEC_CONTRACT_DESIGN.md ---

export const CODEX_EXEC_TOOL_CONTRACT = {
  name: "codex.exec",
  version: "1",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["worktreeId", "task"],
    properties: {
      projectId: { type: "string" },
      // Writes only ever happen in a worktree, never the base checkout — so the
      // worktree id is required, not optional as it is for review.
      worktreeId: { type: "string" },
      task: { type: "string", maxLength: 4000 },
      approvalMode: { enum: ["ask", "auto", "full"] },
    },
  },
  outputSchema: {
    structuredResult: true,
    imports: {
      collection: "codexExecChanges",
      authoritative: false,
    },
    change: {
      file: { type: "string" },
      action: { enum: ["created", "modified", "deleted"] },
      diffPreview: { type: "string" },
      changeRisk: { enum: ["low", "medium", "high", "unknown"] },
      summary: { type: "string" },
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
    "invalid_approval_mode",
    "codex_exec_disabled",
    "agent_not_available",
  ],
};

// Phase 1 ships default-OFF behind a feature flag (design §11.2). An operator
// opts in with MYAGENTTOOL_CODEX_EXEC_ENABLED=1. When off, the tool is absent
// from the capability catalog and every invocation is refused — no write-capable
// Codex path exists unless explicitly enabled.
export function isCodexExecEnabled(env = process.env) {
  const flag = env?.MYAGENTTOOL_CODEX_EXEC_ENABLED;
  return flag === "1" || flag === "true";
}

export function createCodexExecAgentRegistration({
  wrapperScriptPath = "tools/agents/codex-exec-wrapper.mjs",
  costOwner = "usr_local",
  currency = "USD",
} = {}) {
  const wrapperPath = String(wrapperScriptPath ?? "").trim();
  if (!wrapperPath) {
    throw new Error("codex exec wrapperScriptPath is required.");
  }
  return {
    id: "agt_codex_exec",
    type: "cli",
    name: "Codex Exec",
    description: "Runs a governed Codex edit session in a project worktree and returns the resulting changeset.",
    command: "node",
    args: [wrapperPath, "--mode", "edit"],
    timeoutSeconds: 600,
    outputFormat: "plain_result",
    toolContract: CODEX_EXEC_TOOL_CONTRACT,
    capabilityName: "code_edit",
    capabilityDescription: "Make code changes in a worktree and return a reviewable diff.",
    // Writing code is high risk — contrast the read-only review agent's `low`.
    // Every run passes through the approval broker; the change lands in a worktree
    // and is never auto-promoted.
    riskLevel: "high",
    riskTags: ["write_worktree", "code_change", "local_agent"],
    economicModel: "external_billed",
    pricingDimensions: [],
    currency,
    costOwner,
    unknownCostPolicy: "warn",
    registrationNotes: {
      risk: "Runs a fixed Codex edit wrapper in a worktree. External callers cannot choose cwd, shell args, sandbox, or permission flags.",
      data: "Edits the selected project worktree and records the git-derived changeset as evidence. The base checkout and main are never touched.",
      cost: "Codex usage is externally billed by the configured Codex/OpenAI account and should be reported separately from platform charges.",
      cancellation: "The Desktop Bridge attempts to terminate the Codex process tree when cancellation is requested.",
    },
  };
}

export function isGovernedCodexExecAgent(agent) {
  return isGovernedWrapperAgent(agent, {
    id: "agt_codex_exec",
    toolName: CODEX_EXEC_TOOL_CONTRACT.name,
    capabilityName: "code_edit",
    wrapper: "codex-exec-wrapper.mjs",
    mode: "edit",
  });
}
