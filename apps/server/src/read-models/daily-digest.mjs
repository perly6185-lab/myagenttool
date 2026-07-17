// The daily digest — "what happened today, where do we stand, what needs a
// nudge" in one derived object. It is PURE over the same team-scoped locals the
// Status board (work-board.mjs) already consumes, so it inherits tenancy and
// stays unit-testable, and it REUSES the computed board for the standing counts
// so the digest and the board can never disagree.
//
// Everything here is derivable from a single state snapshot — no event-log
// archaeology. "Finished today" leans on an auto-run's updatedAt (its last
// transition stamp): for a terminal run (done/failed) that is when it finished,
// a documented proxy that needs no separate completion log. A future increment
// that wants exact per-transition timing can join the event stream; this stays
// honest about being snapshot-derived.

const HOUR_MS = 60 * 60 * 1000;
const AGING_THRESHOLD_MS = 24 * HOUR_MS; // a decision/run older than a day wants a nudge
const ATTENTION_LIMIT = 5; // top-N per attention list — the digest is a nudge, not a dump

const STATE_LABELS = {
  pending_decision: "待决策 Pending decision",
  in_progress: "正在做 In progress",
  waiting: "在等待 Waiting",
  done: "已做完 Done",
  failed: "已失败 Failed",
  follow_up: "要跟进 Follow-up",
};

function inWindow(iso, windowStart, now) {
  if (!iso) return false;
  const ms = Date.parse(iso);
  return !Number.isNaN(ms) && ms >= windowStart && ms <= now;
}

function ageHours(iso, now) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round(((now - ms) / HOUR_MS) * 10) / 10);
}

// A stamped date label for the window (UTC — deterministic and test-stable; the
// caller decides the window bounds, which is where any local-day choice lives).
function dateLabel(windowStart) {
  return new Date(windowStart).toISOString().slice(0, 10);
}

/**
 * @param {object} sources
 * @param {{states: Record<string, {count:number, items: object[]}>}} sources.board - workBoard() output (reused for standing)
 * @param {Array<object>} [sources.autoRuns]
 * @param {Array<object>} [sources.refusals]
 * @param {number} sources.windowStart - epoch ms, start of the reporting day
 * @param {number} [sources.now] - epoch ms, end of the window (default Date.now())
 * @returns {object} the structured digest + a pre-rendered markdown report
 */
export function dailyDigest({ board, autoRuns = [], refusals = [], windowStart, now = Date.now() } = {}) {
  const states = board?.states ?? {};
  const standing = Object.fromEntries(
    Object.entries(STATE_LABELS).map(([key]) => [key, states[key]?.count ?? 0]),
  );

  // Today's flow, from raw auto-runs/refusals stamped within the window.
  let opened = 0;
  let completed = 0;
  let failed = 0;
  for (const run of autoRuns) {
    if (inWindow(run?.createdAt, windowStart, now)) opened += 1;
    const finishedAt = run?.updatedAt ?? run?.createdAt ?? null;
    if (run?.status === "done" && inWindow(finishedAt, windowStart, now)) completed += 1;
    if (run?.status === "failed" && inWindow(finishedAt, windowStart, now)) failed += 1;
  }

  const refusalsByCategory = {};
  let refusalsToday = 0;
  for (const r of refusals) {
    if (!inWindow(r?.at, windowStart, now)) continue;
    refusalsToday += 1;
    const cat = r?.category ?? "unknown";
    refusalsByCategory[cat] = (refusalsByCategory[cat] ?? 0) + 1;
  }

  // Needs-attention lists, drawn from the board's own items so the digest never
  // re-derives lens membership. Oldest-first: the stalest item is the nudge.
  const agingFrom = (items) =>
    (items ?? [])
      .map((i) => ({ id: i.id, title: i.title, section: i.section, targetId: i.targetId ?? null, ageHours: ageHours(i.updatedAt, now) }))
      .filter((i) => i.ageHours != null && i.ageHours * HOUR_MS >= AGING_THRESHOLD_MS)
      .sort((a, b) => b.ageHours - a.ageHours)
      .slice(0, ATTENTION_LIMIT);

  const attention = {
    agingDecisions: agingFrom(states.pending_decision?.items),
    stuckRuns: agingFrom(states.waiting?.items),
  };

  const digest = {
    date: dateLabel(windowStart),
    windowStart,
    now,
    standing,
    flow: { opened, completed, failed, refusals: refusalsToday, refusalsByCategory },
    attention,
  };
  return { ...digest, markdown: renderDigestMarkdown(digest) };
}

/** Render the structured digest as a copy-pasteable / channel-postable report. */
export function renderDigestMarkdown(digest) {
  const { date, standing, flow, attention } = digest;
  const lines = [];
  lines.push(`# Work digest — ${date}`);
  lines.push("");
  lines.push("**Today's flow**");
  lines.push(`- Opened: ${flow.opened} · Completed: ${flow.completed} · Failed: ${flow.failed}`);
  const refCats = Object.entries(flow.refusalsByCategory).map(([c, n]) => `${c} ${n}`).join(", ");
  lines.push(`- Refusals: ${flow.refusals}${refCats ? ` (${refCats})` : ""}`);
  lines.push("");
  lines.push("**Standing now**");
  for (const [key, label] of Object.entries(STATE_LABELS)) {
    lines.push(`- ${label}: ${standing[key] ?? 0}`);
  }
  if (attention.agingDecisions.length || attention.stuckRuns.length) {
    lines.push("");
    lines.push("**Needs attention (>24h)**");
    for (const d of attention.agingDecisions) lines.push(`- Decision aging ${d.ageHours}h — ${d.title}`);
    for (const s of attention.stuckRuns) lines.push(`- Run stuck ${s.ageHours}h — ${s.title}`);
  }
  return lines.join("\n");
}
