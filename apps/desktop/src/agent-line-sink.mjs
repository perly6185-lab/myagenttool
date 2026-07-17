/**
 * Line sink for a CLI child's stdio stream — owns chunk→line buffering and
 * serializes the async per-line handler into one awaitable chain.
 *
 * Why serial + awaited (#1228): the per-line handler posts events to the server
 * and, for the jsonl adapters, returns the run's terminal result only after
 * those round trips. The runner used to fire it without awaiting, so a child
 * that prints its result line and exits immediately (the normal CLI behavior)
 * let `close` win the race: /api/bridge/complete was posted while the result
 * line was still inside its HTTP round trip — the summary degraded to the
 * generic fallback, usage/cost attribution was lost, and the line's events
 * landed after invocation_completed. A serial chain keeps stream order (event
 * posts cannot reorder under latency jitter) and gives the runner a single
 * promise to drain before it reports any outcome.
 */
export function createAgentLineSink(handleLine, { onError } = {}) {
  let buffer = "";
  let chain = Promise.resolve();

  function enqueue(line) {
    chain = chain
      .then(() => handleLine(line))
      .catch((error) => {
        // A bad line (e.g. malformed RESULT json) fails that line only — never
        // the rest of the chain, and never the process-level unhandledRejection
        // backstop. onError itself must not be able to break the chain either.
        try {
          onError?.(error, line);
        } catch {
          /* swallow: reporting a line failure must not fail the sink */
        }
      });
  }

  return {
    /** Feed a stdio chunk; every COMPLETE line is enqueued, the partial tail
     * stays buffered until the next chunk or flush(). */
    push(chunk) {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        enqueue(line);
      }
    },
    /** Enqueue the residual partial line (trimmed, matching the runner's old
     * residual handling) and wait for every handler to settle. Idempotent. */
    async flush() {
      const rest = buffer.trim();
      buffer = "";
      if (rest) {
        enqueue(rest);
      }
      await chain;
    },
  };
}
