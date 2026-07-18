# Coding Agent Capability Interface

Codex and Claude share the `/api/capabilities` caller contract while retaining
different, truthful provenance. Codex remains a governed Tool per #925; Claude
also owns the canonical `app_claude` Application. There is intentionally no
`app_codex` registration.

## Discovery

Coding capabilities publish `metadata.interface`:

```json
{
  "family": "coding_agent",
  "version": "1",
  "provider": "codex",
  "operation": "review.diff",
  "mutation": "read_only",
  "session": "isolated",
  "approval": "allowed",
  "resultCollection": "codexReviewFindings"
}
```

Callers may select capabilities without parsing adapter-specific names:

```text
GET /api/capabilities?interfaceFamily=coding_agent
GET /api/capabilities?interfaceFamily=coding_agent&operation=review.diff
```

Provider provenance remains explicit:

| Surface | Provider type | Reason |
| --- | --- | --- |
| `codex.review.diff`, `codex.exec` | `tool` | Platform-governed CLI contract; user-installed auth and sandbox stay visible |
| `app.app_claude.*` | `application` | Canonical binary Application owns discovery, readiness, and result lineage |
| `claude.*` compatibility Tools | `tool` | Existing Tool callers remain supported without changing `/api/tools` |

## Invocation Envelope

A successful `POST /api/capabilities/:name/invocations` returns these fields for
both Tool and Application providers:

```json
{
  "capability": "app.app_claude.review.diff",
  "provider": { "type": "application", "id": "app_claude" },
  "invocationId": "inv_...",
  "status": "queued",
  "outputCollection": "claudeReviewFindings",
  "interface": { "family": "coding_agent", "version": "1" },
  "invocation": {}
}
```

Legacy fields such as `tool` remain additive compatibility fields. Error
responses retain their established refusal shapes and do not gain metadata that
could weaken tenancy opacity.

## Capability Matrix

| Provider | Operation | Mutation | Approval |
| --- | --- | --- | --- |
| Codex | `review.diff` | read-only | allowed |
| Codex | `execute.change` | worktree write | approval broker; default-off discovery |
| Claude | `review.diff`, `explain.diff`, `explain.code`, `analyze.issue`, `plan.change` | read-only | allowed |
| Claude | `propose.patch` | immutable proposal only | allowed; never applies |
| Claude | `apply.patch` | worktree write | single-use grant; default-off discovery |

The interface describes common caller semantics; provider-specific schemas and
security gates remain authoritative. A caller must still validate each selected
capability's `inputSchema`, readiness, mutation, and approval posture.
