import { reapRunTranscriptRecord } from "./run-transcripts.mjs";
import { scrubPii } from "./round-telemetry.mjs";

/*
 * ADR 0018 — per-subject deletion of observability data. A targeted, on-demand
 * extension of the retention chokepoint: it ERASES content for a subject
 * (team | user | device), but never deletes the SHIELDED evidence
 * (ledger / lifecycle audit / refusals / audit summaries) — those are retained
 * of record. Owner-gated at the caller; the engine here is idempotent and never
 * throws. Every run leaves one `observability_data_deleted` audit event.
 */

// The shielded set — never deleted by any tier. Mirrors retention.mjs's shields.
export const SHIELDED_COLLECTIONS = ["ledgerEntries", "lifecycleAuditRecords", "refusals", "auditSummaries"];

export const deletionScopes = ["team", "user", "device"];
export const deletionTiers = ["operational", "full"];

// ADR 0018 invariant 6: owner-gated. Deletion is irreversible, so only an owner
// or admin may invoke it — an operator/viewer is refused.
export function canDeleteObservabilityData(actor) {
  return actor?.role === "owner" || actor?.role === "admin";
}

/**
 * The invocationIds that belong to a subject.
 *  - device: invocations run by an agent located on that device.
 *  - user:   invocations that user requested.
 *  - team:   invocations on a project the team owns.
 */
export function resolveSubjectInvocationIds(state, { scope, subjectId }) {
  const ids = new Set();
  if (!subjectId) return ids;
  const invocations = state.invocations ?? [];
  if (scope === "user") {
    for (const inv of invocations) if (inv.requestedBy === subjectId) ids.add(inv.id);
    return ids;
  }
  if (scope === "device") {
    const agentIds = new Set(
      (state.agents ?? []).filter((a) => a?.location?.deviceId === subjectId).map((a) => a.id),
    );
    for (const inv of invocations) if (agentIds.has(inv.agentId)) ids.add(inv.id);
    return ids;
  }
  if (scope === "team") {
    const projectIds = new Set(
      (state.projects ?? []).filter((p) => p?.ownerTeamId === subjectId).map((p) => p.id),
    );
    for (const inv of invocations) {
      const projectId = inv.projectId ?? inv.input?.metadata?.projectId ?? null;
      if (projectId && projectIds.has(projectId)) ids.add(inv.id);
    }
    return ids;
  }
  return ids;
}

// The team that owns an invocation, via its project. Null when there is no
// project link (an orphan invocation cannot be attributed to a team).
function invocationTeam(state, invocation) {
  const projectId = invocation.projectId ?? invocation.input?.metadata?.projectId ?? null;
  if (!projectId) return null;
  const project = (state.projects ?? []).find((p) => p.id === projectId);
  return project?.ownerTeamId ?? null;
}

/**
 * Delete a subject's observability data. Idempotent (re-nulling an already-empty
 * digest is a no-op). `operational` erases content; `full` additionally removes
 * the subject's events/traces/spans. The shielded set is never touched. Emits one
 * audit event whose counts equal the rows changed.
 *
 * TENANCY (security): a SCOPED actor (authenticated, with a teamId) may only ever
 * delete its OWN team's data — role alone is not enough, because every team has
 * its own owner. The resolved invocation set is intersected with the actor's team,
 * so a foreign subjectId (any scope) resolves to nothing and touches no other
 * team's data. `actor == null` is unscoped single-team local dev and is unfiltered.
 */
