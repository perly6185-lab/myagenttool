// L6 feedback triage (docs/engineering/FEEDBACK_LOOP.md).
//
// Turns intake events (.myagenttool/feedback/inbox.jsonl) into tracked GitHub
// issues — the automated slice of "feedback becomes tracked work". Pure
// module: no process.exit, no gh calls; the command in ../index.mjs owns I/O.
//
// Two rules carry the design:
// - DEDUPE is load-bearing: nightly cron repeats identical events; a dedupeKey
//   already in the ledger (or still open on the tracker) is skipped.
// - HIGH-RISK never auto-files: the drafted issue is judged by the PRODUCT's
//   own approval gate (injected gateReasons fn — no third vocabulary); gated
//   drafts queue as "pending" for a human, mirroring ai:issue-tree --apply.

import { isNonEmptyString, stringArray } from "../evals/util.mjs";

export function parseIntakeEvents(text) {
  const events = [];
  const problems = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line);
      if (!isNonEmptyString(raw.title) || !isNonEmptyString(raw.dedupeKey)) {
        problems.push(`event missing title/dedupeKey: ${line.slice(0, 80)}`);
        continue;
      }
      events.push({
        source: isNonEmptyString(raw.source) ? raw.source : "unknown",
        severity: raw.severity === "high" ? "high" : raw.severity === "low" ? "low" : "medium",
        title: raw.title,
        detail: isNonEmptyString(raw.detail) ? raw.detail : "",
        dedupeKey: raw.dedupeKey,
        createdAt: isNonEmptyString(raw.createdAt) ? raw.createdAt : "",
      });
    } catch {
      problems.push(`unparseable event line: ${line.slice(0, 80)}`);
    }
  }
  return { events, problems };
}

// Draft the tracked-issue payload for one event. Carries full label groups,
// milestone, and Project Fields so auto-filed issues keep the L1 gate at 100%
// and satisfy pr-governance's dedicated-issue rule.
export function draftIssue(event) {
  const type = event.severity === "high" ? "bug" : "task";
  const risk = event.severity === "high" ? "medium" : "low";
  return {
    title: `[${type === "bug" ? "Bug" : "Task"}]: ${event.title}`,
    labels: [`type/${type}`, "status/backlog", "area/cross-cutting", `risk/${risk}`, "feedback/auto"],
    milestone: "M3 - Lifecycle Automation and Billing",
    body: [
      "## Problem",
      "",
      event.detail || event.title,
      "",
      "## Source",
      "",
      `- Auto-filed by the feedback triage pipeline (docs/engineering/FEEDBACK_LOOP.md).`,
      `- Producer: ${event.source} · event time: ${event.createdAt || "unknown"} · dedupeKey: \`${event.dedupeKey}\``,
      "",
      "## Acceptance Criteria",
      "",
      "- Root cause identified and fixed or explicitly accepted.",
      "- The originating signal is green on the next scheduled run (or the case/probe is corrected).",
      "",
      "## Project Fields",
      "Milestone: M3",
      "Area: cross-cutting",
      `Type: ${type}`,
      "Status: backlog",
      `Risk: ${risk}`,
      "Acceptance: defined",
      "Platform: all",
      "Agent Target: none",
      "Priority: p2",
      "Source Doc: docs/engineering/FEEDBACK_LOOP.md",
    ].join("\n"),
  };
}

// Plan the triage: for each event decide created/pending/skipped.
//   ledgerKeys: Set of dedupeKeys already processed.
//   openKeys:   Set of dedupeKeys with a still-open auto-filed issue.
//   gateReasons(draft, event): product approval-gate categories for the
//     drafted issue (inject humanApprovalRequiredReasons∘spec-shape from the
//     command; judge event CONTENT, not body scaffolding).
export function planTriage({ events, ledgerKeys, openKeys, gateReasons, humanApproved = false }) {
  const plan = [];
  const seenThisRun = new Set();
  for (const event of events) {
    if (ledgerKeys.has(event.dedupeKey) || openKeys.has(event.dedupeKey) || seenThisRun.has(event.dedupeKey)) {
      plan.push({ event, action: "skipped-duplicate" });
      continue;
    }
    seenThisRun.add(event.dedupeKey);
    const draft = draftIssue(event);
    const reasons = stringArray(gateReasons(draft, event));
    if (reasons.length > 0 && !humanApproved) {
      plan.push({ event, draft, action: "pending-approval", reasons });
      continue;
    }
    plan.push({ event, draft, action: "create", reasons });
  }
  return plan;
}

// The L6 measurement over the processed ledger (+ tracker outcomes supplied by
// the command): conversion, latency, false-triage. Local target — no external
// anchor exists for feedback automation (MATURITY_CALIBRATION frontier note).
export function triageReport({ ledgerEntries, closedAutoIssues = [] }) {
  const handled = ledgerEntries.filter((entry) => entry.action === "created" || entry.action === "pending-approval");
  const created = ledgerEntries.filter((entry) => entry.action === "created");
  const latencies = created
    .map((entry) => Date.parse(entry.processedAt) - Date.parse(entry.eventCreatedAt))
    .filter((ms) => Number.isFinite(ms) && ms >= 0)
    .sort((a, b) => a - b);
  // gh emits the GraphQL enum ("NOT_PLANNED"); compare case-insensitively so a
  // REST-shaped "not_planned" also counts.
  const invalid = closedAutoIssues.filter((issue) => String(issue.stateReason ?? "").toLowerCase() === "not_planned").length;
  return {
    events: ledgerEntries.length,
    conversionRate: ledgerEntries.length === 0 ? null : round3(handled.length / ledgerEntries.length),
    created: created.length,
    pendingApproval: ledgerEntries.filter((entry) => entry.action === "pending-approval").length,
    skippedDuplicates: ledgerEntries.filter((entry) => entry.action === "skipped-duplicate").length,
    medianLatencyMinutes: latencies.length === 0 ? null : round3(latencies[Math.floor(latencies.length / 2)] / 60000),
    falseTriage: { closedAutoIssues: closedAutoIssues.length, notPlanned: invalid, rate: closedAutoIssues.length === 0 ? null : round3(invalid / closedAutoIssues.length) },
  };
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
