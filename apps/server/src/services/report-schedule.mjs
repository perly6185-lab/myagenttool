// Scheduled push of the work report to a channel — turns the Status report from
// pull (open the console) to push (it arrives in WeCom daily/weekly). A best-
// effort server sweep (mirrors sweepAutoRunSloAlerts) checks "is a post due?" on
// a slow tick and, when due, enqueues the pre-rendered markdown through the
// existing durable channel-delivery pipeline.
//
// Constraints baked in from the channel model:
//   • Outbound targets a conversation's externalUserId (a WeCom `touser`), NOT a
//     group/room — so a schedule posts to one user who has DM'd the bot. There is
//     no broadcast primitive today.
//   • enqueueChannelDelivery caps content at 2048 chars, so a long report is
//     chunked into multiple deliveries.
//   • Dedupe is per PERIOD, not per tick: a due schedule that already posted this
//     period window is skipped, and nextRunAt always rolls forward.

import { workBoard } from "../read-models/work-board.mjs";
import { pendingDecisions } from "../read-models/pending-decisions.mjs";
import { workReport, calendarPeriods, periodSpec } from "../read-models/work-report.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const PERIOD_KEYS = new Set(["day", "week", "month", "quarter"]);
const COVERAGES = new Set(["previous", "current"]);
const CADENCES = new Set(["daily", "weekly"]);
// Byte budget per chunk — WeCom's text cap is 2048 BYTES (a Chinese char is 3),
// so chunk by encoded length, not char count, or a Chinese report is truncated.
const CONTENT_BYTE_LIMIT = 1900; // margin under 2048 for the provider envelope
const utf8Len = (s) => Buffer.byteLength(s, "utf8");

export function createDefaultReportSchedule() {
  return {
    enabled: false,
    channelId: null,
    conversationId: null,
    periodKey: "day",
    // "previous" = the just-CLOSED period (yesterday / last week …) — what a
    // scheduled push should summarize. "current" = period-to-date (near-empty
    // right after the period rolls over).
    coverage: "previous",
    cadence: "daily",
    weekday: 1, // 0=Sun..6=Sat; used when cadence === "weekly" (1 = Monday)
    time: "09:00", // HH:MM, server LOCAL time (mirrors the automation scheduler)
    nextRunAt: null,
    lastPostedStartDate: null,
    lastPostedAt: null,
    updatedAt: null,
  };
}

function clampInt(v, lo, hi, fallback) {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback;
}

function normalizeTime(v, fallback) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(v ?? ""));
  return m ? `${String(m[1]).padStart(2, "0")}:${m[2]}` : fallback;
}

/**
 * The next fire time (ISO) at or after `fromIso`, at the configured local HH:MM,
 * on the cadence. Local-time semantics match the automation scheduler.
 */
export function computeReportNextRun(fromIso, cfg) {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return null;
  const [hh, mm] = normalizeTime(cfg.time, "09:00").split(":").map(Number);
  const at = new Date(from);
  at.setHours(hh, mm, 0, 0);
  if (cfg.cadence === "weekly") {
    const weekday = clampInt(cfg.weekday, 0, 6, 1);
    const delta = (weekday - at.getDay() + 7) % 7;
    at.setDate(at.getDate() + delta);
    if (at.getTime() <= from.getTime()) at.setDate(at.getDate() + 7);
  } else if (at.getTime() <= from.getTime()) {
    at.setDate(at.getDate() + 1);
  }
  return at.toISOString();
}

/** Split a report body into ≤byteLimit (UTF-8) chunks on line boundaries — so a
 * Chinese report is chunked losslessly to fit WeCom's byte cap, not truncated. */
