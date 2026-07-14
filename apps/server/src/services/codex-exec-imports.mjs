import { isGovernedCodexExecAgent } from "./codex-agent.mjs";

const MAX_CODEX_EXEC_CHANGES = 1000;
const MAX_CHANGES_PER_RUN = 1000;

// Imports the git-derived changeset a governed codex.exec run produced in its
// worktree. Mirrors codex-review-imports: the wrapper reports the AUTHORITATIVE
// changes (from `git status`/`git diff` in the worktree, not the model's self
// report); we store bounded, redacted rows keyed to the invocation.
export function createCodexExecImportService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
}) {
  function recordCodexExecChanges({ invocation, result, agent }) {
    if (!isGovernedCodexExecAgent(agent) || !isCodexExecResult(result)) {
      return [];
    }
    const allChanges = normalizeChanges(result.output.changes);
    const droppedChangeCount = Math.max(0, allChanges.length - MAX_CHANGES_PER_RUN);
    const changes = allChanges.slice(0, MAX_CHANGES_PER_RUN);
    if (!changes.length) {
      return [];
    }
    const createdAt = now();
    const records = changes.map((change, index) => ({
      id: nextId("cec_demo"),
      source: "codex",
      execInvocationId: invocation.id,
      invocationId: invocation.id,
      projectId: invocation.projectId ?? invocation.options?.metadata?.projectId ?? null,
      worktreeId: invocation.worktreeId ?? invocation.options?.metadata?.worktreeId ?? null,
      requestedBy: invocation.requestedBy ?? null,
      agentId: invocation.agentId ?? null,
      execAgentName: agent?.name ?? null,
      tool: "codex.exec",
      mode: String(result.output.mode ?? "edit"),
      task: stringOrNull(result.output.task),
      summary: stringOrNull(result.output.summary ?? result.summary),
      changeIndex: index,
      file: change.file,
      action: change.action,
      diffPreview: change.diffPreview,
      changeRisk: change.changeRisk,
      changeSummary: change.summary,
      authoritative: false,
      raw: change.raw,
      createdAt,
    }));
    state.codexExecChanges.unshift(...records);
    state.codexExecChanges = state.codexExecChanges.slice(0, MAX_CODEX_EXEC_CHANGES);
    appendEvent({
      invocationId: invocation.id,
      type: "codex_exec_changes_recorded",
      level: "info",
      message: `Imported ${records.length} Codex exec change(s).`,
      data: {
        codexExecChangeIds: records.map((record) => record.id),
        tool: "codex.exec",
        authoritative: false,
        droppedChangeCount,
      },
    });
    persistStateSoon();
    return records;
  }

  return { recordCodexExecChanges };
}

function isCodexExecResult(result) {
  return result?.output?.source === "codex"
    && result.output.tool === "codex.exec"
    && !result.output.error;
}

function normalizeChanges(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      file: stringOrNull(item.file),
      action: enumValue(item.action, "modified", ["created", "modified", "deleted"]),
      diffPreview: stringOrNull(item.diffPreview),
      changeRisk: enumValue(item.changeRisk, "unknown", ["low", "medium", "high", "unknown"]),
      summary: stringOrNull(item.summary),
      raw: item,
    }))
    .filter((item) => item.file);
}

function enumValue(value, fallback, allowed) {
  const text = String(value ?? fallback).trim();
  return allowed.includes(text) ? text : fallback;
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
