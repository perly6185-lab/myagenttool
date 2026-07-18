/**
 * #1251: one shared cancellation poll for the whole device.
 *
 * Each in-flight run used to poll GET /api/bridge/cancel-status every 250ms on
 * its own timer — N runs meant N HTTP round trips per tick. This watcher runs a
 * single 250ms GET /api/bridge/cancellations (the device-wide multiplex) and
 * fires a per-run handler the first time that run's id appears in the
 * cancel-requested set. HTTP cost is O(1) in the number of concurrent runs
 * instead of O(N); the ~250ms cancel latency is unchanged.
 *
 * The handler owns the actual reaction (terminate + event posts) and its own
 * error handling, so the #1250 terminal-race guards live in the caller's
 * closure, not here. A handler fires at most once per run; unsubscribe on the
 * run's terminal path so a completed run is never fired.
 */
export function createCancellationWatcher({ request, intervalMs = 250, onError } = {}) {
  const handlers = new Map(); // invocationId -> { fired, handler }
  let timer = null;
  let polling = false;

  async function pollOnce() {
    // Nothing to watch → no HTTP at all (an idle bridge makes zero cancel calls).
    // `polling` guards against overlap if a poll outlives the interval.
    if (handlers.size === 0 || polling) return;
    polling = true;
    try {
      const response = await request("GET", "/api/bridge/cancellations");
      const requested = new Set(Array.isArray(response?.invocationIds) ? response.invocationIds : []);
      for (const [id, entry] of handlers) {
        if (entry.fired || !requested.has(id)) continue;
        entry.fired = true;
        // Fire WITHOUT awaiting: a handler that awaits terminateProcessTree (up
        // to the kill grace) must not delay detecting other runs' cancellations.
        Promise.resolve().then(entry.handler).catch((error) => onError?.(error, id));
      }
    } catch (error) {
      // A transient GET failure (server blip) just skips this tick; the next one
      // retries. Never let it escape as an unhandled rejection.
      onError?.(error, null);
    } finally {
      polling = false;
    }
  }

  return {
    /** Watch one run; returns an unsubscribe to call on its terminal path. */
    watch(invocationId, handler) {
      handlers.set(invocationId, { fired: false, handler });
      return () => handlers.delete(invocationId);
    },
    start() {
      if (!timer) {
        timer = setInterval(() => { void pollOnce(); }, intervalMs);
      }
      return this;
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    // Test hooks.
    pollOnce,
    size: () => handlers.size,
  };
}
