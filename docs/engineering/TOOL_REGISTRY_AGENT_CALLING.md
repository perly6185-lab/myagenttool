# Tool Registry Agent Calling

This document describes the governed CLI/JSON channel external tools and other
agents should use to discover and invoke platform-managed tools such as
`ccusage.report`, `codex.review.diff`, and `claude.review.diff`.

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
GET /api/tools/claude.review.diff
POST /api/tools/ccusage.report/invocations
POST /api/tools/codex.review.diff/invocations
POST /api/tools/claude.review.diff/invocations
GET /api/capabilities
GET /api/capabilities/{capabilityName}
POST /api/capabilities/{capabilityName}/invocations
GET /api/review-findings
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

Codex and Claude tools use the same discovery and invocation shape. A caller
should treat `codex.review.diff` and `claude.review.diff` as governed review
capabilities, not as permission to launch local CLIs with arbitrary arguments.

`/api/capabilities` is the generalized discovery facade. It includes the
governed tools above with `provider.type = "tool"` and application-projected
capabilities with `provider.type = "application"`. `/api/tools` remains the
stable tool-only compatibility surface.
Invoking application capabilities through `/api/capabilities/{name}/invocations`
creates normal invocation/audit records backed by the platform Application
Control agent.

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
Completed code review rows are surfaced in their provider-specific collection
and in the derived `reviewFindings` collection with the same `invocationId`.
For filtered polling, prefer:

```http
GET /api/review-findings?invocationId=inv_456
Authorization: Bearer <token>
```

A minimal external agent client is available at
`tools/dev/tool-registry-review-client.mjs`:

```bash
node tools/dev/tool-registry-review-client.mjs \
  --base-url http://127.0.0.1:3001 \
  --tool claude.review.diff \
  --project-id prj_local \
  --worktree-id wtr_local \
  --severity-floor medium
```

The client demonstrates discover -> invoke -> poll without depending on
internal adapter fields.

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
Multi-review orchestrators can also read the derived `reviewFindings` public
state view and filter by `source: "codex"` or `tool: "codex.review.diff"`.

## Claude Review Example

Claude review uses the same facade pattern, backed by a dedicated read-only
agent registration:

```http
POST /api/tools/claude.review.diff/invocations
Content-Type: application/json
Authorization: Bearer <token>

{
  "projectId": "prj_local",
  "worktreeId": "wt_123",
  "instruction": "Review this diff for correctness and missing tests.",
  "severityFloor": "medium"
}
```

Successful creation returns a normal invocation id and a Claude-specific output
collection:

```json
{
  "tool": "claude.review.diff",
  "invocationId": "inv_789",
  "agentId": "agt_claude_review_diff",
  "status": "queued",
  "outputCollection": "claudeReviewFindings"
}
```

The Claude wrapper forces `--permission-mode plan`. External callers cannot use
this tool to request `acceptEdits`, `bypassPermissions`, edit/apply behavior,
arbitrary cwd, shell, env, model, or raw argv. Completed findings are exposed as
normalized records in `claudeReviewFindings`, not as raw Claude transcripts.
They are also available in the unified `reviewFindings` view.

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
400 invalid_source
400 invalid_severity
409 approval_required
409 agent_not_available
409 codex_unavailable
409 claude_unavailable
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
