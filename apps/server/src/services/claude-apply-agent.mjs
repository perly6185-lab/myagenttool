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
