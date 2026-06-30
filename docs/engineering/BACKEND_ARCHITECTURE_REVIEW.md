# Backend Architecture Review

Date: 2026-06-23

Scope: the control-plane backend — `apps/server/src/index.mjs` (~3.7k lines),
`apps/desktop/src/index.mjs` (bridge), `packages/protocol`, evaluated against
`docs/vision/{ARCHITECTURE,SECURITY,POLICY_AND_RISK,ECONOMIC_LEDGER}.md` and the
ADRs. This is an **architecture** assessment (boundaries, coupling, durability,
contracts, alignment), not a line-level bug review — see
`CODE_REVIEW_2026-06-23.md` for that.

Method: five parallel reviewer passes (server structure; state/persistence/
concurrency; contracts/type-safety; bridge/transport; vision/security/tenancy),
then synthesis.

## Architecturally sound (keep)

- **Invocation spine / state machine** is faithful to the vision: `createInvocation
  → evaluateInvocationPolicy → policy record → queue/dispatch → bridge ack →
  events → completeInvocation → audit + ledger`. Offline queueing, lease-based
  redelivery, and cancellation propagation are implemented.
- **Gateway abstraction**: one invoke path serves CLI / HTTP / platform adapters;
  transport hidden behind `runsWithoutBridge` / `startInvocationIfAllowed`.
- **Platform agents reuse the invocation path** (troubleshooter, integration
  builder run as real, metered, audited invocations). This is the right design —
  do not special-case them.
- **Economic ledger** genuinely matches `ECONOMIC_LEDGER.md` (reported/estimated/
  voided entries, cost-owner + agent rollups, warn/require_approval/block).
- **Domain logic is already function-decomposed** (~130 single-purpose functions;
  thin handlers). Extraction is mostly *move*, not rewrite.
- **Delivery vocabulary is transport-agnostic** (lease, cursor, idempotencyKey,
  dispatch attempts) — ADR-0002 faithful, so a transport swap is contained.
- **Cancellation / process-tree teardown** is the most production-grade part
  (SIGTERM→SIGKILL escalation, Windows taskkill, forced-kill audited).

## Architectural gaps (ranked)

1. **Identity / auth / multi-tenancy is absent — the missing load-bearing wall.**
   No auth/token/session anywhere; ~27 hardcoded `usr_local` literals.
   `requestedBy`, `costOwner`, audit `requesterId`, approval `decidedBy`, policy
   approver are all the same constant. Consequence: the governance/economics value
   props are architecturally undecidable — audit cannot attribute, budgets cannot
   isolate tenants, and any caller of `/api/approvals/:id/approve` "is" usr_local.
   This is the missing trust root, not a stub inside a feature.
2. **No persistence; capped, mutable record arrays.** `state` is an in-memory
   literal (no fs/db); `ledgerEntries`/`events` are `.slice(0, 200)` truncated.
   An audit/ledger that evaporates on restart and silently drops old entries
   cannot be "authoritative" — it can't support reconciliation, billing, dispute,
   or compliance, and historical spend is undercounted (budget drift).
3. **Bridge trust boundary is asserted, not enforced.** "The bridge owns
   execution" but `createCliSpawnPlan` spawns whatever `command`/`args` the server
   sends, with **no local allowlist/approval at execution** (risk gating lives
   only in discovery metadata). The bridge sends **no Authorization**; bridge
   endpoints gate only on a server-side `unlinkState` flag — any process that can
   reach the server URL is a bridge. The trust model is currently "trust the
   server completely," which inverts the stated principle.
4. **Contracts are decorative at runtime.** `packages/protocol` is rich TS, but
   server and bridge are `.mjs` that never import it. `Agent`/`LedgerEntry`/
   `InvocationEvent` exist in three hand-maintained copies (protocol, server
   constructors, web `console-state.ts`) and **have already drifted** (the server
   ledger entry matches the web mirror, not protocol). The bridge↔server `cost`
   contract rides on `??` defaults across a process boundary with no shared type.
5. **Concurrency: TOCTOU + dispatch claim race.** Budget admission reads spend,
   then `createInvocation` mutates, with `await` points between — concurrent
   over-budget requests can both pass. `GET /api/bridge/next` does `find` +
   `markDispatched` non-atomically → double dispatch. `idempotencyKey` is set but
   never read → redelivery can run a job twice (violates ADR-0002).
6. **Monolith + embedded test harness.** 3.7k-line single file mixes routing,
   domain logic, state, and a 267-line `runProtocolSelfCheck` that destructively
   resets the live `state`. The giant if-chain router has two matching styles and
   no declarative surface; input validation is per-handler and inconsistent.

## Prioritized roadmap (foundations first)

The reviewers converge: **identity and persistence are the two foundations**; real
permissions, authoritative audit, tenant isolation, and atomic concurrency all sit
on them. Trust-boundary and contracts follow; modularization is mechanical and
incremental.

1. **Persistence** — a durable append-only event log + ledger (e.g.
   `better-sqlite3`; synchronous transactions also close the TOCTOU/dispatch races
   in #5). The named mutators are ready-made repository seams; keep an in-memory
   adapter for `--check`. Fixes #2 and #5, and makes audit authoritative.
2. **Identity / tenancy** — authenticated principals + a device-bound bridge
   credential; `workspaceId`/`userId` on every record; derive `requestedBy`/
   `costOwner`/approver from the authenticated caller; scope state by tenant.
   Fixes #1 (and #3's credential half); converts economics/audit from fictional to
   real. Add a subject→resource permission check (`canInvoke(principal, agent,
   device)`) ahead of risk gating.
3. **Bridge execution trust gate** — a local allowlist/approval at the point of
   `runInvocation` (reuse the existing high-risk-command logic that today only
   informs discovery) + a bearer token on bridge requests. Fixes #3.
4. **Contract validator** — ship Zod schemas from `packages/protocol` for the
   boundary shapes (`InvocationCompleteBody` incl. a real `Cost`, `BridgeRegister`,
   emitted `LedgerEntry`/`Agent`), import them in the `.mjs` at the four trust
   boundaries, and derive TS types via `z.infer` to collapse the three copies.
   Higher leverage than a full TS migration (tsc cannot guarantee a separate
   process's payloads). Fixes #4.
5. **Modularization** — extract `store/`, a route table, lift the self-check to
   `test/`, then split domain modules along the existing function clusters
   (invocations / economics / discovery / integrations). Mechanical once the store
   and router exist.

## Orca lens (`~/projects/orca`)

- **Borrow**: Orca's `src/relay` (`pty-handler`, `subprocess`, `remote-cli`, SSH)
  is the reference for the execution channel and remote execution (already noted
  in `REMOTE_EXECUTION_RESEARCH.md`); its `agent-trust-presets` is a ready model
  for the bridge execution trust gate (#3).
- **Does not transfer**: Orca is a local-first, single-user Electron desktop app.
  It does not solve multi-tenant auth, cloud persistence, or tenant isolation
  (#1/#2) — those are myagenttool's own control-plane responsibility and the core
  differentiator. Look to Orca for transport/execution robustness; build the
  identity/persistence load-bearing wall yourself.

## Bottom line

The execution machinery and the economic-ledger model are genuinely well-built,
and platform-agent reuse is the right call. But identity is a load-bearing wall
that was never built: without it, the governance/economics differentiators are
well-implemented mechanisms attributing to a fictional single user over volatile
in-memory state. Persistence and identity, in that order, are the next
foundations.
