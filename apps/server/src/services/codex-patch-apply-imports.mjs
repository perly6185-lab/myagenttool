import { isGovernedCodexApplyPatchAgent } from "./codex-agent.mjs";

export function createCodexPatchApplyImportService({
  state,
  now,
  appendEvent,
  persistStateSoon = () => {},
}) {
  function recordCodexPatchApply({ invocation, result, agent }) {
    if (!isGovernedCodexApplyPatchAgent(agent) || !isCodexPatchApplyResult(result)) {
      return [];
    }
    const proposalId = stringOrNull(result.output.proposalId ?? invocation.options?.metadata?.proposalId);
    const patchSha256 = validSha256(result.output.patchSha256 ?? invocation.options?.metadata?.patchSha256);
    if (!proposalId || !patchSha256) {
      return [];
    }
    const proposal = (state.codexPatchProposals ?? []).find((item) => item.id === proposalId);
    if (!proposal || proposal.patchSha256 !== patchSha256) {
      return [];
    }
    proposal.reviewState = "applied";
    proposal.appliedInvocationId = invocation.id;
    proposal.appliedAt = now();
    proposal.applySummary = stringOrNull(result.summary ?? result.output.summary) ?? "Patch proposal applied.";
    proposal.applyResult = {
      applied: true,
      invocationId: invocation.id,
      patchSha256,
      files: normalizeFiles(result.output.files),
      createdAt: proposal.appliedAt,
    };
    appendEvent({
      invocationId: invocation.id,
      type: "codex_patch_proposal_applied",
      level: "info",
      message: "Applied approved Codex patch proposal.",
      data: {
        codexPatchProposalId: proposal.id,
        tool: "codex.apply.patch",
        patchSha256,
      },
    });
    persistStateSoon();
    return [proposal];
  }

  return { recordCodexPatchApply };
}

function isCodexPatchApplyResult(result) {
  return result?.output?.source === "codex"
    && result.output.tool === "codex.apply.patch"
    && result.output.applied === true
    && !result.output.error;
}

function normalizeFiles(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 100);
}

function validSha256(value) {
  const text = String(value ?? "").trim();
  return /^[a-f0-9]{64}$/i.test(text) ? text.toLowerCase() : null;
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
