# Server Decomposition Map

> Status: working plan · 2026-07-18 · raised in the architecture governance review
> (`docs/ARCHITECTURE_OVERVIEW.md` §6, evolution item E).

`apps/server` is one process holding **105 service files**, **19 route modules**,
and **~80 collections** on a single in-memory `state` object, wired by hand in the
**3354-line** `runtime/service-composer.mjs`. That is a comprehension and change
cost *today*, independent of any scaling goal (SaaS is out of scope). This map is
the **safe first step** of modularization: it fixes the target bounded contexts
and the order to extract them in, so the work can proceed incrementally instead of
as a risky big-bang.

**This document changes no code.** It is the boundary agreement that later,
per-context extractions cite.

## Guardrails (why this is incremental, not a rewrite)

1. **One context at a time, each behind its existing tests.** The server has 1537
   passing unit tests — every extraction must keep them green. No context moves
   until its boundary is expressed as an explicit module surface.
2. **Shard the composer, don't rewrite it.** `service-composer.mjs` is the
   concrete manifestation of cross-context coupling. Each extraction moves that
   context's `register*` wiring into a per-context composer, shrinking the hub
   rather than replacing it.
3. **Cut a shared collection by turning cross-context writes into events**, not by
   two contexts co-owning a slice of `state`. Refusal, approval, and quota-decision
   writes are the ones that leak across boundaries — model them as recorded events
   a context emits, not fields a neighbor reaches into.
4. **Keep the two-plane boundary (ADR 0020).** This decomposition is entirely
   within the invocation plane (`apps/server`); it never reaches into the loop
   plane (`tools/ai`).

## Target bounded contexts

| # | Context | Services (rough) | Routes | Key state collections |
|---|---|---|---|---|
| 1 | **Invocation & Dispatch** (core hub) | `invocations.mjs` + `invocations/*` (creation, dispatch, dispatch-fairness, completion, cancellation, compare, agent-failover, troubleshooting…), `invocation-events/-trace/-refusals`, `round-telemetry`, `otlp-export`, `run-transcripts` (~18) | `invocations` | `invocations`, `compareRuns`, `dispatchAssignments`, `invocationRounds`, `toolInvocationRecords`, `runTranscripts`, `traces`, `spans`, `events` |
| 2 | **Agent Registry & Capabilities** (shared kernel) | `agents`, `agent-skills`, `capabilities`, `governed-agent` (~4) | `agents`, `agent-skills`, `capabilities` | `agents`, `agentSkills` |
| 3 | **Managed Coding Sessions** (Codex/Claude/Tools) | `codex*`, `claude-*-agent`/`-imports`, `tools`, `decision-command`, `design-render` (~20) | `codex`, `tools`, `review-findings` | `codexSessions`, `codexWorkspaces`, `codexEvidenceRecords`, `codexHookEvents`, `codexApprovalBrokerRequests`, `codexReviewFindings`, `claudeReviewFindings`, `claudeApplyAuthorizations` |
| 4 | **Applications & Connectors** | `applications`, `application-*`, `git/gmail/ccusage-application` (~12) | `applications` | `applications`, `applicationInstallRuns`, `applicationRecoveryActions`, `applicationDailyStats`, `applicationResults` |
| 5 | **Devices, Bridge & Terminal** | `terminal` + runtime `device`, `bridge-auth` (~1 svc) | `bridge`, `terminal`, device paths in `agents` | `devices`, `device`, `tokens`, `terminalSessions`, `terminalBridgeActions`, `sshTargets` |
| 6 | **Channels & Mail** | `channels`, `channel-conversation/-delivery`, `mail-*` (~8) | `channels`, `mail` | `channels`, `channelIdentities`, `channelEvents`, `channelConversations`, `channelDeliveries` |
| 7 | **Economics** (quota/ledger/usage) | `ccusage-agent/-imports`, `eval-trend`, economics half of `m3` (~4) | `m3` (ledger/quota/ai-usage), budgets in `control-plane` | `ledgerEntries`, `budgets`, `budgetReservations`, `quotaPolicies`, `quotaDecisionRecords`, `aiUsageRecords`, `importedUsageEstimates` |
| 8 | **Governance & Compliance** | `approval-grants`, `decision-soft-claims`, `retention*`, `observability-deletion`, governance half of `m3`, `invocations/approval`, `invocation-refusals` (~6) | `approval-grants`, `refusal-http-gate`, governance paths in `m3` | `approvalGrants`, `approvalRequests`, `policyDecisionRecords`, `refusals`, `refusalDailyStats`, `auditSummaries`, `auditExportRequests`, `lifecycle*`, `privateCatalogEntries`, `signedBundleManifests` |
| 9 | **Integrations & Discovery** | `integrations` + `integrations/*` (artifacts, discovery, governance, probes, registration) (~8) | `integrations` | `integrationArtifacts`, `discoveryRuns`, `integrationProbeRuns`, `healthChecks` |
| 10 | **Projects, Worktrees & Auto-run** | `projects`, `worktree-verify`, `auto-run` + `auto-run-*` (16), `auto-trigger`, `automation-schedule/-target`, `issue-claims/-status`, `report-schedule` (~24) | `projects`, `loop-routines`, automations in `control-plane` | `projects`, `projectTargets`, `worktrees`, `worktreeReviews`, `autoRuns`, `deployments`, `automations`, `issueClaims` |

