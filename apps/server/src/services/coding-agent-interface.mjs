export const CODING_AGENT_INTERFACE_FAMILY = "coding_agent";
export const CODING_AGENT_INTERFACE_VERSION = "1";

const OPERATIONS = new Map([
  ["codex.review.diff", contract("codex", "review.diff", "read_only", "allowed")],
  ["codex.exec", contract("codex", "execute.change", "worktree_write", "approval_broker")],
  ["claude.review.diff", contract("claude", "review.diff", "read_only", "allowed")],
  ["claude.explain.diff", contract("claude", "explain.diff", "read_only", "allowed")],
  ["claude.explain.code", contract("claude", "explain.code", "read_only", "allowed")],
  ["claude.analyze.issue", contract("claude", "analyze.issue", "read_only", "allowed")],
  ["claude.plan.change", contract("claude", "plan.change", "read_only", "allowed")],
  ["claude.propose.patch", contract("claude", "propose.patch", "proposal_only", "allowed")],
  ["claude.apply.patch", contract("claude", "apply.patch", "worktree_write", "single_use_grant")],
]);

export function codingAgentInterfaceForTool(toolName, { outputCollection = "invocations" } = {}) {
  const value = OPERATIONS.get(String(toolName ?? ""));
  return value ? { ...value, resultCollection: outputCollection } : null;
}

export function normalizeCapabilityInvocationResult(result, capability) {
  if (!result || typeof result !== "object" || !result.body || typeof result.body !== "object" || result.status >= 400) return result;
  const invocation = result.body.invocation ?? null;
  return {
    ...result,
    body: {
      ...result.body,
      capability: capability.name,
      provider: capability.provider,
      invocationId: result.body.invocationId ?? invocation?.id ?? null,
      status: result.body.status ?? invocation?.status ?? null,
      outputCollection: result.body.outputCollection ?? capability.outputCollection ?? capability.metadata?.outputCollection ?? capability.metadata?.resultPath?.outputCollection ?? "invocations",
      interface: capability.metadata?.interface ?? null,
    },
  };
}

function contract(provider, operation, mutation, approval) {
  return {
    family: CODING_AGENT_INTERFACE_FAMILY,
    version: CODING_AGENT_INTERFACE_VERSION,
    provider,
    operation,
    mutation,
    session: "isolated",
    approval,
  };
}
