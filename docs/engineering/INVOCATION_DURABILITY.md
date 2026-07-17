# Invocation Acceptance & Completion Durability (#890.2)

The bounded unit-of-work slice of #890: make the two highest-value invocation
transitions — **acceptance** and **completion** — durable on every exit, so a
crash cannot lose a run the caller was told exists, lose a rejection's audit, or
(the important one) lose a committed ledger charge and re-run the invocation.

## Why a whole-file snapshot still had torn windows

Persistence is a single-file atomic snapshot (`durableWriteFileSync`: temp →
fsync → atomic rename), so a flush is all-or-nothing across every collection —
{invocation, its embedded idempotency key + dispatch-claim fields, policy record,
ledger entry, events} cannot tear relative to each other *within* one flush. The
risk was never a partial write; it was the **debounce window**. A write left to
the 20 ms `persistStateSoon` timer is lost if the process dies before it fires.
Two barriers exist:

- `persistStateSoon()` — 20 ms debounced, lossy on a crash in the window.
- `persistStateNow()` — synchronous flush (cancels the pending debounce). The
  only durable barrier.

The accept happy-path already flushed synchronously. Two paths did not:

- **W1 — rejection returns.** A quota/budget rejection returned after only
  `persistStateSoon()`, so a crash in the window lost the whole rejection
  (invocation `status:"rejected"`, refusal record, audit summary).
- **W3 — completion + ledger (the important one).** `completeInvocation` and the
  ledger entry it records both ended with `persistStateSoon()` only. A crash in
  the window recovered the run as still `running`; its dispatch lease then expired
  and `redeliverExpiredDispatches` requeued it → the agent **re-executed AND a
  second ledger entry was recorded (double charge)**.

## The unit-of-work boundary

`runStateTransaction(commit, fn)` (`runtime/state-transaction.mjs`) runs the
mutating body, then flushes ONCE with the synchronous barrier on every exit
(return, early return, or throw). It makes the commit unconditional and names the
boundary, so callers stop hand-placing a barrier at each return and a future
partial-record store can hook `commit` to open/commit a real transaction without
touching call sites.

- **Acceptance** (`invocations/creation.mjs`): every exit — queued/running,
  awaiting-approval, or a quota/budget rejection — commits through one
  synchronous `commitAccept` barrier. Closes W1.
- **Completion** (`invocations/completion.mjs`): the terminal status + result +
  ledger entry + audit commit inside `runStateTransaction` before the function
  returns and before the fire-and-forget reaction hook runs. Closes W3.

## What is deliberately NOT in this slice

- **The dispatch claim / lease** (`markDispatched`) stays a separate,
  lease-recoverable step persisted by debounce. Folding it into the accept unit is
  a lifecycle change, not a barrier move; an interrupted claim is safe today
  because the invocation stays `queued` and is re-dispatched (idempotent).
- **The full transactional / append-only store** (route every service write
  through a repository) remains the rest of #890, and coordinates with #124's
  storage design rather than repeating it.

## Verification

`test/invocation-durability.test.mjs` models a crash by making `persistStateSoon`
a no-op (the eaten debounce) while `persistStateNow` really flushes, then reloads
from disk: an accepted run + its idempotency key, a rejection + its refusal/audit,
and a completion + its single ledger entry all survive; idempotency dedup holds
across restart; a redelivered completion does not double-charge. Reverting the
completion barrier to the debounce makes the W3 tests fail — the tests bite.
