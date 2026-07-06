# Codex Next Capabilities Plan

This plan turns the Codex governance roadmap into the next buildable sequence
after `codex.review.diff`. The product direction is to expose useful Codex
capabilities to confirming humans and other agents without turning Codex into
raw local CLI access.

## Decision

Build the next Codex capabilities in three controlled layers:

```text
1. read-only planning
2. patch proposal artifacts
3. approval-gated patch application
```

`codex.review.diff` remains the proven compatibility slice. Every new Codex
tool must use the Tool Registry / Tool Facade shape, normal invocation records,
tenant-scoped project and worktree checks, structured result import, audit
events, and Desktop Bridge execution.

## Current Baseline

Already available:

- `codex.review.diff` is discoverable through `/api/tools` when a governed
  Codex review agent is registered and visible to the actor.
- Invocation uses
  `POST /api/tools/codex.review.diff/invocations`.
- Results are normalized into `codexReviewFindings` and the unified
  `reviewFindings` read model.
- Discovery hides adapter command, argv, cwd, and raw local execution details.
- Windows npm `.cmd` shim resolution is handled in the Codex review wrapper.

Still intentionally unavailable:

- arbitrary `codex` command execution
- arbitrary cwd, model, sandbox, approval, env, or shell args
- automatic file writes
- raw transcript exposure in public state

## Workstream 1 - `codex.plan.change`

Purpose: let a caller ask Codex for a bounded implementation plan for a selected
project worktree without writing files.

Tool contract:

```text
tool: codex.plan.change
version: 1
riskLevel: low
riskTags: read_only, read_project, planning, local_agent
requiresLocalDevice: true
authoritativeBilling: false
outputCollection: codexChangePlans
```

Input fields:

```text
projectId
worktreeId
goal
constraints
severityFloor
```

Rules:

- `projectId` and `worktreeId` are required.
- `worktreeId` must belong to the resolved actor-visible project.
- `goal` is required and bounded.
- `constraints` is optional and bounded.
- The wrapper uses a fixed planning prompt and asks Codex for structured JSON.
- The tool may read the selected worktree but must not write files.

Output:

```json
{
  "summary": "Plan for adding governed patch proposals.",
  "steps": [
    {
      "title": "Add tool descriptor",
      "rationale": "Expose the capability without raw adapter fields.",
      "files": ["apps/server/src/services/tools.mjs"],
      "risk": "medium"
    }
  ],
  "openQuestions": [],
  "verification": ["node tools/dev/codex-plan-smoke.mjs"]
}
```

Acceptance:

- `GET /api/tools` exposes `codex.plan.change` only when a governed Codex plan
  agent is available.
- `POST /api/tools/codex.plan.change/invocations` creates a normal invocation
  for an actor-owned worktree.
- Unknown fields, foreign worktrees, missing goal, and oversized constraints
  are rejected before invocation creation.
- Completed runs import normalized records into `codexChangePlans`.
- Public state shows plan summaries, steps, open questions, and verification
  suggestions only.

## Workstream 2 - `codex.propose.patch`

Purpose: let Codex produce a reviewable patch artifact without applying it.

Tool contract:

```text
tool: codex.propose.patch
version: 1
riskLevel: medium
riskTags: read_project, patch_artifact, code_generation, local_agent
requiresLocalDevice: true
authoritativeBilling: false
outputCollection: codexPatchProposals
```

Input fields:

```text
projectId
worktreeId
goal
constraints
basePlanId
maxFiles
```

Rules:

- The tool may generate patch text as an artifact.
- The tool must not mutate the selected worktree.
- `basePlanId` is optional but, when present, must belong to the same project
  and worktree.
- Large scope, high-risk file areas, or high file count should return
  `approval_required` before running.
- The patch artifact is immutable once recorded.

Output:

```json
{
  "summary": "Patch proposal generated for review.",
  "proposalId": "cpp_123",
  "files": [
    {
      "path": "apps/server/src/services/tools.mjs",
      "changeType": "modify",
      "risk": "medium"
    }
  ],
  "diffPreview": "...",
  "verification": ["pnpm --filter @myagenttool/server test"]
}
```

Acceptance:

