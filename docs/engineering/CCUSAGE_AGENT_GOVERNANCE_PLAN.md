# ccusage Agent Governance Plan

This document plans how `ccusage` should be onboarded as a governed agent in
myagenttool.

`ccusage` is a local usage-reporting CLI, not a coding agent. It reads local
coding-agent usage data and emits token and cost reports. The governance design
therefore treats it as a read-only local utility agent first, then promotes
installation, update, and uninstall into M3 lifecycle automation once recipe
execution is ready.

## Goals

- Let users run `ccusage` reports from the Web Console through the normal agent
  registry, invocation queue, Desktop Bridge, audit, trace, and usage paths.
- Make local data access, command execution, output capture, and cost ownership
  explicit before invocation.
- Keep report execution separate from package installation.
- Support pinned, reviewable installation later without allowing arbitrary
  `npm install -g` commands through invocation.
- Provide a repeatable pattern for similar local observability tools.

## Non-Goals

- Do not classify `ccusage` as a coding agent.
- Do not let user prompt text become arbitrary CLI flags.
- Do not run `npm install -g ccusage` as an invocation task.
- Do not silently install, update, uninstall, or auto-enable `ccusage`.
- Do not scrape or upload raw local agent history outside the existing
  invocation event and result path.
- Do not add payment, invoice, or settlement behavior for `ccusage` itself.

## Current Context

Existing product surfaces already provide the first usable integration path:

- Manual CLI registration through `POST /api/agents`.
- Invocation creation through `POST /api/invocations`.
- Desktop Bridge structured process spawning for CLI adapters.
- Health checks, enable/disable, queueing, cancellation, audit events, trace,
  and cost-owner metadata.

The current CLI adapter renders invocation input into configured args through
`{{task}}` or `{{payloadJson}}`. For `ccusage`, the safer default is fixed
report args, not prompt-driven args.

## Agent Shape

Register `ccusage` as one or more local CLI agents with fixed commands:

```json
{
  "id": "agt_ccusage_daily",
  "type": "cli",
  "name": "ccusage Daily Report",
  "description": "Reads local coding-agent usage data and reports daily token/cost usage.",
  "command": "node",
  "args": [
    "tools/agents/ccusage-wrapper.mjs",
    "--ccusage-cli",
    "<global-npm-root>/ccusage/src/cli.js",
    "--report",
    "daily"
  ],
  "timeoutSeconds": 60,
  "outputFormat": "plain_result",
  "capabilityName": "usage_cost_report",
  "capabilityDescription": "Generate a read-only local usage and cost report from ccusage.",
  "riskLevel": "low",
  "riskTags": ["read_only", "read_local", "shell_exec"],
  "economicModel": "free",
  "costOwner": "usr_local",
  "unknownCostPolicy": "warn"
}
```

Recommended managed report agents:

| Agent id | Command args | Purpose |
| --- | --- | --- |
| `agt_ccusage_daily` | `daily --json --offline` | Daily usage report for all detected sources |
| `agt_ccusage_weekly` | `weekly --json --offline` | Weekly usage rollup |
| `agt_ccusage_monthly` | `monthly --json --offline` | Monthly usage rollup |
| `agt_ccusage_session` | `session --json --offline` | Session-level audit/reconciliation |
| `agt_ccusage_codex_daily` | `codex daily --json --offline` | Codex-specific usage report |
| `agt_ccusage_claude_daily` | `claude daily --json --offline` | Claude Code-specific usage report |

Avoid a single generic `ccusage` agent that accepts arbitrary user-supplied
arguments. When filters are needed, expose reviewed options such as `since`,
`until`, `timezone`, `source`, and `reportKind` as structured invocation options
and render only allowlisted flags.

The governed tool contract is:

```text
tool: ccusage.report
input: report, source, since, until, timezone, offline
output: structured ccusage RESULT, importedUsageEstimates
```

Only registered ccusage report agents carrying this contract, the fixed wrapper
argv, and `usage_cost_report` capability may import ccusage estimates. A
successful result that merely claims `output.source: ccusage` is ignored when it
comes from any other agent.

