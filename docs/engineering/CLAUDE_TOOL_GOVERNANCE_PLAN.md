# Claude Tool Governance Plan

This document plans how local Claude Code capabilities are exposed through the
same governed tool registry used by `ccusage.report` and `codex.review.diff`.

## Decision

Expose Claude as governed tools, not as raw local CLI access.

```text
external agent
-> Tool Registry / Tool Facade
-> governed Claude tool contract
-> dedicated Claude wrapper
-> normal invocation
-> structured result import
-> audit and public state
```

Callers discover and invoke Claude capabilities through:

```text
GET /api/tools
GET /api/tools/claude.review.diff
POST /api/tools/claude.review.diff/invocations
GET /api/state
```

They must not call local `claude` commands directly, choose arbitrary working
directories, override permission mode, or replay adapter argv.

## Goals

- Reuse the governed tool registry, facade, invocation, audit, and read-model
  pattern already used for ccusage and Codex.
- Let other agents discover Claude review capability without learning local
  Claude CLI, account, workspace, or permission details.
- Start with a read-only review tool before any patch-producing or file-writing
  tools.
- Keep project and worktree scoping explicit and tenant-safe.
- Produce structured findings that other agents and the Web Console can consume.

## Non-Goals

- Do not expose a general-purpose `claude.run_anything` tool.
- Do not let external callers choose `--permission-mode acceptEdits`,
  `--permission-mode bypassPermissions`, shell flags, cwd, env, model, or raw
  Claude args.
- Do not reuse the existing write-capable `agt_claude_acceptEdits` registration.
- Do not apply Claude-generated edits in the first governed tool phase.
- Do not expose raw transcripts or local filesystem details in public state.

## Shared Framework

Claude tools use the same public control-plane shape as other governed tools:

```text
ToolDescriptor
ToolInvocationRequest
ToolInvocationResponse
Invocation
Structured import collection
Audit event stream
```

The facade owns discovery, input validation, project/worktree checks, agent
availability checks, invocation creation, and output collection naming. The
Claude wrapper owns bounded execution details for the selected tool. Those
details are never the public interface.

## Initial Tool Contract

Start with `claude.review.diff`.

```text
tool: claude.review.diff
version: 1
riskLevel: low
riskTags: read_only, read_project, code_review, local_agent
requiresLocalDevice: true
authoritativeBilling: false
agent: agt_claude_review_diff
outputCollection: claudeReviewFindings
```

Input:

```json
{
  "projectId": "prj_local",
  "worktreeId": "wtr_local",
  "instruction": "Review this diff for bugs and missing tests.",
  "severityFloor": "medium"
}
```

Rules:

- `projectId` is required unless the facade can resolve an actor-owned default
  project.
- `worktreeId` is required for diff review.
- `worktreeId` must belong to the resolved project or its workspace project.
- `instruction` is optional, bounded to 1200 characters, and only augments the
  fixed review prompt.
- `severityFloor` defaults to `low` and must be one of `low`, `medium`, `high`.
- The wrapper forces Claude `--permission-mode plan`.

Output:

```json
{
  "summary": "Review found 1 issue.",
  "findings": [
    {
      "severity": "high",
      "file": "apps/server/src/routes/tools.mjs",
      "line": 34,
      "message": "Guard project before invocation.",
      "suggestion": "Resolve project through the facade before creating work.",
      "confidence": "medium"
    }
  ]
}
```

## Development Plan

### Phase 1: Governed Read-Only Review

- Define `CLAUDE_REVIEW_TOOL_CONTRACT`.
- Add `createClaudeReviewAgentRegistration()` with deterministic id
  `agt_claude_review_diff`.
- Add `claude.review.diff` discovery to `/api/tools`.
- Add facade validation and invocation creation through
  `POST /api/tools/claude.review.diff/invocations`.
- Add `tools/agents/claude-review-wrapper.mjs`.
- Force wrapper execution to Claude `--permission-mode plan`.
- Import structured findings into `state.claudeReviewFindings`.
- Strip raw finding payloads from public state.
- Add external contract fixture coverage and smoke tests.

Acceptance:

- `GET /api/tools` includes `claude.review.diff` only when a governed Claude
  review agent is registered.
- Discovery exposes schemas, risk metadata, approval policy, and output
  collection, but no command, argv, cwd, env, permission mode, or wrapper path.
- Valid actor-owned worktree requests create queued invocations.
- Foreign project/worktree requests fail before invocation creation.
- Desktop Bridge injects only governed `--cwd`, `--instruction`, and
  `--severity-floor` wrapper flags.
- Completed invocations import normalized findings into `claudeReviewFindings`.

### Phase 2: Review Result Consumption

- Add UI views or filters for Claude review findings next to Codex findings.
- Add agent-facing examples for joining `invocationId` to
  `claudeReviewFindings`.
- Add retention/export rules for raw Claude transcripts if audit storage needs
  them later.

Acceptance:

- External orchestrators can discover, invoke, poll, and consume Claude review
  findings without any local CLI knowledge.

### Phase 3: Patch Proposal

- Add `claude.plan.change` or `claude.propose.patch`.
- Store plans or patch proposals as artifacts, not applied files.
- Require approval for broad scope, high risk, or write-adjacent behavior.

Acceptance:

- Other agents can ask Claude for proposed changes without gaining write access
  to a worktree.

### Phase 4: Approved Apply

- Add an apply tool only after approval, preview, and artifact binding exist.
- Reuse reviewed patch artifacts bound to the same project/worktree.
- Record changed files, verification output, and rollback guidance.

Acceptance:

- Missing, denied, or stale approvals cannot mutate files.

## Recommended Checks

```text
pnpm smoke:tool-contract
pnpm smoke:claude-review-wrapper
pnpm smoke:claude-tool
pnpm --filter @myagenttool/server test:integration
pnpm --filter @myagenttool/desktop lint
pnpm typecheck
pnpm docs:check
git diff --check
```
