const TECHNICAL_COMPLETION_SUMMARY = /^(?:codex(?: cli| app-server turn)?|claude(?: cli| agent sdk)?) (?:completed|succeeded)\.?$/i;

function nonEmptyText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isTechnicalCompletionSummary(value) {
  const text = nonEmptyText(value);
  return Boolean(text && TECHNICAL_COMPLETION_SUMMARY.test(text));
}

function latestAgentMessage(result) {
  return nonEmptyText(result?.output?.latestMessage)
    ?? nonEmptyText(result?.latestMessage)
    ?? null;
}

/**
 * Codex JSONL emits the user-facing agent_message before turn.completed. The
 * latter carries usage/cost telemetry, not a replacement answer. Merge both so
 * terminal telemetry cannot erase the last substantive message.
 */
export function mergeCodexCliResult(previous, next) {
  if (!previous || typeof previous !== "object") return next;
  if (!next || typeof next !== "object") return previous;

  const previousMessage = latestAgentMessage(previous);
  const nextMessage = latestAgentMessage(next);
  const mergedMessage = nextMessage ?? previousMessage;
  const nextSummary = nonEmptyText(next.summary);
  const previousSummary = nonEmptyText(previous.summary);

  return {
    ...previous,
    ...next,
    summary: nextMessage
      ?? (nextSummary && !isTechnicalCompletionSummary(nextSummary) ? nextSummary : null)
      ?? mergedMessage
      ?? previousSummary
      ?? nextSummary,
    touchedUserFiles: Boolean(previous.touchedUserFiles || next.touchedUserFiles),
    output: {
      ...(previous.output && typeof previous.output === "object" ? previous.output : {}),
      ...(next.output && typeof next.output === "object" ? next.output : {}),
      ...(mergedMessage ? { latestMessage: mergedMessage } : {}),
    },
    cost: {
      ...(previous.cost && typeof previous.cost === "object" ? previous.cost : {}),
      ...(next.cost && typeof next.cost === "object" ? next.cost : {}),
    },
  };
}
