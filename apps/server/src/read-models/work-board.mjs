// The Status board — one place that answers "what's 要跟进 / 在等待 / 正在做 /
// 已做完 / 待决策 / 已失败" across the surfaces that each speak their own status
// vocabulary (auto-runs, the pending-decision queue, refusals). It is PURE over
// the already-tenancy-scoped read-model locals it is handed, so it inherits
// scoping for free and stays unit-testable.
//
// The grain is the AUTO-RUN — the issue → worktree → PR work item. Standalone
// invocations live in the Invocations ledger and are intentionally out of scope
// here (they are steps, not tracked work items). The six lenses:
//
//   pending_decision  待决策 — the full pendingDecisions queue (auto-run gates +
//                     approvals + compare promotions + lifecycle …). The single
//                     source of truth for "awaiting a human decision", reused
//                     verbatim so this board never re-derives gate logic.
//   in_progress       正在做 — an auto-run actively executing.
//   waiting           在等待 — an auto-run parked but NOT on a queued decision
//                     (blocked, needs-input-without-a-gate, a rejected plan that
//                     never advanced). These need a nudge, not an approve/deny.
//   done              已做完 — a terminal success.
//   failed            已失败 — a terminal failure.
//   follow_up         要跟进 — a CROSS-CUTTING attention list, NOT a sixth
//                     exclusive bucket: failed auto-runs, recent device refusals,
//                     and durable due Local Issue follow-up reminders. It overlaps
//                     `failed` by design; the count is the size of the attention
//                     queue, ordered most-recent first.

// Auto-run statuses that mean the run is actively moving (autoRunStates in
// services/auto-run.mjs). plan_proposed/report_posted/pr_open are deliberately
// NOT here — they are parked states resolved below by the pending-decision
// cross-reference (a live gate → pending_decision) or fall through to `waiting`.
const IN_PROGRESS_STATES = new Set(["materializing", "running", "verifying", "publishing", "decomposed"]);
const WAITING_STATES = new Set(["waiting_capacity", "blocked", "needs_input", "awaiting_approval", "plan_proposed", "report_posted"]);

const FOLLOW_UP_REFUSAL_WINDOW_MS = 48 * 60 * 60 * 1000;

function truncate(text, max = 80) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function autoRunContext(run) {
  const link = run?.link;
  if (link?.number) return truncate(`#${link.number}${link.title ? ` ${link.title}` : ""}`);
  return truncate(run?.name ?? run?.id ?? "auto-run");
}

function autoRunStamp(run) {
  return run?.updatedAt ?? run?.createdAt ?? null;
}

// Coarse lifecycle bucket for a single auto-run, BEFORE the pending-decision
// override. A pr_open run resolves by its PR state: merged/closed → done, still
// open → parked (waiting, unless a live merge gate lifts it to pending_decision).
function baseState(run) {
  const status = run?.status;
  if (status === "done") return "done";
  if (status === "failed") return "failed";
  // `cancelled` is a terminal, operator-settled status — it must NOT fall through
  // to `waiting`, or a killed run would nag forever as a stuck/aging item. It is
  // finished (no action needed), so it sits in the done lens like any terminal.
  if (status === "cancelled") return "done";
  if (status === "pr_open") {
    const prState = run?.prState;
    return prState === "MERGED" || prState === "CLOSED" ? "done" : "waiting";
  }
  if (IN_PROGRESS_STATES.has(status)) return "in_progress";
  if (WAITING_STATES.has(status)) return "waiting";
  // Unknown/unmapped status: treat as parked rather than silently dropping it.
  return "waiting";
}

function autoRunItem(run, state, schedule = null) {
  return {
    id: `autorun:${run?.id}`,
    state,
    kind: "auto_run",
    title: autoRunContext(run),
    subtitle: truncate([run?.status ? String(run.status).replaceAll("_", " ") : null, run?.summary].filter(Boolean).join(" · ")),
    section: "autoRuns",
    targetId: run?.id ?? null,
    workItemId: run?.localIssueId ?? null,
    projectId: run?.projectId ?? null,
    updatedAt: autoRunStamp(run),
    scheduleKey: `autorun:${run?.id}`,
    plannedDate: schedule?.plannedDate ?? null,
    schedulePlanSource: schedule?.schedulePlanSource ?? null,
    scheduleReason: schedule?.scheduleReason ?? null,
    scheduleOrder: Number.isFinite(schedule?.scheduleOrder) ? schedule.scheduleOrder : null,
  };
}

