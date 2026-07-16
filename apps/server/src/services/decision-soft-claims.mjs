import { LOCAL_TEAM_ID, LOCAL_USER_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

// Decision soft-claims (#1151): an ADVISORY "X is handling this" marker on a
// pendingDecisions queue row, so two operators looking at the same Approvals
// queue don't both start working the same item. Deliberately soft: it never
// gates the decision itself (decisions are quick; a hard lock would strand rows
// behind a distracted claimer). The hard guarantee lives downstream — every
// decision path is idempotent and reports alreadyDecided on a lost race.
//
// Keyed by the pendingDecisions row id ("<kind>:<record id>", stable — see
// read-models/pending-decisions.mjs). Claims expire on a short lease; expiry is
// lazy (filtered on read, marked on the next write) so no timer is needed.

const DEFAULT_TTL_MINUTES = 15;
const SETTLED_TAIL = 100;

export function createDecisionSoftClaimService({ state, now, nextId, persistStateSoon, store }) {
  const runTx = makeRunTx({ store, persistStateSoon });

  function ttlMinutes() {
    const configured = Number(state.autoRunSettings?.decisionClaimTtlMinutes ?? 0);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTL_MINUTES;
  }

  function isActive(claim, nowIso) {
    return claim?.status === "active" && (!claim.expiresAt || Date.parse(claim.expiresAt) > Date.parse(nowIso));
  }

  function activeClaimFor(decisionId, nowIso = now()) {
    return (state.decisionSoftClaims ?? []).find((claim) => claim.decisionId === decisionId && isActive(claim, nowIso)) ?? null;
  }

  // Bounded collection: every active marker + a small settled tail. Also the
  // lazy-expiry write: any active row past its lease is marked expired here.
  function compactClaims(nowIso) {
    const rows = state.decisionSoftClaims ?? [];
    for (const row of rows) {
      if (row.status === "active" && row.expiresAt && Date.parse(row.expiresAt) <= Date.parse(nowIso)) {
        row.status = "expired";
        row.updatedAt = nowIso;
      }
    }
    const active = rows.filter((row) => row.status === "active");
    const settled = rows.filter((row) => row.status !== "active").slice(0, SETTLED_TAIL);
    state.decisionSoftClaims = [...active, ...settled];
  }

  /**
   * Mark a pending decision as "being handled by me". Advisory: a marker held by
   * someone else returns `{ok:false, claim}` so the UI can show the holder, but
   * nothing downstream enforces it. Re-claiming your own marker renews the lease.
   */
  function claimDecision({ decisionId, actor } = {}) {
    const id = String(decisionId ?? "").trim();
    if (!id) return { ok: false, reason: "A decisionId is required." };
    const nowIso = now();
    const userId = actor?.userId ?? LOCAL_USER_ID;
    const existing = activeClaimFor(id, nowIso);
    const expiresAt = new Date(Date.parse(nowIso) + ttlMinutes() * 60_000).toISOString();
    if (existing && existing.claimedBy !== userId) {
      return { ok: false, reason: `Already being handled by ${existing.claimedBy}.`, claim: existing };
    }
    if (existing) {
      runTx(() => {
        existing.expiresAt = expiresAt;
        existing.updatedAt = nowIso;
      });
      return { ok: true, claim: existing, renewed: true };
    }
    const claim = {
      id: nextId("dsc"),
      decisionId: id,
      claimedBy: userId,
      teamId: actor?.teamId ?? LOCAL_TEAM_ID,
      status: "active",
      expiresAt,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    runTx(() => {
      (state.decisionSoftClaims ??= []).unshift(claim);
      compactClaims(nowIso);
    });
    return { ok: true, claim, renewed: false };
  }

  // Hand the marker back (idempotent). Holder-only — anyone else's stale marker
  // simply expires on its own short lease.
  function releaseDecisionClaim({ decisionId, actor } = {}) {
    const nowIso = now();
    const claim = activeClaimFor(String(decisionId ?? "").trim(), nowIso);
    const userId = actor?.userId ?? LOCAL_USER_ID;
    if (!claim || claim.claimedBy !== userId) return false;
    return runTx(() => {
      claim.status = "released";
      claim.updatedAt = nowIso;
      return true;
    });
  }

  // The read model's source: active, unexpired markers only (visibility scoping
  // is the caller's job — read-models/state.mjs filters by the viewer's team).
  function activeDecisionClaims(nowIso = now()) {
    return (state.decisionSoftClaims ?? []).filter((claim) => isActive(claim, nowIso));
  }

  return { claimDecision, releaseDecisionClaim, activeDecisionClaims, activeClaimFor };
}
