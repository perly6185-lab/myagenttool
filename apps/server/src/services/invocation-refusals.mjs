/*
 * Read surface for an invocation's refusals, INCLUDING the ones the 200-row cap
 * evicted to the durable archive (slice 1). Merges the live snapshot with the
 * archived rows for this invocation, dedupes by id, newest-first. Refusals per
 * invocation are few (a handful), so this is a bounded list, not a paginated
 * cursor walk like the events surface. Mirrors invocation-events.mjs.
 */

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export function createInvocationRefusalService({ state, readArchiveWithMetadata }) {
  function listInvocationRefusals(invocation, { limit = DEFAULT_LIMIT } = {}) {
    const cap = clampLimit(limit);
    const archive = typeof readArchiveWithMetadata === "function"
      ? readArchiveWithMetadata("refusals", { filter: (row) => row?.invocationId === invocation.id })
      : { entries: [], malformedLines: 0, readError: null };

    let invalidArchivedRows = 0;
    const byId = new Map();
    for (const entry of archive.entries ?? []) {
      const refusal = entry?.row;
      if (!isInvocationRefusal(refusal, invocation.id)) {
        invalidArchivedRows += 1;
        continue;
      }
      // readArchiveWithMetadata returns newest archive writes first; keep the
      // first copy if a crash appended the same evicted row twice.
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
      // or a torn/unreadable archive line.
      truncated: all.length > cap
        || Number(archive.malformedLines ?? 0) > 0
        || Boolean(archive.readError)
        || invalidArchivedRows > 0,
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
