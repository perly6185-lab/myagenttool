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

Current remaining expansion work is broader real end-to-end coverage for mixed
fleets that includes Desktop Bridge execution inside the mixed fleet, rather
than only the current deterministic server/read-model/restart smoke.
