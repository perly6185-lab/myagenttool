# M3 Acceptance Closeout

M3 delivers governed lifecycle automation, a quota/ledger/billing skeleton with
real enforcement where it matters, and the Application capability runtime. Per
[NEXT_PHASE_PLAN_2026-07.md](NEXT_PHASE_PLAN_2026-07.md), this closes M3 around
**what is implemented and provable**, not around open-ended automation. Almost
all M3 server logic lives in `apps/server/src/services/m3.mjs` behind
`apps/server/src/routes/m3.mjs`.

Last refreshed after #407: ccusage Application wrapper runtime semantics are
published in the external consumer contract, and recovery explanation guidance
has seeded UI regression coverage.

## Accepted Scope

### Lifecycle recipes and execution

- Reviewable recipe lifecycle: `createLifecycleRecipe` never executes
  (`validateLifecycleRecipe` rejects `execute:true`/`run:true`); recipes move
  draft → needs_review → approved/rejected/archived.
- Layered gate before any execution: `evaluateLifecyclePolicy` →
  `allowed` / `requires_local_approval` / `blocked`; uninstall and high/critical
  risk force a human `local-approval`; `queueLifecycleAction` only enables
  execution when `buildExecutableLifecycleCommand` resolves an **allowlisted**
  command, otherwise it queues as audit evidence only.
- Real execution: the Desktop Bridge (`apps/desktop/src/index.mjs`
  `runLifecycleAction`) `spawnSync`s the resolved plan with `shell:false` and a
  10s timeout, then reports back; a failed action with `rollback.available`
  auto-creates a rollback request.
- Allowlisted commands (server `lifecycleCommandAllowlist`, mirrored byte-for-byte
  in the bridge `lifecycleCommandPlan`): `demo_agent_{version,update,health,
  rollback}`, `npm_global_install_pinned`, `npm_global_uninstall_package`,
  `ccusage_version`, `ccusage_report_probe`, restricted per action.

Acceptance evidence:

- `tools/dev/ccusage-agent-smoke.mjs` drives a pinned-ccusage install recipe
  review → approve → local-approval → queue and asserts
  `executionEnabled === true` with the pinned args; an unpinned recipe is
  blocked from queueing.
- The desktop self-check (`apps/desktop/src/index.mjs`, run by `pnpm smoke:local`
  and `desktop test:unit`) asserts the work-contract → plan mapping and rejects
  non-allowlisted command ids and `ccusage@latest`.

### Review gates

- Governance gate (`tools/github/src/index.mjs checkPullRequest`) **fails** a PR
  with no linked/closing work issue, a linked issue lacking Project Fields
  metadata, no verification evidence, or no changed files/commits. Predicates are
  shared with the org metric (`pr-evidence.mjs`, `governance.mjs`) so the per-PR
  gate and `governance-report` cannot drift.
- Risk-evidence routes (`reviewRiskGates`) flag web/product/desktop/protocol/
  adapter/security-billing/privileged-execution/release changes that lack matching
  evidence; changes to applications/capabilities/tools/agent-wrappers/bridge force
  a security-review mention.
