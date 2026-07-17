import { createHash } from "node:crypto";

/*
 * Run transcripts (#1072, Epic #1070): the wrapper's bounded stream-json
 * transcript (thinking / tool_use / tool_result / assistant text, #1071) gets a
 * durable per-run home. The device already bounds what it sends, but the device
 * is not trusted: everything is re-clamped here with the server's own limits
 * before it touches state, and an oversized or malformed payload degrades —
 * it never rejects the completion.
 *
 * Storage shape: one record per invocation in `state.runTranscripts`
 * (newest-first, count-capped). The raw payload is stripped off
 * `invocation.result` on ingest so the collection is its single durable home —
 * a transcript embedded in the invocation would ship with every /api/state
 * snapshot and be double-stored.
 *
 * Retention (#913/#970 policy): past the operator window the block PAYLOADS are
 * reaped in place — kind/toolName/durations/sizes survive, so the timeline
 * shape outlives its content, marked `payloadReaped`.
 *
 * Evidence chain (#1084): the record carries `traceId` (trace-centric search)
 * and a server-computed `contentHash`; ingest and reap leave events; replacing
 * a transcript on re-delivery keeps the superseded hash on the new record —
 * a swapped transcript is provable, not silent; a count-cap eviction goes to
 * the retention archive instead of vanishing.
 */

export const RUN_TRANSCRIPT_LIMITS = {
  thinkingChars: 4000,
  inputChars: 4000,
  outputChars: 8000,
  textChars: 16000,
  descriptionChars: 200,
  idChars: 120,
  toolNameChars: 120,
  totalChars: 262144,
  maxBlocks: 2000,
};

// Space cap for the collection itself (newest-first). 200 transcripts at the
// 256KB budget bound the worst case at ~50MB of SQLite payload; retention
// reaps payloads well before the cap matters in practice.
export const MAX_RUN_TRANSCRIPTS = 200;

const BLOCK_PAYLOAD = {
  thinking: { field: "text", cap: "thinkingChars" },
  tool_use: { field: "input", cap: "inputChars" },
  tool_result: { field: "output", cap: "outputChars" },
  text: { field: "text", cap: "textChars" },
};

/**
 * Re-clamp a device-reported transcript into the durable shape. Returns null
 * for anything that is not a plausible transcript (absent, wrong type, no
 * blocks array) — the caller then simply records nothing.
 */
export function sanitizeRunTranscript(raw, limits = RUN_TRANSCRIPT_LIMITS) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.blocks)) return null;
  const blocks = [];
  let totalChars = 0;
  let droppedBlocks = nonNegativeInt(raw.droppedBlocks);
  for (const rawBlock of raw.blocks) {
    const payloadSpec = rawBlock && typeof rawBlock === "object" ? BLOCK_PAYLOAD[rawBlock.kind] : undefined;
    if (!payloadSpec) {
      droppedBlocks += 1;
      continue;
    }
    if (blocks.length >= limits.maxBlocks) {
      droppedBlocks += 1;
      continue;
    }
    const block = { kind: rawBlock.kind };
    if (rawBlock.kind === "thinking" && Number.isFinite(Number(rawBlock.durationMs))) {
      block.durationMs = Math.max(0, Math.round(Number(rawBlock.durationMs)));
    }
    if (rawBlock.kind === "tool_use") {
      block.toolName = clampString(rawBlock.toolName ?? "unknown", limits.toolNameChars) || "unknown";
      const description = clampString(rawBlock.description, limits.descriptionChars);
      if (description) block.description = description;
    }
    if (rawBlock.kind === "tool_use" || rawBlock.kind === "tool_result") {
      const toolUseId = clampString(rawBlock.toolUseId, limits.idChars);
      block.toolUseId = toolUseId || null;
    }
    if (rawBlock.kind === "tool_result") {
      block.isError = rawBlock.is_error === true || rawBlock.isError === true;
    }
    // A block the device already degraded to a skeleton stays a skeleton.
    if (rawBlock.payloadDropped === true || typeof rawBlock[payloadSpec.field] !== "string") {
      block.payloadDropped = true;
      block.chars = nonNegativeInt(rawBlock.chars);
      blocks.push(block);
      continue;
    }
    const value = rawBlock[payloadSpec.field];
    const deviceDropped = nonNegativeInt(rawBlock.droppedChars);
    if (totalChars >= limits.totalChars) {
      droppedBlocks += 1;
      blocks.push({ ...block, payloadDropped: true, chars: value.length + deviceDropped });
      continue;
    }
    const cap = Math.min(limits[payloadSpec.cap], limits.totalChars - totalChars);
    const kept = value.length <= cap ? value : value.slice(0, cap);
    totalChars += kept.length;
    block[payloadSpec.field] = kept;
    const droppedChars = deviceDropped + (value.length - kept.length);
    if (droppedChars > 0) {
      block.truncated = true;
      block.droppedChars = droppedChars;
    }
    blocks.push(block);
  }
  return {
    version: 1,
    blocks,
    totalChars,
    droppedBlocks,
    unparsedLines: nonNegativeInt(raw.unparsedLines),
    truncated: droppedBlocks > 0 || blocks.some((block) => block.truncated || block.payloadDropped),
  };
}

