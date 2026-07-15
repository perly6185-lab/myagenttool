import { createHash, randomBytes } from "node:crypto";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

// Approval grants (docs/design/APPROVAL_GRANTS.md): server-issued, single-use,
// action-scoped tokens behind the `approvalToken` request field. NOT
// cryptographic auth — tenancy/session stay the authorization boundary; grants
// add what the old intent marker never had: intent-binding, single-use, expiry,
// and a decision record. Phase 1 is dual-accept: unknown non-empty tokens still
// pass as `legacy_token`, stamped in the audit trail and counted, so nothing
// breaks while callers migrate.

const GRANT_TTL_MS = 10 * 60 * 1000; // a confirm-click artifact, not a work queue
const MAX_GRANTS = 200;

function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function isSystemActor(actor) {
  return typeof actor?.userId === "string" && actor.userId.startsWith("system");
}

export function createApprovalGrantService({ state, now, nextId, appendEvent, persistStateSoon, archiveEvicted = null, store }) {
  const runTx = makeRunTx({ store, persistStateSoon });
  function pruneGrants(reference) {
    // Consumed grants are audit records and expired ones prove an approval was
    // once minted — neither may vanish silently. Everything the in-memory cap
    // drops goes to the on-disk archive first.
    const kept = [];
    const evicted = [];
    for (const grant of state.approvalGrants ?? []) {
      (grant.consumedAt || Date.parse(grant.expiresAt) > reference ? kept : evicted).push(grant);
    }
    evicted.push(...kept.slice(MAX_GRANTS));
    if (evicted.length) archiveEvicted?.("approvalGrants", evicted);
    state.approvalGrants = kept.slice(0, MAX_GRANTS);
  }

  /**
   * Mint a grant for one (action, target). Human actors only — the autonomy
   * policy ("autonomy never crosses an approval gate") would be hollow if a
   * system actor could mint its own approvals. Broker decisions use
   * mintDecisionGrant instead, which records WHICH decision authorized it.
   */
  function issueApprovalGrant({ action, targetId } = {}, actor = null) {
    if (isSystemActor(actor)) {
      return { ok: false, status: 403, body: { error: "system_actor_cannot_issue_grants" } };
    }
    const normalizedAction = String(action ?? "").trim();
    const normalizedTarget = String(targetId ?? "").trim();
    if (!normalizedAction || !normalizedTarget) {
      return { ok: false, status: 400, body: { error: "invalid_grant_request", message: "action and targetId are required." } };
    }
    const issuedAt = now();
    pruneGrants(Date.parse(issuedAt));
    const token = randomBytes(16).toString("hex");
    const grant = {
      id: nextId("apg"),
      tokenHash: hashToken(token),
      action: normalizedAction,
      targetId: normalizedTarget,
      issuedBy: actor?.userId ?? "usr_local",
      teamId: actor?.teamId ?? null,
      sourceDecisionId: null,
      issuedAt,
      expiresAt: new Date(Date.parse(issuedAt) + GRANT_TTL_MS).toISOString(),
      consumedAt: null,
      consumedBy: null,
    };
    runTx(() => state.approvalGrants.unshift(grant));
    return { ok: true, status: 201, body: { grantId: grant.id, token, action: grant.action, targetId: grant.targetId, expiresAt: grant.expiresAt } };
  }

  /** Grant minted BY a recorded human decision (e.g. a broker approve) — the
   * audit chain reads decision → grant → execution, no magic strings. Returns
   * the raw token for the internal executor to consume. */
  function mintDecisionGrant({ action, targetId, sourceDecisionId, decidedBy = null, teamId = null }) {
    const issuedAt = now();
    pruneGrants(Date.parse(issuedAt));
    const token = randomBytes(16).toString("hex");
    runTx(() => state.approvalGrants.unshift({
      id: nextId("apg"),
      tokenHash: hashToken(token),
      action: String(action),
      targetId: String(targetId),
      issuedBy: decidedBy ?? "usr_local",
      teamId,
      sourceDecisionId: sourceDecisionId ?? null,
      issuedAt,
      expiresAt: new Date(Date.parse(issuedAt) + GRANT_TTL_MS).toISOString(),
      consumedAt: null,
      consumedBy: null,
    }));
    return token;
  }

  /**
   * The dual-accept validator behind every `approvalToken` field.
   * Grant tokens are matched by hash and consumed (single-use); any other
   * non-empty string passes as legacy in phase 1, stamped and counted.
   */
  function validateApprovalToken(token, { action, targetId, actor = null, allowLegacy = true } = {}) {
    const raw = String(token ?? "").trim();
    if (!raw) return { approved: false, mode: null, reason: "missing_token" };
    const tokenHash = hashToken(raw);
    const grant = (state.approvalGrants ?? []).find((item) => item.tokenHash === tokenHash);
    if (grant) {
      const at = now();
      if (grant.consumedAt) return { approved: false, mode: "grant", reason: "grant_already_consumed", grantId: grant.id };
      if (Date.parse(grant.expiresAt) <= Date.parse(at)) return { approved: false, mode: "grant", reason: "grant_expired", grantId: grant.id };
      if (grant.action !== String(action ?? "").trim()) return { approved: false, mode: "grant", reason: "grant_action_mismatch", grantId: grant.id };
      if (grant.targetId !== String(targetId ?? "").trim()) return { approved: false, mode: "grant", reason: "grant_target_mismatch", grantId: grant.id };
      if ((grant.teamId ?? null) !== (actor?.teamId ?? null)) return { approved: false, mode: "grant", reason: "grant_team_mismatch", grantId: grant.id };
      return runTx(() => {
        grant.consumedAt = at;
        grant.consumedBy = actor?.userId ?? "usr_local";
        appendEvent({
          invocationId: null,
          type: "approval_grant_consumed",
          level: "info",
          message: `Approval grant ${grant.id} consumed for ${grant.action} on ${grant.targetId}.`,
          data: { grantId: grant.id, action: grant.action, targetId: grant.targetId, issuedBy: grant.issuedBy, consumedBy: grant.consumedBy, sourceDecisionId: grant.sourceDecisionId },
        });
        return { approved: true, mode: "grant", grantId: grant.id };
      });
    }
    // Gates that never accepted arbitrary free text (e.g. the recovery bypass's
    // historical operator-approved prefix) opt out of the legacy fallback —
    // rejected without stamping the counter, since nothing was accepted.
    if (!allowLegacy) {
      return { approved: false, mode: null, reason: "grant_required" };
    }
    // Phase 2 strict mode (operator-flipped once the legacy counter flatlines):
    // free text no longer passes anywhere.
    if (state.autoRunSettings?.requireIssuedApprovals) {
      return { approved: false, mode: null, reason: "grant_required_strict" };
    }
    // Phase 1 legacy path: honest about what actually gated the action.
    return runTx(() => {
      state.approvalTokenLegacyUses = {
        count: (state.approvalTokenLegacyUses?.count ?? 0) + 1,
        lastAt: now(),
      };
      appendEvent({
        invocationId: null,
        type: "approval_token_legacy_used",
        level: "warn",
        message: `Legacy free-text approvalToken accepted for ${action ?? "unknown"} on ${targetId ?? "unknown"} — migrate this caller to issued grants.`,
        data: { action: action ?? null, targetId: targetId ?? null, actorId: actor?.userId ?? null },
      });
      return { approved: true, mode: "legacy" };
    });
  }

  return { issueApprovalGrant, mintDecisionGrant, validateApprovalToken };
}