## Permission Model

Default risk classification:

```text
riskLevel: low
riskTags: read_only, read_local, shell_exec
```

Rationale:

- `ccusage` reads local usage/history files.
- It executes as a local process.
- It should not need file writes, credential access, network access, repository
  edits, browser control, desktop control, or destructive operations.

The default args should include `--offline` where practical so report execution
does not fetch pricing data at runtime. If online pricing refresh is enabled
later, the agent risk tags should add `network_access`, and the registration
notes should explain what leaves the machine.

## Data Handling

Report output may reveal:

- Which coding agents are used.
- Approximate work cadence and session timing.
- Token usage and model names.
- Project or instance names when source tools store them.
- Estimated costs.

Control-plane display should keep raw output available for audit but provide a
summarized result for normal users. Sensitive local paths should be redacted in
summaries when possible.

The wrapper converts `ccusage --json` into the Desktop Bridge `RESULT ...`
format so the server can store structured output in `invocation.result.output`.

Public read models expose normalized imported estimate fields only. The raw
ccusage row is retained server-side for audit/reconciliation, but it is omitted
from `GET /api/state` so local paths, session names, or provider-specific
metadata do not become normal dashboard data by accident.

## Execution Protocol

### Phase 1: Fixed CLI Registration

Use the existing CLI adapter with the governed wrapper:

```text
node tools/agents/ccusage-wrapper.mjs --ccusage-cli <global-npm-root>/ccusage/src/cli.js --report daily
```

The invocation `task` is used for the audit summary only. It is not rendered
into CLI args.

Health check behavior can initially rely on the generic CLI health result:

```text
Desktop Bridge can attempt CLI command: node.
```

### Phase 2: Result Wrapper

The bridge-owned wrapper script is:

```text
node tools/agents/ccusage-wrapper.mjs --ccusage-cli <path> --report daily
```

Wrapper responsibilities:

- Resolve the installed `ccusage` binary or package script safely.
- Run only allowlisted report kinds and sources.
- Add `--json` and `--offline` by default.
- Parse JSON output.
- Emit progress lines as normal logs.
- Emit one final line:

```text
RESULT {"summary":"ccusage daily report generated.","output":{...},"touchedUserFiles":false}
```

This lets the existing Desktop Bridge result parser capture a structured result
without changing the invocation completion protocol.

### Phase 3: Native Adapter Descriptor

If `ccusage` becomes a first-class built-in integration, add a small adapter
descriptor that declares:

- Supported report kinds.
- Supported sources.
- Allowed filters.
- Default offline mode.
- Health probe command.
- Result parser.
- Data sensitivity metadata.

This should still execute through the Desktop Bridge as structured argv.

## Lifecycle Management

Installation, update, uninstall, and rollback belong to lifecycle automation,
not invocation.

### Manual Development Path

For local development and early use:

```text
npm install -g ccusage@20.0.14
```

Then register fixed report agents through `POST /api/agents`.

The development helper can register the recommended fixed report agents against
a running local server:

```text
pnpm ccusage:register -- --all
```

It resolves the global npm installation with `npm root -g` and registers each
agent through `tools/agents/ccusage-wrapper.mjs`, which enforces fixed report
ids and `--json --offline` execution.

### Governed M3 Path

Add a lifecycle recipe for pinned `ccusage` installation:

```json
{
  "agentId": "agt_ccusage_daily",
  "action": "install",
  "packageName": "ccusage",
  "version": "20.0.14",
  "source": {
    "type": "npm",
    "registry": "https://registry.npmjs.org/",
    "package": "ccusage",
    "version": "20.0.14"
  },
  "expectedBinary": "ccusage",
  "installCommandId": "npm_global_install_pinned",
  "installArgs": ["ccusage@20.0.14"],
  "healthCheck": {
    "commandId": "ccusage_version",
    "expectedPattern": "ccusage"
  },
  "rollback": {
    "available": false,
    "summary": "Uninstall or reinstall a prior pinned version manually."
  }
}
```

Desktop Bridge should not accept arbitrary package-manager commands. It should
accept only reviewed lifecycle command ids such as:

