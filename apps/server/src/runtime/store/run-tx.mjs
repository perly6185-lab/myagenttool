/*
 * #1001 (Epic #1000) — a service's durable unit-of-work commit, extracted so the
 * Phase A write-migration sweep doesn't re-define it per service (the pattern was
 * established inline by #968 for dispatch/approval/lifecycle).
 *
 * `runTx(fn)` runs the mutating body, then commits: through the Store's transaction
 * when one is wired (the durable path — the transaction owns the flush), else via
 * the debounced writer (the unchanged default where no store is injected, e.g. a
 * hermetic unit test). The body mutates `state` in place; the transaction is the
 * atomic boundary. Under the default in-memory adapter this is byte-identical to
 * the prior `mutate + persistStateSoon`, so each migration lands as a no-op.
 */
export function makeRunTx({ store, persistStateSoon } = {}) {
  return (fn) => {
    if (typeof store?.transaction === "function") return store.transaction(fn);
    const result = fn();
    if (typeof persistStateSoon === "function") persistStateSoon();
    return result;
  };
}
