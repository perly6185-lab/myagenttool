import { isGovernedClaudeApplyAgent } from "./claude-apply-agent.mjs";

// Phase 4b: when a governed apply RUNNER completes, fold its git-apply result into
// the authorization the Phase 4a gate created — the applied file list, the
// verification outcome, and reversible rollback guidance. The authorization row is
// the single durable record of "this approved patch was applied (or failed)".
export function createClaudeApplyImportService({
  state,
  now,
  appendEvent,
  persistStateSoon = () => {},
}) {
  function recordClaudeApplyResult({ invocation, result, agent }) {
    if (!isGovernedClaudeApplyAgent(agent) || !isClaudeApplyResult(result)) {
      return null;
    }
    const metadata = invocation?.options?.metadata ?? {};
    const authorization = (state.claudeApplyAuthorizations ?? []).find(
      (item) => item.id === metadata.claudeApplyAuthorizationId || item.executionInvocationId === invocation.id,
    );
    if (!authorization) {
      return null;
    }
    const output = result.output;
    const applied = output.applied === true;
    authorization.status = applied ? "applied" : "failed";
    authorization.applied = applied;
    authorization.executable = false;
    authorization.appliedFiles = normalizeAppliedFiles(output.appliedFiles);
    authorization.verification = normalizeVerification(output.verification);
    authorization.rollback = applied ? normalizeRollback(output.rollback) : null;
    authorization.resultSummary = stringOrNull(output.summary ?? result.summary);
    authorization.appliedAt = now();
    appendEvent({
      invocationId: invocation.id,
      type: applied ? "claude_apply_completed" : "claude_apply_failed",
      level: applied ? "info" : "warn",
      message: applied
        ? `Applied an authorized Claude patch (${authorization.appliedFiles.length} file(s)) for authorization ${authorization.id}.`
        : `A Claude patch apply failed for authorization ${authorization.id}; the worktree was not mutated.`,
      data: {
        claudeApplyAuthorizationId: authorization.id,
        proposalInvocationId: authorization.proposalInvocationId,
        applied,
        fileCount: authorization.appliedFiles.length,
        rollbackAvailable: Boolean(authorization.rollback?.available),
      },
    });
    persistStateSoon();
    return authorization;
  }

  return { recordClaudeApplyResult };
}

function isClaudeApplyResult(result) {
  return result?.output?.source === "claude"
    && result.output.tool === "claude.apply.patch"
    && result.output.applied !== undefined;
}

function normalizeAppliedFiles(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      path: String(item.path ?? "").trim(),
      added: Number.isFinite(Number(item.added)) ? Number(item.added) : null,
      deleted: Number.isFinite(Number(item.deleted)) ? Number(item.deleted) : null,
    }))
    .filter((item) => item.path);
}

function normalizeVerification(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { checkPassed: null };
  return {
    checkPassed: value.checkPassed === true ? true : value.checkPassed === false ? false : null,
    error: stringOrNull(value.error),
  };
}

function normalizeRollback(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    available: value.available === true,
    strategy: stringOrNull(value.strategy),
    command: stringOrNull(value.command),
  };
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