```text
npm_global_install_pinned
npm_global_uninstall_package
ccusage_version
ccusage_report_probe
```

Each command id must validate package name, version, shell mode, platform, and
argument shape before execution.

## User Experience

The Web Console should present `ccusage` as an observability/reporting tool:

- Name: `ccusage Daily Report`, `ccusage Monthly Report`, etc.
- Category: Usage and cost reporting.
- Data access: Reads local coding-agent usage data.
- Local execution: Runs a local CLI command through Desktop Bridge.
- Cost: Free tool; reports external costs from source agents.
- Output: Usage summary and raw JSON report.
- Controls: Check health, enable/disable, run report, cancel running report.

Do not ask the user to understand npm global paths. The UI should resolve or
store the command path during registration or lifecycle install.

## Policy And Approval

Default fixed offline reports can be allowed without local approval after the
agent is registered and healthy.

Require local approval when:

- The report includes custom paths.
- The report uses online mode or pricing refresh.
- The source filter targets a sensitive provider or project.
- The command path is user-provided and not bridge-managed.
- The agent is newly installed or updated.
- The invocation requests raw session-level output export.

Block invocation when:

- Agent is disabled or unhealthy.
- Device is unlinked.
- Args contain non-allowlisted flags in managed mode.
- Command path points outside the reviewed install location in managed mode.
- The lifecycle recipe is unreviewed or signature/source validation fails.

## Economics

`ccusage` itself should default to:

```text
economicModel: free
pricingDimensions: []
unknownCostPolicy: warn
```

The report output may contain costs for other agents or providers. Those values
should be treated as observed external usage data, not as myagenttool platform
charges. The current reconciliation flow maps `ccusage` report rows into a
separate imported-estimates collection with:

```text
amountSource: imported_ccusage_report
economicModel: external_billed
authoritative: false
```

These imported estimates are visible through `importedUsageEstimates` and audit
export usage references. They are intentionally not written to
`ledgerEntries`, do not affect project budgets, and do not change
platform-managed AI quota enforcement.

## Audit Evidence

Every report invocation should record:

- Requester.
- Agent id and version when known.
- Device id.
- Command preview.
- Report kind and source.
- Offline or online mode.
- Time range filters.
- Policy decision.
- Completion status.
- Raw output reference or structured result reference.

Lifecycle actions should additionally record:

- Package name and pinned version.
- Registry/source.
- Review decision.
- Local approval decision.
- Install/update/uninstall logs.
- Health result after lifecycle action.

## Phased Implementation Plan

### Phase 0: Documentation And Manual Recipe

- Add this design document.
- Document the manual `npm install -g ccusage@<pinned>` plus `POST /api/agents`
  registration flow.
- Do not change runtime behavior.

Acceptance:

- The recommended agent shape, permissions, lifecycle boundary, and risks are
  documented.

### Phase 1: Fixed CLI Agents

- Add a developer smoke or fixture that registers `agt_ccusage_daily` when
  `ccusage` is available.
- Add a manual verification snippet for Windows, macOS, and Linux path
  resolution.
- Ensure report agents are registered through the governed wrapper and never
  render prompt text into CLI flags.

Acceptance:

- A user can run a daily report through normal invocation.
- Disable blocks new report invocations.
- Health check is visible.
- Audit records show command preview and policy decision.

Phase 1 smoke coverage:

```text
pnpm smoke:ccusage-agent
```

### Phase 2: ccusage Wrapper

- Add `tools/agents/ccusage-wrapper.mjs`.
- Validate report kind, source, and date filters.
- Emit `RESULT ...` with parsed JSON output.
- Add unit/smoke coverage for valid report, invalid flag, missing binary, and
  malformed JSON.

Acceptance:

- `invocation.result.output` contains structured report JSON.
- Unsupported args are blocked before spawn.
- The wrapper does not use shell command strings.

### Phase 3: Lifecycle Recipe MVP

