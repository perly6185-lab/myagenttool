import type { InvocationSnapshot } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";

// Pure helpers behind the application execution-visibility cards: every
// invocation an application produced (orchestration runs, wrapper commands,
// lifecycle/generate capability calls, recovery products), classified and
// rolled up. Computed client-side from the snapshot — the server already
// stamps metadata.applicationId on all of them.

const ACTIVE_STATUSES = new Set(["queued", "dispatching", "running", "cancelling"]);
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "timed_out", "cancelled", "expired", "rejected"]);

export function applicationInvocations(invocations: InvocationSnapshot[], applicationId: string): InvocationSnapshot[] {
  return invocations
    .filter((invocation) => invocation.options?.metadata?.applicationId === applicationId)
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

/** Human label for what KIND of execution this invocation was. */
export function executionKind(invocation: InvocationSnapshot): string {
  const metadata = invocation.options?.metadata ?? {};
  if (metadata.recoveryActionType) return `recovery ${String(metadata.recoveryActionType).replaceAll("_", " ")}`;
  if (metadata.source === "application_orchestration") {
    return metadata.routineName ? `orchestration · ${metadata.routineName}` : "orchestration run";
  }
  if (metadata.applicationWrapper || String(metadata.capability ?? "").includes(".wrapper.")) {
    const command = String(metadata.capability ?? "").split(".wrapper.")[1];
    return command ? `wrapper · ${command}` : "wrapper command";
  }
  if (metadata.applicationAction) return String(metadata.applicationAction).replaceAll("_", " ");
  if (metadata.capability) return String(metadata.capability);
  return "capability call";
}

export interface ExecutionDigest {
  total: number;
  succeeded: number;
  failed: number;
  active: number;
  /** Success rate over TERMINAL runs only — null until something finished. */
  successRate: number | null;
  lastAt: string | null;
  recoveryRuns: number;
}

export function applicationExecutionDigest(rows: InvocationSnapshot[]): ExecutionDigest {
  const terminal = rows.filter((row) => TERMINAL_STATUSES.has(row.status ?? ""));
  const succeeded = terminal.filter((row) => row.status === "succeeded").length;
  return {
    total: rows.length,
    succeeded,
    failed: terminal.filter((row) => ["failed", "timed_out"].includes(row.status ?? "")).length,
    active: rows.filter((row) => ACTIVE_STATUSES.has(row.status ?? "")).length,
    successRate: terminal.length ? Math.round((succeeded / terminal.length) * 100) / 100 : null,
    lastAt: rows[0]?.createdAt ?? null,
    recoveryRuns: rows.filter((row) => Boolean(row.options?.metadata?.recoveryActionType)).length,
  };
}

export function digestTone(digest: ExecutionDigest): Tone {
  if (digest.successRate == null) return "neutral";
  if (digest.successRate >= 0.9) return "success";
  if (digest.successRate >= 0.5) return "warning";
  return "danger";
}

export interface DurableWindowSummary {
  days: number;
  succeeded: number;
  failed: number;
  recovered: number;
}

/** Sum the durable daily counters for one application over the last N days. */
export function durableStatsWindow(
  stats: { applicationId: string; date: string; succeeded: number; failed: number; timedOut: number; recovered: number }[],
  applicationId: string,
  days: number,
  today = new Date().toISOString().slice(0, 10),
): DurableWindowSummary {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = stats.filter((row) => row.applicationId === applicationId && row.date >= cutoff && row.date <= today);
  return {
    days,
    succeeded: rows.reduce((sum, row) => sum + row.succeeded, 0),
    failed: rows.reduce((sum, row) => sum + row.failed + row.timedOut, 0),
    recovered: rows.reduce((sum, row) => sum + row.recovered, 0),
  };
}

export interface DailyStatBar {
  date: string;
  succeeded: number;
  failed: number;
  total: number;
}

/**
 * Per-day series for one application over the last N days, oldest→newest, with
 * empty days zero-filled so a sparkline has a continuous baseline (the durable
 * counters only store days that had activity).
 */
export function dailyStatsSeries(
  stats: { applicationId: string; date: string; succeeded: number; failed: number; timedOut: number }[],
  applicationId: string,
  days: number,
  today = new Date().toISOString().slice(0, 10),
): DailyStatBar[] {
  const byDate = new Map(
    stats.filter((row) => row.applicationId === applicationId).map((row) => [row.date, row]),
  );
  const out: DailyStatBar[] = [];
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(todayMs - i * 86_400_000).toISOString().slice(0, 10);
    const row = byDate.get(date);
    const succeeded = row?.succeeded ?? 0;
    const failed = (row?.failed ?? 0) + (row?.timedOut ?? 0);
    out.push({ date, succeeded, failed, total: succeeded + failed });
  }
  return out;
}

/** A card-glance success rate over the durable window; null until something finished. */
export function durableSuccessRate(
  stats: { applicationId: string; date: string; succeeded: number; failed: number; timedOut: number; recovered: number }[],
  applicationId: string,
  days = 30,
  today = new Date().toISOString().slice(0, 10),
): number | null {
  const w = durableStatsWindow(stats, applicationId, days, today);
  const terminal = w.succeeded + w.failed;
  return terminal ? Math.round((w.succeeded / terminal) * 100) / 100 : null;
}

/** Bounded, copy-safe rendering of a result payload for the output browser. */
export function formatResultOutput(output: unknown, maxChars = 4000): { text: string; truncated: boolean } | null {
  if (output == null) return null;
  let text: string;
  try {
    text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  } catch {
    text = String(output);
  }
  if (!text.trim()) return null;
  if (text.length > maxChars) {
    return { text: `${text.slice(0, maxChars)}\n… (${text.length - maxChars} more characters — open the invocation for the full payload)`, truncated: true };
  }
  return { text, truncated: false };
}
