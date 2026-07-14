# Codex Exec Capability — Design Draft (`codex.exec`)

Status: **DRAFT** (not implemented). Author-facing design for extending the
governed Codex integration from read-only review to a **write-capable** capability
that internal application agents can call over the open capability API.

Companion proof: PR #915 (`codex-capability-caller-smoke`) shows an internal
caller already consumes the read-only `codex.review.diff` capability end to end
with zero product changes. This draft is the "B" follow-up: let an internal agent
ask Codex to **make code changes** — still governed, auditable, tenant-scoped, and
never auto-merged.

## 1. Goal & non-goals

**Goal.** A `codex.exec` capability, discoverable at `GET /api/capabilities` and
invokable at `POST /api/capabilities/codex.exec/invocations`, that runs Codex in a
worktree with edit permission, captures the resulting changeset as authoritative
evidence, and hands the caller a reviewable diff — without ever touching the base
checkout or main.

**Non-goals.**
- No change to Codex CLI ownership of native auth / sandbox / approval. The
  platform wraps and records; it never re-implements Codex's permission model.
- No auto-promotion. `codex.exec` produces a changeset in a worktree; turning it
  into a PR/merge reuses the existing human-gated promote path.
- No M3 billing automation, marketplace, or credential layer.

## 2. Reuse, don't rebuild — what already exists

| Building block | Where | Reuse for `codex.exec` |
| --- | --- | --- |
| Capability layer (discover + invoke + tenancy + refusal) | [capabilities.mjs](../../apps/server/src/services/capabilities.mjs) | Same path; `codex.exec` is just another governed tool in the catalog. |
| Tool contract + argv path-lock | [codex-agent.mjs](../../apps/server/src/services/codex-agent.mjs) (`isExactGovernedReviewWrapperArgs`) | New `CODEX_EXEC_TOOL_CONTRACT` + `isGovernedCodexExecAgent` with the same exact-path-segment lock. |
| Tool dispatch (`createReviewInvocation`) | [tools.mjs](../../apps/server/src/services/tools.mjs) | New `createExecInvocation` mirroring it. |
| Approval broker (hook → PermissionRequest → manual/auto) | [codex.mjs](../../apps/server/src/services/codex.mjs) (`createCodexApprovalBrokerRequest`, `codexApprovalRequiresManualReview`) | Write runs route through it; sensitive-pattern list already forces manual review. |
| File-change evidence | [codex.mjs](../../apps/server/src/services/codex.mjs) (`createCodexEvidenceRecord`, `fileChange*`) | Populate `fileChangeSummary/Path/Action/diffPreview/changeRisk` from the real diff. |
| Change-review gate | [codex.mjs](../../apps/server/src/services/codex.mjs) (`createCodexChangeReview`) | Gate promotion on approved review. |
| Worktree isolation + diff + promote | Worktree Line A / compare-run promote | Changeset lands in a worktree; promotion reuses `promoteCompareRun` / `createWorktreePr`. |
| Reserved invocation metadata | [invocations.mjs](../../apps/server/src/routes/invocations.mjs) (`RESERVED_INVOCATION_METADATA_KEYS`) | Client can never supply the wrapper argv. |

The only genuinely new code is: the contract, the exec wrapper, `createExecInvocation`,
and the import of the authoritative changeset. Everything governance-shaped exists.

## 3. The contract — `CODEX_EXEC_TOOL_CONTRACT`

```jsonc
{
  "name": "codex.exec",
  "version": "1",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["worktreeId", "task"],
    "properties": {
      "projectId":    { "type": "string" },
      "worktreeId":   { "type": "string" },        // REQUIRED — writes only in a worktree
      "task":         { "type": "string", "maxLength": 4000 },  // the change instruction
      "approvalMode": { "enum": ["ask", "auto", "full"] },      // default "ask"
      "maxRuntimeSeconds": { "type": "number" }     // bounded; server-clamped
    }
  },
  "outputSchema": {
    "structuredResult": true,
    "imports": { "collection": "codexExecChanges", "authoritative": false },
    "change": {
      "file":        { "type": "string" },
      "action":      { "enum": ["created", "modified", "deleted"] },
      "diffPreview": { "type": "string" },          // bounded, summary-only
      "changeRisk":  { "enum": ["low", "medium", "high", "unknown"] },
      "summary":     { "type": "string" }
    }
  },
  "errorCodes": [
    "invalid_input", "unknown_field", "project_required", "worktree_required",
    "worktree_not_found", "task_required", "task_too_long",
    "current_repo_not_allowed", "approval_required", "approval_denied",
    "agent_not_available", "codex_failed"
  ]
}
```

