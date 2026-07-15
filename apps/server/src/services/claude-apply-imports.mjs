import { isGovernedClaudeApplyAgent } from "./claude-apply-agent.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

// Phase 4b: when a governed apply RUNNER completes, fold its git-apply result into
// the authorization the Phase 4a gate created — the applied file list, the
// verification outcome, and reversible rollback guidance. The authorization row is
// the single durable record of "this approved patch was applied (or failed)".
export function createClaudeApplyImportService({
  state,
  now,
  appendEvent,
  persistStateSoon = () => {},
  store,
  // #1052: the deferred-verify dispatch. A synchronous post-apply verify held the
  // single-lane bridge for the whole test run; instead, when a successful apply
  // folds, a SEPARATE verify invocation is created (same transaction — durable
  // atomically with the applied status) and the lane is already free. Late-bound
  // lambdas from the composer; when absent (unit tests, misconfiguration) the
  // fold marks the authorization loudly "applied, unverified" — never a silent
  // skip and never a silent pass.
  createInvocation = null,
  startInvocationIfAllowed = null,
  findApplyRunner = null,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  function findAuthorization(invocation) {
    const metadata = invocation?.options?.metadata ?? {};
    return (state.claudeApplyAuthorizations ?? []).find(
      (item) => item.id === metadata.claudeApplyAuthorizationId
        || item.executionInvocationId === invocation?.id
        || item.rollbackInvocationId === invocation?.id
        || item.verifyInvocationId === invocation?.id,
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
    // #1052: the deferred verify leg has its own fold — it only ever touches
    // authorization.verification, never the applied/failed status. Routed FIRST:
    // a verify result carries no `applied` field, so the apply-result guard below
    // would misread it as a result-less termination.
    if (metadata.claudeApplyVerify === true) {
      return runTx(() => {
        recordVerifyOutcome({ invocation, result, authorization });
        return authorization;
      });
    }
    // A terminal run that produced NO valid apply result (timeout, cancel, refuse,
    // liveness reclaim) must still resolve the authorization — otherwise it is
    // stuck at applying/rolling_back forever with the grant already burned.
    if (!isClaudeApplyResult(result)) {
      return runTx(() => {
        reconcileTerminated(authorization, metadata.claudeApplyRollback === true, terminalReason(invocation, result));
        dropInvocationPatch(invocation);
        return authorization;
      });
    }
    const output = result.output;
    const succeeded = output.applied === true;
    if (metadata.claudeApplyRollback === true) {
      return runTx(() => {
        recordRollbackOutcome({ invocation, authorization, output, succeeded, resultSummary: result.summary });
        dropInvocationPatch(invocation);
        return authorization;
      });
    }
    return runTx(() => {
      authorization.status = succeeded ? "applied" : "failed";
      authorization.applied = succeeded;
      authorization.appliedFiles = normalizeAppliedFiles(output.appliedFiles);
      authorization.verification = normalizeVerification(output.verification);
      authorization.rollback = succeeded ? normalizeRollback(output.rollback) : null;
      authorization.resultSummary = stringOrNull(output.summary ?? result.summary);
      authorization.appliedAt = now();
      // #1052: the apply run no longer verifies in-line — dispatch the deferred
      // verify now, inside the SAME transaction as the applied status, so a crash
      // can never leave "applied" durable without its verify row (or its loud
      // unverified marker). The bridge lane is already free: this run is terminal.
      if (succeeded && authorization.verifyCommandId) {
        dispatchDeferredVerify(invocation, authorization);
      }
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
      return authorization;
    });
  }

  // Deny bypasses the completion runtime entirely (approval.mjs sets status
  // "rejected" without calling completeInvocation), so the completion hook above
  // never runs for a denied apply/rollback. This is the reconcile path for that
  // (and any other) result-less termination, called from onInvocationDenied.
  function reconcileClaudeApplyTermination(invocation) {
    const authorization = findAuthorization(invocation);
    if (!authorization) return null;
    // #1052: a verify leg that terminated without a result (deny/timeout/reclaim)
    // resolves to "applied, unverified" — the apply status is never touched.
    if (invocation?.options?.metadata?.claudeApplyVerify === true) {
      return runTx(() => {
        markUnverified(authorization, invocation.id, terminalReason(invocation, invocation?.result ?? null));
        return authorization;
      });
    }
    return runTx(() => {
      reconcileTerminated(
        authorization,
        invocation?.options?.metadata?.claudeApplyRollback === true,
        terminalReason(invocation, invocation?.result ?? null),
      );
      dropInvocationPatch(invocation);
      return authorization;
    });
  }

  // #1052: create the verify leg. Runs inside the caller's transaction. On any
  // missing prerequisite (no runner, dispatch deps unwired) the verification is
  // marked "unverified" LOUDLY — an applied-but-unverified patch with rollback
  // guidance beats a silent skip that reads as verified.
  function dispatchDeferredVerify(applyInvocation, authorization) {
    const runner = typeof findApplyRunner === "function" ? findApplyRunner() : null;
    if (!runner || typeof createInvocation !== "function") {
      markUnverified(authorization, applyInvocation.id, "no governed runner available to execute the deferred verification");
      return;
    }
    const verifyInvocation = createInvocation(
      `Verify an applied Claude patch (authorization ${authorization.id}) with ${authorization.verifyCommandId}.`,
      runner,
      {
        requestedBy: authorization.requestedBy ?? null,
        metadata: {
          tool: "claude.apply.patch",
          claudeApplyAuthorizationId: authorization.id,
          // Routes this run to the verify fold and tells the bridge to inject
          // --verify-only instead of a patch file.
          claudeApplyVerify: true,
          verifyCommandId: authorization.verifyCommandId,
          projectId: authorization.projectId ?? null,
          worktreeId: authorization.worktreeId ?? null,
        },
        timeoutSeconds: 180,
      },
    );
    authorization.verifyInvocationId = verifyInvocation.id;
    authorization.verification = { ...(authorization.verification ?? {}), state: "pending", verifyCommand: authorization.verifyCommandId };
    appendEvent({
      invocationId: verifyInvocation.id,
      type: "claude_apply_verify_dispatched",
      level: "info",
      message: `Dispatched deferred verification (${authorization.verifyCommandId}) for authorization ${authorization.id}; the apply lane is already free.`,
      data: { claudeApplyAuthorizationId: authorization.id, verifyInvocationId: verifyInvocation.id, verifyCommandId: authorization.verifyCommandId },
    });
    if (typeof startInvocationIfAllowed === "function") {
      startInvocationIfAllowed(verifyInvocation, runner);
    }
  }

  // #1052: fold the verify leg's outcome. Only verification changes — the applied
  // status and the rollback guidance are untouched whatever the verdict. A
  // result-less or malformed terminal reads "unverified", never "verified".
  function recordVerifyOutcome({ invocation, result, authorization }) {
    const verification = result?.output?.verifyOnly === true ? result.output.verification : null;
    if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
      markUnverified(authorization, invocation.id, terminalReason(invocation, result));
      return;
    }
    const passed = verification.testsPassed === true;
    authorization.verification = {
      ...normalizeVerification({ checkPassed: authorization.verification?.checkPassed ?? true, ...verification }),
      state: passed ? "passed" : "failed",
    };
    appendEvent({
      invocationId: invocation.id,
      type: passed ? "claude_apply_verified" : "claude_apply_verify_failed",
      level: passed ? "info" : "warn",
      message: passed
        ? `Deferred verification passed for authorization ${authorization.id}.`
        : `Deferred verification FAILED for authorization ${authorization.id}; the patch stays applied and the governed rollback remains available.`,
      data: { claudeApplyAuthorizationId: authorization.id, verifyInvocationId: invocation.id, testsPassed: passed },
    });
  }

  function markUnverified(authorization, invocationId, reason) {
    // Idempotent: a verdict that already landed must not be downgraded by a late
    // reconcile of the same run.
    if (["passed", "failed"].includes(authorization.verification?.state)) return;
    authorization.verification = { ...(authorization.verification ?? {}), state: "unverified", error: stringOrNull(reason) };
    appendEvent({
      invocationId,
      type: "claude_apply_unverified",
      level: "warning",
      message: `Authorization ${authorization.id} is applied but UNVERIFIED (${reason}); review manually or use the governed rollback.`,
      data: { claudeApplyAuthorizationId: authorization.id, reason: stringOrNull(reason) },
    });
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
