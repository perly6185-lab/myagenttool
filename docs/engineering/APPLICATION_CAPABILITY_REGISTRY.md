# Application Capability Registry

This document captures the first application-asset slice for myagenttool.

The goal is to register applications as governed assets, project their managed
capabilities, and let agents discover those capabilities through the same
control-plane patterns used by governed tools such as `ccusage.report`,
`codex.review.diff`, and `claude.review.diff`.

## Object Model

```text
Application = asset under management
Agent       = execution identity
Capability = discoverable and invokable contract
Routine    = orchestration built from capabilities
```

Applications do not have to expose a native API, CLI, MCP server, or agent
protocol. The platform can still project managed capabilities such as inspect,
search, refresh, offline, and orchestration generation.

## Supported Sources

The first registry slice supports:

```text
git
local
npm
manual
```

Git and local sources may also create or reuse project records. NPM and manual
sources are registered as application assets first; execution and installation
remain separate lifecycle capabilities.

## Lifecycle

Application status values:

```text
draft
probing
registered
active
offline
archived
failed
```

The current API supports:

```text
POST /api/applications/register
GET  /api/applications
GET  /api/applications/:id
POST /api/applications/:id/probe
POST /api/applications/:id/online
POST /api/applications/:id/offline
POST /api/applications/:id/archive
POST /api/applications/:id/refresh
GET  /api/applications/:id/capabilities
GET  /api/capabilities
GET  /api/capabilities/:capabilityName
POST /api/capabilities/:capabilityName/invocations
GET  /api/applications/:id/orchestrations
POST /api/applications/:id/orchestrations/generate
POST /api/applications/:id/orchestrations/:routineId/run
GET  /api/applications/:id/orchestrations/:routineId/runs
GET  /api/applications/:id/orchestrations/:routineId/runs/:invocationId
GET  /api/applications/:id/orchestrations/:routineId/runs/:invocationId/events
GET  /api/applications/:id/orchestrations/:routineId/runs/:invocationId/recovery
POST /api/applications/:id/orchestrations/:routineId/runs/:invocationId/recovery/actions
```

`offline` does not delete files or registry history. It disables execution-like
projected capabilities and records an audit event.

## Projected Capabilities

Every application currently projects managed capabilities:

```text
app.<application-id>.inspect
app.<application-id>.search
app.<application-id>.refresh
app.<application-id>.offline
app.<application-id>.archive
app.<application-id>.generate_orchestration
```

Descriptors include provider metadata, risk level, approval requirement, input
schema, output schema, and status. They intentionally do not expose local
commands, wrapper paths, or argv.

## Probe Metadata

`POST /api/applications/:id/probe` performs a read-only metadata probe and
stores structured results on `application.probe`.

Probe capability entries use:

```text
source = managed | declared | inferred
status = available | disabled | candidate
invocationMode = gateway | not_invokable
```

Managed capabilities are the platform lifecycle/read capabilities above.
Declared capabilities come from a manual source manifest. Inferred capabilities
come from metadata such as `package.json`, NPM package metadata, README files,
package `bin`, selected safe script names, and package `exports`.

Inferred capabilities are discovery candidates only. They are intentionally
`not_invokable` until a wrapper descriptor and approval path are added in a
later slice. NPM probes inspect registration metadata only; they do not install
packages, run scripts, or execute package code.

## NPM Wrapper Descriptors

NPM application sources may include a governed wrapper descriptor:

```text
source.wrapper.mode = metadata-only | installed-wrapper
```

`metadata-only` records reviewable wrapper metadata but projects no invokable
commands. `installed-wrapper` can project approved commands as capabilities:

```text
app.<application-id>.wrapper.<command-id>
```

Wrapper commands carry command allowlist metadata, declared per-invocation
argument inputs, input schema, env redaction, cwd, timeout, cancellation, file
policy, network policy, compatibility facade, billing semantics, and result
import metadata. Only commands with `status = approved` are projected. Draft and
disabled commands remain visible in the application source/probe metadata but
are not invokable through `/api/capabilities`.

Approved `installed-wrapper` commands now execute as normal governed
invocations through the platform Application Wrapper Runner. The server resolves
the reviewed command and appends only declared, validated inputs; the Desktop
Bridge independently re-checks the inner command, argv, cwd, file policy, and
network policy before spawning the fixed wrapper runner. MyAgentTool still does
not install arbitrary packages or accept free-form npm commands.

The executable path now supports reviewed NPM wrapper descriptors beyond
ccusage. `npm_script` commands are executed through the declared package manager
(`npm`, `pnpm`, or `yarn`) and still pass through the fixed Application Wrapper
Runner. The local Desktop Bridge gate remains conservative: generic wrappers are
allowed only for server-resolved `app.*.wrapper.*` capabilities whose declared
policy stays within read-only files and forbidden network access.

## Application MCP

Applications may persist an `mcpAgent` descriptor or discover MCP server
candidates during probe. A persisted descriptor can recover the corresponding
Agent row and shared tool names after restart.

Probe currently reads common project MCP config files such as `.vscode/mcp.json`,
`.cursor/mcp.json`, and `.mcp.json`, supporting both `servers` and `mcpServers`.
High-confidence stdio `node` entrypoints whose scripts stay inside the
Application root can be auto-registered. Shell and HTTP candidates are retained
as manual-confirm evidence; the Applications inspector can now confirm a ready
manual candidate through an explicit intent action that persists the MCP
descriptor and projects shared tool names.

Application-scoped MCP tools are exposed as governed tool/capability names such
as `doocs_md.render_markdown` without exposing adapter command, argv, or local
paths to callers. The Desktop Bridge re-checks MCP stdio execution before spawn
and records `local_execution_refused` evidence on policy mismatch.