Note the deliberate asymmetry vs `codex.review.diff`: `task` is required (there is
no default review prompt), `worktreeId` is required and `current_repo` is refused
(§7), and the output is an **applied changeset in the worktree**, not findings.

## 4. Risk & governance

- `riskLevel: "high"`; `riskTags: ["write_worktree", "code_change", "local_agent"]`
  (contrast the review agent's `read_only`/`low`).
- **Every** `codex.exec` run creates file-change evidence and passes through the
  approval broker. `codexApprovalRequiresManualReview` already forces manual review
  when the task/tool/summary mentions secrets, `rm -rf`, credentials, etc.
- `approvalMode` (default `ask`): `ask` pauses at the broker on every permission
  request; `auto` auto-approves low-risk requests but still forces manual on the
  sensitive-pattern list; `full` auto-approves non-blocked requests. **Decision
  (§11.1): `ask` + `auto` are in scope; `full` is deferred to Phase 4.** Phase 1
  ships `ask` + `auto`, so unattended internal-agent writes are allowed for
  low-risk changes while secrets / `rm -rf` / credential-shaped requests still fall
  to manual review via `codexApprovalRequiresManualReview`.
- Promotion of the produced changeset is gated on `createCodexChangeReview`
  returning `approved` before any promote/PR step runs.

## 5. Execution path

```
internal caller agent
  └─ POST /api/capabilities/codex.exec/invocations   { worktreeId, task, approvalMode }
        └─ createCapabilityInvocation()            capabilities.mjs
              └─ getTool("codex.exec") → createToolInvocation()   tools.mjs
                    └─ createExecInvocation()  (NEW, mirrors createReviewInvocation)
                          · validate input (worktree required, task required, no current_repo)
                          · resolveToolProjectId() tenancy gate
                          · require a MATERIALIZED worktree (not pending)
                          · select governed exec agent (isGovernedCodexExecAgent)
                          · createInvocation(metadata: { tool, worktreeId, task, approvalMode })
                          · startInvocationIfAllowed()
        ← 202 { capability:"codex.exec", invocationId, outputCollection:"codexExecChanges" }

Desktop Bridge
  └─ runs codex-exec-wrapper.mjs --mode edit --cwd <worktree>
        · codex exec (edit-enabled) in the worktree
        · PermissionRequest hooks → approval broker (recordCodexHookEvent)
        · after the run: git status/diff in the worktree → AUTHORITATIVE changeset
        · RESULT { summary, touchedUserFiles:true, changes:[...], cost:{...} }
  → completion imports changes into codexExecChanges + file-change evidence
```

## 6. The wrapper — `tools/agents/codex-exec-wrapper.mjs`

Mirrors `codex-review-wrapper.mjs`, with three write-mode differences:

1. **Edit-enabled invocation.** Runs Codex with its native edit/sandbox controls
   (the platform does not override them). `--cwd` must be an absolute, existing
   worktree; refuse otherwise — identical guard to `requireReviewCwd`.
2. **Authoritative changeset from git, not the model.** After Codex exits, the
   wrapper runs `git -C <cwd> status --porcelain` + `git -C <cwd> diff` to derive
   the real per-file changes and bounded `diffPreview`. The model's self-report is
   never trusted for what was written. `touchedUserFiles` reflects the git result.
3. **Fixed argv, path-locked.** `isGovernedCodexExecAgent` requires the exact
   `tools/agents/codex-exec-wrapper.mjs` trailing segment + `--mode edit`, so a
   forged agent registration can't repoint the "governed" facade at an arbitrary
   script (the exact attack `isExactGovernedReviewWrapperArgs` was hardened against).

## 7. Security invariants (must all hold)

1. **Worktree-only writes.** `workspacePolicy` ∈ {`new_worktree`, `existing_worktree`};
   `current_repo` is refused (`current_repo_not_allowed`). The base checkout and main
   stay clean; every change is isolated, reviewable, and discardable.
2. **Argv path-lock.** As above — no arbitrary local execution via a forged registration.
3. **Reserved metadata.** `applicationWrapper` and friends stay server-set
   ([invocations.mjs](../../apps/server/src/routes/invocations.mjs)); the client
   supplies `task`/`approvalMode` only, never the command.
4. **No auto-promote.** `codex.exec` yields a changeset; promotion to PR/main reuses
   the existing human-gated `promoteCompareRun` / `createWorktreePr` path.
5. **Cost attribution.** `economicModel: external_billed`; `requestedBy`/`costOwner`
   attribute usage to the real internal caller, not `usr_local`.
6. **Tenancy.** Capability visible only to the owning team; ungranted → `capability_not_granted`
   refusal → opaque `capability_not_found` (no existence leak).

## 8. Result consumption (async)

The caller gets `202 + invocationId + outputCollection: "codexExecChanges"`, then:
polls the invocation to `succeeded` → reads `codexExecChanges` for the per-file
changeset → reads the full diff via the existing worktree diff endpoint → decides to
request a change review and/or promote. Same async shape the read-only demo already
exercises; only the output collection and the follow-up (review/promote) differ.

## 9. Phased rollout

- **Phase 1 — contract + read-back, default OFF (decision §11.2).** Register the
  exec agent default-disabled behind a feature flag (pattern: tier-2 sandbox
  shipped default-OFF). `approvalMode` supports `ask` + `auto` (not `full`; §11.1).
  Wrapper computes the authoritative diff; a fixture drives CI without a live
  model. Ship a `codex-exec-caller-smoke` analogous to the read-only one.
- **Phase 2 — governance wiring.** ✅ Change-review gate (2b) + Evidence Center lens
  (2a) shipped. Approval broker: the server contract is **already in place** — an
  exec invocation carries its `approvalMode` in `options`, and `recordCodexHookEvent`
  → `createCodexApprovalBrokerRequest` governs a `PermissionRequest` for ANY
  invocation (no managed session required), so exec runs auto-approve low-risk
  requests and force manual review on the sensitive-pattern list. Locked by
  `codex-exec-caller-smoke`. **Residual:** the Desktop Bridge does not yet forward
  real Codex `PermissionRequest` hooks (with the exec `invocationId`) to
  `/api/codex/hooks` — that integration needs a live Codex to validate and is the
  one remaining piece of end-to-end unattended approval.
- **Phase 3 — promote path.** ✅ Changeset → worktree-PR reuse, gated on
  `execRunPromotionGate` (every change approved). Human-gated.
- **Phase 4 — policy.** `approvalMode` authority (who may `auto`/`full`), budget pool.

## 10. pr-governance note

`codex.exec` touches risk surfaces (`apps/server/src/services/*`, `routes/*`), so
**every implementing PR must carry the matching risk-evidence sections** or
pr-governance blocks it. Run `pnpm pr:evidence` before pushing each slice.

## 11. Decisions

1. **`approvalMode` authority — RESOLVED (2026-07-14).** `ask` + `auto` are in
   scope; `full` deferred to Phase 4. Unattended internal-agent writes are allowed
   for low-risk changes; the sensitive-pattern list (`codexApprovalRequiresManualReview`)
   forces manual review on secrets / `rm -rf` / credentials regardless of mode.
2. **Default enablement — RESOLVED (2026-07-14).** Ship Phase 1 **default-OFF
   behind a feature flag**, matching the tier-2 sandbox rollout. Enablement is an
   explicit opt-in, not on-by-default even for owner-team projects.

Still open:

3. **Worktree lifecycle** — fresh worktree per `codex.exec` call, or reuse a
   caller-supplied existing worktree (compare-run style)? Affects cleanup/disk.
4. **Changeset authority** — confirm git-derived diff is the source of truth over
   the model's self-report (this draft assumes yes).
