# Tool Registry External Consumer Contract

This is the stable contract external orchestrators, tools, and other agents use
to discover and invoke governed MyAgentTool capabilities. The machine-readable
fixture is [tool-registry-contract.v1.json](fixtures/tool-registry-contract.v1.json).

## Contract Version

Current contract version: `1`.

The public surface is:

```text
GET /api/tools
GET /api/tools/{toolName}
POST /api/tools/{toolName}/invocations
GET /api/review-findings
GET /api/state
```

Everything below the tool facade is implementation detail. Consumers must not
read, cache, replay, or synthesize local adapter `command`, `args`, `cwd`,
`shell`, `sandbox`, `env`, wrapper paths, or CLI paths.

## Discovery

Use `GET /api/tools` to list currently discoverable governed tools. A tool only
appears when at least one governed agent registration backs it.

Every descriptor must include:

```text
name
version
displayName
description
riskLevel
riskTags
requiresLocalDevice
inputSchema
outputSchema
agents
approvalPolicy
authoritativeBilling
outputCollection
```

Descriptors may expose governed agent ids and availability status. They must not
expose executable commands, argv, working directories, shell config, sandbox
settings, local env, or wrapper internals.

Use `GET /api/tools/{toolName}` when an orchestrator needs the full schema and
approval policy for one tool.

## Invocation

Invoke through the facade only:

```http
POST /api/tools/{toolName}/invocations
Content-Type: application/json
Authorization: Bearer <token>
```

A successful response has this shape:

```json
{
  "tool": "codex.review.diff",
  "invocationId": "inv_demo_123",
  "agentId": "agt_codex_review_diff",
  "status": "queued",
  "outputCollection": "codexReviewFindings"
}
```

After creation, poll `GET /api/state`, find the invocation by `invocationId`,
then read records from the descriptor's `outputCollection`.

Review tools also appear in the unified `reviewFindings` public state view.
Consumers that orchestrate multiple review providers should prefer
`reviewFindings` and use `source` / `tool` to distinguish Codex from Claude.

For narrow polling, use `GET /api/review-findings` instead of fetching the full
state document:

```http
GET /api/review-findings?invocationId=inv_demo_123
Authorization: Bearer <token>
```

Supported filters:

```text
projectId, worktreeId, invocationId, source, severity
```

`source` must be `codex` or `claude`. `severity` must be `low`, `medium`, or
`high`. Unknown filters are rejected.

The runnable external-client example is:

```bash
node tools/dev/tool-registry-review-client.mjs \
  --base-url http://127.0.0.1:3001 \
  --tool claude.review.diff \
  --project-id prj_local \
  --worktree-id wtr_local \
  --instruction "Review this diff for correctness and missing tests." \
  --severity-floor medium
```

The example intentionally uses only public API endpoints. It does not read or
replay agent adapter commands, wrapper paths, local cwd, env, or CLI flags.

## Tool Inputs

`ccusage.report` allowed fields:

```text
report, source, since, until, timezone, offline, projectId
```

Example:

```json
{
  "report": "daily",
  "source": "all",
  "since": "2026-07-01",
  "until": "2026-07-02",
  "timezone": "Asia/Shanghai",
  "offline": true,
  "projectId": "prj_local"
}
```

`codex.review.diff` allowed fields:

```text
projectId, worktreeId, instruction, severityFloor
```

Example:

```json
{
  "projectId": "prj_local",
  "worktreeId": "wtr_local",
  "instruction": "Review this diff for correctness and missing tests.",
  "severityFloor": "medium"
}
```

`instruction` augments the fixed governed review prompt. It cannot select cwd,
shell, sandbox, model, permission mode, output format, or arbitrary CLI flags.

`claude.review.diff` uses the same allowed fields and output shape as
`codex.review.diff`. It runs through a dedicated governed Claude review wrapper
in read-only `plan` mode; consumers cannot select Claude permission mode or
request edit/apply behavior through this tool.

## Output Joins

`ccusage.report` writes normalized records to `importedUsageEstimates`. Join by
`reportInvocationId`.

`codex.review.diff` writes normalized findings to `codexReviewFindings`. Join by
`invocationId` or `reviewInvocationId`.

`claude.review.diff` writes normalized findings to `claudeReviewFindings`. Join
by `invocationId` or `reviewInvocationId`.

Both review tools are also exposed through `reviewFindings`, a derived public
view that merges Codex and Claude findings after tenant scoping and raw-payload
stripping. Join by `invocationId` or `reviewInvocationId`; use `source` and
`tool` when provider-specific routing is needed.

The same normalized rows can be queried directly through
`GET /api/review-findings`.

Public state intentionally strips raw payloads. Consumers should depend on
normalized fields only.

## Errors

Consumers must handle these as stable governance/API outcomes:

```text
400 invalid_input
400 unknown_field
400 project_required
400 worktree_required
400 unsupported_report
400 unsupported_source
400 source_report_mismatch
400 invalid_date_filter
400 invalid_timezone
400 invalid_severity_floor
400 invalid_source
400 invalid_severity
400 instruction_too_long
404 tool_not_found
404 project_not_found
404 worktree_not_found
409 approval_required
409 agent_not_available
```

Treat `approval_required` as a governance decision. Do not bypass it by calling
the underlying CLI directly.

## Consumer Rules

- Discover first, then invoke by tool name.
- Validate input against `inputSchema` before calling.
- Send only allowed fields; unknown fields are rejected.
- Use `outputCollection` to decide where completion results appear.
- Prefer `reviewFindings` when consuming results from multiple review tools.
- Prefer `GET /api/review-findings` for filtered polling by invocation, source,
  severity, project, or worktree.
- Treat `authoritativeBilling: false` as evidence or imported estimate, not a
  platform ledger charge.
- Never infer local execution details from previous responses or local files.
- Tolerate additive descriptor fields, new tools, and new error codes.

## Versioning

Contract version `1` guarantees the endpoint shape, descriptor required fields,
current tool names, current output collections, and the forbidden raw execution
fields listed in the fixture.

Compatible changes:

```text
new tools
new descriptor fields
new enum values when schemas advertise them
new error codes
additional normalized output fields
```

Breaking changes require a new fixture file and an updated contract version.
