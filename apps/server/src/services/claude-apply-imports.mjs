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
  function findAuthorization(invocation) {
    const metadata = invocation?.options?.metadata ?? {};
    return (state.claudeApplyAuthorizations ?? []).find(
      (item) => item.id === metadata.claudeApplyAuthorizationId
        || item.executionInvocationId === invocation?.id
        || item.rollbackInvocationId === invocation?.id,
    ) ?? null;
  }

  function recordClaudeApplyResult({ invocation, result, agent }) {
    if (!isGovernedClaudeApplyAgent(agent)) {
      return null;
    }
    const authorization = findAuthorization(invocation);
    if (!authorization) {
      return null;
    }
    const metadata = invocation?.options?.metadata ?? {};
    // A terminal run that produced NO valid apply result (timeout, cancel, refuse,
    // liveness reclaim) must still resolve the authorization — otherwise it is
    // stuck at applying/rolling_back forever with the grant already burned.
    if (!isClaudeApplyResult(result)) {
      reconcileTerminated(authorization, metadata.claudeApplyRollback === true, terminalReason(invocation, result));
      dropInvocationPatch(invocation);
      persistStateSoon();
      return authorization;
    }
    const output = result.output;
    const succeeded = output.applied === true;
    if (metadata.claudeApplyRollback === true) {
      recordRollbackOutcome({ invocation, authorization, output, succeeded, resultSummary: result.summary });
      dropInvocationPatch(invocation);
      persistStateSoon();
      return authorization;
    }
    authorization.status = succeeded ? "applied" : "failed";
    authorization.applied = succeeded;
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
    dropInvocationPatch(invocation);
    persistStateSoon();
    return authorization;
  }

  // Deny bypasses the completion runtime entirely (approval.mjs sets status
  // "rejected" without calling completeInvocation), so the completion hook above
  // never runs for a denied apply/rollback. This is the reconcile path for that
  // (and any other) result-less termination, called from onInvocationDenied.
  function reconcileClaudeApplyTermination(invocation) {
    const authorization = findAuthorization(invocation);
    if (!authorization) return null;
    reconcileTerminated(
      authorization,
      invocation?.options?.metadata?.claudeApplyRollback === true,
      terminalReason(invocation, invocation?.result ?? null),
    );
    dropInvocationPatch(invocation);
    persistStateSoon();
    return authorization;
  }

  // Resolve an authorization whose run ended without applying. git apply is atomic,
  // so a failed APPLY left the tree unchanged (-> failed); a failed ROLLBACK left
  // the patch on disk (-> back to applied, retryable). Idempotent: an already-
  // terminal authorization is left alone.
  function reconcileTerminated(authorization, isRollback, reason) {
    if (isTerminalApplyStatus(authorization.status)) return;
    if (isRollback) {
      authorization.status = "applied";
      authorization.rollbackError = reason;
    } else {
      authorization.status = "failed";
      authorization.applied = false;
      authorization.verification = { checkPassed: false, error: reason };
    }
    appendEvent({
      invocationId: authorization.executionInvocationId ?? authorization.rollbackInvocationId ?? authorization.invocationId,
      type: isRollback ? "claude_rollback_failed" : "claude_apply_failed",
      level: "warn",
      message: isRollback
        ? `Rolling back Claude patch authorization ${authorization.id} did not complete (${reason}); the patch remains applied.`
        : `Claude patch apply for authorization ${authorization.id} did not complete (${reason}); the worktree was not mutated.`,
      data: { claudeApplyAuthorizationId: authorization.id, proposalInvocationId: authorization.proposalInvocationId, reconciled: true },
    });
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
      // A successful retry must clear the error a prior failed rollback recorded,
      // or the UI shows "rollback failed" on a rolled-back row.
      authorization.rollbackError = null;
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

  return { recordClaudeApplyResult, reconcileClaudeApplyTermination };
}

// The large patch blob rides the invocation metadata only so the bridge can write
// it to a temp file; once the run is terminal nothing re-reads it, and leaving it
// keeps a third durable copy of every patch in state.invocations forever.
function dropInvocationPatch(invocation) {
  if (invocation?.options?.metadata && typeof invocation.options.metadata.applyPatch === "string") {
    delete invocation.options.metadata.applyPatch;
  }
}

function isTerminalApplyStatus(status) {
  return status === "applied" || status === "failed" || status === "rolled_back";
}

function terminalReason(invocation, result) {
  return stringOrNull(result?.errorCode)
    ?? stringOrNull(result?.summary)
    ?? `run ${stringOrNull(invocation?.status) ?? "terminated"} without a result`;
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