- Enforced in CI: `.github/workflows/governance.yml` runs the gate on every
  `pull_request` under `GOVERNANCE_PROJECTS_TOKEN`, and `pr-governance` is a
  **required** status check on `main` alongside `verify` and `eval-gates`, with
  admin enforcement (#390/#397).
- Agent review wrappers (`tools/agents/{claude,codex}-review-wrapper.mjs`) run
  read-only and emit a governed RESULT with findings + reported cost, imported
  into `state.{claude,codex}ReviewFindings` and served with tenancy scoping at
  `GET /api/review-findings`.

Acceptance evidence:

- `tools/dev/claude-review-wrapper-smoke.mjs` and
  `tools/dev/ccusage-agent-smoke.mjs` (codex path) assert the RESULT contract,
  read-only permission mode, and that raw findings are stripped from public state.

### Quota, ledger, and budgets (real enforcement)

- Quota decisions enforce: `decideQuota` returns `blocked_*` reasons and
  `POST /api/m3/ai-usage` returns 409 when blocked.
- Invocation cost → ledger: a reported `total_cost_usd` becomes a **finalized**
  entry; token counts become an **estimated** entry; no cost/tokens creates
  nothing. `capLedgerEntries` never drops a spend-bearing row, so budget re-sums
  cannot under-count.
- Budgets enforce: project- and team-pool budgets with `budgetGateForProject`
  blocking new runs when over limit under policy `block`.
- Attribution: `chargebackExport` (`GET /api/m3/chargeback-export`) and ledger
  summaries by cost owner / project / agent.

Acceptance evidence:

- `tools/dev/cost-attribution-smoke.mjs`: reported cost → finalized entry +
  budget reflects it; unknown cost → no entry; a $2.50 spend survives past the
  200-entry cap. `apps/server/test/economics.test.mjs`.

### Application capability runtime

- Registration projects capabilities (`registerApplication` →
  `projectApplicationCapabilities`); `GET /api/applications/:id/capabilities`.
- Execution routes by kind (`createCapabilityInvocation`): tools → tool facade;
  non-wrapper application caps → synchronous Application Control agent; wrapper
  caps → async Application Wrapper Runner via the bridge, after tenancy/status/
  approvalToken guards. The server resolves the approved command; the bridge
  injects discrete argv.
- Unified discovery at `GET /api/capabilities` (governed tools + visible
  application caps, tenancy-filtered); the stable `GET /api/tools` facade remains.
- ccusage runs via the Application capability path (`agt_platform_application_
  wrapper`), import is non-authoritative / external-billed, and the public
  contract records the Application wrapper compatibility facade, output
  collection, billing stance, and result-import semantics (#396/#407).
- Recovery-action outcomes are explainable end-to-end:
  `applicationRecoveryActionExplanation` records selected action, reason, next
  step, recovery category, approval ids, result invocation/orchestration ids, and
  selected agent evidence (#398); the Web Applications inspector renders this
  guidance in history and suggested action cards (#403), with seeded UI
  regression coverage for pending-approval and executed recovery records (#406).

Acceptance evidence:

- `tools/dev/application-registry-smoke.mjs` (registration, discovery, wrapper
  requires `approvalToken`, plan returned with `invocationPlan.executable ===
  false`), `tools/dev/ccusage-agent-smoke.mjs` (report parity, non-authoritative
  import, raw rows stripped), `apps/desktop/test/application-wrapper-*.test.mjs`.
- `docs/engineering/fixtures/tool-registry-contract.v1.json` and
  `tools/dev/tool-registry-contract-smoke.mjs` assert that `/api/capabilities`
  publishes ccusage `compatibilityFacade`, `importedUsageEstimates`,
  `externalBilled`, and `resultImport` semantics, and that direct wrapper
  capability invocation returns the same output collection without exposing
  wrapper script paths.
- `apps/server/test/integration/tools-http.test.mjs` covers direct
  `POST /api/capabilities/app.app_ccusage.wrapper.daily/invocations` and no
  wrapper-script leakage.
- `apps/web/src/features/applications/applications-inspector.test.ts` seeds
  recovery explanation records and asserts the operator-facing guidance remains
  visible.

### Durable control-plane state (#388)

- `apps/server/src/runtime/persistence.mjs` persists 54 array surfaces + key
  objects (applications, lifecycle records, catalog/bundles, quota decisions, AI
  usage, ledger entries, budgets, audit export requests, review findings,
  invocations/events) to a versioned JSON snapshot.

Acceptance evidence:

- `tools/dev/persistence-smoke.mjs` (snapshot + restore recovers projects and
  invocations).

## Lifecycle Execution Sample (pinned ccusage)

The single allowlisted end-to-end lifecycle sample. `ccusage@20.0.14` is pinned
(`CCUSAGE_VERSION`); `npm_global_install_pinned` → `npm install -g
ccusage@20.0.14` (an unpinned `ccusage@latest` is rejected). Path:

1. `POST /api/m3/lifecycle-recipes` (ccusage source, pinned `20.0.14`).
2. `/review` → `/approve`.
3. `/policy` → `/local-approval` (`/lifecycle-approvals/:id/approve`).
4. `/queue` → `executionEnabled:true`, `command.commandId =
   npm_global_install_pinned` (args confirmed pinned).
5. Bridge polls `GET /api/bridge/lifecycle-next` → `runLifecycleAction` →
   `spawnSync("npm", ["install","-g","ccusage@20.0.14"])` → posts result →
   `completeLifecycleAction` (rollback request created on failure).

Proven by `tools/dev/ccusage-agent-smoke.mjs` and the desktop self-check.

## Safety Boundaries Preserved

- Recipes never execute server-side; execution happens only on the local bridge,
  only for allowlisted commands, only after approval + policy pass.
- No free-form or unpinned command execution; args are exact-matched.
- No automatic registration/enablement; wrapper capabilities return a plan
  (`executable === false`) until a linked bridge runs them.
- ccusage import is non-authoritative and never rolled into the metered ledger.
- Public capability discovery exposes compatibility and import semantics, not
  executable wrapper script paths, local cwd, shell, or argv internals.
- Destructive private-deployment entitlements (block export, delete user data,
  remove local software, prevent device unlink) are hardcoded off.

## Verification Baseline

```text
pnpm docs:check
pnpm repo:check
pnpm typecheck
pnpm test
pnpm smoke:local
pnpm smoke:port
git diff --check
```

## Residual Risks and Deferred Scope

Accepted as skeleton / not-executed in M3, recorded honestly rather than claimed:

- **Persistence durability.** Snapshot writes are now **atomic and fsync'd**
  (temp file → fsync → rename → dir fsync), so a crash mid-write can no longer
  leave a torn file that restore silently discarded as total loss. An accepted
  invocation is flushed through a **synchronous durable barrier**
  (`persistStateNow`) before the create returns — a crash in the debounce window
  cannot drop a run the caller was told exists (a dispatched run is already
  recoverable via its lease). Invocation create is **idempotent** on a persisted,
  tenant-scoped client key, and the **dispatch claim is proven atomic**
  (test-locked). Remaining: service arrays are still capped (`slice(0,100)`/`200`)
  so old history is lossy by design; non-critical bookkeeping writes still ride
  the 20ms debounce; and budget admission checks actual spend (no reservation
  model). A per-record append-only WAL is the scale option (backlog P1).
- **Platform-managed AI-usage pricing is skeleton.** `createLedgerEntryForUsage`
  records attribution with `unitPrice`/`amount` = `"unknown"`; real USD only comes
  from the invocation path. Quota "limit" is a request counter, not windowed
  provider metering.
- **Audit export is shape only.** External delivery is not executed
  (`external_delivery_not_executed`); the manifest checksum is synthetic, not a
  real digest. Immutability is a flag, not an enforced immutable store.
- **Signed bundles are self-declared.** `signatureStatus` is trusted input; there
  is no cryptographic verification or checksum computation.
- **Lifecycle execution proof stops at the plan.** Smokes validate command
  resolution and the work-contract → plan mapping; an actual `npm install`/ccusage
  spawn is environment-dependent and not run in CI. ccusage rollback is
  registry/manual only (`buildRollbackLifecycleCommand` is `demo_agent_rollback`).

## Non-Goals (unchanged for this phase)

Production payment/invoice/tax, paid subscription management, public marketplace
publishing and settlement, external SIEM/immutable-audit delivery, background
auto-update, and unsandboxed generated-code execution remain out of scope. See
[M3_ISSUE_PLAN.md](M3_ISSUE_PLAN.md) for the full non-goal list.

## Closeout Decision

M3 is accepted around the scope above. The delivery discipline is itself now
enforced: `main` requires `verify`, `eval-gates`, and `pr-governance`; DORA
change-failure/recovery are instrumented
([MATURITY_CALIBRATION.md](MATURITY_CALIBRATION.md)); and `pnpm test` now runs
the tool-registry contract smoke through `smoke:port`. The deferred items above
are the durability-phase backlog, not M3 gaps.

Post-M3 hardening (see [BACKLOG_PLAN_2026-07.md](BACKLOG_PLAN_2026-07.md)):
durable-state WS2 landed idempotent invocation create + atomic/fsync snapshot
writes with a durable barrier (#418, #422), and bridge-trust WS3 deepened the
local-execution boundary across all five surfaces — MCP env scoping, CLI/terminal
cwd confinement, lifecycle refusal auditing, the container descriptor guard, and
bridge-credential idle-expiry (#427, #431, #433, #437, #439). These strengthen
the durability and local-execution residual risks noted above rather than change
M3's accepted scope.
