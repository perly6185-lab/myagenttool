/*
 * Run-transcript capture from a `claude --output-format stream-json --verbose`
 * stdout stream (#1071, Epic #1070).
 *
 * The wrappers used to buffer the whole stdout and keep only the final RESULT
 * JSON — every thinking block, tool_use input, tool_result output and assistant
 * text was discarded at the source. This collector is fed one stdout line at a
 * time while the CLI streams, and produces an ordered, BOUNDED transcript that
 * ships as a `transcript` field on the wrapper's final RESULT.
 *
 * Bounding contract (no silent loss):
 * - each block's payload is capped per kind; over-cap content is cut with
 *   `truncated: true` + `droppedChars`;
 * - once the total payload budget is spent, further blocks degrade to a
 *   skeleton (kind/toolName/sizes, `payloadDropped: true`) so the timeline
 *   shape survives;
 * - past `maxBlocks` nothing is appended at all;
 * - every degraded or unappended block increments `droppedBlocks`.
 *
 * A malformed / non-JSON line must never throw: it increments `unparsedLines`
 * and is skipped — the wrapper's RESULT contract does not depend on this
 * module succeeding.
 */

export const TRANSCRIPT_LIMITS = {
  thinkingChars: 4000,
  inputChars: 4000,
  outputChars: 8000,
  textChars: 16000,
  descriptionChars: 200,
  totalChars: 262144,
  maxBlocks: 2000,
};

export function createTranscriptCollector({ now = Date.now, limits = TRANSCRIPT_LIMITS } = {}) {
  const blocks = [];
  let totalChars = 0;
  let droppedBlocks = 0;
  let unparsedLines = 0;
  // Baseline for the first thinking duration: collector creation ≈ CLI spawn.
  let lastEventAt = now();

  function pushLine(rawLine) {
    const line = String(rawLine ?? "").trim();
    if (!line) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      unparsedLines += 1;
      return;
    }
    if (!event || typeof event !== "object") return;
    const arrivedAt = now();
    if (event.type === "assistant") {
      collectAssistantEvent(event, arrivedAt - lastEventAt);
    } else if (event.type === "user") {
      collectToolResults(event);
    }
    // Every well-formed stream event advances the clock (system init included),
    // so the first thinking block is timed from the previous event, not from 0.
    lastEventAt = arrivedAt;
  }

  function collectAssistantEvent(event, deltaMs) {
    const content = event.message?.content;
    if (!Array.isArray(content)) return;
    // The whole assistant turn arrives as one event; attribute its wall-clock
    // delta to the first thinking block (the IDE's "Thought for Ns").
    let durationAssigned = false;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "thinking" && typeof part.thinking === "string") {
        appendBlock(
          { kind: "thinking", ...(durationAssigned ? {} : { durationMs: Math.max(0, deltaMs) }) },
          { field: "text", value: part.thinking, cap: limits.thinkingChars },
        );
        durationAssigned = true;
      } else if (part.type === "text" && typeof part.text === "string") {
        appendBlock({ kind: "text" }, { field: "text", value: part.text, cap: limits.textChars });
      } else if (part.type === "tool_use") {
        appendBlock(
          {
            kind: "tool_use",
            toolName: String(part.name ?? "unknown"),
            toolUseId: typeof part.id === "string" ? part.id : null,
            description: toolDescription(part.input),
          },
          { field: "input", value: stringifyInput(part.input), cap: limits.inputChars },
        );
      }
    }
  }

  function collectToolResults(event) {
    const content = event.message?.content;
    if (!Array.isArray(content)) return;
    for (const part of content) {
      if (!part || typeof part !== "object" || part.type !== "tool_result") continue;
      appendBlock(
        {
          kind: "tool_result",
          toolUseId: typeof part.tool_use_id === "string" ? part.tool_use_id : null,
          isError: part.is_error === true,
        },
        { field: "output", value: contentText(part.content), cap: limits.outputChars },
      );
    }
  }

  function appendBlock(base, payload) {
    if (blocks.length >= limits.maxBlocks) {
      droppedBlocks += 1;
      return;
    }
    const value = String(payload.value ?? "");
    if (totalChars >= limits.totalChars) {
      droppedBlocks += 1;
      blocks.push({ ...base, payloadDropped: true, chars: value.length });
      return;
    }
    const cap = Math.min(payload.cap, limits.totalChars - totalChars);
    const kept = value.length <= cap ? value : value.slice(0, cap);
    totalChars += kept.length;
    blocks.push({
      ...base,
      [payload.field]: kept,
      ...(kept.length < value.length ? { truncated: true, droppedChars: value.length - kept.length } : {}),
    });
  }

  function toolDescription(input) {
    const text = input && typeof input === "object" && typeof input.description === "string"
      ? input.description.trim()
      : "";
    return text ? text.slice(0, limits.descriptionChars) : null;
  }

  function stringifyInput(input) {
    if (input === undefined || input === null) return "";
    if (typeof input === "string") return input;
    try {
      return JSON.stringify(input, null, 1);
    } catch {
      return String(input);
    }
  }

  function contentText(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .map((part) => (typeof part === "string" ? part : part?.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }

  function finish() {
    return {
      version: 1,
      blocks,
      totalChars,
      droppedBlocks,
      unparsedLines,
      truncated: droppedBlocks > 0 || blocks.some((block) => block.truncated || block.payloadDropped),
    };
  }

  return { pushLine, finish };
}