export function chunkContent(text, byteLimit = CONTENT_BYTE_LIMIT) {
  const s = String(text ?? "");
  if (utf8Len(s) <= byteLimit) return [s];
  const chunks = [];
  let cur = "";
  const flush = () => { if (cur) { chunks.push(cur); cur = ""; } };
  for (const line of s.split("\n")) {
    // A single over-long line is hard-split on code-point boundaries by bytes.
    if (utf8Len(line) > byteLimit) {
      flush();
      let piece = "";
      for (const ch of line) {
        if (utf8Len(piece) + utf8Len(ch) > byteLimit) { chunks.push(piece); piece = ch; }
        else piece += ch;
      }
      cur = piece; // carry the remainder to merge with following lines
      continue;
    }
    if (utf8Len(cur ? `${cur}\n${line}` : line) > byteLimit) { flush(); cur = line; }
    else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// Assemble the GLOBAL (unscoped) work report from raw state — the sweep has no
// viewer, so it uses the full data and refusalsAvailable:true. Mirrors the
// pipeline buildPublicState runs per-viewer.
export function assembleGlobalWorkReport(state, nowMs, periods = calendarPeriods(nowMs)) {
  const autoRuns = state.autoRuns ?? [];
  const pd = pendingDecisions({
    approvalRequests: state.approvalRequests ?? [],
    autoRuns,
    compareRuns: state.compareRuns ?? [],
    codexApprovalBrokerRequests: state.codexApprovalBrokerRequests ?? [],
    lifecycleLocalApprovals: state.lifecycleLocalApprovals ?? [],
    lifecycleRollbackRequests: state.lifecycleRollbackRequests ?? [],
    applicationRecoveryActions: state.applicationRecoveryActions ?? [],
    applicationsById: new Map((state.applications ?? []).map((a) => [a.id, a])),
    invocationsById: new Map((state.invocations ?? []).map((i) => [i.id, i])),
    decisionSoftClaims: state.decisionSoftClaims ?? [],
  });
  const board = workBoard({ autoRuns, pendingDecisions: pd, refusals: state.refusals ?? [], now: nowMs });
  return workReport({
    board,
    autoRuns,
    refusalDailyStats: state.refusalDailyStats ?? [],
    refusalStatsSince: state.refusalStatsMeta?.since ?? null,
    refusalsAvailable: true,
    periods,
    now: nowMs,
  });
}

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {() => string} deps.now - ISO clock
 * @param {(args:{channelId:string,conversationId:string,content:string}) => object} deps.enqueueChannelDelivery
 * @param {() => void} [deps.persistStateSoon]
 * @param {(event:object) => void} [deps.appendEvent]
 */
export function createReportScheduleRuntime({ state, now, enqueueChannelDelivery, persistStateSoon = () => {}, store, appendEvent = () => {} }) {
  if (!state.reportSchedule) state.reportSchedule = createDefaultReportSchedule();
  // Durable writes go through the Store's unit-of-work (#1001), not a bare persist.
  const runTx = makeRunTx({ store, persistStateSoon });

  // Enqueue the given period's report to the configured channel. Dedupe-aware
  // unless `force` (the manual "post now"). Never throws — a bad channel/config
  // is returned as a reason, so the sweep tick and the route stay safe.
  function post(cfg, { force = false } = {}) {
    if (!cfg.channelId || !cfg.conversationId) return { posted: false, reason: "no_target" };
    let period;
    try {
      const nowIso = now();
      const nowMs = Date.parse(nowIso);
      // Build ONLY the configured period at the configured coverage — a scheduled
      // push defaults to the just-closed period ("previous"), not the near-empty
      // period-to-date.
      const spec = periodSpec(nowMs, cfg.periodKey, cfg.coverage ?? "previous");
      const report = spec ? assembleGlobalWorkReport(state, nowMs, [spec]) : null;
      period = report?.periods?.[cfg.periodKey];
      if (!period) return { posted: false, reason: "no_report" };
      if (!force && cfg.lastPostedStartDate === period.startDate) return { posted: false, reason: "already_posted" };
      const chunks = chunkContent(period.markdown);
      // enqueueChannelDelivery returns {ok:false} (does NOT throw) on a stale/
      // mismatched target — honor it, or we would mark the period posted with
      // nothing queued and dedupe would suppress it forever.
      const results = chunks.map((content) => enqueueChannelDelivery({ channelId: cfg.channelId, conversationId: cfg.conversationId, content }));
      const okCount = results.filter((r) => r?.ok).length;
      if (okCount === 0) return { posted: false, reason: results[0]?.reason ?? "enqueue_failed" };
      cfg.lastPostedStartDate = period.startDate;
      cfg.lastPostedAt = nowIso;
      appendEvent({
        invocationId: null,
        type: "work_report_posted",
        level: "info",
        message: `Posted the ${period.label} work report to channel ${cfg.channelId}.`,
        data: { channelId: cfg.channelId, periodKey: cfg.periodKey, startDate: period.startDate, chunks: okCount, ofChunks: chunks.length },
      });
      return { posted: true, chunks: okCount, startDate: period.startDate, label: period.label };
    } catch (error) {
      // Never throw: a malformed-state assemble error must not propagate and
      // stall the sweep's nextRunAt roll-forward (which would busy-loop).
      return { posted: false, reason: "error", error: String(error?.message ?? error) };
    }
  }

  // Slow-tick sweep: post when the schedule is due, then always roll nextRunAt
  // forward so neither a skip nor a failure busy-loops. The mutation + enqueue
  // commit atomically through runTx.
  function sweepReportSchedule() {
    const cfg = state.reportSchedule;
    if (!cfg?.enabled || !cfg.channelId || !cfg.conversationId) return { posted: false, reason: "disabled" };
    const nowIso = now();
    if (!cfg.nextRunAt || Date.parse(nowIso) < Date.parse(cfg.nextRunAt)) return { posted: false, reason: "not_due" };
    return runTx(() => {
      const result = post(cfg);
      // A due post that didn't land (stale target, assemble error) is skipped to
      // the next period — surface it so a persistently-broken schedule is visible
      // instead of silently dropping every report. "already_posted" is not a fault.
      if (!result.posted && result.reason !== "already_posted") {
        appendEvent({
          invocationId: null,
          type: "work_report_post_failed",
          level: "warn",
          message: `Scheduled work report was not posted (${result.reason}).`,
          data: { channelId: cfg.channelId, periodKey: cfg.periodKey, reason: result.reason },
        });
      }
      cfg.nextRunAt = computeReportNextRun(nowIso, cfg);
      cfg.updatedAt = nowIso;
      return result;
    });
  }

  // Manual "post now" — ignores dedupe + schedule, for setup/testing.
  function postReportNow() {
    const cfg = state.reportSchedule;
    return runTx(() => {
      const result = post(cfg, { force: true });
      if (result.posted) cfg.updatedAt = now();
      return result;
    });
  }

  function setReportSchedule(patch = {}) {
    return runTx(() => {
      const cur = state.reportSchedule ?? createDefaultReportSchedule();
      const next = {
        ...cur,
        enabled: patch.enabled != null ? Boolean(patch.enabled) : cur.enabled,
        channelId: "channelId" in patch ? (patch.channelId || null) : cur.channelId,
        conversationId: "conversationId" in patch ? (patch.conversationId || null) : cur.conversationId,
        periodKey: PERIOD_KEYS.has(patch.periodKey) ? patch.periodKey : cur.periodKey,
        coverage: COVERAGES.has(patch.coverage) ? patch.coverage : (cur.coverage ?? "previous"),
        cadence: CADENCES.has(patch.cadence) ? patch.cadence : cur.cadence,
        weekday: patch.weekday != null ? clampInt(patch.weekday, 0, 6, cur.weekday) : cur.weekday,
        time: patch.time != null ? normalizeTime(patch.time, cur.time) : cur.time,
      };
      const nowIso = now();
      // Recompute nextRunAt whenever the cadence/time could have moved, or when
      // arming an enabled schedule that has none yet.
      next.nextRunAt = next.enabled ? computeReportNextRun(nowIso, next) : null;
      next.updatedAt = nowIso;
      state.reportSchedule = next;
      return next;
    });
  }

  return { sweepReportSchedule, postReportNow, setReportSchedule, getReportSchedule: () => state.reportSchedule };
}
