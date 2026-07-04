# M3 Issue Plan

This document plans the first M3 Lifecycle Automation and Billing development
batch, its five implementation PRs, and the acceptance map for the remaining
milestone.

## M3 Goal

Approved lifecycle recipes, platform-managed AI billing controls, chargeback
records, private deployment packaging, signed extension metadata, and repeatable
workflows become governed product capabilities without weakening local approval,
audit, or user data ownership.

## Issue Tree

| Order | Issue | Scope | First PR batch? |
| --- | --- | --- | --- |
| 1 | M3 Issue Plan and Acceptance Map | Define the M3 issue tree, acceptance map, sequencing, and safety boundary | Yes |
| 2 | Lifecycle Recipe Artifact Schema | Add declarative install, update, uninstall, rollback, source, signature, and compatibility artifact schema | Yes |
| 3 | Lifecycle Review and Approval Gates | Add review, policy, and local approval gates for lifecycle actions before any bridge execution | Yes |
| 4 | Billing Ledger and Quota Enforcement Skeleton | Turn M2 quota records into enforceable platform-managed AI decisions and auditable ledger entries | Yes |
| 5 | Private Deployment and Audit Export Shape | Add private deployment export, immutable audit option, alert sink, and SIEM export configuration contracts | Yes |
| 6 | Private Catalog and Signed Bundle Verification | Add private catalog read model, signed bundle metadata, and compatibility checks | No |
| 7 | Repeatable Task Templates | Save and repeat approved task patterns without rebuilding plans from scratch | No |
| 8 | Lifecycle Execution MVP | Queue approved recipe-driven lifecycle actions to Desktop Bridge under explicit local approval | No |
| 9 | Billing Reporting, Credits, and Chargeback Export | Add dashboards, soft and hard quota notifications, credit placeholders, and chargeback exports | No |
| 10 | M3 Acceptance Closeout | Close the M3 initiative with verification evidence and residual risks | No |

## Five Development PRs

### PR 1: M3 Issue Plan

Create the planning artifact that keeps M3 narrow enough to build safely:

- Map M3 acceptance criteria to concrete issues and later batches.
- Mark which M3 criteria are intentionally deferred beyond the first PR batch.
- Preserve cross-milestone gates for local execution, audit, quota, metering,
  and plain-language user flows.
- Capture residual M2 follow-up that must be handled before commercializing
  lifecycle or billing flows.
- Document the five development PRs and their verification expectations.

Accepted implementation scope:

- `docs/engineering/M3_ISSUE_PLAN.md` exists and is linked from the milestone
  index.
- The first implementation batch is limited to the five PRs in this document.
- Later M3 surfaces are named but not pulled into the first implementation
  batch.
- The plan explicitly excludes silent install, silent uninstall, public
  marketplace publishing, production payment integration, and arbitrary
  generated code execution.
- No runtime behavior changes in this PR.

Suggested files:

- `docs/engineering/M3_ISSUE_PLAN.md`
- `docs/engineering/MILESTONES.md`

Verification:

```text
pnpm docs:check
pnpm repo:check
git diff --check
```

### PR 2: Lifecycle Recipe Model

Define lifecycle recipes as reviewable artifacts before adding execution:

- Install, update, and uninstall recipe artifact types.
- Source, author, version, checksum, signature status, compatibility range, and
  supported platform metadata.
- Required permissions, risk tags, expected binary or endpoint, health check,
  rollback availability, migration notes, and uninstall limits.
- Plain-language summary fields for recipe source, action, risk, rollback,
  local approval, and data impact.

Accepted implementation scope:

- Shared protocol types or schemas represent lifecycle recipe artifacts.
- Server-side validation refuses malformed recipes, unsupported lifecycle
  actions, missing source metadata, and unsafe uninstall defaults.
- Review state and generated/source metadata match the existing integration
  artifact review model where practical.
- Recipe artifacts are stored and auditable but do not execute install, update,
  uninstall, or migration commands in this issue.
- Tests or self-checks cover valid recipes, invalid recipes, missing rollback
  metadata, unsupported platforms, and unsafe uninstall defaults.

Suggested files:

- `packages/protocol/src/*`
- `apps/server/src/services/*`
- `apps/server/src/index.mjs`
- `apps/web/public/app/*` only if a read model needs a minimal display hook

Verification:

```text
pnpm --filter @myagenttool/protocol test
pnpm --filter @myagenttool/protocol typecheck
pnpm --filter @myagenttool/server test
pnpm typecheck
pnpm test
git diff --check
```

### PR 3: Lifecycle Review Gates

Add the control-plane state machine for lifecycle actions without broad
automation:

- Review, approve, reject, archive, request local approval, grant local
  approval, deny local approval, and expire approval states.
- Policy checks for source trust, signature status, action risk, supported
  platform, bridge-managed ownership, and rollback availability.
