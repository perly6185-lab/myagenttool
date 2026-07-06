# Codex Tool Governance Plan

This document plans how local Codex capabilities should be exposed to other
agents through the same governed tool registry used by `ccusage.report`.

## Decision

Expose Codex as governed tools, not as raw local CLI access.

```text
external agent
-> Tool Registry / Tool Facade
-> governed Codex tool contract
-> Codex wrapper or app-server adapter
-> normal invocation
-> structured result import
-> audit and public state
```

Callers must discover and invoke Codex capabilities through:

```text
GET /api/tools
GET /api/tools/codex.review.diff
POST /api/tools/codex.review.diff/invocations
GET /api/state
```

They must not call local `codex` commands directly, choose arbitrary working
directories, override sandbox or permission settings, or replay adapter argv.

## Goals

- Reuse the governed tool registry, facade, invocation, audit, and read-model
  pattern already introduced for `ccusage.report`.
- Let other agents discover Codex capabilities without learning Codex CLI,
  app-server, sandbox, or workspace details.
- Start with read-only review capabilities before introducing patch-producing
  or file-writing tools.
- Keep project and worktree scoping explicit and tenant-safe.
- Produce structured findings that other agents and the Web Console can consume.

## Non-Goals

- Do not expose a general-purpose `codex.run_anything` tool.
- Do not let external agent prompt text become arbitrary shell flags, cwd,
  sandbox, model, or approval settings.
- Do not auto-apply Codex-generated patches in the first phase.
- Do not expose raw prompts, full transcripts, or local filesystem details in
  public state.

## Shared Framework

Codex tools should use the same control-plane shape as ccusage:

```text
ToolDescriptor
ToolInvocationRequest
ToolInvocationResponse
Invocation
Structured import collection
Audit event stream
```

The shared facade owns:

- tool discovery
- input validation
- project and worktree tenancy checks
- agent availability checks
- approval-required decisions
- invocation creation
- output collection naming

The Codex adapter owns only the bounded execution details for a selected tool.
Those details are never the public interface.

## Initial Tool Contract

Start with `codex.review.diff`.

```text
tool: codex.review.diff
version: 1
riskLevel: low
riskTags: read_only, read_project, code_review, local_agent
requiresLocalDevice: true
authoritativeBilling: false
outputCollection: codexReviewFindings
```

Input:

```json
{
  "projectId": "prj_local",
  "worktreeId": "wt_123",
  "instruction": "Review this diff for bugs and missing tests.",
  "severityFloor": "low"
}
```

Allowed fields:

```text
projectId, worktreeId, instruction, severityFloor
```

Rules:

- `projectId` is required unless the facade can resolve an actor-owned default
  project.
- `worktreeId` is required for diff review.
- `worktreeId` must belong to the resolved project or its workspace project.
- `instruction` is optional and bounded; it augments the fixed review prompt but
  cannot alter sandbox, cwd, approval, command, or output format.
- `severityFloor` defaults to `low` and must be one of `low`, `medium`, `high`.

Output:

```json
{
  "summary": "2 findings. One high severity issue needs attention.",
  "findings": [
    {
      "severity": "high",
      "file": "apps/server/src/routes/tools.mjs",
      "line": 34,
      "message": "Foreign-project checks must run before creating an invocation.",
      "suggestion": "Resolve projectId through the actor-owned project guard.",
      "confidence": "medium"
    }
  ]
}
```

## Execution Strategy

### MVP: `codex exec` Wrapper

Use a governed wrapper first:

```text
node tools/agents/codex-review-wrapper.mjs
  --mode diff-review
  --project <resolved-project-id>
  --worktree <resolved-worktree-id>
```

Wrapper responsibilities:

- Resolve the worktree path from server-provided ids, not from caller input.
- Run Codex in the resolved project/worktree directory.
- Use a fixed review prompt template.
- Force structured JSON output.
- Emit one `RESULT ...` payload.
- Enforce timeout and cancellation.
- Normalize Codex errors into stable result fields.

The wrapper must not accept arbitrary shell args, arbitrary cwd, arbitrary model
selection, or raw permission flags from the external caller.

### Later: Codex App-Server Adapter

Move to Codex app-server when the product needs long-running threads, streamed
events, richer approvals, or conversation reuse. The public tool contract should
stay stable while the adapter changes underneath.

## Governance

Read-only tools:

```text
codex.review.diff
codex.explain.repo
codex.plan.change
```

Default policy:

- auto-allowed for actor-owned projects
- local-device required
- no file writes
- no network expansion beyond the selected Codex profile
- bounded prompt and output sizes