- Add a pinned install recipe for `ccusage@20.0.14`.
- Add Desktop Bridge lifecycle command ids for pinned npm install, uninstall,
  version check, and report probe:
  `npm_global_install_pinned`, `npm_global_uninstall_package`,
  `ccusage_version`, and `ccusage_report_probe`.
- Require review and local approval before install/update/uninstall.
- Keep uninstall limited to the bridge-managed package record.

Acceptance:

- `ccusage` can be installed from a reviewed pinned recipe.
- Install creates lifecycle audit evidence.
- Health check confirms the installed CLI.
- Uninstall requires explicit local approval.

### Phase 4: Ledger Import And Reporting

- Parse `ccusage` structured output into imported usage estimates.
- Link report rows to agent/provider/model where possible.
- Store imported estimates separately from authoritative platform-managed AI
  ledger entries in `state.importedUsageEstimates`.
- Mark each row with `amountSource: imported_ccusage_report`,
  `economicModel: external_billed`, and `authoritative: false`.
- Keep imported report rows out of `state.ledgerEntries`, budget spend, and
  platform-managed quota enforcement.
- Include imported usage estimate ids in audit export usage references.
- Gate imports on the governed `ccusage.report` agent contract, not just on the
  result payload's claimed source.
- Cap each imported report to 1000 normalized rows and record dropped row count
  in the import event.
- Omit raw ccusage rows from public state while retaining them server-side.

Acceptance:

- Imported costs are visible but clearly marked as estimates.
- Existing platform-managed AI quota and billing records remain authoritative.
- Reports can be exported with audit references.

Phase 4 smoke coverage:

```text
pnpm smoke:ccusage-agent
```

### Phase 5: Tool Registry And Facade

- Expose governed tool discovery through:
  - `GET /api/tools`
  - `GET /api/tools/ccusage.report`
- Expose invocation creation through:
  - `POST /api/tools/ccusage.report/invocations`
- Return the tool contract, risk metadata, approval policy, output collection,
  and available governed agents without exposing adapter command or argv.
- Validate tool input before invocation creation:
  - known report id only
  - no unknown fields
  - `offline` must remain `true` until online approval exists
  - `session` returns `approval_required` until explicit approval exists
  - date filters must use `YYYY-MM-DD`
  - timezone must use the wrapper-safe character set
- Select the fixed report agent by report id and create a normal invocation with
  `metadata.tool: ccusage.report`.
- Document the external agent calling contract in
  [Tool Registry Agent Calling](TOOL_REGISTRY_AGENT_CALLING.md), including the
  discovery flow, invocation payload, expected outputs, and governance errors.
- Reuse this same governed tool registry pattern for local Codex capabilities;
  see [Codex Tool Governance Plan](CODEX_TOOL_GOVERNANCE_PLAN.md).

Acceptance:

- Other agents can discover `ccusage.report` without reading raw CLI adapter
  details.
- Valid offline daily/codex/claude reports create governed invocations.
- Invalid fields, online mode, and session reports are blocked or marked
  approval-required before any bridge command is queued.

## Test Strategy

Recommended checks:

```text
pnpm --filter @myagenttool/server test
pnpm --filter @myagenttool/desktop test
pnpm smoke:local
pnpm typecheck
pnpm docs:check
git diff --check
```

Focused coverage:

- Registration validation keeps `riskLevel: low` and expected risk tags.
- Invocation with a disabled `ccusage` agent is blocked.
- Wrapper rejects unknown report kinds and flags.
- Wrapper handles missing global package.
- Wrapper handles non-zero `ccusage` exit.
- Wrapper emits `RESULT ...` on success.
- Lifecycle recipe refuses unpinned versions.
- Lifecycle execution rejects shell commands and unallowlisted command ids.

## Open Questions

- Should managed installs prefer global npm, project-local `node_modules`, or a
  bridge-owned tools directory?
- Should online pricing refresh be allowed, and if so, should it require local
  approval every time or only at registration?
- Which `ccusage` fields should be redacted in summaries by default?
- Should session-level reports require a higher risk level than daily/monthly
  aggregate reports?
- Should imported `ccusage` estimates be stored in the main economic ledger or
  in a separate reconciliation table first?
