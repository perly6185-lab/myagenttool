# Tool Registry Agent Calling

This document describes the governed CLI/JSON channel external tools and other
agents should use to discover and invoke platform-managed tools such as
`ccusage.report` and future Codex tools such as `codex.review.diff`.

## Contract

The tool registry is the public contract. Callers must not read or replay an
agent's `adapter.command`, `adapter.args`, local binary path, wrapper path, or
shell details. Those fields are implementation details owned by the control
plane and Desktop Bridge.

Use this flow:

```text
GET /api/tools
GET /api/tools/ccusage.report
GET /api/tools/codex.review.diff
POST /api/tools/ccusage.report/invocations
POST /api/tools/codex.review.diff/invocations
GET /api/state
```

`GET /api/tools` returns all currently discoverable governed tools:

```json
{
  "tools": [
    {
      "name": "ccusage.report",
      "version": "1",
      "displayName": "ccusage Usage Report",
      "riskLevel": "low",
      "riskTags": ["read_only", "read_local", "shell_exec"],
      "requiresLocalDevice": true,
      "outputCollection": "importedUsageEstimates",
      "authoritativeBilling": false
    }
  ]
}
```

`GET /api/tools/ccusage.report` returns the full descriptor, including input and
output schemas, approval policy, and governed agent references. The descriptor
may include agent ids and health-facing status, but intentionally does not
expose the executable command or argv.

Codex tools use the same discovery and invocation shape. A caller should treat
`codex.review.diff` as a governed review capability, not as permission to launch
the local Codex CLI with arbitrary arguments.

## Invocation

Create a report invocation through the facade:

```http
POST /api/tools/ccusage.report/invocations
Content-Type: application/json
Authorization: Bearer <token>

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

Successful creation returns a normal invocation id:

```json
{
  "tool": "ccusage.report",
  "invocationId": "inv_123",
  "agentId": "agt_ccusage_daily",
  "status": "queued",
  "outputCollection": "importedUsageEstimates"
}
```

After creation, poll `GET /api/state` and follow the invocation by
`invocationId`. Completed ccusage rows are surfaced in
`importedUsageEstimates` with `reportInvocationId` equal to that invocation id.

## Codex Review Example

Future Codex review tools follow the same facade pattern:

```http
POST /api/tools/codex.review.diff/invocations
Content-Type: application/json
Authorization: Bearer <token>

{
  "projectId": "prj_local",
  "worktreeId": "wt_123",
  "instruction": "Review this diff for correctness and missing tests.",
  "severityFloor": "low"
}
```

Successful creation returns a normal invocation id and a dedicated output
collection:

```json
{
  "tool": "codex.review.diff",
  "invocationId": "inv_456",
  "agentId": "agt_codex_review_diff",
  "status": "queued",
  "outputCollection": "codexReviewFindings"
}
```

After creation, poll `GET /api/state` and follow the invocation by
`invocationId`. Completed review findings should be exposed as normalized
records in `codexReviewFindings`, not as raw Codex transcripts.

## ccusage Input Rules

Allowed request fields:

```text
report, source, since, until, timezone, offline, projectId
```

Current report ids are those returned by the descriptor. Offline aggregate
reports are allowed. `session` reports and `offline: false` return
`approval_required` until explicit approval flow support is added.

Date filters must use `YYYY-MM-DD`. Timezones must use the wrapper-safe
character set accepted by the server.

## Errors

Common errors:

```text
404 tool_not_found
404 project_not_found or foreign-project denial
404 worktree_not_found or foreign-worktree denial
400 invalid_input
400 unknown_field
400 project_required
400 worktree_required
400 unsupported_report
400 unsupported_source
400 source_report_mismatch
400 invalid_date_filter
400 invalid_timezone
409 approval_required
409 agent_not_available
409 codex_unavailable
```

Callers should treat `approval_required` as a governance result, not a transport
failure. Do not bypass it by directly invoking the underlying CLI.

## Billing Semantics

`ccusage.report` imports observed external usage estimates only. Rows in
`importedUsageEstimates` have:

```text
amountSource: imported_ccusage_report
economicModel: external_billed
authoritative: false
```

They are not authoritative myagenttool ledger entries, do not become platform
charges, and should not be used for platform quota enforcement unless a later
reconciliation step explicitly promotes them.
