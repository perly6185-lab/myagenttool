# Next Phase Plan (2026-07)

## Decision

Adopt the next-phase strategy: stop broadening the platform and make the
already-built control-plane loops durable, locally enforceable, and closable.

The current codebase already has the major M0-M3 product shapes: web/server/
desktop, identity and tenancy, governed tools, Application capabilities,
lifecycle recipes, quota/ledger records, private deployment contracts, and
ccusage moving through the Application capability path. The next phase should
turn those shapes into dependable product foundations.

## Operating sequence

```text
1. Re-baseline planning docs and local verification.
2. Add durable state for audit, ledger, invocation, application, and identity.
3. Enforce the Desktop Bridge trust boundary at local execution time.
4. Close the Application capability runtime around ccusage.
5. Close M3 with evidence, residual risks, and one lifecycle execution sample.
```

## Workstream 1 - Re-baseline

Purpose: make the repo's written plan match the latest code.

Acceptance:

- `BACKLOG_PLAN_2026-07.md` points to durable state, bridge trust, Application
  runtime, and M3 closeout as the active priorities.
- Milestone references include this plan.
- Local verification commands are recorded before deeper implementation begins.

Verification:

```text
pnpm docs:check
pnpm repo:check
git diff --check
```

## Workstream 2 - Durable State

Purpose: make audit, billing, invocation, and identity records survive restart
and stop relying on capped in-memory arrays.

First slice:

- Introduce a store boundary with durable and in-memory implementations.
- Persist users, teams, tokens, projects, invocations, events, approvals,
  applications, lifecycle records, quota decisions, AI usage, and ledger rows.
- Keep tests hermetic by defaulting test fixtures to the in-memory store.
- Use transactional writes for dispatch claims, idempotency, and budget
  admission where the current mutable state can race.

Out of scope:

- Cloud database operations.
- Full schema migration framework.
- Analytics warehouse or billing provider integration.

## Workstream 3 - Bridge Trust Boundary

Purpose: make local execution consent real instead of relying only on server
policy.

First slice:

- Implementation status: the first P2 cut now issues a device-bound bridge
  bearer, requires it on `/api/bridge/*` work routes, and refuses non-allowlisted
  local CLI spawn plans before process start using an auditable local policy
  manifest with file/network policy checks.
- Register or issue a device-bound bridge credential.
- Require bridge credentials on bridge polling and completion routes.
- Add a local execution gate before process start.
- Check command id, executable, args, cwd, file/network policy, and approval
  evidence against a local allowlist.
- Return explicit refusal events when the bridge declines execution.

Out of scope:

- Remote device management.
- Silent install, update, uninstall, or remediation.
- Replacing the current transport.

## Workstream 4 - Application Capability Runtime

Purpose: make the Application path the primary pattern for governed software
assets without breaking the stable tool facade. The next cut is a closed-loop
slice, not another descriptor-only slice:

```text
discover -> access -> execute -> result
```

First slice:

- Implementation status: the first P3 cut now publishes ccusage Application
  wrapper compatibility metadata through `/api/capabilities` and carries the
  same output/import/billing semantics into queued wrapper invocations.
- Second-slice status: recovery action responses and the state read model now
  expose an `explanation` object for selected action, guard/refusal reason,
  execution result ids, and the operator next step.
- Third-slice status: the Web Applications inspector now renders recovery
  guidance from `explanation`, including approval request, duplicate guard,
  result invocation/orchestration, agent choice, and next-step evidence.
- Closeout status: ccusage Application wrapper semantics are published in the
  external consumer contract and enforced by the tool-registry contract smoke;
  recovery guidance has seeded UI regression coverage.
- Discovery: keep `/api/capabilities?providerType=application` and
  `/api/applications/:id/capabilities` as the supported surfaces, with
  readiness, risk, approval, schema, output collection, and result-import
  metadata present without exposing wrapper internals.
- Access: require owner-scoped authorization plus explicit approval for
  side-effecting Application capabilities, and keep local bridge allowlist
  checks for command id, cwd, args, env, file policy, and network policy before
  any spawn.
- Execution: wire the approved `installed-wrapper` path through the normal
  invocation/trace/audit flow for ccusage first, preserving reviewed wrapper
  argv construction and rejecting free-form npm execution.
- Result: import completion output into the declared read model, attach result
  refs to invocation/Application/audit evidence, and render result links plus
  next-step guidance in Applications and Invocations.
- Keep `/api/tools/ccusage.report` stable for consumers.
- Source the ccusage descriptor and execution path from the Application
  capability path where parity is already proven.
- Preserve dynamic filters, import metadata, external-billed semantics, and
  smoke coverage.
- Keep recovery explainability assertions green across approval pending,
  duplicate-action guard, regenerate, rerun, view-only, and agent-selection
  recovery paths.
- Keep the operator-facing recovery guidance visible in history and suggested
  action cards so blocked/pending/executed recoveries do not require reading
  raw JSON.

Out of scope:

- General marketplace packaging.
- Arbitrary npm execution.
- Free-form wrapper arguments.

Acceptance:

- A ccusage Application capability can be registered, probed, discovered,
  approved, bridge-executed, completed, imported, and inspected through both API
  contract tests and the Web UI.
- Regression coverage includes happy path, access denied, duplicate guard,
  bridge/local-policy refusal, restart/read-model restore, and stable
  `/api/tools/ccusage.report` compatibility.

## Workstream 5 - M3 Closeout

Purpose: close the milestone around verified capability rather than open-ended
automation.

First slice:

- Status: `M3_ACCEPTANCE_CLOSEOUT.md` exists and is refreshed with accepted
  scope for lifecycle recipes, review gates, quota/ledger, private deployment
  shape, catalog/bundle metadata, and Application capability runtime.
- The allowlisted lifecycle execution sample is pinned ccusage npm lifecycle.
- Residual risks are recorded for persistence, external export sinks, public
  marketplace, payment, invoice, tax, and full repeatable workflows.

Out of scope:

- Production payment processing.
- Public marketplace publishing.
- External SIEM delivery.
- Unsandboxed generated code execution.

## Phase gate

Do not start broad new adapters or marketplace work until these are true:

- Audit and ledger rows survive restart.
- Bridge execution requires local credential and local allowlist approval.
- ccusage remains green through the Application-backed compatibility facade.
- M3 closeout records accepted scope and deferred risks.
