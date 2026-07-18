/**
 * #1251/#1302: one shared cancellation channel for the whole device.
 *
 * Each in-flight run used to poll GET /api/bridge/cancel-status every 250ms on
 * its own timer — N runs meant N HTTP round trips per tick. This watcher runs a
 * single long-poll loop over GET /api/bridge/cancellations?wait=1 (the
 * device-wide multiplex) and fires a per-run handler the first time that run's
 * id appears in the cancel-requested set. HTTP cost is O(1) in the number of
 * concurrent runs.
 *
 * #1302 long-poll: the server parks the request until a cancellation for this
 * device or a max-wait timeout, so a busy-but-uncancelled device makes ~one call
 * per max-wait window (not 4/second) and a cancellation is delivered
 * near-instantly. Against an older server that ignores ?wait=1 and answers
 * immediately, the per-cycle floor makes the loop degrade gracefully to ~250ms
 * polling instead of spinning.
 *
 * The handler owns the actual reaction (terminate + event posts) and its own
 * error handling, so the #1250 terminal-race guards live in the caller's
 * closure, not here. A handler fires at most once per run; unsubscribe on the
 * run's terminal path so a completed run is never fired.
 */
export function createCancellationWatcher({ request, idleMs = 250, minCycleMs = 250, onError } = {}) {
  const handlers = new Map(); // invocationId -> { fired, handler }
  let running = false;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function dispatch(response) {
    const requested = new Set(Array.isArray(response?.invocationIds) ? response.invocationIds : []);
    for (const [id, entry] of handlers) {
      if (entry.fired || !requested.has(id)) continue;
      entry.fired = true;
      // Fire WITHOUT awaiting: a handler that awaits terminateProcessTree (up to
      // the kill grace) must not delay the loop from parking on the next poll.
      Promise.resolve().then(entry.handler).catch((error) => onError?.(error, id));
    }
  }

  // One long-poll: parks server-side (?wait=1) until a cancellation for this
  // device or the server's max-wait timeout, then dispatches. Standalone for tests.
  async function pollOnce() {
    if (handlers.size === 0) return;
    try {
      const response = await request("GET", "/api/bridge/cancellations?wait=1");
      dispatch(response);
    } catch (error) {
      // A transient failure (server blip) just ends this cycle; the loop retries.
      onError?.(error, null);
    }
  }

  async function loop() {
    while (running) {
      if (handlers.size === 0) {
        // Nothing to watch → don't hold a poll open; re-check soon so a
        // freshly-spawned run starts being watched within idleMs.
        await delay(idleMs);
        continue;
      }
      const startedAt = Date.now();
      await pollOnce();
      const elapsed = Date.now() - startedAt;
      if (running && elapsed < minCycleMs) {
        await delay(minCycleMs - elapsed);
      }
    }
  }

  return {
    /** Watch one run; returns an unsubscribe to call on its terminal path. */
    watch(invocationId, handler) {
      handlers.set(invocationId, { fired: false, handler });
      return () => handlers.delete(invocationId);
    },
    start() {
      if (running) return this;
      running = true;
      // Fire-and-forget loop; it exits after the current poll once running flips.
      void loop();
      return this;
    },
    stop() {
      running = false;
    },
    // Test hooks.
    pollOnce,
    size: () => handlers.size,
  };
}
