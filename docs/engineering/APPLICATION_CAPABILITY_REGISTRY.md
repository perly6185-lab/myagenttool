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

## Governed Installation Plans

Known Applications can request a plan through
`POST /api/applications/install/plan`. P1 is plan-only: it never spawns a
process, installs software, queues bridge work, or consumes an approval.

The server resolves `git`, `ccusage`, and `claude` through versioned recipes for
Windows, macOS, and Linux. Each plan binds the Application, project, device,
platform, architecture, provider, package identifier, fixed executable, and
fixed discrete argv into a stable fingerprint. The public contract also carries
risk, approval, timeout, cancellation, and post-install probe metadata.

Callers may supply only Application and target scope. Command, executable,
argv, package, provider, version, plan identity, and fingerprint overrides fail
closed. Foreign project/device scope and target platform mismatches also fail
closed. Future execution must re-resolve the current server recipe and require
an exact plan identity before Desktop Bridge dispatch.

P2 adds that execution boundary. `POST /api/applications/install/runs` consumes
a server-issued, single-use `application.install` approval grant bound to the
exact `planId`. The server re-resolves and compares the complete current plan
before queueing a device-bound run. Desktop Bridge then independently verifies
the schema, recipe version, platform, package, executable, discrete argv,
fingerprint, and plan id before spawning with `shell = false`.

Install runs expose bounded progress summaries but never persist stdout,
stderr, environment, credentials, or package-manager shell strings. Operators
can request cancellation; the Bridge polls the device-bound run, terminates the
process tree, and reports a terminal `succeeded`, `failed`, `cancelled`,
`timed_out`, or `refused` classification for audit.

P3 exposes the governed setup state machine in the Register application dialog:

```text
detect -> plan -> approval -> installing -> probing -> registering -> ready
```

Failed and cancelled runs retain actionable recovery and retry controls. If
device readiness already reports the binary as available, setup skips plan,
approval, and installation and registers the canonical Application directly.
Offline devices, approval failures, installation failures, and probe failures
remain distinct operator-facing outcomes. Advanced source registration stays
available as a collapsed secondary path.

P4 hardens the release boundary. NPM recipes use an exact approved version and
the canonical npm registry instead of a moving `latest` alias. Plans expire ten
minutes after issuance, and both the server and Desktop Bridge independently
reject expired, modified, wrong-platform, or elevation-requesting plans. Git is
enabled only on Windows and macOS until Linux has an explicit elevation broker;
the Bridge never turns plan metadata into implicit privilege escalation.

Bridge progress and completion evidence are bounded, sensitive assignments and
user-home paths are redacted, and terminal status/classification pairs are
allowlisted. Install and readiness-probe timeouts are separate. Automatic
rollback and uninstall remain disabled because package-manager state may have
existed before setup; every non-successful run records that operator review is
required. Cross-platform contract tests run on Windows, macOS, and Linux. The
release evidence and rollback boundary are recorded in
`docs/engineering/APPLICATION_INSTALL_RELEASE_EVIDENCE.md`.

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

Wrapper commands carry command allowlist metadata, input schema, env redaction,
cwd, timeout, cancellation, file policy, and network policy. Only commands with
`status = approved` are projected. Draft and disabled commands remain visible in
the application source/probe metadata but are not invokable through
`/api/capabilities`.

The first wrapper slice still does not install packages or execute npm. A
wrapper invocation creates the normal governed invocation, requires approval,
and returns the audited wrapper execution plan with `executable = false`.
Runtime adapter wiring is a follow-up slice.

## Agent Facades

An Application capability may delegate to a **registered Agent** (an MCP, A2A,
HTTP, or CLI agent) the way a `tool_facade` delegates to a governed Tool:

```text
capabilityFacades: [
  { id, toolName, ... }                    -> tool_facade  (governed Tool)
  { id, agentId, agentToolName?, ... }     -> agent_facade (registered Agent)
]
```

A facade declares **exactly one** of `toolName` / `agentId`. `agentToolName`
names which tool on the agent the capability calls (an MCP server can expose
several); omitted, the bridge's single-tool auto-resolution applies.

Invocation goes through `POST /api/capabilities/:capabilityName/invocations`,
creates a normal governed invocation on the named agent (async through the
bridge), and stamps Application lineage (`applicationId`, `capability`,
`applicationAction: agent:<agentId>:<toolName>`). Guards run in two layers, on
purpose:

- **Application-side** (`planAgentFacadeInvocation`): tenancy, lifecycle status
  (`archived`/`offline` refuse), and the facade's declared `requiresApproval`
  (missing token -> `409 approval_required`).
