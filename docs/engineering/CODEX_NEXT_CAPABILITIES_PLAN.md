# Codex Next Capabilities Plan

This plan turns the Codex governance roadmap into the next buildable sequence
after `codex.review.diff`. The product direction is to expose useful Codex
capabilities to confirming humans and other agents without turning Codex into
raw local CLI access.

For the reader-facing product path that checks the implemented Codex governed
tool suite from the console, see
[Codex Capability Use Case](CODEX_CAPABILITY_USE_CASE.md).

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
- `codex.plan.change`, `codex.propose.patch`, and `codex.apply.patch` are also
  implemented as governed tool facades with fixed wrappers, structured result
  imports, and public read-model evidence.
- Invocation uses
  `POST /api/tools/codex.review.diff/invocations`.
- Results are normalized into `codexReviewFindings`, the unified
  `reviewFindings` read model, `codexChangePlans`, and
  `codexPatchProposals`.
- Discovery hides adapter command, argv, cwd, and raw local execution details.
- Windows npm `.cmd` shim resolution is handled in the governed wrappers.
- The Tools page has a `Codex capability case` panel that checks the four-tool
  suite and can run the safe review and planning actions from a selected
  worktree.

Still intentionally unavailable:

- arbitrary `codex` command execution
- arbitrary cwd, model, sandbox, approval, env, or shell args
- automatic file writes
- raw transcript exposure in public state
- a fake `app_codex` Application asset; Codex remains a governed tool suite
  until there is a real Application asset lifecycle to manage

Productization gap:

- `codex.propose.patch` and `codex.apply.patch` are implemented in the API and
  smoke/integration coverage, but the Web `Codex capability case` does not yet
  expose them as a guided operator workflow.
- Apply is approval-gated and backend-safe, but a human currently has to inspect
  proposal evidence and drive approval/application through the generic
  invocation/approval surfaces rather than a purpose-built Codex flow.

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

## Workstream 5 - Web Productization

Purpose: complete the operator-facing Codex flow in the existing Tools page
without introducing `app_codex`.

The target product path is:

```text
select worktree
  -> run diff review
  -> run change plan
  -> generate immutable patch proposal
  -> inspect proposal evidence and hash
  -> request/approve apply
  -> apply approved patch
  -> inspect result and changed-file evidence
```

### 5.1 Proposal Generation UI

Add a `Generate patch proposal` action to `Codex capability case`.

Inputs:

```text
projectId       derived from selected worktree
worktreeId      selected in the case panel
goal            shared with or copied from the plan goal field
constraints     bounded text field, defaulting to "Do not apply the patch."
basePlanId      optional select from same-project/same-worktree plans
maxFiles        small numeric input, default 4
```

Behavior:

- Enable only when `codex.propose.patch`, Desktop Bridge, Codex CLI agent, and a
  worktree are ready.
- Prefer the latest same-worktree change plan as `basePlanId` when available.
- Create a normal tool invocation through
  `POST /api/tools/codex.propose.patch/invocations`.
- Show queued/running/succeeded/failed state using the same invocation status
  component as review and plan.
- After completion, surface proposal id, review state, file count, bounded diff
  preview summary, verification suggestions, and patch SHA-256.

Acceptance:

- A user can create a proposal from the Codex case panel without leaving Tools.
- The worktree remains unchanged after proposal generation.
- The panel links to the created invocation and latest proposal evidence.
- Oversized or high-risk proposal requests show the backend refusal reason
  without creating misleading local UI state.

### 5.2 Proposal Review UI

Add a compact `Patch proposal review` block beside the existing latest evidence
summary.

Fields:

```text
proposalId
reviewState
patchSha256
files
verification
diffPreview
createdAt
invocationId
```

Behavior:

- Prefer proposals for the selected worktree.
- Sort proposals newest first.
- Make `generated`, `approved`, `rejected`, and `applied` states visually
  distinct.
- Keep raw diff and transcripts out of public UI; show bounded preview only.
- Link back to the proposal invocation.

Acceptance:

- Operators can see whether a proposal is eligible for apply.
- Operators can copy the proposal id and patch hash when needed.
- The UI does not expose raw wrapper args or unrestricted patch content.

### 5.3 Apply Request And Approval UI

Add an `Apply approved patch` action that wraps the existing approval-required
API flow.

Flow:

```text
POST /api/tools/codex.apply.patch/invocations
  without approvalRequestId
  -> returns waiting_for_local_approval + approvalRequestId
operator approves through /api/approvals/:id/approve
POST /api/tools/codex.apply.patch/invocations
  with approvalRequestId
  -> queues agt_codex_apply_patch
```

Behavior:

- Enable only for same-worktree proposals with `reviewState = approved`.
- Require the proposal's current `patchSha256`.
- Use the normal approval route, not a Codex-specific shortcut.
- On approval and retry, create the governed apply invocation.
- Show blocked states clearly:
  - `proposal_not_approved`
  - `patch_hash_mismatch`
  - `approval_required`
  - `approval_not_approved`
  - `agent_not_available`
  - foreign or missing worktree/project

Acceptance:

- Denied, pending, mismatched, or foreign approvals do not queue apply.
- Successful apply links to the apply invocation.
- Applied proposal evidence updates to `reviewState = applied` with changed-file
  and apply-result metadata.
- The UI never accepts arbitrary patch text or arbitrary cwd.

### 5.4 Tests And Smoke

Web tests:

```text
pnpm --filter @myagenttool/web test:unit -- tools-view
```

Required cases:

- Proposal button builds the correct `codex.propose.patch` payload.
- Latest same-worktree plan is offered as the default base plan.
- Proposal evidence renders id, hash, state, files, and invocation link.
- Apply button first requests approval for approved proposals.
- Approved request retries with `approvalRequestId`.
- Unapproved/generated proposal disables or explains apply.
- Backend refusal messages render as next actions.

Server/smoke coverage to keep green:

```text
node tools/dev/codex-tool-smoke.mjs
node tools/dev/codex-plan-smoke.mjs
node tools/dev/codex-patch-proposal-smoke.mjs
pnpm smoke:loop-worktree-promotion-apply
pnpm --filter @myagenttool/server exec node --test test/tool-facade-units.test.mjs
pnpm --filter @myagenttool/server exec node --test test/integration/tools-http.test.mjs
```

## Implementation Order

Completed:

1. Add shared Codex structured-output helpers so review, plan, and proposal
   wrappers do not duplicate parsing and normalization.
2. Implement `codex.plan.change` contract, descriptor, wrapper, import
   collection, API smoke, and docs.
3. Add a Web Tools surface path that lets a confirming human run
   `codex.plan.change` from an existing worktree.
4. Implement `codex.propose.patch` as artifact-only, with no file mutation.
5. Implement approval issuance and bridge-local enforcement for
   `codex.apply.patch`.
6. Add apply result import, proposal state updates, and changed-file evidence.

Next:

1. Add `Generate patch proposal` to `Codex capability case`.
2. Add selected-worktree proposal review UI with proposal id, hash, state,
   files, verification, preview, and invocation links.
3. Add `Apply approved patch` UI that requests approval, approves through the
   normal approval route, retries with `approvalRequestId`, and links to the
   apply invocation.
4. Add focused Tools page tests for proposal and apply workflow.
5. Re-run the Codex smoke and integration matrix.

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
pnpm smoke:loop-worktree-promotion-apply
```

Manual verification before enabling `codex.apply.patch`:

- approved apply mutates only expected files
- denied approval leaves worktree unchanged
- bridge policy refusal leaves worktree unchanged
- public state shows result refs and not raw transcript
- review/proposal/apply records are tenant-scoped

## Phase Gate

Do not expose one-click Web apply until all of these are true:

- `codex.plan.change` and `codex.propose.patch` are green through API smoke.
- Patch proposal artifacts are immutable and tenant-scoped.
- Approval issuance and local bridge enforcement are both tested.
- Web UI can show the patch preview, approval state, and apply outcome without
  requiring raw logs.
- The residual risk is recorded in PR notes and engineering docs.
