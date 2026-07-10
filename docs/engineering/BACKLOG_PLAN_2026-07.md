# Near-term backlog plan (2026-07)

This backlog supersedes the earlier #209-#213 sequencing. Auth and tenancy have
landed, and the latest ccusage/Application work moved the active product line
from "agent registry slices" toward governed Application capabilities.

The next phase should therefore stop adding new surface area and make the
existing control plane durable, locally enforceable, and easier to close out.

```text
re-baseline docs + tests
  -> durable state and audit/ledger history
  -> bridge credential + local execution gate
  -> Application capability runtime closeout
  -> M3 closeout and one lifecycle execution sample
```

See `docs/engineering/NEXT_PHASE_PLAN_2026-07.md` for the operating plan.

## P0 - Baseline and scope control

- **Update planning docs.** Keep this backlog, milestones, ADR 0007, M3 issue
  plan, and Application Capability Registry in sync with the latest code.
- **Run the local gate before new feature work.** Use:
  `pnpm docs:check`, `pnpm repo:check`, `pnpm typecheck`, `pnpm test`,
  `pnpm smoke:local`, and `git diff --check`.
- **File or update issue references for deferred work.** Any new runtime scope
  should map back to persistence, bridge trust, Application capabilities, M3
  closeout, or billing/reporting.
- **Recently landed baseline:**
  - #212 broadened hermetic coverage (worktree naming/lifecycle/diff, loop
    promotion gates).
  - #213 CI is **active and enforced**: `main` requires `verify`, `eval-gates`,
    and `pr-governance` with admin enforcement.
  - #390/#397 closed the pr-governance Projects-token gap: the check reads
    Projects via the `GOVERNANCE_PROJECTS_TOKEN` secret, so the "linked work
    issue with Project Fields" rule is satisfiable — the governance gate is now
    enforced end-to-end rather than bypassed by admin override. Follow-up:
    rotate that secret to a least-privilege `read:project` token.
  - #394 instrumented DORA change-failure rate + recovery time from a
    `Change-failure: #N` marker signal (honest zero until incidents are
    recorded), replacing the two "not instrumented" rows.
  - #137's MCP connect slice landed (#387): pre-flight dry-probe + Connect MCP
    server card.