- **Agent-side** (capability service): the agent must exist and not be disabled
  (`409 agent_not_available`), and a named tool must be inside the agent's own
  registered `allowedTools` (`409 agent_tool_not_allowlisted`). The bridge's MCP
  client enforces the same allowlist again client-side before the wire — a
  mis-pointed descriptor still cannot reach a tool the agent's registration
  does not allow.

Discovery overlays the **live** agent state onto the capability's readiness
(`agent_not_registered` / `agent_disabled` / `agent_available`), so a
capability whose agent has gone away explains itself instead of failing a run
opaquely — the same precise-refusal shape the device gives a missing binary.

### Why a new mode, not agents projected as Tools

The alternative — projecting registered agents into the Tool Registry so the
existing `tool_facade` covers them — was rejected (#975). The mode name is
load-bearing audit metadata: it records **which trust regime** execution was
delegated to. A Tool is a platform-curated, reviewed contract; a registered
Agent is user-registered code. Projecting agents as Tools would launder that
provenance — an audit row saying `tool:` would imply a review status the
executor does not have — and would churn `/api/tools` (a surface this document
commits to keeping stable) every time an agent registers, goes offline, or is
removed, while inheriting none of the agent's tenancy scoping. Convergence
already happens where it belongs: `/api/capabilities` is the one discovery
surface, and `provider.type` keeps the provenance honest there.

## Relationship To Existing Agents

Codex and ccusage remain governed agents/tools. Claude additionally has a
canonical `app_claude` registration whose `app.app_claude.review.diff`
capability delegates to the existing `claude.review.diff` Tool. This generic
`tool_facade` pattern lets an Application own discovery, readiness, lineage,
and result presentation without duplicating the governed execution adapter:

```text
discover contract -> validate input -> create invocation -> policy/audit/trace
```

The next slice should generalize the Tool Registry so application capabilities
can appear beside `ccusage.report`, `codex.review.diff`, and
`claude.review.diff` without callers depending on adapter internals.

The first generalized discovery slice adds `/api/capabilities` while keeping
`/api/tools` stable. Existing tools are mapped with `provider.type = "tool"`;
application-projected capabilities use `provider.type = "application"`.
Application capability invocation normally runs through the platform
`agt_platform_application_control` agent for synchronous control actions.
Capabilities declaring `metadata.execution.mode = "tool_facade"` delegate to
their named governed Tool while stamping Application lineage on the invocation.
Every side-effecting action — `offline`, `archive`, `refresh`,
`generate_orchestration`, and `wrapper:*` commands — requires an explicit
`approvalToken` and returns `409 approval_required` without one. In this slice
the token is an explicit-intent confirmation on an owner-scoped resource
(tenancy is the real authorization boundary), **not** a cryptographic approval;
a real approval-issuance/verification flow is tracked as follow-up.

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
npm package -> application asset -> governed report capability -> fixed wrapper agents
```

Existing `ccusage.report` APIs and import guards should remain compatible while
adding an `app_ccusage` application record later.

## Next Phase: Discovery -> Access -> Execute -> Result

The next Application runtime slice should close the product loop around one
reference application, then generalize only after that path is measured. The
target operator path is:

```text
register/probe application
  -> discover governed capabilities
  -> request approved access
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
- Add regression coverage that discovery survives restart and remains scoped to
  the owning team/project.

### 2. Access

Access is the consent and trust boundary. A caller may discover a capability
without being able to execute it.

- Require owner-scoped authorization plus an explicit approval request for every
  side-effecting Application capability.
- Show pending approval and duplicate-action guard evidence in both
  Applications and Invocations, using the shared recovery/explanation helpers.
- Carry bridge/device ownership into wrapper execution so access cannot be
  replayed through an unbound bridge.
- Keep local execution policy independent of server approval: command id, cwd,
  args, env, file policy, and network policy must still pass the bridge-side
  allowlist before spawn.

### 3. Execute

Execution should be a normal governed invocation, not a hidden adapter shortcut.

- Wire the approved `installed-wrapper` path to the platform Application Wrapper
  runner for the ccusage reference application first.
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
- Attach result refs to the invocation, Application run history, audit summary,
  and Evidence Center read model.
- Render result links and next steps in Applications and Invocations, including
  approval pending, policy refusal, executed result, and recovery/view-result
  states.
- Make restart tests prove that Application records, approval requests,
  invocation result refs, imported evidence, and audit refs remain explainable.

### Acceptance Bar

The first closed-loop slice is accepted when a ccusage Application capability
can be registered, discovered, approved, bridge-executed, completed, imported,
and inspected through both the API contract and Web UI. The regression suite
should cover the happy path plus access denied, duplicate guard, local policy
refusal, restart/read-model restore, and stable `/api/tools/ccusage.report`
compatibility.
