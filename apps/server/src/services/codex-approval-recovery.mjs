// A Codex broker timeout is a terminal decision for the original invocation,
// but it must not turn a later explicit approval into a no-op.  This service
// records the late approval and resumes the linked auto-run on its existing
// worktree once the original invocation has settled.
import { makeRunTx } from "../runtime/store/run-tx.mjs";

export function createCodexApprovalRecoveryService({
  state,
  now,
  appendEvent,
  persistStateSoon,
  store,
  findInvocation,
  retryAutoRun,
} = {}) {
  const STARTING_LEASE_MS = 30_000;
  const runTx = makeRunTx({ store, persistStateSoon });
  const activeRecoveryRequestIds = new Set();
  const settledAutoRunStatuses = new Set([
    "pr_open",
    "report_posted",
    "needs_input",
    "plan_proposed",
    "decomposed",
    "blocked",
    "done",
    "failed",
    "cancelled",
  ]);
  const stamp = () => (typeof now === "function" ? now() : new Date().toISOString());
  // Mutations above each call are synchronous; commit them through the shared
  // transaction writer so a recovery state transition cannot bypass durable
  // Store accounting.
  const persist = () => runTx(() => undefined);

  function publicRecovery(request) {
    const recovery = request?.lateApprovalRecovery ?? null;
    if (!recovery) return null;
    return {
      status: recovery.status,
      autoRunId: recovery.autoRunId ?? null,
      sourceInvocationId: recovery.sourceInvocationId ?? null,
      resumedInvocationId: recovery.resumedInvocationId ?? null,
      requestedAt: recovery.requestedAt ?? null,
      resumedAt: recovery.resumedAt ?? null,
      error: recovery.error ?? null,
    };
  }

  function sourceAutoRun(request) {
    const recoveryId = request?.lateApprovalRecovery?.autoRunId ?? null;
    if (recoveryId) {
      return (state.autoRuns ?? []).find((run) => run.id === recoveryId) ?? null;
    }
    return (state.autoRuns ?? []).find((run) => run.invocationId === request?.invocationId) ?? null;
  }

  function invocationFor(id) {
    if (!id) return null;
    return typeof findInvocation === "function"
      ? findInvocation(id)
      : (state.invocations ?? []).find((row) => row.id === id) ?? null;
  }

  function reconcileStrandedStart(request, { force = false } = {}) {
    const recovery = request?.lateApprovalRecovery;
    if (recovery?.status !== "starting") return "continue";
    if (activeRecoveryRequestIds.has(request.id)) return "wait";

    const autoRun = sourceAutoRun(request);
    const target = invocationFor(recovery.targetInvocationId);
    if (target && autoRun?.invocationId === target.id) {
      recovery.status = "resumed";
      recovery.resumedInvocationId = target.id;
      recovery.resumedAt ??= stamp();
      recovery.error = null;
      persist();
      return "settled";
    }

    const startedAtMs = Date.parse(recovery.startedAt ?? "");
    const leaseExpired = !Number.isFinite(startedAtMs)
      || Date.parse(stamp()) - startedAtMs >= STARTING_LEASE_MS;
    if (!force && !leaseExpired) return "wait";

    if (target) {
      // An exact recovery invocation exists but is not bound to the auto-run.
      // Never create a second one automatically; surface the inconsistency for
      // inspection instead of risking duplicate side effects.
      recovery.status = "unavailable";
      recovery.error = "A recovery invocation exists but is no longer bound to the linked auto-run.";
      persist();
      return "settled";
    }

    recovery.status = "requested";
    recovery.startedAt = null;
    recovery.claimToken = null;
    recovery.targetInvocationId = null;
    recovery.error = null;
    persist();
    return "continue";
  }

  function recordLateApproval(request, actor) {
    if (!request || request.status !== "timed_out") {
      throw new Error("Only a timed-out Codex approval can be recovered.");
    }
    const existing = request.lateApprovalRecovery;
    if (existing && !["failed", "unavailable"].includes(existing.status)) {
      return existing;
    }
    const autoRun = sourceAutoRun(request);
    const at = stamp();
    request.lateApprovalRecovery = {
      status: autoRun ? "requested" : "unavailable",
      autoRunId: autoRun?.id ?? null,
      sourceInvocationId: request.invocationId ?? null,
      requestedAt: at,
      requestedBy: actor?.userId ?? "usr_local",
      resumedInvocationId: null,
      resumedAt: null,
      error: autoRun ? null : "The expired approval is not linked to a recoverable auto-run.",
    };
    request.updatedAt = at;
    persist();
    if (typeof appendEvent === "function") {
      appendEvent({
        invocationId: request.invocationId ?? null,
        type: "codex_approval_granted",
        level: autoRun ? "info" : "warn",
        message: autoRun
          ? "Late Codex approval recorded; the auto-run will resume on its existing worktree."
          : "Late Codex approval recorded, but no linked auto-run can be resumed.",
        data: {
          approvalBrokerRequestId: request.id,
          decision: "allow_after_timeout",
          lateApproval: true,
          autoRunId: autoRun?.id ?? null,
        },
      });
    }
    return request.lateApprovalRecovery;
  }

  async function continueRecovery(request) {
    const recovery = request?.lateApprovalRecovery;
    if (!recovery || ["resumed", "unavailable"].includes(recovery.status)) {
      return publicRecovery(request);
    }
    if (recovery.status === "starting") {
      const reconciled = reconcileStrandedStart(request);
      if (reconciled !== "continue") return publicRecovery(request);
    }
    const autoRun = sourceAutoRun(request);
    if (!autoRun) {
      recovery.status = "unavailable";
      recovery.error = "The linked auto-run no longer exists.";
      persist();
      return publicRecovery(request);
    }
    if (!["failed", "blocked"].includes(autoRun.status)) {
      const sourceInvocation = typeof findInvocation === "function"
        ? findInvocation(recovery.sourceInvocationId)
        : (state.invocations ?? []).find((row) => row.id === recovery.sourceInvocationId);
      if (settledAutoRunStatuses.has(autoRun.status)) {
        recovery.status = "unavailable";
        recovery.error = `The linked auto-run already settled as ${autoRun.status} and is not retryable.`;
      } else {
        // The bridge can settle the invocation just before the auto-run reaction
        // updates its own status. Keep waiting in that small window; the
        // completion hook calls this service again after the reaction.
        recovery.status = "waiting_for_terminal";
      }
      persist();
      return publicRecovery(request);
    }

    // Claim synchronously before awaiting retryAutoRun. Node's event loop can
    // otherwise let the approval route and invocation-completion hook both
    // create a recovery invocation.
    recovery.status = "starting";
    recovery.startedAt = stamp();
    recovery.attempt = Number(recovery.attempt ?? 0) + 1;
    recovery.claimToken = `${request.id}:${recovery.attempt}:${recovery.startedAt}`;
    recovery.error = null;
    persist();
    activeRecoveryRequestIds.add(request.id);
    try {
      const result = await retryAutoRun(autoRun.id, {
        actor: { userId: recovery.requestedBy ?? "usr_local" },
        approvalRecoveryRequestId: request.id,
        approvalRecoveryClaimToken: recovery.claimToken,
      });
      recovery.status = "resumed";
      recovery.resumedInvocationId = result?.invocation?.id ?? null;
      recovery.resumedAt = stamp();
      recovery.error = null;
    } catch (error) {
      recovery.status = "failed";
      recovery.error = String(error?.message ?? error);
    } finally {
      activeRecoveryRequestIds.delete(request.id);
    }
    persist();
    return publicRecovery(request);
  }

  async function recoverTimedOutApproval(request, actor = null) {
    recordLateApproval(request, actor);
    return continueRecovery(request);
  }

  async function resumeForSettledInvocation(invocation) {
    const requests = (state.codexApprovalBrokerRequests ?? []).filter((request) =>
      request.invocationId === invocation?.id
      && ["requested", "waiting_for_terminal"].includes(request.lateApprovalRecovery?.status));
    for (const request of requests) {
      await continueRecovery(request);
    }
  }

  async function reconcilePendingRecoveries() {
    const requests = (state.codexApprovalBrokerRequests ?? []).filter((request) =>
      ["requested", "waiting_for_terminal", "starting"].includes(request.lateApprovalRecovery?.status));
    for (const request of requests) {
      if (request.lateApprovalRecovery?.status === "starting") {
        reconcileStrandedStart(request, { force: true });
      }
      if (["requested", "waiting_for_terminal"].includes(request.lateApprovalRecovery?.status)) {
        await continueRecovery(request);
      }
    }
  }

  return {
    recoverTimedOutApproval,
    resumeForSettledInvocation,
    reconcilePendingRecoveries,
  };
}