/** Server-computed integrity binding over the clamped blocks (#1084 — the
 *  device never supplies it, mirroring the #913 proposal contentHash). */
export function transcriptContentHash(blocks) {
  return createHash("sha256").update(JSON.stringify(blocks ?? [])).digest("hex");
}

/**
 * Ingest the transcript a completed run carried on its RESULT (any terminal
 * status — a failed run's transcript is the most valuable one). Strips the raw
 * payload off `result` and upserts the per-invocation record. Mutates state
 * only; the caller's enclosing transaction owns the durable commit.
 * `appendEvent` and `capWithArchive` are optional (hermetic harnesses) — the
 * evidence trail degrades, the ingest never fails over them.
 */
export function recordRunTranscript({ state, invocation, result, now, appendEvent, capWithArchive }) {
  if (!invocation || !result || typeof result !== "object" || Array.isArray(result)) return null;
  const transcript = sanitizeRunTranscript(result.transcript);
  if ("transcript" in result) delete result.transcript;
  if (!transcript || transcript.blocks.length === 0) return null;
  if (!Array.isArray(state.runTranscripts)) state.runTranscripts = [];
  const contentHash = transcriptContentHash(transcript.blocks);
  const emit = (type, message, data) => {
    if (typeof appendEvent === "function") {
      appendEvent({ invocationId: invocation.id, type, level: "info", message, data });
    }
  };
  const record = {
    id: `trs_${invocation.id}`,
    invocationId: invocation.id,
    traceId: invocation.traceId ?? null,
    projectId: invocation.projectId ?? invocation.input?.metadata?.projectId ?? null,
    agentId: invocation.agentId ?? null,
    status: invocation.status ?? null,
    ...transcript,
    contentHash,
    payloadReaped: false,
    createdAt: now(),
  };
  // Upsert: a repaired/re-delivered completion replaces its transcript instead
  // of duplicating the row (completeInvocation is already terminal-guarded).
  // Identical content is an idempotent no-op; DIFFERENT content keeps the
  // superseded hash on the new record + leaves an event — a swapped transcript
  // is provable after the fact, never silent.
  const existing = state.runTranscripts.findIndex((item) => item?.invocationId === invocation.id);
  if (existing >= 0) {
    const previous = state.runTranscripts[existing];
    if (previous?.contentHash === contentHash) return previous;
    record.supersededHash = previous?.contentHash ?? null;
    record.supersededAt = now();
    state.runTranscripts[existing] = record;
    emit(
      "run_transcript_superseded",
      `Run transcript replaced by re-delivery (${transcript.blocks.length} block(s)).`,
      { contentHash, supersededHash: record.supersededHash },
    );
    return record;
  }
  state.runTranscripts.unshift(record);
  if (state.runTranscripts.length > MAX_RUN_TRANSCRIPTS) {
    // Evictions are audit-relevant: spill to the retention archive (#1084)
    // rather than vanishing; plain truncation only when no archive is wired.
    state.runTranscripts = typeof capWithArchive === "function"
      ? capWithArchive(state.runTranscripts, MAX_RUN_TRANSCRIPTS, "runTranscripts")
      : state.runTranscripts.slice(0, MAX_RUN_TRANSCRIPTS);
  }
  emit(
    "run_transcript_recorded",
    `Run transcript captured (${transcript.blocks.length} block(s)${transcript.truncated ? ", truncated" : ""}).`,
    { contentHash, blocks: transcript.blocks.length, totalChars: transcript.totalChars, truncated: transcript.truncated },
  );
  return record;
}

/**
 * Retention: reap block payloads of records older than the cutoff, keeping the
 * skeleton (kinds, tool names, durations, sizes, order). Returns the count and
 * the affected invocationIds so the caller can leave ONE audit event per sweep
 * (bounded — never per-record event spam).
 */
export function reapRunTranscriptPayloads(state, { cutoffMs, now }) {
  const invocationIds = [];
  for (const record of state.runTranscripts ?? []) {
    if (!record || record.payloadReaped) continue;
    const ts = Date.parse(record.createdAt ?? "");
    if (!Number.isFinite(ts) || ts >= cutoffMs) continue;
    record.blocks = (record.blocks ?? []).map(skeletonBlock);
    record.totalChars = 0;
    record.payloadReaped = true;
    record.reapedAt = now();
    invocationIds.push(record.invocationId ?? null);
  }
  return { reaped: invocationIds.length, invocationIds };
}

function skeletonBlock(block) {
  const spec = BLOCK_PAYLOAD[block?.kind];
  if (!spec) return block;
  const payload = block[spec.field];
  const { [spec.field]: _payload, truncated: _truncated, droppedChars, ...rest } = block;
  return {
    ...rest,
    payloadDropped: true,
    chars: block.payloadDropped ? nonNegativeInt(block.chars) : (payload?.length ?? 0) + nonNegativeInt(droppedChars),
  };
}

function clampString(value, cap) {
  return typeof value === "string" ? value.trim().slice(0, cap) : "";
}

function nonNegativeInt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}
