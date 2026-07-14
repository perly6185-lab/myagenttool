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
      (item) => item.id === metadata.claudeApplyAuthorizationId
        || item.executionInvocationId === invocation.id
        || item.rollbackInvocationId === invocation.id,
    );
    if (!authorization) {
      return null;
    }
    const output = result.output;
    const succeeded = output.applied === true;
    if (metadata.claudeApplyRollback === true) {
      recordRollbackOutcome({ invocation, authorization, output, succeeded, resultSummary: result.summary });
      persistStateSoon();
      return authorization;
    }
    authorization.status = succeeded ? "applied" : "failed";
    authorization.applied = succeeded;
    authorization.executable = false;
    authorization.appliedFiles = normalizeAppliedFiles(output.appliedFiles);
    authorization.verification = normalizeVerification(output.verification);
    authorization.rollback = succeeded ? normalizeRollback(output.rollback) : null;
    authorization.resultSummary = stringOrNull(output.summary ?? result.summary);
    authorization.appliedAt = now();
    appendEvent({
      invocationId: invocation.id,
      type: succeeded ? "claude_apply_completed" : "claude_apply_failed",
      level: succeeded ? "info" : "warn",
      message: succeeded
        ? `Applied an authorized Claude patch (${authorization.appliedFiles.length} file(s)) for authorization ${authorization.id}.`
        : `A Claude patch apply failed for authorization ${authorization.id}; the worktree was not mutated.`,
      data: {
        claudeApplyAuthorizationId: authorization.id,
        proposalInvocationId: authorization.proposalInvocationId,
        applied: succeeded,
        fileCount: authorization.appliedFiles.length,
        rollbackAvailable: Boolean(authorization.rollback?.available),
      },
    });
    persistStateSoon();
    return authorization;
  }

  // The governed rollback run (#914 follow-up). Success retires the authorization
  // (`rolled_back`; the rollback guidance is consumed). Failure is honest about
  // the tree: git apply is atomic, so a refused/failed reverse leaves the patch
  // APPLIED — the status returns to `applied` with the error recorded, and the
  // operator may retry with a fresh grant.
  function recordRollbackOutcome({ invocation, authorization, output, succeeded, resultSummary }) {
    if (succeeded) {
      authorization.status = "rolled_back";
      authorization.rolledBackAt = now();
      authorization.rollback = { ...(authorization.rollback ?? {}), available: false, executed: true };
    } else {
      authorization.status = "applied";
      authorization.rollbackError = normalizeVerification(output.verification).error
        ?? stringOrNull(output.summary ?? resultSummary)
        ?? "rollback failed";
    }
    authorization.resultSummary = stringOrNull(output.summary ?? resultSummary);
    appendEvent({
      invocationId: invocation.id,
      type: succeeded ? "claude_rollback_completed" : "claude_rollback_failed",
      level: "warn",
      message: succeeded
        ? `Rolled back Claude patch authorization ${authorization.id}; the worktree no longer carries the patch.`
        : `Rolling back Claude patch authorization ${authorization.id} failed; the patch remains applied.`,
      data: {
        claudeApplyAuthorizationId: authorization.id,
        proposalInvocationId: authorization.proposalInvocationId,
        rolledBack: succeeded,
      },
    });
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
    // Post-apply verification (allowlisted command): recorded honestly whether it
    // passed or failed — a failing verification does not undo the apply.
    ...(value.testsPassed !== undefined ? {
      verifyCommand: stringOrNull(value.verifyCommand),
      testsPassed: value.testsPassed === true,
      testExitCode: Number.isFinite(Number(value.testExitCode)) ? Number(value.testExitCode) : null,
      testOutputPreview: stringOrNull(value.testOutputPreview),
    } : {}),
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
