# Claude Tool Governance Plan

This document plans how local Claude Code capabilities are exposed through the
same governed tool registry used by `ccusage.report` and `codex.review.diff`.

## Decision

Expose Claude as a governed Application with capability facades, not as raw
local CLI access.

```text
external agent
-> Application Capability Registry (`app_claude`)
-> `app.app_claude.review.diff` Tool facade
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
GET /api/capabilities/app.app_claude.review.diff
POST /api/capabilities/app.app_claude.review.diff/invocations
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

### Phase 1: Application-Backed Read-Only Review (#911)

- Define `CLAUDE_REVIEW_TOOL_CONTRACT`.
- Register the canonical binary Application as `app_claude`.
- Project `app.app_claude.review.diff` as a generic `tool_facade` capability
  backed by `claude.review.diff`.
- Add `createClaudeReviewAgentRegistration()` with deterministic id
  `agt_claude_review_diff`.
- Keep `claude.review.diff` discovery in `/api/tools` for compatibility and link
  its descriptor to the Application capability.
- Report local binary readiness for the `app.app_claude.*` capability prefix.
- Add `tools/agents/claude-review-wrapper.mjs`.
- Force wrapper execution to Claude `--permission-mode plan`.
- Import structured findings into `state.claudeReviewFindings`.
- Attach Application lineage to the invocation, latest Application result,
  audit event, and Evidence Center.
- Strip raw finding payloads from public state.
- Add registration tooling, contract tests, and a real Server/Bridge process
  smoke test.

Acceptance:

- Claude registers active as `app_claude` and exposes
  `app.app_claude.review.diff` through `/api/capabilities`.
- `GET /api/tools` links `claude.review.diff` to that Application capability
  when the Application is active.
- Discovery exposes schemas, risk metadata, approval policy, and output
  collection, but no command, argv, cwd, env, permission mode, or wrapper path.
- Valid actor-owned worktree requests create queued invocations.
- Foreign project/worktree requests fail before invocation creation.
- Desktop Bridge injects only governed `--cwd`, `--instruction`, and
  `--severity-floor` wrapper flags.
- Completed invocations import normalized findings into `claudeReviewFindings`.
- Completion records `providerType`, `applicationId`, capability, delegated Tool
  action, imported record ids, latest Application result, and Evidence Center
  evidence.

### Phase 2: Governed Read-Only Analysis (#912)

- Add narrowly scoped repository inspection and analysis capabilities.
- Reuse the Application registry, readiness, project/worktree tenancy, and
  bounded wrapper policies established in Phase 1.
- Keep every Phase 2 capability read-only and independently discoverable.

Acceptance:

- External orchestrators can consume governed Claude analysis without arbitrary
  command, cwd, environment, or permission control.

Implementation status (first slice): `claude.explain.diff` ships as the first
Phase 2 capability — it explains a worktree diff (what changed / why it matters)
instead of judging it. It reuses the Phase 1 machinery: the same fixed wrapper
(`claude-review-wrapper.mjs`) with a new read-only `--mode diff-explain`
(`--permission-mode plan`), the same project/worktree tenancy guard via
`createReviewInvocation`, and the same `tool_facade` discovery
(`app.app_claude.explain.diff`). It takes no `severityFloor` (a stray one is a
hard `unknown_field`) and, because an explanation is analysis rather than
queryable evidence, it does not write a bespoke findings collection — the
explanation rides the invocation result and the durable Application-result
lineage. The governed identity gate (`isGovernedClaudeExplainAgent`) pins the
`diff-explain` mode and the canonical wrapper path, and the Desktop Bridge injects
only the governed `--cwd`/`--instruction` flags. Remaining Phase 2 surface (broader
inspection capabilities) can follow the same pattern.

### Phase 3: Immutable Patch Proposal (#913)

- Add `claude.plan.change` or `claude.propose.patch`.
- Store plans or patch proposals as artifacts, not applied files.
- Require approval for broad scope, high risk, or write-adjacent behavior.

Acceptance:

- Other agents can ask Claude for proposed changes without gaining write access
  to a worktree.

Implementation status: `claude.propose.patch` ships as the Phase 3 capability. It
reuses the Phase 1/2 machinery — the same fixed wrapper with a new read-only
`--mode propose-patch` (`--permission-mode plan`), the same tenancy guard, and the
same `tool_facade` discovery (`app.app_claude.propose.patch`). It requires a
`task` (the change to propose) and returns an immutable artifact: a unified diff
plus a summary and the touched files (recovered from the diff headers if the model
omits them). Claude NEVER writes the worktree — the proposal is diff-as-text and
rides the durable invocation result, so generating it is read-only and needs no
approval (`requiresApproval: false`); the descriptor's `approvalPolicy.applyPatch`
stays `approval_required`. A later apply consumes the proposal by invocation id.
The Desktop Bridge injects only the governed `--cwd`/`--task`/`--instruction`
flags. Broader-scope/high-risk approval gating for proposal generation, if needed,
can layer onto the same facade. Phase 4 (below) consumes this proposal by
invocation id under an approval grant.

### Phase 4: Approval-Bound Apply (#914)

- Add an apply tool only after approval, preview, and artifact binding exist.
- Reuse reviewed patch artifacts bound to the same project/worktree.
- Record changed files, verification output, and rollback guidance.

Acceptance:

- Missing, denied, or stale approvals cannot mutate files.
- Successful apply records verification and rollback evidence bound to the
  approved proposal artifact.

Implementation status (Phase 4a — the gate, not the write): `claude.apply.patch`
ships behind a default-OFF flag (`MYAGENTTOOL_CLAUDE_APPLY_ENABLED`), so a
deployment that has not opted in has no discoverable or invokable apply path. It
binds to a Phase 3 proposal by invocation id (same actor-owned project; the apply
worktree must match the proposal's), enforces tenancy, and requires a valid,
single-use approval grant for `(action apply_patch, target proposalInvocationId)`
— it fails closed if the grant validator is unwired. On success it records an
immutable `claudeApplyAuthorizations` row (grant consumed, patch + files bound,
`status: "authorized"`, `executable: false`) and a `claude_apply_authorized`
event. **No file is written in 4a** — the acceptance "missing, denied, or stale
approvals cannot mutate files" holds because there is no mutation path and no
authorization exists without a valid grant + applicable, bound proposal.

Implementation status (Phase 4b — the write): shipped, still behind the same
default-OFF flag. When a governed apply RUNNER agent (`agt_claude_apply_patch`,
`isGovernedClaudeApplyAgent`) is registered, `authorizeApply` dispatches the
git-apply as a queued bridge invocation carrying the authorized patch; without a
runner it stays a 4a authorization. The runner is `tools/agents/claude-apply-wrapper.mjs`:
it `git apply --check`s first and refuses a patch that does not apply cleanly (no
half-applied tree), then `git apply`s, and reports the authoritative file list
(from `git apply --numstat`) plus reversible rollback guidance (`git apply
--reverse`). On completion `recordClaudeApplyResult` folds the outcome into the
authorization — `status: applied`/`failed`, applied files, verification, rollback
— so the authorization row is the one durable record of the write. The Desktop
Bridge classifies the runner as its own write-capable `claudeApply` policy kind
(`workspace_write`, no network — never read_only) and materializes the patch to a
temp file (`--patch-file`); the full patch is stripped from public state. The
wrapper is verified against a real git worktree (apply, clean-check refusal,
rollback). The full server -> bridge -> git-apply seam is exercised end to end by
`tools/dev/claude-apply-caller-smoke.mjs` (`pnpm smoke:claude-apply`): it boots a
real server + Desktop Bridge, proposes a patch (fake Claude), issues an approval
grant, applies, and asserts the file is git-applied on disk in the bound worktree,
the authorization transitions to `applied` with the file list + reversible
rollback, and the rollback genuinely reverts — proving the patch reaches the
bridge via invocation metadata (it is stripped only from public state).

Phases are stage-gated. Phase 2 implementation starts only after Phase 1
acceptance is verified; the same rule applies between later phases.

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