- **2026-07-04 closeout measurement:** this branch's round-end gate measured
  docs links (`pnpm docs:check`), repo scaffold (`pnpm repo:check`), all typed
  workspace surfaces (`pnpm typecheck`), full workspace unit + local/port smoke
  behavior (`pnpm test`), DORA delivery health (`pnpm github:dora`), backlog
  hygiene (`pnpm github:backlog`), and held-out AI behavior
  (`pnpm ai:eval-heldout`). The latest Application slice measured a real
  `discover -> access -> execute -> result` loop: capability descriptors expose
  readiness/result-path metadata, Desktop Bridge refuses non-allowlisted
  application-wrapper inner commands and child-cwd escapes before spawn,
  completion links imported ccusage rows across invocation/app/audit/public
  state/Evidence Center, and Web Applications inspector shows the latest result
  with a View invocation path. The remaining measured gaps are CI green rate
  73.8% vs 95%, four stale backlog items (#118, #117, #116, #114), and mock
  held-out pass rate 4/6. `smoke:local` emitted one handled
  `bridge_invocation_not_active` event-post warning during cancellation timing,
  but the suite completed successfully.
- **2026-07-05 P1-P4 Application MCP closed-loop measurement:** the doocs/md
  path now covers discovery -> access -> execute -> result through its own MCP
  server, with durable evidence and local bridge refusal checks. What was
  tested: MCP agents with `allowedTools` publish stable governed tool names
  such as `doocs_md.render_markdown`; discovery hides adapter command/argv
  while retaining provider/tool metadata; `/api/capabilities/:name/invocations`
  creates a bridge-dispatched invocation with preserved `toolName` and
  `toolArguments`; an Application can persist an `mcpAgent` descriptor and
  recover the Agent plus shared tool names after restart when the Agent row is
  missing; existing durable-state tests still restore approval, policy, and
  export evidence with explainable read-model/audit references; App-scoped MCP
  tools are hidden from a foreign team in both `/api/tools` and
  `/api/capabilities`; same-namespace MCP tools are named only within the
  actor-visible Application scope; Application probe reads doocs/md-style
  `.vscode/mcp.json`, `.cursor/mcp.json`, and root `.mcp.json` entries,
  supports both `servers` and `mcpServers`, redacts HTTP query/hash/userinfo in
  previews, auto-registers only high-confidence stdio `node` entrypoints whose
  script stays inside the Application root, and keeps shell/HTTP candidates as
  manual-confirm evidence; a doocs/md-like executable MCP fixture really calls
  `render_markdown` and links the rendered result across invocation result,
  Application `latestResult`, audit summary, and Evidence Center; the Desktop
  Bridge refuses local MCP stdio execution before spawn when command, cwd,
  entrypoint args, file policy, or network policy violates the local allowlist,
  with structured `local_execution_refused` evidence; and the Web Applications
  inspector shows registered MCP tools, probe confidence, latest MCP result,
  and the View invocation path. The existing MCP smoke still proves live
  registration, probe, call, and allowlist refusal.
  Round-end gates measured docs links, repo scaffold, all typed workspace
  surfaces, full workspace test + local/port smoke, DORA delivery health,
  backlog hygiene, and held-out AI behavior. The remaining measured gaps are CI
  green rate 73.8% vs 95%, 9 stale backlog items (#125, #124, #123, #122, #121,
  #118, #117, #116, #114), and mock held-out pass rate 4/6. `docs:check` was
  hardened to ignore nested Git repositories and generated dependency/state
  directories, so registered external application checkouts no longer poison
  repository-doc link validation. Evidence:
  `.myagenttool/metrics/2026-07-05T02-23-45-784Z-dora/`,
  `.myagenttool/metrics/2026-07-05T02-23-39-172Z-backlog/`, and
  `.myagenttool/evals/2026-07-05T02-23-36-394Z-heldout/`.

## P1 - Durable control-plane state

Persistence is the highest-value foundation still missing from the architecture
review. The first slice should be intentionally small:

- Status: local durable-state hardening closeout is recorded in
  [P1_DURABLE_STATE_CLOSEOUT.md](P1_DURABLE_STATE_CLOSEOUT.md). The current
  accepted scope covers local snapshot restore for lifecycle/rollback/ledger,
  imported usage/review evidence, terminal/Codex Evidence Center linkage, and
  restart/read-model/audit-ref coverage for lifecycle policy decisions, policy
  decision records, approval requests, Codex approval broker requests, and audit
  export requests. What was tested: after snapshot restore, approval, policy,
  and export evidence still has explainable read-model and audit references;
  production-grade transactional persistence remains future work.
- **WS2 landed:** invocation create is **idempotent** on a persisted,
  tenant-scoped client key (#418); snapshot writes are **atomic + fsync'd**
  (temp → fsync → rename → dir fsync) with a **synchronous durable barrier** at
  the accepted-invocation commit and a crash-guard so a write failure is logged,
  not fatal (#422). A per-record append-only WAL remains the scale option.
- Add a durable store boundary with an in-memory adapter kept for tests and
  self-checks.
- Persist tokens, users, teams, projects, invocations, events, approvals,
  application records, lifecycle records, quota decisions, usage, and ledger
  entries.
- Stop treating audit and ledger rows as capped demo arrays for any path that
  claims governance, billing, or export semantics.
- Use store transactions to close dispatch claim, budget admission, and
  idempotency races where practical. **Finding (WS2):** in the single-threaded
  event loop, `createInvocation` and the `/api/bridge/next` claim are fully
  synchronous, so dispatch-claim and budget-admission do not actually race —
  only idempotency was a real gap (now closed, #418). The dispatch-claim
  atomicity invariant is test-locked.

## P2 - Bridge trust boundary

The Desktop Bridge enforces local trust at the point of execution. The first cut
(#392) added the bridge bearer credential (required on every `/api/bridge/*`
route) + the CLI local-execution gate. WS3 then deepened the boundary across
every local execution surface:

- **MCP stdio env scoping (#427):** a spawned MCP server no longer inherits the
  bridge's full `process.env` (secret-leak fix) — only a non-secret allowlist +
  operator-configured env.
- **CLI cwd confinement (#431):** the gate refuses a spawn cwd outside the
  invocation's approved project/worktree root.
- **Lifecycle refusal auditing (#431):** a non-allowlisted lifecycle spawn
  records structured `local_execution_refused` evidence, not just prose.
- **Terminal cwd confinement (#433):** a client-supplied local terminal cwd must
  be inside a registered project/worktree root (the default bridge cwd stays
  trusted).
- **Container descriptor guard (#437):** the bridge independently enforces
  runtime/network/image/resource invariants before spawn (principle #5 — it does
  not trust the server-normalized descriptor).
- **Bridge credential idle-expiry (#439):** a leaked bearer stops working after
  the idle TTL; an active bridge never idles out.
- **Credential ownership closeout (this PR):** bridge-owned work is checked
  across polling, completion callbacks, lifecycle completion, dispatch
  selection, health, discovery, and probe paths. What was tested: off-device
  bridge work is filtered or refused before execution, null-device
  lifecycle/discovery/probe work is skipped instead of claimed by any bridge,
  legacy queued local invocations are stamped with the claiming device before
  ack/complete, and refusal events are emitted as audit evidence rather than
  silent skips.
- **Application wrapper local gate (this PR):** the Desktop Bridge now checks
  the wrapper's inner `execCommand`, `execArgs`, child `cwd`, and declared
  file/network policy before spawning the fixed runner. What was tested:
  ccusage's approved offline report argv is allowed, a `node -e` inner command
  is refused as non-allowlisted, and a wrapper child cwd outside the approved
  project/worktree root is refused with structured `local_execution_refused`
  evidence.
- **Application MCP local gate (this PR):** stdio MCP execution is now checked
  at the Desktop Bridge before spawn. What was tested: rooted doocs/md-style
  `node` entrypoints are allowed; entrypoints outside the Application root,
  non-node commands, and expanded network policy are refused; refused bridge
  execution completes the invocation as failed and emits structured
  `local_execution_refused` evidence.
- Remaining (#426): a bridge-side PTY gate mirroring the server-side terminal
  confinement, and general approval-evidence enforcement + an independent local
  consent record. The principle stands: server policy approval does not by
  itself mean local execution consent.

## P3 - Application capability runtime

The latest ccusage work makes the Application path real enough to be the next
product-quality focus:

- Status: first slice started on `feat/application-capability-runtime-closeout`;
  ccusage Application wrapper capabilities now expose compatibility facade,
  output collection, external-billed, and import semantics through discovery and
  queued wrapper invocation metadata.
- Status: second slice started on `feat/application-recovery-explainability`;
  recovery action APIs and `/api/state` now publish a shared explainability
  shape for selected action, refusal/guard reason, result ids, and next step.
- Status: third slice started on `feat/application-recovery-explanation-ui`;
  the Web Applications inspector now renders the recovery explanation as
  operator guidance in history and suggested action cards.
- Status: `feat/recovery-explanation-web` extends the same operator
  explanation pattern into Invocations and extracts shared recovery readable/
  tone helpers so Applications and Invocations do not maintain separate
  phrasing. What was tested: pending approval, duplicate-action guard, executed
  result, and View result navigation are covered by Web unit regression tests;
  review follow-up also verifies the operator explanation prefers the active
  recovery-action approval over the original invocation approval.
- Status: runtime contract closeout landed; ccusage Application wrapper
  semantics are published in the external consumer contract and enforced by the
  tool-registry contract smoke inside `smoke:port`.
- Status: `feat/recovery-explanation-web` now has the first closed-loop
  ccusage reference slice. Discover exposes readiness/result-path metadata;
  access/execute is locally re-gated by the Desktop Bridge allowlist before the
  wrapper runner starts; result imports are linked to invocation/app/audit and
  Evidence Center; and Web Applications inspector surfaces the latest result
  with a navigation path back to the invocation.
- Status: the doocs/md MCP slice now exercises the same closed-loop pattern
  through a project-owned MCP server. Discover finds config/source candidates
  with confidence/manual-confirm evidence; access publishes governed
  `doocs_md.*` capability names without exposing adapter argv; execute calls
  `render_markdown` through the MCP bridge path; result links the rendered
  output across invocation/Application/audit/Evidence Center; and Web shows MCP
  tools, probe confidence, latest result, and View invocation.
- Status: the real doocs/md rehearsal now runs through `pnpm
  smoke:doocs-md-application`, including Desktop Bridge MCP process execution,
  rendered-result import, option-catalog artifacts, governed smoke evidence,
  retention, and restart recovery for probe/MCP/tools/latest-result/imported
  artifacts/evidence.
- Status: mixed-fleet bridge coverage now has a live `pnpm
  smoke:application-wrapper` path for both reviewed npm-wrapper execution and
  stdio MCP execution, with the MCP render result imported back into the
  Application result read model.
- Status: the Web Application Result Center now has URL-backed result
  selection via `applicationResult=<resultId>`, so a restored Applications deep
  link can reopen the result modal directly.
- Status: live manual-confirm UX now exists for ready MCP candidates. The Web
  Applications inspector can confirm a manual candidate through explicit intent,
  and the server persists the descriptor, registers the Agent, and projects
  shared tool names without exposing adapter argv.
- Status: the HTTP Application surface now returns redacted Application
  snapshots for list/detail/register/probe/confirm and `/api/state`; MCP
  `adapter` command/args/url stay internal while Web still receives probe
  previews, shared tool names, recovery, discovery, and latest-result refs.
- Status: MCP candidates now carry structured manual-confirm review details:
  data boundary, file/network policy, allowed tool count, and redacted HTTP
  endpoint origin/host/protocol. The Applications inspector renders these
  fields, while query tokens, headers, full argv, and raw adapter config remain
  server-internal.
- Status: M4.1 readiness closeout is recorded in
  [APPLICATION_M4_READINESS_CLOSEOUT.md](APPLICATION_M4_READINESS_CLOSEOUT.md).
  The new `pnpm smoke:application-m4-readiness` gate reuses focused tests and
  smokes to verify ccusage pin freshness, Application registration/result
  evidence, doocs/md MCP rehearsal, Evidence Center navigation, governed Codex
  tool flows, typechecks, and docs links before the next productization slice.
- Status: M4.2 guided-intake first slice is recorded in
  [APPLICATION_M4_ONBOARDING_GUIDE_CLOSEOUT.md](APPLICATION_M4_ONBOARDING_GUIDE_CLOSEOUT.md).
  Register Application now shows a live onboarding guide for source readiness,
  integration brief capture, descriptor draft review, and smoke-path planning.
  The same flow can apply generated MCP, npm wrapper, or manual manifest drafts
  into advanced descriptor JSON before registration, with generated npm wrapper
  commands kept draft and approval-required. Registration policy preview now
  covers MCP, npm wrapper, and manual manifest JSON before submit. Application
  detail now carries the guide forward as `Onboarding continuity`, tying source,
  brief, descriptor, and smoke readiness to descriptor drafts and post-save next
  actions. The M4 readiness gate includes descriptor-utils, draft-generator,
  onboarding-guide, register-modal, and inspector continuity regressions.
- Status: M4.3-M4.4 operations closeout is recorded in
  [APPLICATION_M4_OPERATIONS_CLOSEOUT.md](APPLICATION_M4_OPERATIONS_CLOSEOUT.md).
  Result Center now has a `Result operations` summary, recovery actions have a
  top-level `Recovery operations` approval/routing panel, the readiness gate
  includes `smoke:application-fleet` for HTTP MCP/manual-manifest coverage, and
  approval issuance/verification is covered across recovery, wrapper consent,
  and HTTP MCP confirmation.
- Status: M5 productization closeout is recorded in
  [APPLICATION_M5_PRODUCTIZATION_CLOSEOUT.md](APPLICATION_M5_PRODUCTIZATION_CLOSEOUT.md).
  Recovery requests now have `recovery=` deep links and focused recovery
  history expansion; Result Center operations have a focused split regression;
  Applications has an operational fleet overview for npm wrapper, stdio MCP,
  HTTP MCP, manual manifest, blocked-probe, ready-MCP, and automation-attention
  cohorts; Application detail has a scoped approval queue; and
  `pnpm smoke:application-m5-productization` gates the M5 surface.
- Next focus: keep restart/read-model evidence green while broadening approval
  ownership fields if the server read model grows beyond invocation metadata
  and recovery approval ids.
- **Discover:** make Application capability descriptors complete enough for
  external and Web callers to choose a capability without adapter knowledge:
  readiness, risk, approval, schema, output collection, and result-import
  metadata must be present and restart-safe.
- **Access:** turn approval and local consent into visible state: owner scope,
  approval request, duplicate guard, bridge ownership, and local allowlist
  refusal should all produce operator-readable evidence.
- **Execute:** move approved `installed-wrapper` commands from audited
  execution-plan preview into the normal invocation/trace/audit path, preserving
  reviewed argv construction and continuing to reject arbitrary npm execution.
- **Result:** import completion output into the declared read model, link it
  from invocation/Application/audit evidence, and show result/next-step guidance
  in Applications and Invocations.
- Keep `/api/tools` stable while `/api/capabilities` becomes the unified
  discovery surface.
- Finish ccusage parity on the Application-backed tool facade, including
  descriptor, dynamic filters, import metadata, ledger semantics, and smoke
  coverage.
- Keep recovery actions explainable after execution: selected action, refusal
  reason, result, next step, and duplicate-action guard evidence.
- Keep the UI path aligned with that contract so approval, duplicate guard,
  result, and next-step evidence are visible without opening raw diagnostics.
- Generalize only after ccusage remains green through the compatibility facade.

## P4 - M3 closeout

M3 should close around what is already implemented instead of expanding:

- Status: `M3_ACCEPTANCE_CLOSEOUT.md` records accepted scope, evidence, residual
  risks, explicit non-goals, and latest ccusage/recovery guidance evidence.
- Keep lifecycle execution to one allowlisted sample first, preferably the
  pinned ccusage npm lifecycle path.
- Keep billing work to enforceable quota decisions, ledger attribution,
  reporting shape, and chargeback export. Do not add payment, invoice, tax, or
  public marketplace flows in this phase.

## Later backlog

- A2A and container live clients (the MCP live client + connect flow have landed).
- Public marketplace and settlement.
- External SIEM/export delivery providers.
- Production identity providers, SSO, and full RBAC administration.
- Repeatable workflow productization once persistence and audit are reliable.
