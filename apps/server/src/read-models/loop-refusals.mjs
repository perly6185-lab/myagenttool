import { refusalEventCatalog } from "@myagenttool/protocol";

import { readLoopRegistry, readLoopEvents } from "../../../../tools/ai/src/loop/registry.mjs";

// Refusal model (#758) Tier-2: loop promotion refusals live in tools/ai's own
// per-run events.jsonl and never reach the server's state.refusals[]. This
// read-model surfaces them (read-only, best-effort) so the console refusal lens
// can answer "what did this device refuse?" across BOTH sources — merged in the
// view, not written into server state. Served lazily on GET /api/loop-refusals so
// /api/state stays cheap.
//
// Bounded on purpose: only the most-recently-updated runs are scanned, and the
// result is capped — a full-history scan would read every run's JSONL on request.
// `truncatedRuns` tells the caller when older runs were skipped (no silent cap).

const CATALOG = new Map(refusalEventCatalog.map((entry) => [entry.eventType, entry]));
const LOOP_REFUSAL_RE = /_refused$|_blocked$/;
const DEFAULT_MAX_RUNS = 40;
const DEFAULT_MAX_REFUSALS = 200;

/**
 * Map one loop event to a Refusal row, or null if it is not a taxonomy-mapped
 * refusal event. Pure — no filesystem — so it is unit-testable.
 */
export function mapLoopRefusalEvent(event, { runId: fallbackRunId = null, updatedAt = null } = {}) {
  const type = String(event?.type ?? "");
  if (!LOOP_REFUSAL_RE.test(type)) return null;
  const mapped = CATALOG.get(type);
  if (!mapped) return null;
  const runId = event.runId ?? fallbackRunId ?? null;
  return {
    id: event.id ?? `${runId}-${type}`,
    at: event.createdAt ?? updatedAt ?? null,
    subject: { kind: "worktree_action", id: runId },
    requester: { kind: "automation", id: runId },
    category: mapped.category,
    code: mapped.code,
    decidedBy: {
      kind: mapped.category === "human" ? "user" : "policy_engine",
      id: event.data?.approval ?? "promotion_gate",
    },
    summary: event.message || `${type} on ${runId}`,
    evidence: event.data && typeof event.data === "object" && !Array.isArray(event.data) ? event.data : {},
    remedy: "Resolve the promotion blocker in the loop run, then re-request promotion.",
    retryAfter: null,
    appealTo: "device_owner",
    source: "loop",
    runId,
  };
}

export function loopRefusalReadModel({ maxRuns = DEFAULT_MAX_RUNS, maxRefusals = DEFAULT_MAX_REFUSALS } = {}) {
  let runs;
  try {
    runs = readLoopRegistry().runs ?? [];
  } catch {
    return { refusals: [], scannedRuns: 0, totalRuns: 0, truncatedRuns: false };
  }
  const recent = [...runs]
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .slice(0, maxRuns);

  const refusals = [];
  for (const entry of recent) {
    let events;
    try {
      events = readLoopEvents(entry);
    } catch {
      continue; // a missing/torn event log for one run never breaks the lens
    }
    for (const event of events) {
      const row = mapLoopRefusalEvent(event, { runId: entry.runId, updatedAt: entry.updatedAt });
      if (row) refusals.push(row);
    }
  }
  refusals.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  return {
    refusals: refusals.slice(0, maxRefusals),
    scannedRuns: recent.length,
    totalRuns: runs.length,
    truncatedRuns: runs.length > recent.length,
  };
}
