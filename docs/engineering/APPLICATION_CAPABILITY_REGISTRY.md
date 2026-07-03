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

## Relationship To Existing Agents

Codex, Claude, and ccusage remain normal governed agents/tools. Application
capabilities should reuse their existing facade pattern:

```text
discover contract -> validate input -> create invocation -> policy/audit/trace
```

The next slice should generalize the Tool Registry so application capabilities
can appear beside `ccusage.report`, `codex.review.diff`, and
`claude.review.diff` without callers depending on adapter internals.

The first generalized discovery slice adds `/api/capabilities` while keeping
`/api/tools` stable. Existing tools are mapped with `provider.type = "tool"`;
application-projected capabilities use `provider.type = "application"`.
Application capability invocation runs through the platform
`agt_platform_application_control` agent for the first synchronous execution
slice. Every side-effecting action — `offline`, `archive`, `refresh`,
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