- Local approval evidence for high-risk actions, especially uninstall.
- Clear refusal reasons and audit events when lifecycle actions cannot proceed.

Accepted implementation scope:

- Lifecycle actions cannot be queued for Desktop Bridge execution unless the
  recipe is reviewed, policy is allowed, and required local approval is present.
- Uninstall defaults to bridge-managed agents only; manually registered agents
  can remove registry state without deleting underlying software unless the user
  explicitly approves a stronger action.
- Approval records include requester, device, agent, recipe id, action, risk,
  source, signature status, rollback summary, and expiration.
- Web Console or API read models expose plain-language lifecycle status and
  refusal reasons.
- No issue in this first PR batch runs package managers, shell installers,
  update commands, uninstall commands, or background auto-update.

Suggested files:

- `packages/protocol/src/*`
- `apps/server/src/services/*`
- `apps/server/src/index.mjs`
- `apps/desktop/src/*` only for local approval evidence contracts, not command
  execution
- `apps/web/public/app/*`

Verification:

```text
pnpm --filter @myagenttool/protocol test
pnpm --filter @myagenttool/server test
pnpm --filter @myagenttool/desktop test
pnpm --filter @myagenttool/web test
pnpm smoke:local
pnpm typecheck
pnpm test
git diff --check
```

### PR 4: Billing Ledger Foundation

Promote M2 quota decisions from record-only governance into enforceable
platform-managed AI and ledger gates:

- Quota policy dimensions for user, team, provider, model, agent, and time
  window.
- Pre-call quota decisions for platform-managed AI provider mode.
- AI usage records with attribution, provider, model, token counts when known,
  request count, latency, status, error code, estimated cost, and created time.
- Ledger entries for estimated cost, chargeback owner, revenue assumption,
  quota decision, and related invocation or agent.
- Export-ready reporting shape for user, team, agent, invocation, and provider.

Accepted implementation scope:

- Platform-managed AI calls require a quota decision before execution.
- Blocked quota decisions prevent the model call and create audit evidence.
- Allowed calls create usage and ledger records, even when cost remains
  `unknown`.
- BYOK and local-model modes remain attributable and auditable but do not create
  SaaS billable charges by default.
- The skeleton can run without a payment provider, invoice generator, tax
  handling, or subscription plan engine.
- Tests or self-checks cover allowed quota, blocked quota, missing credential,
  disabled provider, unknown cost, and chargeback export shape.

Suggested files:

- `packages/protocol/src/economics.ts`
- `apps/server/src/services/*`
- `apps/web/public/app/*`
- `tools/dev/*` for focused smoke or self-check coverage

Verification:

```text
pnpm --filter @myagenttool/protocol test
pnpm --filter @myagenttool/server test
pnpm --filter @myagenttool/web test
pnpm smoke:local
pnpm typecheck
pnpm test
git diff --check
```

### PR 5: Private Deployment and Audit Export

Add private deployment and audit-export contracts as a shape, not a full
enterprise implementation:

- Audit export format for invocation, lifecycle, quota, usage, ledger, and
  policy evidence.
- Immutable audit sink configuration shape and capability flags.
- Alert sink and SIEM export configuration models.
- Private deployment mode and entitlement capability flags.
- Export dry-run or validation read model that proves configuration is
  parseable and auditable without sending data to external systems.

Accepted implementation scope:

- Server or shared protocol contracts represent private deployment export
  settings, immutable audit options, alert sinks, SIEM sinks, and export
  request metadata.
- Audit export read models include enough references to trace records back to
  invocations, lifecycle actions, quota decisions, usage records, ledger
  entries, and policy decisions.
- Export validation can report missing sink configuration, unsupported sink
  types, disabled private deployment capabilities, and retention conflicts.
- No external SIEM, storage, license server, or immutable ledger provider is
  required.
- No entitlement change can silently delete data, remove local software, block
  owned data export, or prevent device unlinking.

Suggested files:

- `packages/protocol/src/*`
- `apps/server/src/services/*`
- `apps/server/src/index.mjs`
- `docs/vision/DEPLOYMENT.md` only if the contract needs clarification

Verification:

```text
pnpm --filter @myagenttool/protocol test
pnpm --filter @myagenttool/server test
pnpm typecheck
pnpm test
pnpm docs:check
git diff --check
```

## Later M3 Batches

### Batch 2: Lifecycle Execution MVP

- Queue approved lifecycle actions to Desktop Bridge.
- Execute only allowlisted, recipe-driven local actions.
- Capture logs, health check results, final lifecycle state, and rollback
  availability.
- Keep uninstall constrained to bridge-managed agents unless extra approval is
  present.
- Use `docs/engineering/CCUSAGE_AGENT_GOVERNANCE_PLAN.md` as the first concrete
  pinned local CLI lifecycle recipe pattern.

### Batch 3: Private Catalog and Signed Bundle Verification

