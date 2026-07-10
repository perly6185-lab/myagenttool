# Application Closed-loop Development Report (2026-07-04)

Status: implemented on `feat/recovery-explanation-web`.

Objective: make the ccusage reference Application prove the operator loop
`discover -> access -> execute -> result` before expanding the Application
runtime to broader npm-wrapper assets.

## Phase 1 - Discover

- Application capability descriptors now publish readiness metadata for
  wrapper-backed capabilities: application status, install state, and execution
  mode.
- Descriptors also publish the result path: output collection, import semantics,
  and whether Evidence Center should contain the result.
- Web `ApplicationCapability` types were extended so the Applications inspector
  can render readiness and result collection without reaching into raw adapter
  fields.

What was tested: ccusage wrapper capability projection asserts
`readiness.state`, `readiness.executionMode`, `resultPath.outputCollection`,
and the platform wrapper runner id.

## Phase 2 - Access And Execute

- The Desktop Bridge now independently validates the inner Application wrapper
  command before spawning the fixed `application-wrapper.mjs` runner.
- The local gate allows the current ccusage offline report contract only:
  approved report argv, declared read-only/no-network policy, and child cwd
  inside the approved project/worktree root.
- Non-allowlisted inner commands, policy mismatches, malformed wrapper argv, and
  child cwd escapes are refused before spawn and continue through the existing
  `local_execution_refused` audit path.

What was tested: desktop unit coverage allows ccusage, rejects a `node -e`
inner command, and rejects an Application wrapper child cwd outside the
approved root. Desktop `--check` now exercises both the allowed and refused
contracts.

## Phase 3 - Result

- Application invocation completion now attaches an `applicationResult` reference
  to invocation metadata/result, the audit summary, and the owning Application's
  `latestResult`.
- Imported ccusage rows are added to Evidence Center as `usage_estimate` records
  with summary-only redaction and invocation linkage.
- A new `application_result_recorded` event marks the result linkage.

What was tested: ccusage wrapper completion imports a report row and links the
same imported id across invocation result, invocation metadata, audit summary,
Application `latestResult`, public state, and Evidence Center.

## Phase 4 - Operator UX

- Applications inspector now shows capability readiness/result collection badges
  and a `Latest result` panel for Application results.
- The latest result panel shows status, output collection, imported record ids,
  and a View invocation action that opens the result invocation.

What was tested: the Web regression renders the discovered capability readiness,
the `importedUsageEstimates` result collection, imported record id, and verifies
View invocation navigation.

## Verification

- `pnpm docs:check`: Markdown relative links OK.
- `pnpm repo:check`: repository scaffold OK.
- `pnpm typecheck`: all typed workspace packages/apps passed.
- `pnpm test`: workspace unit suites plus `smoke:local` and `smoke:port`
  passed. `smoke:local` emitted one handled `bridge_invocation_not_active`
  event-post warning during cancellation timing, but completed successfully.
- `pnpm github:dora`: 206 merged PRs in 30 days; lead time 0.03h median /
  0.48h p90; CI green 73.8% (152/206, 47 without checks); evidence
  `.myagenttool/metrics/2026-07-04T14-09-38-069Z-dora/`.
