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
