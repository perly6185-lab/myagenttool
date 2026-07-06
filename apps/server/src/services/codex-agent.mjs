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

export const CODEX_PLAN_TOOL_CONTRACT = {
  name: "codex.plan.change",
  version: "1",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["projectId", "worktreeId", "goal"],
    properties: {
      projectId: { type: "string" },
      worktreeId: { type: "string" },
      goal: { type: "string", maxLength: 2000 },
      constraints: { type: "string", maxLength: 2000 },
      severityFloor: { enum: ["low", "medium", "high"] },
    },
  },
  outputSchema: {
    structuredResult: true,
    imports: {
      collection: "codexChangePlans",
      authoritative: false,
    },
    plan: {
      summary: { type: "string" },
      steps: { type: "array" },
      openQuestions: { type: "array" },
      verification: { type: "array" },
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
    "constraints_too_long",
    "invalid_severity_floor",
    "agent_not_available",
  ],
};

export const CODEX_PATCH_PROPOSAL_TOOL_CONTRACT = {
  name: "codex.propose.patch",
  version: "1",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["projectId", "worktreeId", "goal"],
    properties: {
      projectId: { type: "string" },
      worktreeId: { type: "string" },
      goal: { type: "string", maxLength: 2000 },
      constraints: { type: "string", maxLength: 2000 },
      basePlanId: { type: "string" },
      maxFiles: { type: "number", minimum: 1, maximum: 25 },
    },
  },
  outputSchema: {
    structuredResult: true,
    imports: {
      collection: "codexPatchProposals",
      authoritative: false,
      immutable: true,
    },
    proposal: {
      summary: { type: "string" },
      files: { type: "array" },
      diffPreview: { type: "string" },
      patchSha256: { type: "string" },
      verification: { type: "array" },
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
    "constraints_too_long",
    "base_plan_not_found",
    "base_plan_scope_mismatch",
    "invalid_max_files",
    "approval_required",
    "agent_not_available",
  ],
};