// Newest-activity first within a lens (deterministic id tiebreak) — the freshest
// item is the one a supervisor most likely wants at the top, and a stable order
// keeps the board from jumping between refreshes.
function byNewest(a, b) {
  const at = a.updatedAt ?? "";
  const bt = b.updatedAt ?? "";
  if (at !== bt) return at < bt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * @param {object} sources - already team-scoped read-model locals
 * @param {Array<object>} [sources.autoRuns]
 * @param {Array<object>} [sources.pendingDecisions] - the computed queue (reused verbatim)
 * @param {Array<object>} [sources.refusals]
 * @param {Array<object>} [sources.followUpReminders] - due, team-scoped Local Issue reminders
 * @param {number} [sources.now] - epoch ms, for the refusal attention window (injectable for tests)
 * @returns {{ generatedAt: number, states: Record<string, {count: number, items: object[]}> }}
 */
export function workBoard({
  autoRuns = [],
  pendingDecisions = [],
  refusals = [],
  followUpReminders = [],
  schedules = [],
  now = Date.now(),
} = {}) {
  // Any auto-run with a live gate is represented by its pendingDecisions row, so
  // exclude it from the lifecycle buckets — otherwise the same run would show as
  // both "待决策" and "正在做".
  const gatedAutoRunIds = new Set(
    pendingDecisions.map((d) => d?.ref?.autoRunId).filter(Boolean),
  );

  const buckets = {
    pending_decision: [],
    in_progress: [],
    waiting: [],
    done: [],
    failed: [],
    follow_up: [],
  };
  const scheduleByAutoRunId = new Map(schedules
    .filter((schedule) => schedule?.kind === "auto_run" && schedule.targetId)
    .map((schedule) => [schedule.targetId, schedule]));
  const workItemByAutoRunId = new Map(autoRuns
    .filter((run) => run?.id && run?.localIssueId)
    .map((run) => [run.id, run.localIssueId]));

  // 待决策 — the queue verbatim (already oldest-first from pendingDecisions; we
  // re-sort newest-first below like every other lens for a consistent board).
  for (const d of pendingDecisions) {
    buckets.pending_decision.push({
      id: d.id,
      state: "pending_decision",
      kind: d.kind,
      title: d.title,
      subtitle: d.subtitle ?? "",
      section: d.section,
      targetId: d.targetId ?? null,
      workItemId: d?.ref?.autoRunId ? workItemByAutoRunId.get(d.ref.autoRunId) ?? null : null,
      projectId: d.projectId ?? null,
      updatedAt: d.createdAt ?? null,
      scheduleKey: d?.ref?.autoRunId ? `autorun:${d.ref.autoRunId}` : null,
      plannedDate: scheduleByAutoRunId.get(d?.ref?.autoRunId)?.plannedDate ?? null,
      schedulePlanSource: scheduleByAutoRunId.get(d?.ref?.autoRunId)?.schedulePlanSource ?? null,
      scheduleReason: scheduleByAutoRunId.get(d?.ref?.autoRunId)?.scheduleReason ?? null,
      scheduleOrder: scheduleByAutoRunId.get(d?.ref?.autoRunId)?.scheduleOrder ?? null,
    });
  }

  // Lifecycle buckets over the un-gated auto-runs.
  for (const run of autoRuns) {
    if (gatedAutoRunIds.has(run?.id)) continue;
    const state = baseState(run);
    const schedule = scheduleByAutoRunId.get(run.id) ?? null;
    buckets[state].push(autoRunItem(run, state, schedule));
    // 要跟进 attention rollup: a failed run is a loose end even after it is
    // terminal, so it also lands here (overlaps `failed` by design).
    if (state === "failed") {
      buckets.follow_up.push({ ...autoRunItem(run, "failed", schedule), state: "follow_up", reason: "failed run — triage or retry" });
    }
  }

  // 要跟进 — recent device refusals a person should see. No resolution flag
  // exists on a refusal (it is a terminal audit record), so a rolling window is
  // the honest signal: only vetoes from the last 48h surface as attention.
  for (const r of refusals) {
    const at = r?.at ? Date.parse(r.at) : NaN;
    if (Number.isNaN(at) || now - at > FOLLOW_UP_REFUSAL_WINDOW_MS) continue;
    buckets.follow_up.push({
      id: `refusal:${r.id}`,
      state: "follow_up",
      kind: "refusal",
      title: truncate(r.summary || `${r.category}/${r.code}`),
      subtitle: truncate([r.category, r.code].filter(Boolean).join("/")),
      section: "evidence",
      targetId: r.invocationId ?? null,
      projectId: null,
      updatedAt: r.at ?? null,
      reason: "device refusal — review the veto",
    });
  }

  // Due Local Issue follow-ups are durable reminders, projected as a bounded
  // attention row. The reminder id is stable across refreshes and its owner
  // surface remains the Local Issue; this board never becomes a second editor.
  for (const reminder of followUpReminders.filter((row) => row?.status === "due")) {
    buckets.follow_up.push({
      id: `followup:${reminder.id}`,
      state: "follow_up",
      kind: "work_item_follow_up_reminder",
      title: truncate(reminder.workItemTitle || reminder.localRef || reminder.workItemId),
      subtitle: truncate(`Follow-up due · ${reminder.localRef ?? reminder.workItemId}`),
      section: "task",
      targetId: reminder.workItemId,
      projectId: reminder.projectId ?? null,
      updatedAt: reminder.scheduledFor ?? reminder.createdAt ?? null,
      reason: "scheduled stakeholder follow-up is due",
    });
  }

  const states = {};
  for (const [key, items] of Object.entries(buckets)) {
    items.sort(byNewest);
    states[key] = { count: items.length, items };
  }
  return { generatedAt: now, states };
}
