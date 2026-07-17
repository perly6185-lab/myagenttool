/*
 * Read surface for an invocation's refusals, INCLUDING the ones the 200-row cap
 * evicted to the durable archive (slice 1). Merges the live snapshot with the
 * archived rows for this invocation, dedupes by id, newest-first. Refusals per
 * invocation are few (a handful), so this is a bounded list, not a paginated
 * cursor walk like the events surface. Mirrors invocation-events.mjs.
 */

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export function createInvocationRefusalService({ state, readArchiveWithMetadata, queryHistory }) {
  // Archived refusals for one invocation. Prefers the indexed store query
  // (ADR 0019 B-2) — paginated, no whole-file scan — falling back to the JSONL
  // archive read. Returns the rows plus whether the recovered history may be
  // incomplete (more pages, or a torn/unreadable JSONL line).
  function archivedRefusals(invocationId, cap) {
    if (typeof queryHistory === "function") {
      const page = queryHistory("refusals", { invocationId, limit: cap });
      return { rows: page.rows ?? [], damaged: false, more: page.nextBefore != null };
    }
    const archive = typeof readArchiveWithMetadata === "function"
      ? readArchiveWithMetadata("refusals", { filter: (row) => row?.invocationId === invocationId })
      : { entries: [], malformedLines: 0, readError: null };
    return {
      rows: (archive.entries ?? []).map((entry) => entry?.row),
      damaged: Number(archive.malformedLines ?? 0) > 0 || Boolean(archive.readError),
      more: false,
    };
  }

  function listInvocationRefusals(invocation, { limit = DEFAULT_LIMIT } = {}) {
    const cap = clampLimit(limit);
    const archived = archivedRefusals(invocation.id, cap);

    let invalidArchivedRows = 0;
    const byId = new Map();
    for (const refusal of archived.rows) {
      if (!isInvocationRefusal(refusal, invocation.id)) {
        invalidArchivedRows += 1;
        continue;
      }
      // Newest archive write first; keep the first copy if a crash appended the
      // same evicted row twice.
      if (!byId.has(refusal.id)) byId.set(refusal.id, refusal);
    }
    for (const refusal of state.refusals ?? []) {
      if (!isInvocationRefusal(refusal, invocation.id)) continue;
      // The live snapshot is canonical while a row straddles hot storage and the
      // archive after a crash (and carries any post-hoc PII scrub, #1206).
      byId.set(refusal.id, refusal);
    }

    const all = [...byId.values()].sort(compareRefusals);
    return {
      invocationId: invocation.id,
      refusals: all.slice(0, cap).map(publicRefusal),
      // The caller learns the recovered history may be incomplete: over the cap,
      // more archived pages exist, or a torn/unreadable archive line.
      truncated: all.length > cap || archived.more || archived.damaged || invalidArchivedRows > 0,
    };
  }

  return { listInvocationRefusals };
}

function clampLimit(limit) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, parsed);
}

function isInvocationRefusal(refusal, invocationId) {
  return Boolean(refusal)
    && typeof refusal === "object"
    && typeof refusal.id === "string"
    && refusal.id.length > 0
    && refusal.invocationId === invocationId
    && typeof refusal.category === "string";
}

// Newest-first by timestamp; a stable id tie-break keeps a batch's own order.
function compareRefusals(left, right) {
  const byTime = String(right.at ?? "").localeCompare(String(left.at ?? ""));
  if (byTime !== 0) return byTime;
  return String(right.id).localeCompare(String(left.id));
}

function publicRefusal(refusal) {
  return {
    id: refusal.id,
    invocationId: refusal.invocationId,
    at: refusal.at,
    category: refusal.category,
    code: refusal.code,
    decidedBy: refusal.decidedBy ?? null,
    requester: refusal.requester ?? null,
    subject: refusal.subject ?? null,
    summary: refusal.summary ?? "",
    evidence: refusal.evidence ?? {},
    remedy: refusal.remedy ?? "",
    retryAfter: refusal.retryAfter ?? null,
    appealTo: refusal.appealTo ?? null,
    piiRedacted: refusal.piiRedacted === true,
  };
}