Patch-producing tools:

```text
codex.propose.patch
```

Default policy:

- allowed to generate patch artifacts
- must not apply files
- stores patch as an artifact for review
- may require approval when scope is large

File-writing tools:

```text
codex.apply.patch
```

Default policy:

- approval required
- project/worktree required
- diff preview required before apply
- audit must record changed files
- rollback or revert guidance required

## Structured State

Add a dedicated collection for review results:

```text
state.codexReviewFindings
```

Fields:

```text
id
reviewInvocationId
projectId
worktreeId
requestedBy
severity
file
line
message
suggestion
confidence
createdAt
```

Public state should include normalized findings only. Raw Codex transcripts and
full prompts belong in audit-retained internal state, not normal dashboard data.

## Error Codes

Initial facade errors:

```text
tool_not_found
invalid_input
unknown_field
project_required
project_not_found
worktree_required
worktree_not_found
foreign project -> 404
agent_not_available
approval_required
codex_unavailable
codex_output_invalid
```

## Development Plan

The detailed next-phase build plan lives in
[Codex Next Capabilities Plan](CODEX_NEXT_CAPABILITIES_PLAN.md). This section
keeps the stable governance sequence and acceptance shape.

### Phase 1: Contract And Descriptor

- Define `CODEX_REVIEW_TOOL_CONTRACT`.
- Add a `codex.review.diff` descriptor to the tool registry.
- Expose input/output schemas, risk metadata, approval policy, and output
  collection.
- Do not expose Codex command, argv, cwd, sandbox, or profile details.

Acceptance:

- `GET /api/tools` includes `codex.review.diff` when a governed Codex review
  agent is available.
- `GET /api/tools/codex.review.diff` returns schemas and risk metadata.
- Discovery does not leak adapter command or argv.

### Phase 2: Facade Validation

- Add `POST /api/tools/codex.review.diff/invocations`.
- Validate allowed fields and bounded instruction length.
- Resolve project through existing tenant guard.
- Validate worktree ownership.
- Create a normal invocation with `metadata.tool: codex.review.diff`.

Acceptance:

- Valid actor-owned worktree requests create queued invocations.
- Foreign project/worktree requests return 404 before invocation creation.
- Unknown fields and invalid severity return 400.

### Phase 3: Codex Review Wrapper

- Add `tools/agents/codex-review-wrapper.mjs`.
- Use a fixed diff-review prompt template.
- Run Codex in read-only review mode.
- Emit `RESULT ...` with structured JSON.
- Add smoke coverage for success, invalid args, missing Codex, timeout, and
  malformed output.

Acceptance:

- Wrapper emits structured findings on success.
- Wrapper rejects unsupported modes and extra flags before spawning Codex.
- Wrapper never accepts caller-provided cwd or shell args.

### Phase 4: Structured Result Import

- Normalize wrapper output into `state.codexReviewFindings`.
- Keep raw output out of public state.
- Link findings to `reviewInvocationId`, `projectId`, and `worktreeId`.
- Include finding ids in audit export references.

Acceptance:

- Completed review invocations import findings.
- Public state exposes normalized findings only.
- Failed or malformed Codex output does not create findings.

### Phase 5: Web And Agent Client Surface

- Add web client types for Codex review tools and findings.
- Add API client helpers through the existing tool API methods if needed.
- Extend [Tool Registry Agent Calling](TOOL_REGISTRY_AGENT_CALLING.md) with a
  Codex review example.
- Document the no-raw-CLI rule for external agents.

Acceptance:

- External agents can discover, invoke, poll, and read findings with the same
  flow used for `ccusage.report`.
- Docs include request, response, output collection, and error examples.

### Phase 6: Patch Proposal Tools

- Add `codex.plan.change`.
- Add `codex.propose.patch`.
- Store patch proposals as artifacts, not applied files.
- Require approval for high-risk scope or large patch proposals.

Acceptance:

- Other agents can ask Codex for plans and patch proposals without gaining write
  access to the worktree.

### Phase 7: Apply Patch Tool

- Add `codex.apply.patch`.
- Require approval before any file write.
- Apply only reviewed patch artifacts bound to the same project/worktree.
- Record changed files and verification output.

Acceptance:

- Approved patch applications are audited.
- Denied or missing approvals do not mutate files.

## Recommended Checks

```text
pnpm --filter @myagenttool/server test
pnpm smoke:ccusage-agent
pnpm typecheck
pnpm docs:check
git diff --check
```

Add a dedicated `pnpm smoke:codex-tool` once Phase 3 lands.