## Relationship To Existing Agents

Codex, Claude, and ccusage remain normal governed agents/tools. Application
capabilities reuse the same facade pattern:

```text
discover contract -> validate input -> create invocation -> policy/audit/trace
```

The generalized discovery slice adds `/api/capabilities` while keeping
`/api/tools` stable. Existing tools are mapped with `provider.type = "tool"`;
application-projected capabilities use `provider.type = "application"`.
Application capability invocation runs through the platform
`agt_platform_application_control` agent for synchronous control-plane actions
and through `agt_platform_application_wrapper` for approved npm-wrapper
commands. Every side-effecting action — `offline`, `archive`, `refresh`,
`generate_orchestration`, approval-required `wrapper:*` commands, and manual MCP
candidate confirmation — now uses the normal local approval issuance flow. The
first request returns `202` with an `approvalRequestId`; after
`/api/approvals/:id/approve`, the caller retries with that `approvalRequestId`
and the server verifies the approval's invocation metadata matches the same
Application, capability/action, and candidate/command. `approvalToken` remains a
legacy compatibility input while callers migrate.

`app.<application-id>.generate_orchestration` writes a Loop Routine draft into a
platform-managed, per-application directory (keyed by the unique application id,
never the application's own path or the server repo root):

```text
.myagenttool/applications/<application-id>/routines/app-<application-id>-maintenance.json
```

The generated routine uses the normal `LoopRoutine` schema, includes read-only
filesystem/git inputs where applicable, keeps remote and GitHub writes
forbidden, and can be validated with `pnpm ai:loop-routine-check`.

## ccusage Migration Direction

`ccusage` is the reference pattern for NPM-delivered utility software:

```text
npm package -> application asset -> governed report capability -> Application Wrapper Runner
```

`app_ccusage` now registers as a pinned npm-source Application, projects the six
offline report capabilities, executes through the Application-backed wrapper
path, imports usage estimates, and keeps the stable `ccusage.report` facade
compatible.

## Current Runtime Path

The measured Application runtime loop is:

```text
register/probe application
  -> discover governed capabilities
  -> request approved access or explicit intent
  -> execute through the normal invocation path
  -> inspect imported result, audit evidence, and next step
```

### 1. Discovery

Discovery is the contract surface. A caller should be able to answer "what can
this application do?" without seeing wrapper internals.

- Keep `GET /api/capabilities?providerType=application` as the primary discovery
  surface, with `/api/applications/:id/capabilities` as the focused view.
- Publish readiness, risk, approval requirement, input schema, output schema,
  `outputCollection`, and `resultImport` metadata for every projected
  capability.
- Treat inferred package scripts and exports as candidates until a reviewed
  wrapper descriptor promotes them to approved capabilities.
- Regression coverage now verifies Application MCP descriptor recovery after
  restart, actor scoping for Application-bound MCP tools, and HTTP
  list/detail/register/probe/confirm responses that expose only redacted
  Application snapshots rather than raw MCP adapter command/args/url. MCP
  candidates also publish structured review fields for manual confirmation:
  data boundary, file/network policy, allowed tool count, and redacted HTTP
  endpoint origin/host/protocol. The next hardening step is to keep
  descriptor/result-path metadata restart-safe as the surface broadens beyond
  the measured references.

### 2. Access

Access is the consent and trust boundary. A caller may discover a capability
without being able to execute it.

- Require owner-scoped authorization plus explicit intent or an approval request
  for every side-effecting Application capability.
- Show pending approval and duplicate-action guard evidence in both
  Applications and Invocations, using the shared recovery/explanation helpers.
- Carry bridge/device ownership into wrapper execution so access cannot be
  replayed through an unbound bridge.
- Keep local execution policy independent of server approval: command id, cwd,
  args, env, file policy, and network policy must still pass the bridge-side
  allowlist before spawn.

### 3. Execute

Execution should be a normal governed invocation, not a hidden adapter shortcut.

- Keep the approved `installed-wrapper` path wired to the platform Application
  Wrapper Runner for the ccusage reference application.
- Preserve argv construction from the reviewed wrapper descriptor and validated
  inputs; do not accept free-form npm commands or free-form wrapper args.
- Emit invocation, trace, policy decision, local execution preview, refusal, and
  completion events with the same audit semantics as other governed agents.
- Keep `/api/tools/ccusage.report` compatible while it delegates to the
  Application-backed execution path.

### 4. Result

Results are only closed when operators and external consumers can find the
outcome without reading raw diagnostics.

- Import wrapper completion output into the declared `outputCollection`
  (`reviewFindings`, usage estimates, ledger-adjacent evidence, or application
  result records as appropriate).
- Attach result refs to the invocation, Application latest result, audit
  summary, and Evidence Center read model.
- Render result links and next steps in Applications and Invocations, including
  approval pending, policy refusal, executed result, and recovery/view-result
  states.
- Keep restart tests proving that Application records, approval requests,
  invocation result refs, imported evidence, and audit refs remain explainable.

### Acceptance Bar

The first closed-loop slice is accepted for ccusage when its Application
capability can be registered, discovered, bridge-executed, completed, imported,
and inspected through both the API contract and Web UI.

The second measured closed-loop slice is accepted for a doocs/md-style MCP
Application when probe discovers the MCP server, high-confidence rooted `node`
stdio is auto-registered, `render_markdown` executes through the MCP bridge
path, result refs link back to invocation/Application/audit/Evidence Center,
and Web shows MCP tools plus the View invocation path.

The remaining acceptance work is to keep these paths green across restart and
read-model restore, replace intent-marker approval tokens with real approval
issuance, add deeper HTTP MCP live-probe/review evidence, and generalize npm
wrapper execution only after local manifest and consent checks are in place.
