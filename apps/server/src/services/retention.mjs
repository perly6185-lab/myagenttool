import { reapRunTranscriptPayloads } from "./run-transcripts.mjs";

const criticalLifecycleStatuses = new Set(["succeeded", "failed", "cancelled", "blocked", "rejected", "observed"]);

export function isCriticalLifecycleAuditRecord(record) {
  if (!record || typeof record !== "object") {
    return false;
  }
  const status = String(record.status ?? "").toLowerCase();
  return (
    criticalLifecycleStatuses.has(status) ||
    Boolean(record.completedAt) ||
    record.result != null ||
    record.rollback != null ||
    record.operation === "rollback"
  );
}

// #970: TIME-based retention. The per-collection count caps (events.slice(0,500),
// healthChecks.slice(0,50), …) bound SPACE; this bounds TIME by reaping pure
// telemetry — events, traces, spans — older than the operator-configured window
// (retentionSettings.logsDays). Shielded EVIDENCE is never reaped here: the spend
// ledger, critical lifecycle audit, refusals, and audit summaries keep their own
// count caps + shields, so a compliance/billing record can't age out by accident.
// `logsDays` unset or ≤ 0 turns the time policy off (the count caps still bound).
export function applyRetentionPolicies(state, { now, appendEvent }) {
  const days = Number(state?.retentionSettings?.logsDays);
  if (!Number.isFinite(days) || days <= 0) return { reaped: 0 };
  const cutoffMs = Date.parse(now()) - days * 86_400_000;
  if (!Number.isFinite(cutoffMs)) return { reaped: 0 };
  let reaped = 0;
  const reapByAge = (key, tsFields) => {
    const rows = state[key];
    if (!Array.isArray(rows)) return;
    state[key] = rows.filter((row) => {
      const raw = tsFields.map((field) => row?.[field]).find((value) => value != null);
      const ts = Date.parse(raw ?? "");
      const stale = Number.isFinite(ts) && ts < cutoffMs;
      if (stale) reaped += 1;
      return !stale;
    });
  };
  reapByAge("events", ["createdAt"]);
  reapByAge("traces", ["createdAt"]);
  reapByAge("spans", ["startedAt", "createdAt"]);
  // #913: the RAW proposal patch is payload, not evidence. Past the same window
  // the diff text is reaped IN PLACE — the artifact keeps its bindings
  // (contentHash/baseCommit/descriptorRevision), summary, and file list, and
  // becomes visibly not-applicable (the apply gate refuses a proposal with no
  // patch; the read model reports `payload_reaped`). Terminal invocations only —
  // an in-flight proposal is never stripped from under its runner.
  const terminal = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
  for (const invocation of state.invocations ?? []) {
    if (invocation?.options?.metadata?.tool !== "claude.propose.patch") continue;
    if (!terminal.has(invocation.status)) continue;
    const output = invocation.result?.output;
    if (!output || typeof output.patch !== "string") continue;
    const ts = Date.parse(invocation.completedAt ?? invocation.createdAt ?? "");
    if (!Number.isFinite(ts) || ts >= cutoffMs) continue;
    delete output.patch;
    delete output.patchTruncated;
    output.patchRedacted = true;
    output.patchRedactedAt = now();
    reaped += 1;
  }
  // #1072: run-transcript block payloads are payload, not evidence — same window.
  // The skeleton (kinds, tool names, durations, sizes, order) survives in place,
  // marked `payloadReaped`, so the timeline shape outlives its content.
  // #1084: ONE audit event per sweep records which runs were reaped, so "this
  // transcript existed and was emptied at T" is provable from the event log.
  const transcriptReap = reapRunTranscriptPayloads(state, { cutoffMs, now });
  reaped += transcriptReap.reaped;
  if (transcriptReap.reaped > 0 && typeof appendEvent === "function") {
    appendEvent({
      invocationId: null,
      type: "run_transcript_payloads_reaped",
      level: "info",
      message: `Reaped ${transcriptReap.reaped} run-transcript payload(s) past the ${days}-day retention window.`,
      data: { invocationIds: transcriptReap.invocationIds },
    });
  }
  return { reaped };
}

// Lifecycle audit records explain operator-visible recovery state. Bound routine
// queued/running noise, but keep completed/failure/result/rollback evidence even
// when it is older than the display cap.
export function capLifecycleAuditRecords(state, cap = 100) {
  const records = Array.isArray(state.lifecycleAuditRecords) ? state.lifecycleAuditRecords : [];
  const max = Math.max(0, Number(cap) || 0);
  let ordinary = 0;
  state.lifecycleAuditRecords = records.filter((record) => {
    if (isCriticalLifecycleAuditRecord(record)) {
      return true;
    }
    ordinary += 1;
    return ordinary <= max;
  });
}