- `pnpm github:backlog`: 29/29 issues have required labels and milestones; 4
  stale issues remain (#118, #117, #116, #114); evidence
  `.myagenttool/metrics/2026-07-04T14-09-30-546Z-backlog/`.
- `pnpm ai:eval-heldout`: mock held-out pass rate 66.7% (4/6); evidence
  `.myagenttool/evals/2026-07-04T14-09-27-859Z-heldout/`.

## Residual Risks

- The Desktop Bridge Application wrapper allowlist now supports elevated
  write/network policies when server-side wrapper policy consent exists, but
  revocation, expiry, and operator-facing recovery UI still need a product pass.
- CI green rate remains below the L2 target because historical merged PRs still
  include no-check merges; backlog stale items and the mock held-out misses are
  unchanged product maturity gaps.

## 2026-07-06 Follow-up

- Added restart/read-model coverage for generic NPM Application wrapper
  descriptors. The regression restores a persisted Application and proves that
  editable descriptors, approved wrapper capability projection, readiness
  metadata, result path metadata, declared arg inputs, execution planning, and
  public wrapper snapshots all survive runtime restart.
- Added a server-side consent boundary for wrapper policies beyond the current
  read-only/no-network envelope. Write-capable or networked wrapper descriptors
  remain discoverable for review, but their capabilities are marked `disabled`
  with readiness `needs_consent`, and invocation is blocked with
  `application_wrapper_policy_consent_required` before approval or bridge
  dispatch.
- Implemented explicit Application wrapper policy consent. `POST
  /api/applications/:id/wrapper-commands/:commandId/policy-consent` uses the
  normal local approval flow to persist a command-scoped consent grant for the
  declared file/network policy and command fingerprint. Descriptor edits with
  the same command id invalidate the old consent, so the wrapper capability
  returns to `needs_consent`. After consent, the wrapper capability projects as
  ready, elevated policies still require per-run approval, and the Desktop Bridge
  allowlist accepts the elevated wrapper only when command, argv, capability,
  cwd, and policy metadata match the server-resolved plan.
- Added an HTTP MCP live-probe gate. HTTP MCP candidates now publish redacted
  endpoint review plus `liveProbe` state, and confirmation is blocked with
  `mcp_http_live_probe_required` until successful probe evidence exists.
- Implemented the HTTP MCP live-probe runner and API endpoint. `POST
  /api/applications/:id/mcp-candidates/:candidateId/probe` performs JSON-RPC
  `initialize` and `tools/list`, records `json_rpc_initialize_tools_list`
  evidence on the Application probe, verifies that allowed tools are exposed,
  rejects localhost/private/link-local/multicast/non-public endpoint addresses
  before network access, and then permits the approved confirm path to register
  shared MCP tools.
- Re-ran focused Application verification:
  `pnpm --filter @myagenttool/server exec node --test
  test/application-mcp-agent.test.mjs`, targeted
  `test/integration/tools-http.test.mjs`, `pnpm smoke:applications`, and
  `pnpm docs:check`.

Remaining design work is now concentrated on two expansion gates:

- Add revocation/expiry and UI recovery for elevated Application wrapper policy
  consent, including destination disclosure and bridge/device binding cues.
- Extend HTTP MCP operator UX around live-probe retries, endpoint diffs, and
  failure recovery now that the server-side promotion path is wired.

## 2026-07-07 Follow-up

- Added operator next-action guidance for Applications. The shared health model
  now surfaces timeline errors, missing probes, wrapper setup, MCP review,
  HTTP MCP live-probe needed/failed/blocked, automation attention, and open
  recovery actions as explicit issues with action labels and UI targets.
- Added Web inspector recovery actions for those issues, including direct
  Probe/Retry endpoint actions for HTTP MCP candidates before manual
  confirmation is enabled.
- Persisted HTTP MCP network-policy refusals as blocked live-probe evidence
  (`server_network_policy_check`) so the Applications inspector keeps the
  recovery path after refresh.
- Added `smoke:application-fleet`, a mixed-fleet read-model and restart smoke
  that registers npm wrapper, stdio MCP, successful HTTP MCP, blocked HTTP MCP,
  and manual manifest Applications, verifies public state health, MCP,
  automation, and declared-capability evidence, then rebuilds the runtime from
  the persisted state file and verifies the same capability/MCP/live-probe
  health signals still explain correctly.
- Added Web list coverage proving mixed-fleet search can find HTTP MCP
  live-probe recovery issues from the Applications list, and that switching
  between Application cards clears stale run/event/automation selections.

## 2026-07-09 Follow-up

- `pnpm smoke:doocs-md-application` now proves the real local doocs/md MCP
  closeout end to end: probe discovers the stdio MCP server, the rooted node
  entrypoint is auto-registered, `render_markdown` executes through the Desktop
  Bridge, rendered output and option-catalog artifacts are imported, governed
  smoke evidence is saved, result retention archives superseded results, and
  restart restores probe/MCP/tool/latest-result/imported-artifact/evidence
  state.
- `pnpm smoke:application-wrapper` now includes live Desktop Bridge execution
  for both a reviewed npm-wrapper Application and a stdio MCP Application in the
  same mixed smoke, including imported render-result coverage for the MCP path.
- The Web Application Result Center can now be reopened from navigation state:
  result selection is persisted in the Applications deep link with
  `applicationResult=<resultId>`, the inspector opens the result modal from
  restored URL/store state, and operators can copy the stable result link from
  the result modal. The modal and history list share the same result action bar
  for pin/archive, export, Evidence Center save, View invocation, and rerun, and
  the modal surfaces the current retention mode beside result governance state.
- The doocs/md Web editor handoff is captured in
  [DOOCS_MD_WEB_EDITOR_HANDOFF.md](./DOOCS_MD_WEB_EDITOR_HANDOFF.md). The path
  is accepted by `pnpm smoke:doocs-md-editor`, which starts an isolated server,
  Desktop Bridge, and Vite editor, verifies the handoff query parameters,
  imports a rendered editor result, reads it from the Application Result Center,
  and stops the editor. The Web inspector now also exposes failed-editor
  diagnostics and a `Result source` filter for Web editor handoff records.

Current remaining expansion work is productizing the Result Center and recovery
path rather than proving the basic closeout again: broaden the live mixed-fleet
smoke to cover HTTP MCP recovery/manual-manifest edge cases, keep governance
evidence visible, and make result comparison/export/replay flows feel durable.

## 2026-07-10 M4.1 Readiness Follow-up

- Added the M4.1 readiness closeout in
  [APPLICATION_M4_READINESS_CLOSEOUT.md](./APPLICATION_M4_READINESS_CLOSEOUT.md).
  The scope is deliberately a reviewable baseline, not a new product surface:
  prove that current Application integrations can be integrated, used,
  operated, and verified again before starting the guided intake flow.
- Added `pnpm smoke:application-m4-readiness`, an aggregate acceptance gate for
  the Application product line. The gate checks the current published ccusage
  version against the pinned `20.0.16` baseline, then runs focused server,
  desktop, and web regressions plus Application, doocs/md, ccusage, governed
  Codex, and docs smokes.
- The Evidence Center operator loop is now part of the M4.1 baseline:
  Application smoke checklist evidence saves through the Application API,
  projects as `application_smoke_evidence`, appears in the Audit view Evidence
  Center panel, and can be opened from the Applications inspector with the
  saved evidence selected.

Next expansion should start at M4.2: turn the existing integration brief,
descriptor draft, policy preview, and smoke checklist pieces into a guided
Application intake flow.

## 2026-07-10 M4.2 Onboarding Guide Follow-up

- Added the first guided-intake slice in
  [APPLICATION_M4_ONBOARDING_GUIDE_CLOSEOUT.md](./APPLICATION_M4_ONBOARDING_GUIDE_CLOSEOUT.md).
  The Register Application modal now shows an `Onboarding guide` panel that
  tracks source readiness, Codex integration brief capture, descriptor draft
  attachment, and smoke-path planning.
- Added a reusable `applicationOnboardingGuide` model so the same intake state
  is carried into the Application detail page after registration.
- Registration now reuses the descriptor draft generator before an Application
  exists: operators can apply generated MCP, npm wrapper, or manual manifest
  drafts into advanced descriptor JSON from the onboarding guide. Generated npm
  wrapper commands stay `draft` and approval-required.
- Registration policy preview now uses the same descriptor risk model for MCP,
  npm wrapper, and manual manifest JSON. The modal shows projected, draft,
  approval, consent, and high-risk counts before submission.
- Application detail now shows `Onboarding continuity`, keeping source, brief,
  descriptor, and smoke readiness visible beside generated descriptor drafts
  and post-save next actions.
- Expanded `pnpm smoke:application-m4-readiness` to include onboarding-guide,
  draft-generator, descriptor-utils, register-modal, and inspector continuity
  regressions. Focused verification:

  ```powershell
  pnpm --filter @myagenttool/web test -- application-onboarding-guide application-draft-generator descriptor-utils register-application-modal
  pnpm --filter @myagenttool/web test -- applications-inspector
  ```

## 2026-07-10 M4.3-M4.4 Operations Follow-up

- Delivered the Application operations closeout in
  [APPLICATION_M4_OPERATIONS_CLOSEOUT.md](./APPLICATION_M4_OPERATIONS_CLOSEOUT.md).
- Result Center now shows a `Result operations` summary for visible/total
  results, active/pinned/archived counts, evidence-ready records, render versus
  artifact mix, rerunnable results, exportable results, and latest import
  status.
- Recovery actions now surface through a top-level `Recovery operations` panel
  with pending approval, executed, recovered, and attention counts; latest
  guidance; direct approval; recovery-run routing; and result-invocation
  routing.
- `pnpm smoke:application-m4-readiness` now includes
  `pnpm smoke:application-fleet`, so the aggregate gate covers npm wrapper,
  stdio MCP, successful HTTP MCP live probe/confirmation, blocked HTTP MCP
  evidence, manual manifest declared capabilities, public read-model health,
  and restart recovery.
- Approval issuance and verification are now explicitly covered by Web recovery
  approval, wrapper policy consent, HTTP MCP approval retry, and the aggregate
  readiness gate.

Remaining M4 follow-up is incremental: add recovery-action-id deep links if
operators need per-request URLs, and split the long doocs/md Result Center test
if that coverage grows again.

## M5 Productization Closeout - Recovery Links, Fleet Ops, Scoped Approvals

- Delivered the productization closeout in
  [APPLICATION_M5_PRODUCTIZATION_CLOSEOUT.md](./APPLICATION_M5_PRODUCTIZATION_CLOSEOUT.md).
- Recovery action requests now have first-class `recovery=` navigation state,
  copied recovery links, focused recovery history expansion, and run diagnostics
  that preserve both the parent run and the selected recovery request.
- Result Center now has a focused operations regression for metrics, retention,
  filters, export, evidence save, and governance actions, so the long doocs/md
  scenario no longer carries that coverage alone.
- Applications now expose a fleet overview for npm wrappers, stdio MCP, HTTP
  MCP, manual manifests, blocked live probes, ready MCP signals, and automation
  attention, with metric-level filtering.
- Application detail now includes a scoped approval queue that links approvals
  by Application invocation metadata and recovery approval ids, surfaces risk,
  target, duplicate guard, result links, and keeps approval as an explicit
  operator action.
- Added `pnpm smoke:application-m5-productization` as the focused gate for the
  M5 productization surface.