- Private extension catalog read model.
- Signed bundle metadata and verification result.
- Compatibility checks for platform, adapter type, version range, and risk
  tags.
- Catalog entries remain disabled until reviewed and approved.

### Batch 4: Billing Reporting, Credits, and Chargeback Export

- Usage and cost dashboards.
- Internal chargeback export.
- Soft and hard quota notifications.
- Credit or plan placeholders without production payment processing unless a
  later issue explicitly adds it.

### Batch 5: Governed Repeatable Workflows and Platform Agents

- Save and repeat approved task patterns.
- Lifecycle advisor platform agent.
- Cost analyst platform agent.
- Platform agents remain advisory unless normal policy, quota, approval,
  metering, and audit gates allow an action.

## Acceptance Map

| Acceptance area | First PR batch owner | Later batch |
| --- | --- | --- |
| Explicit install, update, and uninstall recipes | Lifecycle Recipe Artifact Schema | Lifecycle Execution MVP |
| Recipe source, signature, risk, rollback, and local approval explanation | Lifecycle Recipe Artifact Schema; Lifecycle Review and Approval Gates | Private Catalog and Signed Bundle Verification |
| Policy checks and local approval for lifecycle operations | Lifecycle Review and Approval Gates | Lifecycle Execution MVP |
| Uninstall limited to bridge-managed agents by default | Lifecycle Recipe Artifact Schema; Lifecycle Review and Approval Gates | Lifecycle Execution MVP |
| Rollback metadata exists when supported | Lifecycle Recipe Artifact Schema | Lifecycle Execution MVP |
| Platform-managed AI quota enforcement | Billing Ledger and Quota Enforcement Skeleton | Billing Reporting, Credits, and Chargeback Export |
| Billable ledger entries and attribution | Billing Ledger and Quota Enforcement Skeleton | Billing Reporting, Credits, and Chargeback Export |
| Credits, usage caps, invoices, or payment integration | Billing Ledger and Quota Enforcement Skeleton | Billing Reporting, Credits, and Chargeback Export |
| Team-level cost allocation and chargeback export | Billing Ledger and Quota Enforcement Skeleton | Billing Reporting, Credits, and Chargeback Export |
| Revenue-share records | Billing Ledger and Quota Enforcement Skeleton | Billing Reporting, Credits, and Chargeback Export |
| Private deployment packaging and audit export | Private Deployment and Audit Export Shape | Full private deployment packaging and external export sinks |
| Immutable audit storage options | Private Deployment and Audit Export Shape | Provider-backed immutable audit storage |
| Private extension catalog and signed bundles | Lifecycle Recipe Artifact Schema | Private Catalog and Signed Bundle Verification |
| Stable public API and versioned SDKs | M3 Issue Plan and Acceptance Map | Deferred until the lifecycle and billing contracts stabilize |
| Private deployment alert sinks and SIEM export | Private Deployment and Audit Export Shape | External alert and SIEM delivery |
| MCP, A2A, and container adapters | M3 Issue Plan and Acceptance Map | Landed: live clients + connect/probe + bridge execution (#137/#387); only adapter-specific hardening deferred |
| Cost analyst and lifecycle advisor platform agents | Billing Ledger and Quota Enforcement Skeleton; Lifecycle Review and Approval Gates | Governed Repeatable Workflows and Platform Agents |
| Repeatable task templates | M3 Issue Plan and Acceptance Map | Governed Repeatable Workflows and Platform Agents |

## M2 Follow-Up Carried Into M3

- Persistent storage for integration artifacts, ledger, quota decisions, and
  lifecycle records **landed (#388)**: the control-plane state is now a durable
  file-backed snapshot store rather than demo in-memory arrays. Remaining work
  is transactional/idempotency hardening, not the initial durability boundary.
- Real provider-backed generation must keep the same review, probe, disabled
  registration, lifecycle, quota, and audit gates.
- M2 quota decision records should become M3 enforceable quota decisions for
  platform-managed AI calls.

## M3 First PR Batch Non-Goals

- Silent installation, update, or uninstall.
- Running shell installers, package managers, generated code, or migration
  scripts.
- Background auto-update.
- Public marketplace publishing.
- Production payment provider integration.
- Invoice generation, tax handling, or paid subscription plan management.
- Full enterprise identity, SSO, SIEM delivery, or provider-backed immutable
  audit implementation.
- ~~MCP, A2A, or container adapter execution.~~ (No longer a non-goal: live
  clients + connect/probe + bridge execution landed in #137/#387.)
- Long-lived worker pools or unattended lifecycle daemons.

## Verification Baseline

Every first PR batch issue should run:

```text
pnpm docs:check
pnpm repo:check
pnpm typecheck
pnpm test
pnpm smoke:local
git diff --check
```

Lifecycle execution changes must also preserve the CI `desktop-smoke` matrix on
Ubuntu, macOS, and Windows once Batch 2 begins.
