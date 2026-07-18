/**
 * #1302 follow-up (long-poll): a per-device wakeup so GET /api/bridge/cancellations
 * can hold a request open until a cancellation is actually requested, instead of
 * the bridge polling every 250ms. `wait(deviceId)` resolves when `notify(deviceId)`
 * fires (a run on that device was asked to cancel) or after a max-wait timeout —
 * whichever comes first. The caller cancels the wait on client disconnect so a
 * dropped long-poll never leaks a held resolver.
 *
 * This is intentionally tiny and transport-agnostic: the route computes the
 * actual cancel-requested set before and after waiting; the signal only answers
 * "did anything on this device change — should you look again yet?".
 */
export function createCancellationSignal({ maxWaitMs = 25_000 } = {}) {
  const waiters = new Map(); // deviceId -> Set<settle>

  function wait(deviceId) {
    let settle;
    const promise = new Promise((resolve) => {
      const timer = setTimeout(() => settle(), maxWaitMs);
      settle = () => {
        // Idempotent: clearing a cleared timer, deleting a missing entry, and
        // resolving twice are all no-ops, so notify + timeout + disconnect can
        // race freely.
        clearTimeout(timer);
        const set = waiters.get(deviceId);
        if (set) {
          set.delete(settle);
          if (set.size === 0) waiters.delete(deviceId);
        }
        resolve();
      };
      const set = waiters.get(deviceId) ?? new Set();
      set.add(settle);
      waiters.set(deviceId, set);
    });
    return { promise, cancel: () => settle() };
  }

  function notify(deviceId) {
    const set = waiters.get(deviceId);
    if (!set) return;
    // Copy first: settle() mutates the set as it resolves each waiter.
    for (const settle of [...set]) settle();
  }

  return {
    wait,
    notify,
    // Test/introspection hook.
    waiterCount: (deviceId) => (deviceId ? waiters.get(deviceId)?.size ?? 0 : [...waiters.values()].reduce((n, s) => n + s.size, 0)),
  };
}
