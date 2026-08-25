import { createHash } from "node:crypto";

const MAX_SAMPLES = 2_000;
const MAX_TEXT_LENGTH = 500;
const RESOLUTION_WINDOW_MS = 30 * 60 * 1_000;
const VALID_STATUSES = new Set(["pending_review", "resolved", "dismissed"]);

function compact(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

export function redactChannelIntentText(value) {
  return compact(value)
    .replace(/\b(?:authorization\s*:\s*)?bearer\s+[a-z0-9._~+/=-]{8,}/gi, "[敏感信息]")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret)\s*[:=]\s*[^\s,;，；]+/gi, "$1=[敏感信息]")
    .replace(/https?:\/\/[^\s<>"'，。；！、）】]+/gi, "[链接]")
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[邮箱]")
    .replace(/(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g, "[号码]")
    .replace(/(?:^|\s)(?:\/[\w.@%+~/-]+|[a-z]:\\[^\s<>:"|?*，。；！、）】]+)(?=\s|$|[，。；！、）】])/gi, (match) => `${match.startsWith(" ") ? " " : ""}[本地路径]`)
    .slice(0, MAX_TEXT_LENGTH);
}

function digest(value) {
  // Hash only the already-redacted text. A hash of a raw phone number or token
  // would still be vulnerable to guessing and does not belong in durable state.
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function boundedPrediction(prediction) {
  if (!prediction || typeof prediction !== "object") return null;
  return {
    intent: compact(prediction.intent).slice(0, 64) || null,
    confidence: Number.isFinite(Number(prediction.confidence)) ? Math.max(0, Math.min(1, Number(prediction.confidence))) : null,
    source: compact(prediction.source).slice(0, 64) || null,
  };
}

function boundedResolution(resolution) {
  if (!resolution || typeof resolution !== "object") return null;
  const bounded = {
    intent: compact(resolution.intent).slice(0, 64) || null,
    controlKind: compact(resolution.controlKind).slice(0, 64) || null,
    taskKind: compact(resolution.taskKind).slice(0, 64) || null,
  };
  return bounded.intent || bounded.controlKind || bounded.taskKind ? bounded : null;
}

export function channelIntentLearningSummary(samples = []) {
  const summary = {
    difficultSamples: 0,
    pendingReviewSamples: 0,
    resolvedCorrections: 0,
    replayReadySamples: 0,
    deduplicatedOccurrences: 0,
    byReason: {},
    byDomain: {},
    updatedAt: null,
  };
  for (const sample of samples ?? []) {
    if (!VALID_STATUSES.has(sample?.status)) continue;
    summary.difficultSamples += 1;
    summary.deduplicatedOccurrences += Math.max(0, Number(sample.occurrenceCount ?? 1) - 1);
    if (sample.status === "pending_review") summary.pendingReviewSamples += 1;
    if (sample.status === "resolved") {
      summary.resolvedCorrections += 1;
      if (sample.expected?.intent || sample.expected?.controlKind || sample.expected?.taskKind) summary.replayReadySamples += 1;
    }
    const reason = compact(sample.reason).slice(0, 64) || "unknown";
    summary.byReason[reason] = Number(summary.byReason[reason] ?? 0) + 1;
    const taskKind = compact(sample.expected?.taskKind);
    const domain = taskKind.startsWith("content_") || taskKind === "coding_digest" || taskKind === "platform_adaptation" || taskKind === "wechat_draft_sync"
      ? "content"
      : taskKind.startsWith("software_") ? "software"
        : taskKind.startsWith("business_") ? "business" : "other";
    summary.byDomain[domain] = Number(summary.byDomain[domain] ?? 0) + 1;
    if (String(sample.updatedAt ?? "") > String(summary.updatedAt ?? "")) summary.updatedAt = sample.updatedAt;
  }
  return summary;
}

export function recordChannelIntentLearningSample({
  state,
  now,
  nextId,
  channelId,
  conversationId,
  eventId = null,
  text,
  reason,
  prediction = null,
  resolution = null,
} = {}) {
  if (!state || !channelId || !conversationId || !compact(reason)) return { ok: false, reason: "invalid_sample" };
  const redactedText = redactChannelIntentText(text);
  if (!redactedText) return { ok: false, reason: "empty_sample" };
  const textDigest = digest(redactedText);
  const at = typeof now === "function" ? now() : new Date().toISOString();
  const rows = state.channelIntentLearningSamples ?? [];
  const existing = rows.find((sample) => sample.channelId === channelId
    && sample.conversationId === conversationId
    && sample.reason === reason
    && sample.textDigest === textDigest
    && sample.status !== "dismissed");
  const expected = boundedResolution(resolution);
  if (existing) {
    existing.occurrenceCount = Number(existing.occurrenceCount ?? 1) + 1;
    existing.lastSeenAt = at;
    existing.updatedAt = at;
    existing.lastSourceEventId = eventId ?? existing.lastSourceEventId ?? null;
    if (expected) {
      existing.status = "resolved";
      existing.expected = expected;
      existing.resolvedAt = at;
      existing.resolvedByEventId = eventId ?? null;
    }
    return { ok: true, sample: existing, deduplicated: true };
  }
  const sample = {
    id: typeof nextId === "function" ? nextId("cil") : `cil_${textDigest.slice(0, 12)}`,
    channelId,
    conversationId,
    sourceEventId: eventId,
    lastSourceEventId: eventId,
    redactedText,
    textDigest,
    reason: compact(reason).slice(0, 64),
    prediction: boundedPrediction(prediction),
    status: expected ? "resolved" : "pending_review",
    expected,
    occurrenceCount: 1,
    createdAt: at,
    lastSeenAt: at,
    updatedAt: at,
    resolvedAt: expected ? at : null,
    resolvedByEventId: expected ? eventId : null,
  };
  state.channelIntentLearningSamples = [...rows, sample].slice(-MAX_SAMPLES);
  return { ok: true, sample, deduplicated: false };
}

export function resolveLatestChannelIntentLearningSample({
  state,
  now,
  conversationId,
  eventId = null,
  resolution,
} = {}) {
  const expected = boundedResolution(resolution);
  if (!state || !conversationId || !expected) return { ok: false, reason: "invalid_resolution" };
  const at = typeof now === "function" ? now() : new Date().toISOString();
  const currentMs = Date.parse(at);
  const sample = [...(state.channelIntentLearningSamples ?? [])]
    .reverse()
    .find((row) => {
      if (row.conversationId !== conversationId || row.status !== "pending_review") return false;
      const sampleMs = Date.parse(row.updatedAt ?? row.lastSeenAt ?? row.createdAt ?? "");
      return Number.isFinite(currentMs) && Number.isFinite(sampleMs)
        && currentMs >= sampleMs
        && currentMs - sampleMs <= RESOLUTION_WINDOW_MS;
    });
  if (!sample) return { ok: true, resolved: false };
  sample.status = "resolved";
  sample.expected = expected;
  sample.resolvedAt = at;
  sample.resolvedByEventId = eventId;
  sample.updatedAt = at;
  return { ok: true, resolved: true, sample };
}

export function buildChannelIntentReplayCases(samples = []) {
  return (samples ?? [])
    .filter((sample) => sample?.status === "resolved"
      && sample.redactedText
      && (sample.expected?.intent || sample.expected?.controlKind || sample.expected?.taskKind))
    .map((sample) => ({
      id: sample.id,
      text: sample.redactedText,
      expected: { ...sample.expected },
      reason: sample.reason,
      source: "reviewed_channel_correction",
    }));
}
