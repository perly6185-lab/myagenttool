# Codex Capability Use Case

Status: implemented

Audience: product readers, operators, and engineers who need to understand how
myagenttool exposes Codex safely without turning it into raw local CLI access.

## Reader Summary

Codex is the reference governed tool-suite use case. It is intentionally not
modeled as an npm Application like `ccusage`.

The important idea is:

```text
Codex CLI -> fixed governed wrappers -> stable tool facades -> imported evidence
```

The supported public tools are:

```text
codex.review.diff
codex.plan.change
codex.propose.patch
codex.apply.patch
```

These tools prove that the platform can expose a multi-stage AI engineering
workflow while still hiding raw adapter command, argv, cwd, sandbox, approval,
model, and environment details from callers.

## 5 Minute Product Path

1. Start the local stack:

   ```bash
   pnpm dev
   ```

2. Open the Tools page:

   ```text
   http://127.0.0.1:5000/?section=tools
   ```

   If the top bar shows `Codex Ops N`, click it to jump directly to:

   ```text
   ?section=tools&tool=codex&focus=ops
   ```

3. Find `Codex capability case`.

4. Confirm the panel shows the governed Codex suite:

   ```text
   codex.review.diff
   codex.plan.change
   codex.propose.patch
   codex.apply.patch
   ```

5. Check setup readiness in the panel:

   ```text
   Desktop Bridge
   Codex CLI agent
   Governed facades
   Worktree
   ```

6. Check `Codex lifecycle` and `Operations queue`:

   ```text
   Review evidence
   Change plan
   Patch proposal
   Patch apply
   ```

   The queue highlights proposal reviews, apply approvals, blocked runs, and
   recent applied patches for the selected worktree.

7. Select a worktree.

8. Click `Run diff review`.

9. Click `Run change plan`.

10. Click `Generate patch proposal`.

11. Inspect the latest patch proposal, then click `Approve proposal` or
    `Reject proposal`.

12. After approval, click `Apply approved patch`. If local approval is required,
    click `Approve and retry apply`.

Expected result: the console creates normal invocations, shows the created
invocation ids, reports queued/running/succeeded/failed status in the case
panel, and imports completed evidence into:

```text
codexReviewFindings
codexChangePlans
codexPatchProposals
```

The current Web case now covers the operable Codex lifecycle: read-only review,
read-only planning, immutable patch proposal, proposal review, local apply
approval, patch application, and applied evidence import.

## Why This Is Not `app_codex`

`ccusage` is a package-shaped Application: one npm package projects report
commands as Application wrapper capabilities.

Codex is different. In this repo it is already a governed agent/tool suite with
separate wrappers, contracts, output collections, approval rules, and result
imports. A fake `app_codex` would blur that boundary before there is a real
Application asset to manage.

The current product shape is therefore:

```text
Tools -> Codex capability case -> governed invocation -> evidence
```

This keeps the Application model honest while still giving readers and operators
a directly operable Codex capability check.

## System Capabilities Proven By Codex

| Capability | What Codex proves |
| --- | --- |
| Governed discovery | `/api/tools` exposes stable Codex contracts without local wrapper internals. |
| Read-only execution | Review and plan tools read selected worktrees without mutating files. |
| Artifact creation | Patch proposal creates an immutable reviewable patch artifact. |
| Approval-gated writes | Apply patch requires proposal scope, hash, review state, and approval evidence. |
| Imported evidence | Results land in public read models such as `reviewFindings`, `codexChangePlans`, and `codexPatchProposals`. |
| Local runtime boundary | Desktop Bridge runs fixed wrappers; callers cannot choose raw Codex CLI flags. |

## API Path

Discover tools:

```bash
curl -s "$BASE_URL/api/tools"
```

Run a governed review:

```bash
curl -s -X POST "$BASE_URL/api/tools/codex.review.diff/invocations" \
  -H "Content-Type: application/json" \
  --data '{
    "projectId": "prj_local",
    "worktreeId": "wt_main",
    "severityFloor": "medium",
    "instruction": "Focus on correctness, regressions, and missing tests."
  }'
```

Run a governed plan:

```bash
curl -s -X POST "$BASE_URL/api/tools/codex.plan.change/invocations" \
  -H "Content-Type: application/json" \
  --data '{
    "projectId": "prj_local",
    "worktreeId": "wt_main",
    "goal": "Plan the next safe productization step for this worktree.",
    "constraints": "Do not write files. Return a bounded implementation plan and verification steps.",
    "severityFloor": "medium"
}'
```

Generate a patch proposal:

```bash
curl -s -X POST "$BASE_URL/api/tools/codex.propose.patch/invocations" \
  -H "Content-Type: application/json" \
  --data '{
    "projectId": "prj_local",
    "worktreeId": "wt_main",
    "goal": "Generate a bounded reviewable patch.",
    "constraints": "Do not apply the patch.",
    "basePlanId": "cpl_demo_123",
    "maxFiles": 4
  }'
```

Review and apply an approved proposal:

```bash
curl -s -X POST "$BASE_URL/api/tools/codex.propose.patch/proposals/cpp_demo_123/review" \
  -H "Content-Type: application/json" \
  --data '{"action":"approve"}'

curl -s -X POST "$BASE_URL/api/tools/codex.apply.patch/invocations" \
  -H "Content-Type: application/json" \
  --data '{
    "projectId": "prj_local",
    "worktreeId": "wt_main",
    "proposalId": "cpp_demo_123",
    "patchSha256": "<proposal patchSha256>",
    "approvalRequestId": "<approved local approval id>"
  }'
```

Operational smoke coverage:

```bash
pnpm smoke:codex-patch-proposal
pnpm smoke:codex-apply-patch
```

## Common Failure Modes

| Message or state | Meaning | Next action |
| --- | --- | --- |
| `agent_not_available` | The governed Codex backing agent is not registered or visible. | Register the governed Codex agents and refresh Tools. |
| Desktop Bridge offline | The server can discover tools, but local execution cannot start. | Start the full local stack with `pnpm dev`. |
| `0/4 registered` | A normal Codex CLI agent exists, but the governed `codex.*` tool agents are not registered. | Register the governed Codex review/plan/proposal/apply agents. |
| No worktree in state | Codex tools are discoverable, but review/plan inputs cannot be formed. | Create or select a project worktree before invoking. |
| `worktree_not_found` | The selected worktree is not visible in the project scope. | Select a valid project worktree. |
| `approval_required` | A write-capable or higher-risk Codex action needs explicit approval. | Approve the request, then retry with the approval id. |

## Product Boundary

Codex capability case is a productized inspection path, not permission to run
arbitrary Codex commands. The platform continues to reject raw cwd, shell,
sandbox, model, approval, and environment overrides unless a future governed
contract explicitly supports them.

Codex is also not registered from the Applications page. That is intentional:
until there is a real Codex Application asset lifecycle to manage, the product
shape remains a governed Tools capability suite rather than a synthetic
`app_codex`.
