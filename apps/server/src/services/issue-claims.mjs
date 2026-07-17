import { LOCAL_TEAM_ID, LOCAL_USER_ID, teamOf } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

// Issue claims (#1143): an issue-level develop lease so multiple humans and
// agents sharing one backlog cannot start duplicate work on the same issue.
// Modeled on the two lease/hold patterns already in the codebase:
// - budget reservations (#890.1): a synchronous check-then-write admission hold
//   — Node is single-threaded, so a read+write done in ONE tick (no await
//   between) is atomic under the #890.3 single-writer process lock;
// - the invocation dispatch lease: leaseExpiresAt + expiry reclaim, so a claim
//   whose holder walks away returns to the pool without operator action.
// claimIssue() is the single write chokepoint: every claim row is created or
// renewed here and nowhere else. `develop` claims are mutually exclusive per
// (projectId, issueNumber); `review` claims coexist with anything (a reviewer
// is not a second developer). Reading an issue is never gated.

const CLAIM_MODES = new Set(["develop", "review"]);
const DEFAULT_TTL_MINUTES = 24 * 60;

export function createIssueClaimService({ state, now, nextId, appendEvent, persistStateSoon, store, mirrorAssignee }) {
  const runTx = makeRunTx({ store, persistStateSoon });

  // #1152: durable claim history. The global event log is a 500-row ring buffer
  // — under multi-user load a claim's audit trail churns out of it in minutes.
  // Every lifecycle transition (claimed/released/expired) also lands here, in a
  // dedicated persisted collection with its own bound, so "who held #42 and
  // when" survives both buffer churn and restart. Compact rows, not full events.
  function recordClaimHistory(claim, type, { actorId = null } = {}) {
    const row = {
      id: nextId("iche"),
      claimId: claim.id,
      projectId: claim.projectId,
      issueNumber: claim.issueNumber,
      type,
      mode: claim.mode,
      claimedBy: claim.claimedBy,
      actorId: actorId ?? claim.claimedBy,
      autoRunId: claim.autoRunId ?? null,
      outcome: claim.outcome ?? null,
      at: now(),
    };
    (state.issueClaimEvents ??= []).unshift(row);
    if (state.issueClaimEvents.length > 1000) state.issueClaimEvents = state.issueClaimEvents.slice(0, 1000);
    return row;
  }

  // #1150: best-effort GitHub assignee mirror — ownership taken in the console
  // shows up for people who only look at GitHub. Fire-and-forget: a slow or
  // failed gh call never blocks or fails the claim; the LOCAL claim record is
  // the authoritative (mutually exclusive) signal, the assignee is a mirror.
  // Only develop claims mirror — a reviewer is not the issue's owner.
  function maybeMirrorAssignee(claim, action) {
    if (typeof mirrorAssignee !== "function" || claim?.mode !== "develop") return;
    Promise.resolve(mirrorAssignee({ projectId: claim.projectId, issueNumber: claim.issueNumber, action })).catch(() => {});
  }

  function claimTtlMinutes() {
    const configured = Number(state.autoRunSettings?.issueClaimTtlMinutes ?? 0);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTL_MINUTES;
  }

  function isExpired(claim, nowIso) {
    return Boolean(claim?.leaseExpiresAt) && Date.parse(claim.leaseExpiresAt) <= Date.parse(nowIso);
  }

  // Lazy expiry: callers see expired leases as inactive the moment they look,
  // and the sweep marks them settled (with an event) so the history is honest.
  // No timer to wire — every admission path sweeps the rows it inspects.
  function sweepExpiredClaims(nowIso = now()) {
    let expired = 0;
    for (const claim of state.issueClaims ?? []) {
      if (claim.status !== "active" || !isExpired(claim, nowIso)) continue;
      runTx(() => {
        claim.status = "expired";
        claim.outcome = "lease_expired";
        claim.updatedAt = nowIso;
        appendEvent({
          invocationId: null,
          type: "issue_claim_expired",
          level: "info",
          message: `Issue claim ${claim.id} on #${claim.issueNumber} expired; the issue is back in the pool.`,
          data: { claimId: claim.id, projectId: claim.projectId, issueNumber: claim.issueNumber, claimedBy: claim.claimedBy },
        });
        recordClaimHistory(claim, "expired");
      });
      maybeMirrorAssignee(claim, "remove");
      expired += 1;
    }
    return expired;
  }

  function activeClaimsForIssue(projectId, issueNumber, nowIso = now()) {
    return (state.issueClaims ?? []).filter(
      (claim) =>
        claim.status === "active" &&
        claim.projectId === projectId &&
        claim.issueNumber === issueNumber &&
        !isExpired(claim, nowIso),
    );
  }

  // Keep the collection bounded: every active lease + a recent settled tail for
  // evidence. Active leases are never dropped (they gate admission).
  function capIssueClaims(limitSettled = 200) {
    const rows = state.issueClaims ?? [];
    const active = rows.filter((row) => row?.status === "active");
    const settled = rows.filter((row) => row?.status !== "active").slice(0, limitSettled);
    state.issueClaims = [...active, ...settled];
  }

  /**
   * Atomically claim an issue for development or review. Synchronous by design:
   * the foreign-claim check and the row write happen in one tick, so two
   * concurrent claimers admit exactly one. Returns `{ok:true, claim}` (renewing
   * the lease when the same user re-claims), or `{ok:false, reason, claim}` when
   * another user holds an active develop claim. Never gates reads.
   */
  function claimIssue({ projectId, issueNumber, actor, mode = "develop", agentId = null, autoRunId = null } = {}) {
    const number = Number(issueNumber);
    if (!projectId || !Number.isFinite(number)) {
      return { ok: false, reason: "A projectId and a numeric issueNumber are required to claim an issue." };
    }
    if (!CLAIM_MODES.has(mode)) {
      return { ok: false, reason: `Unknown claim mode "${mode}" (develop | review).` };
    }
    const nowIso = now();
    sweepExpiredClaims(nowIso);
    const userId = actor?.userId ?? LOCAL_USER_ID;
    const active = activeClaimsForIssue(projectId, number, nowIso);

    if (mode === "develop") {
      const foreign = active.find((claim) => claim.mode === "develop" && claim.claimedBy !== userId);
      if (foreign) {
        return {
          ok: false,
          reason: `Issue #${number} is already claimed for development by ${foreign.claimedBy} (until ${foreign.leaseExpiresAt}).`,
          claim: foreign,
        };
      }
    }

    const leaseExpiresAt = new Date(Date.parse(nowIso) + claimTtlMinutes() * 60_000).toISOString();
    const own = active.find((claim) => claim.mode === mode && claim.claimedBy === userId);
    if (own) {
      // Re-claim by the holder renews the lease and re-attaches the run that now
      // works under it (a retry after a failed admission must point at the NEW
      // run, or its settle would never release) — idempotent, never a second row.
      runTx(() => {
        own.leaseExpiresAt = leaseExpiresAt;
        own.updatedAt = nowIso;
        if (autoRunId) own.autoRunId = autoRunId;
        if (agentId) own.agentId = agentId;
      });
      return { ok: true, claim: own, renewed: true };
    }

    const project = (state.projects ?? []).find((item) => item.id === projectId) ?? null;
    const claim = {
      id: nextId("icl"),
      projectId,
      issueNumber: number,
      mode,
      claimedBy: userId,
      teamId: project ? teamOf(project) : LOCAL_TEAM_ID,
      agentId,
      autoRunId,
      status: "active",
      leaseExpiresAt,
      outcome: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    runTx(() => {
      (state.issueClaims ??= []).unshift(claim);
      capIssueClaims();
      appendEvent({
        invocationId: null,
        type: "issue_claimed",
        level: "info",
        message: `Issue #${number} claimed for ${mode} by ${userId}.`,
        data: { claimId: claim.id, projectId, issueNumber: number, mode, claimedBy: userId, autoRunId },
      });
      recordClaimHistory(claim, "claimed");
    });
    maybeMirrorAssignee(claim, "add");
    return { ok: true, claim, renewed: false };
  }

  function releaseIssueClaim(claimId, { outcome = "released", actor = null } = {}) {
    const claim = (state.issueClaims ?? []).find((item) => item.id === claimId);
    if (!claim || claim.status !== "active") return false; // idempotent
    return runTx(() => {
      claim.status = "released";
      claim.outcome = outcome;
      // #1152: who handed it back lives on the ROW, not only in the ring-buffer
      // event (an auto-run settle releases on the holder's behalf).
      claim.releasedBy = actor?.userId ?? claim.claimedBy;
      claim.updatedAt = now();
      appendEvent({
        invocationId: null,
        type: "issue_claim_released",
        level: "info",
        message: `Issue claim ${claim.id} on #${claim.issueNumber} released (${outcome}).`,
        data: {
          claimId: claim.id,
          projectId: claim.projectId,
          issueNumber: claim.issueNumber,
          claimedBy: claim.claimedBy,
          releasedBy: claim.releasedBy,
          outcome,
        },
      });
      recordClaimHistory(claim, "released", { actorId: claim.releasedBy });
      maybeMirrorAssignee(claim, "remove");
      return true;
    });
  }

  // Settle hook: an auto-run that finishes (merged, blocked, failed, …) hands
  // its issue back — called from the same place budget reservations release.
  function releaseClaimsForAutoRun(autoRunId, { outcome = "committed" } = {}) {
    if (!autoRunId) return 0;
    let released = 0;
    for (const claim of [...(state.issueClaims ?? [])]) {
      if (claim.autoRunId === autoRunId && claim.status === "active") {
        if (releaseIssueClaim(claim.id, { outcome })) released += 1;
      }
    }
    return released;
  }

  function listIssueClaims({ projectId = null, includeSettled = false } = {}) {
    sweepExpiredClaims();
    return (state.issueClaims ?? []).filter(
      (claim) => (projectId == null || claim.projectId === projectId) && (includeSettled || claim.status === "active"),
    );
  }

  return {
    claimIssue,
    releaseIssueClaim,
    releaseClaimsForAutoRun,
    listIssueClaims,
    activeClaimsForIssue,
    sweepExpiredClaims,
  };
}

// Pure helper for auto-trigger candidate selection: is this issue held by an
// unexpired active claim? (Any active claim defers auto-trigger — a human
// developing OR reviewing an issue should not race an unattended agent run.)
export function issueHasActiveClaim({ issueClaims = [], projectId, issueNumber, nowIso }) {
  const cutoff = Date.parse(nowIso ?? new Date().toISOString());
  return issueClaims.some(
    (claim) =>
      claim?.status === "active" &&
      claim.projectId === projectId &&
      claim.issueNumber === issueNumber &&
      (!claim.leaseExpiresAt || Date.parse(claim.leaseExpiresAt) > cutoff),
  );
}
