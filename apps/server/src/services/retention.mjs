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
  let reaped = 0;
  const days = Number(state?.retentionSettings?.logsDays);
  const logsCutoff = Number.isFinite(days) && days > 0 ? Date.parse(now()) - days * 86_400_000 : null;
  // Per-type CONTENT retention runs even when the logs window is off: rounds and
  // tool records are only count-capped, so their bounded/redacted digests can
  // otherwise live indefinitely. Do it before the early logs-window guard.
  reaped += reapRoundDigests(state, { now, appendEvent });
  if (logsCutoff == null || !Number.isFinite(logsCutoff)) return { reaped };
  const cutoffMs = logsCutoff;
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

// #970 follow-up: per-type CONTENT retention for round/tool telemetry. These
// collections are only count-capped, so a round's bounded, redacted digest could
// live indefinitely. Reap the PROMPT-side digests (round.requestDigest +
// tool.inputDigest) past `promptsDays` and the RESPONSE-side digests
// (round.responseDigest + tool.outputDigest) past `responsesDays`, IN PLACE — the
// skeleton (tokens, timing, model, sizes, status, toolName) survives. Each window
// is independent; unset/≤0 leaves that content type untouched. Shielded evidence
// (ledger/audit/refusals) is never in scope. One audit event per sweep records
// the count so "these digests existed and were emptied at T" is provable.
export function reapRoundDigests(state, { now, appendEvent }) {
  const cutoffFor = (setting) => {
    const d = Number(state?.retentionSettings?.[setting]);
    if (!Number.isFinite(d) || d <= 0) return null;
    const c = Date.parse(now()) - d * 86_400_000;
    return Number.isFinite(c) ? c : null;
  };
  const promptCutoff = cutoffFor("promptsDays");
  const responseCutoff = cutoffFor("responsesDays");
  if (promptCutoff == null && responseCutoff == null) return 0;
  let reaped = 0;
  const reapField = (row, field, cutoff) => {
    if (cutoff == null) return;
    if (typeof row?.[field] !== "string" || row[field].length === 0) return;
    const ts = Date.parse(row.createdAt ?? "");
    if (!Number.isFinite(ts) || ts >= cutoff) return; // undated or in-window → keep
    row[field] = null;
    reaped += 1;
  };
  for (const round of state.invocationRounds ?? []) {
    reapField(round, "requestDigest", promptCutoff);
    reapField(round, "responseDigest", responseCutoff);
  }
  for (const tool of state.toolInvocationRecords ?? []) {
    reapField(tool, "inputDigest", promptCutoff);
    reapField(tool, "outputDigest", responseCutoff);
  }
  if (reaped > 0 && typeof appendEvent === "function") {
    appendEvent({
      invocationId: null,
      type: "round_digests_reaped",
      level: "info",
      message: `Reaped ${reaped} round/tool digest(s) past the prompt/response retention window.`,
      data: { count: reaped },
    });
  }
  return reaped;
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
