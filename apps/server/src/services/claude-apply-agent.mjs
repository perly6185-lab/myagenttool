// Claude governance Phase 4 (CLAUDE_TOOL_GOVERNANCE_PLAN.md #914): approval-bound
// apply. This first slice (4a) is the GATE, not the write. `claude.apply.patch`
// binds to a Phase 3 proposal (by invocation id), enforces tenancy, and REQUIRES a
// valid, single-use approval grant. On success it records an immutable "apply
// authorization" artifact (grant consumed, bound to the proposal + worktree) with
// `executable: false` — no file is written here. A later slice (4b) consumes an
// authorization to `git apply` the patch on the bridge and record the result +
// rollback evidence.
//
// The whole tool is behind a default-OFF feature flag, so a deployment that has not
// opted in has no discoverable or invokable apply path at all.

import { isGovernedWrapperAgent } from "./governed-agent.mjs";

// Post-apply verification allowlist: command IDs the apply input may select. The
// wrapper maps each ID to fixed argv INDEPENDENTLY (claude-apply-wrapper.mjs) —
// the same double-allowlist pattern the git wrapper uses — so neither side alone
// can turn `verify` into free-form execution. `node-test` stays network-free,
// matching the runner's declared no-network policy.
export const CLAUDE_APPLY_VERIFY_COMMANDS = ["node-test"];

export const CLAUDE_APPLY_TOOL_CONTRACT = {
  name: "claude.apply.patch",
  version: "1",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["worktreeId", "proposalInvocationId", "approvalToken"],
    properties: {
      projectId: { type: "string" },
      worktreeId: { type: "string" },
      // The Phase 3 claude.propose.patch invocation whose result carries the patch.
      proposalInvocationId: { type: "string" },
      // A server-issued, single-use grant for (action apply_patch, target
      // proposalInvocationId). Without a valid one, no authorization is created.
      approvalToken: { type: "string", minLength: 1, maxLength: 400 },
      // Optional post-apply verification: an allowlisted command ID, never argv.
      // A failing verification does not undo the apply — it is recorded on the
      // authorization, and the governed rollback is the undo.
      verify: { enum: CLAUDE_APPLY_VERIFY_COMMANDS },
    },
  },
  outputSchema: {
    structuredResult: true,
    authorization: {
      status: { enum: ["authorized"] },
      executable: { const: false },
      proposalInvocationId: { type: "string" },
      files: { type: "array" },
    },
  },
  errorCodes: [
    "invalid_input",
    "unknown_field",
    "project_required",
    "worktree_required",
    "proposal_required",
    "worktree_not_found",
    "proposal_not_found",
    "proposal_not_applicable",
    "worktree_binding_mismatch",
    "approval_required",
    "apply_not_enabled",
  ],
};

// Default OFF. A deployment opts in with MYAGENTTOOL_CLAUDE_APPLY_ENABLED=1. When
// off, the tool is absent from discovery and refuses invocation — no write-capable
// Claude path exists.
export function isClaudeApplyEnabled(env = process.env) {
  const flag = env?.MYAGENTTOOL_CLAUDE_APPLY_ENABLED;
  return flag === "1" || flag === "true";
}

// Phase 4b: the write-capable apply RUNNER agent. Unlike the read-only review/
// explain/propose agents, this one WRITES — it runs claude-apply-wrapper.mjs, which
// `git apply`s an authorized patch. The bridge injects only --cwd and --patch-file;
// there is no --mode (the wrapper does one thing).
export function createClaudeApplyAgentRegistration({
  wrapperScriptPath = "tools/agents/claude-apply-wrapper.mjs",
  costOwner = "usr_local",
  currency = "USD",
} = {}) {
  const wrapperPath = String(wrapperScriptPath ?? "").trim();
  if (!wrapperPath) {
    throw new Error("claude apply wrapperScriptPath is required.");
  }
  return {
    id: "agt_claude_apply_patch",
    type: "cli",
    name: "Claude Patch Apply Runner",
    description: "Applies an approval-authorized Claude patch into its bound worktree with git apply.",
    command: "node",
    args: [wrapperPath],
    timeoutSeconds: 120,
    outputFormat: "plain_result",
    toolContract: CLAUDE_APPLY_TOOL_CONTRACT,
    capabilityName: "code_apply",
    capabilityDescription: "Apply an authorized patch to a worktree with git apply and report the result.",
    riskLevel: "high",
    riskTags: ["write_worktree", "code_change", "local_agent", "approval_required"],
    economicModel: "external_billed",
    pricingDimensions: [],
    currency,
    costOwner,
    unknownCostPolicy: "warn",
    registrationNotes: {
      risk: "WRITE-CAPABLE. Runs git apply for a server-authorized, approval-bound patch only. It refuses a patch that does not check cleanly and never applies free-form input.",
      data: "Reads the authorized patch and writes the changed files into the bound worktree; reports the applied file list and rollback guidance.",
      cost: "No model call — this runner only applies a patch. Claude usage was billed at proposal time.",
      cancellation: "The Desktop Bridge attempts to terminate the git process when cancellation is requested.",
    },
  };
}

export function isGovernedClaudeApplyAgent(agent) {
  // mode: null → the single-argument write runner (no --mode). The shared gate
  // still pins the exact canonical wrapper path.
  return isGovernedWrapperAgent(agent, {
    id: "agt_claude_apply_patch",
    toolName: CLAUDE_APPLY_TOOL_CONTRACT.name,
    capabilityName: "code_apply",
    wrapper: "claude-apply-wrapper.mjs",
    mode: null,
  });
}