- Discovery and invocation follow the tool facade, not raw Codex CLI access.
- Patch proposals are stored as artifacts and are linked to invocation,
  project, worktree, requestedBy, and optional base plan.
- A completed proposal does not change the working tree.
- Public state exposes metadata and a bounded diff preview, not raw transcript.
- Approval-required decisions are auditable and do not create partial artifacts.

## Workstream 3 - `codex.apply.patch`

Purpose: apply a previously reviewed Codex patch proposal under explicit
approval and audit.

Tool contract:

```text
tool: codex.apply.patch
version: 1
riskLevel: high
riskTags: write_project, apply_patch, code_change, local_agent
requiresLocalDevice: true
authoritativeBilling: false
outputCollection: codexPatchApplications
```

Input fields:

```text
projectId
worktreeId
proposalId
approvalToken
verificationCommandIds
```

Rules:

- Approval is always required.
- `proposalId` must point to a reviewed patch proposal for the same project and
  worktree.
- The bridge local execution gate must verify command id, cwd, args, file
  policy, and approval evidence before any mutation.
- Apply only the stored artifact, not newly generated Codex output.
- Record changed files, apply result, verification result refs, and rollback
  guidance.

Acceptance:

- Missing, denied, expired, or foreign approval does not mutate files.
- Applying a valid proposal records changed files and audit events.
- Verification commands are allowlisted and recorded as separate invocation or
  evidence refs.
- Re-applying the same proposal is idempotently blocked unless an explicit
  rerun policy is added.

## Workstream 4 - Managed Codex Alignment

Purpose: keep tool capabilities aligned with the managed Codex evidence model.

Tasks:

- Link plan, proposal, and apply invocations to managed Codex session records
  when the platform launched or resumed the session.
- Show effective sandbox, approval, network, hook, and MCP policy facts when
  known.
- Keep imported-after-the-fact evidence separate from managed session proof.
- Surface pending approval broker requests outside raw logs.
- Preserve raw transcripts only in internal evidence/audit storage with
  retention and redaction rules.

Acceptance:

- Web surfaces can distinguish managed proof from imported evidence.
- Public state never needs private Codex session files to explain a tool result.
- Approval requests include session, worktree, tool, risk, timeout, and
  approve/deny outcome.

## Implementation Order

1. Add shared Codex structured-output helpers so review, plan, and proposal
   wrappers do not duplicate parsing and normalization.
2. Implement `codex.plan.change` contract, descriptor, wrapper, import
   collection, API smoke, and docs.
3. Add a Web Review/Tools surface path that lets a confirming human run
   `codex.plan.change` from an existing worktree.
4. Implement `codex.propose.patch` as artifact-only, with no file mutation.
5. Add patch proposal review UI and API reads.
6. Implement approval issuance and bridge-local enforcement for
   `codex.apply.patch`.
7. Add apply result import, verification refs, and rollback guidance.

## Verification Matrix

Minimum automated checks per slice:

```text
pnpm --filter @myagenttool/server exec node --test test/review-wrapper.test.mjs
pnpm --filter @myagenttool/server exec node --test test/integration/tools-http.test.mjs
pnpm --filter @myagenttool/server exec node --test test/integration/tenancy-http.test.mjs
node tools/dev/codex-tool-smoke.mjs
git diff --check
```

Additional smoke targets to add:

```text
node tools/dev/codex-plan-smoke.mjs
node tools/dev/codex-patch-proposal-smoke.mjs
node tools/dev/codex-apply-patch-smoke.mjs
```

Manual verification before enabling `codex.apply.patch`:

- approved apply mutates only expected files
- denied approval leaves worktree unchanged
- bridge policy refusal leaves worktree unchanged
- public state shows result refs and not raw transcript
- review/proposal/apply records are tenant-scoped

## Phase Gate

Do not implement `codex.apply.patch` until all of these are true:

- `codex.plan.change` and `codex.propose.patch` are green through API smoke.
- Patch proposal artifacts are immutable and tenant-scoped.
- Approval issuance and local bridge enforcement are both tested.
- Web UI can show the patch preview, approval state, and apply outcome without
  requiring raw logs.
- The residual risk is recorded in PR notes and engineering docs.
