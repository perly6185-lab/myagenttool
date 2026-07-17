/*
 * #890.2 unit-of-work boundary for the highest-value logical operations —
 * invocation acceptance and completion.
 *
 * Persistence is a single-file atomic snapshot (durableWriteFileSync: temp →
 * fsync → atomic rename), so a flush is all-or-nothing across every collection;
 * {invocation, its embedded idempotency key + dispatch-claim fields, policy
 * record, ledger entry, events} cannot tear relative to each other WITHIN one
 * flush. The remaining risk is the DEBOUNCE window: a write left to the 20ms
 * `persistStateSoon` timer is lost if the process dies before it fires. The accept
 * path already closed this for the happy case with a synchronous barrier; the
 * rejection returns and the whole COMPLETION path (terminal status + ledger entry)
 * did not — a crash there re-runs the invocation and double-charges.
 *
 * `runStateTransaction` makes the boundary explicit and unconditional: run the
 * mutations, then flush ONCE with the synchronous barrier on EVERY exit (normal
 * return, early return, or throw). Callers stop having to remember a barrier at
 * each return, and a future partial-record store can hook `commit` to open/commit
 * a real transaction here without touching call sites.
 */

/**
 * @param {(() => void)|undefined} commit - the synchronous durable barrier
 *   (persistStateNow). Falls through to a no-op if not provided (some hermetic
 *   test harnesses inject only the debounced writer); pass that as `commit` to
 *   preserve today's behavior in those cases.
 * @param {() => T} fn - the state-mutating body.
 * @returns {T}
 * @template T
 */
export function runStateTransaction(commit, fn) {
  try {
    return fn();
  } finally {
    if (typeof commit === "function") commit();
  }
}
