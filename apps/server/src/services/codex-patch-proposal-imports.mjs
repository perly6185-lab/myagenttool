import { createHash } from "node:crypto";
import { isGovernedCodexPatchProposalAgent } from "./codex-agent.mjs";

const MAX_CODEX_PATCH_PROPOSALS = 1000;
const MAX_FILES_PER_PROPOSAL = 100;
const MAX_PUBLIC_DIFF_PREVIEW = 12000;

export function createCodexPatchProposalImportService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
}) {
  function recordCodexPatchProposal({ invocation, result, agent }) {
    if (!isGovernedCodexPatchProposalAgent(agent) || !isCodexPatchProposalResult(result)) {
      return [];
    }
    const diff = normalizeDiff(result.output.diff);
    if (!diff) {
      return [];
    }
    const allFiles = normalizeFiles(result.output.files);
    const droppedFileCount = Math.max(0, allFiles.length - MAX_FILES_PER_PROPOSAL);
    const files = allFiles.slice(0, MAX_FILES_PER_PROPOSAL);
    const diffPreview = boundedText(stringOrNull(result.output.diffPreview) ?? diff, MAX_PUBLIC_DIFF_PREVIEW);
    const patchSha256 = validSha256(result.output.patchSha256) ?? sha256(diff);
    const record = {
      id: nextId("cpp_demo"),
      source: "codex",
      proposalInvocationId: invocation.id,
      invocationId: invocation.id,
      projectId: invocation.projectId ?? invocation.options?.metadata?.projectId ?? null,
      worktreeId: invocation.worktreeId ?? invocation.options?.metadata?.worktreeId ?? null,
      requestedBy: invocation.requestedBy ?? null,
      agentId: invocation.agentId ?? null,
      proposalAgentName: agent?.name ?? null,
      tool: "codex.propose.patch",
      mode: String(result.output.mode ?? "patch-proposal"),
      basePlanId: stringOrNull(result.output.basePlanId ?? invocation.options?.metadata?.basePlanId),
      goal: stringOrNull(result.output.goal ?? invocation.options?.metadata?.goal),
      constraints: stringOrNull(result.output.constraints ?? invocation.options?.metadata?.constraints),
      maxFiles: positiveInteger(result.output.maxFiles ?? invocation.options?.metadata?.maxFiles),
      summary: stringOrNull(result.output.summary ?? result.summary),
      files,
      diffPreview,
      patchSha256,
      verification: normalizeStringList(result.output.verification),
      immutable: true,
      reviewState: "generated",
      authoritative: false,
      droppedFileCount,
      raw: {
        summary: result.output.summary ?? null,
        files: result.output.files ?? [],
        diff,
        verification: result.output.verification ?? [],
      },
      createdAt: now(),
    };
    state.codexPatchProposals.unshift(record);
    state.codexPatchProposals = state.codexPatchProposals.slice(0, MAX_CODEX_PATCH_PROPOSALS);
    appendEvent({
      invocationId: invocation.id,
      type: "codex_patch_proposal_recorded",
      level: "info",
      message: "Imported immutable Codex patch proposal.",
      data: {
        codexPatchProposalId: record.id,
        tool: "codex.propose.patch",
        authoritative: false,
        immutable: true,
        patchSha256,
        droppedFileCount,
      },
    });
    persistStateSoon();
    return [record];
  }

  return { recordCodexPatchProposal };
}

function isCodexPatchProposalResult(result) {
  return result?.output?.source === "codex"
    && result.output.tool === "codex.propose.patch"
    && !result.output.error;
}

function normalizeFiles(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      path: stringOrNull(item.path),
      changeType: enumValue(item.changeType, "unknown", ["add", "modify", "delete", "rename", "unknown"]),
      risk: enumValue(item.risk, "medium", ["low", "medium", "high"]),
    }))
    .filter((item) => item.path);
}

function normalizeDiff(value) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  return text || null;
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 50);
}

function enumValue(value, fallback, allowed) {
  const text = String(value ?? fallback).trim();
  return allowed.includes(text) ? text : fallback;
}

function boundedText(text, maxLength) {
  const value = String(text ?? "");
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function validSha256(value) {
  const text = String(value ?? "").trim();
  return /^[a-f0-9]{64}$/i.test(text) ? text.toLowerCase() : null;
}

function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