export function deleteObservabilityData(state, { scope, subjectId, tier = "operational", now, appendEvent, actor = null }) {
  const resolvedTier = deletionTiers.includes(tier) ? tier : "operational";
  const ids = resolveSubjectInvocationIds(state, { scope, subjectId });
  if (actor && actor.teamId) {
    for (const invocation of state.invocations ?? []) {
      if (ids.has(invocation.id) && invocationTeam(state, invocation) !== actor.teamId) {
        ids.delete(invocation.id);
      }
    }
  }
  const counts = { digests: 0, transcripts: 0, patches: 0, shieldedPiiRedacted: 0, events: 0, traces: 0, spans: 0 };

  // --- operational: erase CONTENT in place, keep the skeleton ---
  for (const round of state.invocationRounds ?? []) {
    if (!ids.has(round.invocationId)) continue;
    if (typeof round.requestDigest === "string") { round.requestDigest = null; counts.digests += 1; }
    if (typeof round.responseDigest === "string") { round.responseDigest = null; counts.digests += 1; }
  }
  for (const tool of state.toolInvocationRecords ?? []) {
    if (!ids.has(tool.invocationId)) continue;
    if (typeof tool.inputDigest === "string") { tool.inputDigest = null; counts.digests += 1; }
    if (typeof tool.outputDigest === "string") { tool.outputDigest = null; counts.digests += 1; }
  }
  for (const record of state.runTranscripts ?? []) {
    if (!ids.has(record.invocationId)) continue;
    if (reapRunTranscriptRecord(record, { now })) counts.transcripts += 1;
  }
  for (const inv of state.invocations ?? []) {
    if (!ids.has(inv.id)) continue;
    const output = inv.result?.output;
    if (output && typeof output.patch === "string") {
      delete output.patch;
      delete output.patchTruncated;
      output.patchRedacted = true;
      output.patchRedactedAt = now();
      counts.patches += 1;
    }
  }

  // --- shielded evidence: RETAIN of-record, but scrub the subject's PII ---
  // ADR 0018 invariant 4: refusals are never deleted (compliance/audit), but
  // their verbatim free text (summary / evidence values / remedy) can carry the
  // subject's PII. For refusals tied to the subject's (team-filtered) invocations,
  // scrub PII in place and mark the row — the record and its taxonomy survive,
  // minus the PII, so a Right-to-Erasure request is honoured without dropping
  // evidence. Runs in BOTH tiers. Idempotent (already-scrubbed text does not
  // re-match). The ledger and audit summaries are id/amount-keyed, not free PII,
  // so they are not in scope here.
  for (const refusal of state.refusals ?? []) {
    if (!refusal || !ids.has(refusal.invocationId)) continue;
    let scrubbed = false;
    for (const field of ["summary", "remedy"]) {
      if (typeof refusal[field] === "string") {
        const next = scrubPii(refusal[field]);
        if (next !== refusal[field]) { refusal[field] = next; scrubbed = true; }
      }
    }
    if (refusal.evidence && typeof refusal.evidence === "object") {
      for (const [key, value] of Object.entries(refusal.evidence)) {
        if (typeof value === "string") {
          const next = scrubPii(value);
          if (next !== value) { refusal.evidence[key] = next; scrubbed = true; }
        }
      }
    }
    if (scrubbed) {
      if (!refusal.piiRedacted) { refusal.piiRedacted = true; refusal.piiRedactedAt = now(); }
      counts.shieldedPiiRedacted += 1;
    }
  }

  // --- full: additionally remove the subject's telemetry rows ---
  if (resolvedTier === "full") {
    const traceIds = new Set((state.traces ?? []).filter((t) => ids.has(t.subjectId)).map((t) => t.id));
    if (Array.isArray(state.spans)) {
      const before = state.spans.length;
      state.spans = state.spans.filter((s) => !traceIds.has(s.traceId));
      counts.spans = before - state.spans.length;
    }
    if (Array.isArray(state.traces)) {
      const before = state.traces.length;
      state.traces = state.traces.filter((t) => !ids.has(t.subjectId));
      counts.traces = before - state.traces.length;
    }
    if (Array.isArray(state.events)) {
      const before = state.events.length;
      state.events = state.events.filter((e) => !ids.has(e.invocationId));
      counts.events = before - state.events.length;
    }
  }

  // The shielded set is intentionally NOT touched here (ledger/audit/refusals/
  // audit summaries) — retained of record. A future PII-redaction of shielded
  // rows would go here; deletion of a shielded row never does.

  // Audit the deletion itself. invocationId:null so a SUBSEQUENT `full` deletion
  // for the same subject cannot erase this proof (it is not subject-scoped).
  if (typeof appendEvent === "function") {
    appendEvent({
      invocationId: null,
      type: "observability_data_deleted",
      level: "info",
      message: `Deleted ${resolvedTier} observability data for ${scope} ${subjectId} (${ids.size} invocation(s)).`,
      // An irreversible action records WHO ran it (the deleting actor's user id).
      data: { scope, subjectId, tier: resolvedTier, invocationCount: ids.size, counts, deletedBy: actor?.userId ?? null },
    });
  }

  return { tier: resolvedTier, invocationCount: ids.size, counts };
}
