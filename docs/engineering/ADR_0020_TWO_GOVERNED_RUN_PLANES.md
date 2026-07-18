# ADR 0020: The invocation plane and the loop plane are two deliberately separate governed-run planes over one shared governance vocabulary

Status: proposed · 2026-07-18

Date: 2026-07-18

Decision: Proposed during the 2026-07 architecture governance review. This ADR
does not change code; it names an existing structural reality so future readers
do not "fix" it by merging. It records that the duplication between the two
planes is intentional, and fixes the rules under which they may converge or
diverge.

Related issue: none yet — raised during the architecture-and-workflow overview
pass (`docs/ARCHITECTURE_OVERVIEW.md`).

## Context

The repository runs **two independent systems that implement the same set of
governance primitives**:

1. **The invocation plane** (`apps/server`) governs *the execution of external
   agents on a user's machine*. It has:
   - a run state machine — `Invocation.status`
     (`created → authorized → queued → running → succeeded / failed / cancelled`,
     plus `waiting_for_local_approval` / `rejected`) and a separate
     `Invocation.delivery.state`
     (`queued → dispatching → acknowledged → complete`, with
     `redelivering / refused / exhausted`), `packages/protocol/src/invocation.ts`;
   - a queue with leases — `delivery` records, `markDispatched` stamps a ~30s
     `leaseExpiresAt`, `redeliverExpiredDispatches` requeues, capped at
     `MAX_DISPATCH_ATTEMPTS = 5` (`apps/server/src/services/invocations/`);
   - a human approval gate — `approvalGrants` (single-use, ~10 min, action- and
     target-scoped) and the approval broker (`docs/design/APPROVAL_GRANTS.md`);
   - an audit trail — `traces / spans / events`, plus a closed `refusal`
     taxonomy (`not_granted → policy → state → human`,
     `packages/protocol/src/refusal.ts`).

2. **The loop plane** (`tools/ai`) governs *the platform's own delivery of code
   changes* (idea → PR). It has:
   - a run state machine — `LOOP_RUN_STATES`
     (`created → planning → planned → applying → running_adapter →
     checking_scope → verifying`, control states `awaiting_human / queued /
     claimed`, terminals `completed / failed / cancelled / timed_out`,
     `tools/ai/src/loop/registry.mjs`);
   - a queue with leases — `enqueue → claim → heartbeat → release →
     timeout-check`, a ~60s lease under a registry lock (same file);
   - a human approval gate — `createLoopHumanGate` / `applyLoopHumanGate`
     (`gateId / state / reason / risk / scope`, states
     `none / requested / approved / rejected / expired`);
   - an audit trail — per-run append-only `events.jsonl` (source of truth) plus a
     rebuildable `registry.json` projection.

The two are structurally near-identical — run state machine, queue + lease +
heartbeat + timeout, human gate keyed on a risk class, append-only event log with
a rebuildable projection — yet share almost no code. A reader who notices the
parallel will be tempted to extract a single "governed-run kernel" and have both
planes use it. This ADR decides whether that is correct.

## Decision

**Keep two planes. Converge their vocabulary; do not merge their runtimes.**
Five invariants:

1. **Two planes, two blast radii — they must be able to fail independently.**
   The invocation plane governs *untrusted external agents executing on a user's
   machine*; the loop plane governs *the trusted platform toolchain mutating this
   repository*. Different trust boundary, different persistence (SQLite-mirrored
   in-memory `state` vs. `.myagenttool/` file-backed event logs), different
   failure domain. A single shared runtime would couple two systems whose whole
   point is to fail, deploy, and be reasoned about separately.

2. **Shared vocabulary lives in `packages/protocol`; shared runtime does not
   exist.** The *concepts* — run state machine, queue + lease + heartbeat +
   timeout, human gate (`requested / approved / rejected / expired`), append-only
   event log + rebuildable projection, risk-class → gate — are the same and must
   be *named* the same across both planes. Where a type can be shared it lives in
   protocol (already true for `invocation.ts`, `refusal.ts`, `loop.ts`,
   `routine.ts`); the executing code stays per-plane.

3. **Neither plane's autonomy crosses the other's approval gate.** A loop
   plane worktree-promotion approval never implies an invocation-plane approval
   grant, and vice versa. This is the project-wide "autonomy never crosses an
   approval gate" invariant applied across the two planes: the gates are
   independent by construction, never transitively satisfied.

4. **Parallel by construction; divergence is a recorded decision, not drift.**
   When one plane adds a control state, a gate outcome, or a lease rule, the
   change must state whether the other plane mirrors it. The two are *allowed* to
   differ (they already do — the loop plane grades `timed_out` as a distinct
   terminal; the invocation plane folds timeouts into `failed`), but each such
   difference is a documented choice, not an accident of separate authorship.

5. **No "governed-run kernel" extraction until a third plane exists.** The
   rule of three governs: two parallel implementations is the accepted cost of
   independence. A shared execution kernel is out of scope until a third governed
   plane appears and the shared shape is proven by three examples, not guessed
   from two.

## Consequences

- Future readers stop treating the duplication as debt to be paid down by
  merging; the ADR is the answer to "why are there two queue/gate/state-machine
  implementations?"
- Convergence has a concrete channel: move genuinely shared enums (gate state,
  risk class) into `packages/protocol` and have both planes import them, without
  touching either runtime. This is safe, incremental, and reversible.
- The two failure domains stay independent: a wedged loop worker cannot stall
  invocation dispatch, and an invocation-plane storage incident cannot corrupt
  loop run history.
- Cost: the parallel must be maintained by discipline (invariant 4), not enforced
  by a shared type at every point. A lightweight periodic diff of the two state
  vocabularies (a doc or a test) is the recommended guard.

## Testable rules

- The human-gate **state** enum (`requested / approved / rejected / expired`) and
  the **risk class** used to trip a gate have a single definition imported by both
  planes, or an open follow-up to move them into `packages/protocol`.
- No module under `tools/ai/src/loop` imports from `apps/server`, and no module
  under `apps/server` imports from `tools/ai` — the planes share types, never a
  runtime.
- Each plane's run state machine is a closed enum with an explicit terminal set;
  a new state or gate outcome in either plane cites this ADR and states the
  other plane's treatment.
