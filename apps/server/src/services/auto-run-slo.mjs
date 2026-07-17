/*
 * A2 (O5.1) — SLOs for the autonomous loop. Turns the raw auto-run records into
 * a handful of service-level indicators with a target line each, so an operator
 * running the loop unattended can see at a glance whether it is healthy and get
 * a red flag when an indicator drops below target.
 *
 * Pure function of the records. Targets are provisional defaults (documented);
 * a run of zero relevant records yields value null / meets null (can't judge —
 * never a false "below").
 */

const SETTLED = new Set(["pr_open", "report_posted", "needs_input", "blocked", "done", "failed"]);
const ATTENTION = new Set(["awaiting_approval", "blocked", "needs_input"]);
const CHANGE_TERMINAL = new Set(["pr_open", "blocked", "failed"]); // code-path runs that settled

// Provisional SLO targets. direction: "gte" = value must be >= target;
// "lte" = value must be <= target. Tune once real volume exists (O6/#250).
export const DEFAULT_SLO_TARGETS = {
  prSuccessRate: 0.7, // of code-path runs that settled, how many opened a PR
  failureRate: 0.2, // of all settled runs, how many failed
  attentionRate: 0.5, // of all runs, how many need a human (approval/blocked/input)
  timeToPrMedianSeconds: 1800, // 30 min
};

function median(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function slo({ key, label, value, target, direction, unit }) {
  const meets = value == null ? null : direction === "gte" ? value >= target : value <= target;
  return { key, label, value, target, direction, unit, meets };
}

export function summarizeAutoRunSlos(autoRuns = [], targets = DEFAULT_SLO_TARGETS) {
  const list = Array.isArray(autoRuns) ? autoRuns : [];
  const total = list.length;
  let settled = 0;
  let failed = 0;
  let prOpen = 0;
  let changeTerminal = 0;
  let attention = 0;
  const timeToPr = [];
  for (const run of list) {
    if (SETTLED.has(run.status)) settled += 1;
    if (run.status === "failed") failed += 1;
    if (run.status === "pr_open") prOpen += 1;
    if (CHANGE_TERMINAL.has(run.status)) changeTerminal += 1;
    if (ATTENTION.has(run.status)) attention += 1;
    if (run.status === "pr_open" && run.createdAt && run.updatedAt) {
      const secs = (Date.parse(run.updatedAt) - Date.parse(run.createdAt)) / 1000;
      if (Number.isFinite(secs) && secs >= 0) timeToPr.push(secs);
    }
  }
  const rate = (num, den) => (den > 0 ? Number((num / den).toFixed(4)) : null);
  const t = { ...DEFAULT_SLO_TARGETS, ...(targets ?? {}) };
  const slos = [
    slo({ key: "prSuccessRate", label: "PR success rate", value: rate(prOpen, changeTerminal), target: t.prSuccessRate, direction: "gte", unit: "ratio" }),
    slo({ key: "failureRate", label: "Failure rate", value: rate(failed, settled), target: t.failureRate, direction: "lte", unit: "ratio" }),
    slo({ key: "attentionRate", label: "Human-attention rate", value: rate(attention, total), target: t.attentionRate, direction: "lte", unit: "ratio" }),
    slo({ key: "timeToPrMedianSeconds", label: "Time to PR (median)", value: median(timeToPr), target: t.timeToPrMedianSeconds, direction: "lte", unit: "seconds" }),
  ];
  return {
    slos,
    anyBelow: slos.some((s) => s.meets === false),
    // cost-per-PR + regression-rate SLOs are intentionally omitted here: cost is
    // not yet attributed per run, and regression lives in the eval-trend panel.
  };
}

// Close the SLO → alert loop (O5.2 follow-up). The metrics summary already
// exposes `anyBelow`, but nothing fired on it — an operator had to be looking at
// the panel. This decides whether a breach warrants an alert, THROTTLED so a
// persistently-below SLO is not re-alerted on every tick: an alert fires only
// when the SET of below-target indicators CHANGES (a new one drops below, the
// set shifts, or it clears). `previousSignature` is the last-emitted set, stored
// on state between ticks; the returned `signature` is what to store next.
//
// A "below" verdict requires meets === false — meets === null (no data yet) is
// never a breach, so an idle loop never false-alarms.
export function evaluateSloAlert(sloSummary, previousSignature = "") {
  const slos = Array.isArray(sloSummary?.slos) ? sloSummary.slos : [];
  const below = slos.filter((s) => s.meets === false);
  const signature = below.map((s) => s.key).sort().join(",");
  const prev = typeof previousSignature === "string" ? previousSignature : "";
  if (signature === prev) return { changed: false, signature, alert: null };
  if (below.length === 0) {
    // Reaching here means a breach cleared (prev was non-empty). Only announce a
    // real RECOVERY when there is data that now meets target. Going to NO DATA
    // (every SLO meets===null — e.g. an empty loop after a restart while the
    // breach signature is still persisted) is NOT a recovery: clear the stale
    // signature silently, no false "back on target" alert.
    const recovered = slos.some((s) => s.meets === true);
    return {
      changed: true,
      signature,
      alert: recovered
        ? {
            kind: "auto_run_slo_recovered",
            severity: "info",
            message: "All auto-run SLOs are back on target.",
            data: { previouslyBelow: prev ? prev.split(",") : [] },
          }
        : null,
    };
  }
  return {
    changed: true,
    signature,
    alert: {
      kind: "auto_run_slo_below",
      severity: "warning",
      message: `Auto-run SLO below target: ${below.map((s) => s.label).join(", ")}.`,
      data: {
        below: below.map((s) => ({
          key: s.key,
          label: s.label,
          value: s.value,
          target: s.target,
          direction: s.direction,
          unit: s.unit,
        })),
      },
    },
  };
}