export const CODEX_APPLY_PATCH_TOOL_CONTRACT = {
  name: "codex.apply.patch",
  version: "1",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["projectId", "worktreeId", "proposalId", "patchSha256"],
    properties: {
      projectId: { type: "string" },
      worktreeId: { type: "string" },
      proposalId: { type: "string" },
      patchSha256: { type: "string", minLength: 64, maxLength: 64 },
      approvalRequestId: { type: "string" },
    },
  },
  outputSchema: {
    structuredResult: true,
    imports: {
      collection: "codexPatchProposals",
      authoritative: true,
      mutates: "reviewState",
    },
    apply: {
      proposalId: { type: "string" },
      patchSha256: { type: "string" },
      applied: { type: "boolean" },
      files: { type: "array" },
    },
  },
  errorCodes: [
    "invalid_input",
    "unknown_field",
    "project_required",
    "worktree_required",
    "worktree_not_found",
    "proposal_required",
    "proposal_not_found",
    "proposal_scope_mismatch",
    "proposal_not_approved",
    "proposal_missing_diff",
    "patch_hash_required",
    "patch_hash_mismatch",
    "approval_required",
    "approval_not_found",
    "approval_not_approved",
    "approval_scope_mismatch",
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

export function createCodexPlanAgentRegistration({
  wrapperScriptPath = "tools/agents/codex-plan-wrapper.mjs",
  costOwner = "usr_local",
  currency = "USD",
} = {}) {
  const wrapperPath = String(wrapperScriptPath ?? "").trim();
  if (!wrapperPath) {
    throw new Error("codex plan wrapperScriptPath is required.");
  }
  return {
    id: "agt_codex_plan_change",
    type: "cli",
    name: "Codex Change Plan",
    description: "Runs a governed read-only Codex planning pass over a project worktree.",
    command: "node",
    args: [wrapperPath, "--mode", "change-plan"],
    timeoutSeconds: 120,
    outputFormat: "plain_result",
    toolContract: CODEX_PLAN_TOOL_CONTRACT,
    capabilityName: "change_planning",
    capabilityDescription: "Plan a bounded code change without mutating files.",
    riskLevel: "low",
    riskTags: ["read_only", "read_project", "planning", "local_agent"],
    economicModel: "external_billed",
    pricingDimensions: [],
    currency,
    costOwner,
    unknownCostPolicy: "warn",
    registrationNotes: {
      risk: "Runs a fixed Codex change-plan wrapper. External callers cannot choose cwd, shell args, sandbox, model, or permission flags.",
      data: "Reads the selected project worktree and stores a structured change plan.",
      cost: "Codex usage is externally billed by the configured Codex/OpenAI account and should be reported separately from platform charges.",
      cancellation: "The Desktop Bridge attempts to terminate the Codex planning process tree when cancellation is requested.",
    },
  };
}

export function createCodexPatchProposalAgentRegistration({
  wrapperScriptPath = "tools/agents/codex-patch-proposal-wrapper.mjs",
  costOwner = "usr_local",
  currency = "USD",
} = {}) {
  const wrapperPath = String(wrapperScriptPath ?? "").trim();
  if (!wrapperPath) {
    throw new Error("codex patch proposal wrapperScriptPath is required.");
  }
  return {
    id: "agt_codex_propose_patch",
    type: "cli",
    name: "Codex Patch Proposal",
    description: "Runs a governed read-only Codex pass that returns a patch artifact without mutating files.",
    command: "node",
    args: [wrapperPath, "--mode", "patch-proposal"],
    timeoutSeconds: 180,
    outputFormat: "plain_result",
    toolContract: CODEX_PATCH_PROPOSAL_TOOL_CONTRACT,
    capabilityName: "patch_proposal",
    capabilityDescription: "Generate a reviewable patch proposal artifact without applying it.",
    riskLevel: "medium",
    riskTags: ["read_project", "patch_artifact", "code_generation", "local_agent"],
    economicModel: "external_billed",
    pricingDimensions: [],
    currency,
    costOwner,
    unknownCostPolicy: "warn",
    registrationNotes: {
      risk: "Runs a fixed Codex patch-proposal wrapper. External callers cannot choose cwd, shell args, sandbox, model, or permission flags, and the wrapper forces read-only sandboxing.",
      data: "Reads the selected project worktree and stores an immutable patch proposal artifact for review.",
      cost: "Codex usage is externally billed by the configured Codex/OpenAI account and should be reported separately from platform charges.",
      cancellation: "The Desktop Bridge attempts to terminate the Codex proposal process tree when cancellation is requested.",
    },
  };
}

export function createCodexApplyPatchAgentRegistration({
  wrapperScriptPath = "tools/agents/codex-apply-patch-wrapper.mjs",
  costOwner = "usr_local",
  currency = "USD",
} = {}) {
  const wrapperPath = String(wrapperScriptPath ?? "").trim();
  if (!wrapperPath) {
    throw new Error("codex apply patch wrapperScriptPath is required.");
  }
  return {
    id: "agt_codex_apply_patch",
    type: "cli",
    name: "Codex Apply Patch",
    description: "Applies an approved immutable Codex patch proposal to the selected worktree.",
    command: "node",
    args: [wrapperPath, "--mode", "apply-patch"],
    timeoutSeconds: 120,
    outputFormat: "plain_result",
    filePolicy: "workspace_write",
    networkPolicy: "forbidden",
    toolContract: CODEX_APPLY_PATCH_TOOL_CONTRACT,
    capabilityName: "patch_apply",
    capabilityDescription: "Apply an approved patch proposal artifact to the worktree.",
    riskLevel: "medium",
    riskTags: ["workspace_write", "patch_apply", "local_agent"],
    economicModel: "external_billed",
    pricingDimensions: [],
    currency,
    costOwner,
    unknownCostPolicy: "warn",
    registrationNotes: {
      risk: "Runs a fixed patch-apply wrapper after the server verifies proposal scope, patch hash, review state, and local approval evidence.",
      data: "Reads a server-created temporary patch artifact and writes only to the selected project worktree through git apply.",
      cost: "No model billing is expected for patch application; any local execution cost is external or unknown.",
      cancellation: "The Desktop Bridge attempts to terminate the patch apply process tree when cancellation is requested.",
    },
  };
}

export function isGovernedCodexReviewAgent(agent) {
  if (!agent) {
    return false;
  }
  const hasId = agent.id === "agt_codex_review_diff";
  const hasCliAdapter = agent.adapter?.type === "cli";
  const hasNodeCommand = String(agent.adapter?.command ?? "") === "node";
  const hasPlainResultOutput = agent.adapter?.outputFormat === "plain_result";
  const hasToolContract = agent.toolContract?.name === CODEX_REVIEW_TOOL_CONTRACT.name;
  const hasReviewCapability = (agent.capabilities ?? []).some((capability) => capability?.name === "code_review");
  const adapterArgs = Array.isArray(agent.adapter?.args) ? agent.adapter.args.map(String) : [];
  const fixedWrapperArgs = isExactGovernedReviewWrapperArgs(adapterArgs, "codex-review-wrapper.mjs");
  return hasId && hasCliAdapter && hasNodeCommand && hasPlainResultOutput && hasToolContract && hasReviewCapability && fixedWrapperArgs;
}

export function isGovernedCodexPlanAgent(agent) {
  if (!agent) {
    return false;
  }
  const hasId = agent.id === "agt_codex_plan_change";
  const hasCliAdapter = agent.adapter?.type === "cli";
  const hasNodeCommand = String(agent.adapter?.command ?? "") === "node";
  const hasPlainResultOutput = agent.adapter?.outputFormat === "plain_result";
  const hasToolContract = agent.toolContract?.name === CODEX_PLAN_TOOL_CONTRACT.name;
  const hasPlanCapability = (agent.capabilities ?? []).some((capability) => capability?.name === "change_planning");
  const adapterArgs = Array.isArray(agent.adapter?.args) ? agent.adapter.args.map(String) : [];
  const fixedWrapperArgs = isExactGovernedWrapperArgs(adapterArgs, "codex-plan-wrapper.mjs", "change-plan");
  return hasId && hasCliAdapter && hasNodeCommand && hasPlainResultOutput && hasToolContract && hasPlanCapability && fixedWrapperArgs;
}

export function isGovernedCodexPatchProposalAgent(agent) {
  if (!agent) {
    return false;
  }
  const hasId = agent.id === "agt_codex_propose_patch";
  const hasCliAdapter = agent.adapter?.type === "cli";
  const hasNodeCommand = String(agent.adapter?.command ?? "") === "node";
  const hasPlainResultOutput = agent.adapter?.outputFormat === "plain_result";
  const hasToolContract = agent.toolContract?.name === CODEX_PATCH_PROPOSAL_TOOL_CONTRACT.name;
  const hasProposalCapability = (agent.capabilities ?? []).some((capability) => capability?.name === "patch_proposal");
  const adapterArgs = Array.isArray(agent.adapter?.args) ? agent.adapter.args.map(String) : [];
  const fixedWrapperArgs = isExactGovernedWrapperArgs(adapterArgs, "codex-patch-proposal-wrapper.mjs", "patch-proposal");
  return hasId && hasCliAdapter && hasNodeCommand && hasPlainResultOutput && hasToolContract && hasProposalCapability && fixedWrapperArgs;
}

export function isGovernedCodexApplyPatchAgent(agent) {
  if (!agent) {
    return false;
  }
  const hasId = agent.id === "agt_codex_apply_patch";
  const hasCliAdapter = agent.adapter?.type === "cli";
  const hasNodeCommand = String(agent.adapter?.command ?? "") === "node";
  const hasPlainResultOutput = agent.adapter?.outputFormat === "plain_result";
  const hasToolContract = agent.toolContract?.name === CODEX_APPLY_PATCH_TOOL_CONTRACT.name;
  const hasApplyCapability = (agent.capabilities ?? []).some((capability) => capability?.name === "patch_apply");
  const hasWritePolicy = agent.adapter?.filePolicy === "workspace_write" && agent.adapter?.networkPolicy === "forbidden";
  const adapterArgs = Array.isArray(agent.adapter?.args) ? agent.adapter.args.map(String) : [];
  const fixedWrapperArgs = isExactGovernedWrapperArgs(adapterArgs, "codex-apply-patch-wrapper.mjs", "apply-patch");
  return hasId && hasCliAdapter && hasNodeCommand && hasPlainResultOutput && hasToolContract && hasApplyCapability && hasWritePolicy && fixedWrapperArgs;
}

function isExactGovernedReviewWrapperArgs(args, wrapperName) {
  return isExactGovernedWrapperArgs(args, wrapperName, "diff-review");
}

function isExactGovernedWrapperArgs(args, wrapperName, mode) {
  if (args.length !== 3) {
    return false;
  }
  // Require the full canonical directory segment, not just the basename. A
  // bare-basename match (`endsWith(wrapperName)`) would also accept an
  // attacker-controlled script at an arbitrary location whose filename ends
  // with the wrapper name (e.g. /tmp/evil/codex-review-wrapper.mjs), which a
  // forged/overriding agent registration could point the governed tool at —
  // turning the "governed" facade into arbitrary local execution. The wrapper
  // is registered as an absolute path, so match the trailing repo path.
  return args[0].replaceAll("\\", "/").endsWith(`tools/agents/${wrapperName}`)
    && args[1] === "--mode"
    && args[2] === mode;
}