> `routes/control-plane.mjs` is a grab-bag spanning identity (`/api/session|teams|users`),
> devices, economics (`/api/budgets`), projects (`/api/automations`), and governance
> (`/api/observability/delete`). Split it along context lines as those contexts extract.

## Coupling seams (what makes it hard)

- **`m3.mjs` is the worst offender.** One service mixes **Economics** (ledger,
  budgets, quota, AI usage) *and* **Governance/Lifecycle** (audit export,
  `lifecycle*`, private catalog, signed bundles, policy decisions) — ~27
  collections. It blocks clean separation of contexts 7 and 8 and must be broken
  up before either can extract.
- **Governance is diffuse, not a directory.** Approval/refusal/policy are injected
  into Invocation via `runtime/refusal-log`, `runtime/auth`, and
  `invocations/approval.mjs`, and scattered across `m3`, `integrations/governance`,
  `approval-grants`, `decision-soft-claims`. No single owner — this is why it
  extracts last.
- **Agent Registry is a supplier, not a peer.** `../agents.mjs` is imported by
  `invocations/*`, all `integrations/*`, `tools`, `codex`, `m3`. Extract it as a
  shared kernel other contexts depend on, never as a sibling.
- **Bidirectional cycle 1 ↔ 3 ↔ 10.** `auto-run.mjs` imports `invocations.mjs` +
  `invocations/agent-failover.mjs`; `invocations/completion.mjs` imports back into
  Managed Sessions (`claude-*-imports`) and Observability (`run-transcripts`).
  These cycles must be broken with an explicit invocation contract before 3/10 move.
- **Mail → Projects leak.** `mail-issue-write.mjs` imports `auto-run-spawn` +
  `issue-status` — the Mail sub-cluster reaches into Projects.
- **Shared-`state` heaviness** (distinct-file reference count): `invocations` (15),
  `projects` (14), then `worktrees`/`autoRuns`/`approvalRequests`/`agents` (5 each).
  These are the hardest collections to cut and pin the extraction order.

## Extraction sequence (easiest → hardest)

Do them in this order; each is a self-contained PR that keeps the 1537 tests green.

1. **Channels** — cleanest boundary: imports only `runtime/auth` + `run-tx`, 5
   dedicated collections, one route, zero inbound cross-imports.
2. **Devices, Bridge & Terminal** — `terminal` depends only on `runtime/device`;
   device/terminal/ssh state is self-contained; bridge already owns its route + auth.
3. **Integrations & Discovery** — already a physical subdirectory; only outbound
   coupling is read-only `../agents`. First turn its `quotaDecisionRecords`/`lifecycle*`
   writes into events.
4. **Agent Registry & Capabilities** — small and cohesive; extract *as the shared
   kernel* since 1/3/9/10 read `state.agents`.
5. **Applications & Connectors** — 12 cohesive files, private `application*` state;
   leaks (`git/mail/ccusage-result`) stay internal.
6. **Managed Coding Sessions** — internally cohesive around `governed-agent`, but
   coupled outward via `invocations/completion` re-importing claude imports; needs
   the invocation contract (see cycle) defined first.
7. **Economics** — narrow state surface, but requires first carving the economics
   half out of the `m3.mjs` monolith.
8. **Projects, Worktrees & Auto-run** — largest fan-out (24 files), `state.projects`
   shared by 14 files, imports three other contexts; extract after 1 + 3 stabilize.
9. **Invocation & Dispatch** — the core hub (`state.invocations` shared by 15 files)
   with the most inbound edges; cleanest internal subdir but moves late.
10. **Governance & Compliance** — hardest: no directory of its own, injected via
    refusal-log/auth/approval, state trapped inside `m3.mjs`. Extract last, after
    `m3` is broken up and refusal/approval become cross-context events.

## Prerequisite work (before step 1)

- **Break up `m3.mjs`** into an Economics module and a Governance/Lifecycle module.
  This is the single highest-leverage prerequisite — it unblocks contexts 7 and 8
  and removes the widest cross-collection reach in the codebase.
- **Define an explicit invocation contract** (a narrow module surface for "create /
  complete / cancel an invocation") so the 1 ↔ 3 ↔ 10 cycle can be cut.

## Non-goals

- Not a rewrite, not a service split into separate processes, not a storage change.
- Not driven by scaling (SaaS is out of scope) — the goal is a **governable,
  comprehensible** codebase where each context can be reasoned about and changed
  in isolation.
