import type { ApprovalSnapshot, CodexPatchProposal, ConsoleSnapshot, InvocationSnapshot } from "@/lib/console-state";

export const CODEX_TOOL_NAMES = [
  "codex.review.diff",
  "codex.plan.change",
  "codex.propose.patch",
  "codex.apply.patch",
] as const;

const PENDING_APPROVAL_STATES = new Set(["pending", "waiting", "waiting_for_local_approval"]);
const BLOCKED_INVOCATION_STATES = new Set(["failed", "rejected", "timed_out", "expired", "cancelled"]);

export interface CodexOpsSummary {
  proposalReviewCount: number;
  applyApprovalCount: number;
  blockedRunCount: number;
  appliedPatchCount: number;
  pendingCount: number;
}

export function codexOpsSummary(state?: Pick<ConsoleSnapshot,
  "approvalRequests" | "codexPatchProposals" | "invocations"
> | null): CodexOpsSummary {
  const proposals = state?.codexPatchProposals ?? [];
  const invocations = state?.invocations ?? [];
  const approvals = state?.approvalRequests ?? [];
  const proposalReviewCount = proposals.filter(needsProposalReview).length;
  const applyApprovalCount = approvals.filter((approval) => isPendingCodexApplyApproval(approval, invocations)).length;
  const blockedRunCount = invocations.filter(isBlockedCodexInvocation).length;
  const appliedPatchCount = proposals.filter((proposal) => proposal.reviewState === "applied").length;
  return {
    proposalReviewCount,
    applyApprovalCount,
    blockedRunCount,
    appliedPatchCount,
    pendingCount: proposalReviewCount + applyApprovalCount + blockedRunCount,
  };
}

function needsProposalReview(proposal: CodexPatchProposal) {
  return proposal.reviewState === "generated" || proposal.reviewState === "reviewed";
}

function isPendingCodexApplyApproval(approval: ApprovalSnapshot, invocations: InvocationSnapshot[]) {
  if (!PENDING_APPROVAL_STATES.has(approval.status)) return false;
  const invocation = approval.invocationId
    ? invocations.find((item) => item.id === approval.invocationId)
    : null;
  return invocation?.options?.metadata?.tool === "codex.apply.patch";
}

function isBlockedCodexInvocation(invocation: InvocationSnapshot) {
  const tool = invocation.options?.metadata?.tool;
  return typeof tool === "string"
    && CODEX_TOOL_NAMES.includes(tool as (typeof CODEX_TOOL_NAMES)[number])
    && BLOCKED_INVOCATION_STATES.has(invocation.status ?? "");
}
