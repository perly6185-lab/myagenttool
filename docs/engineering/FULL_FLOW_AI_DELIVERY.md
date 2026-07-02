# Full-flow AI Delivery

This document defines what "full-flow AI development" means for MyAgentTool.

The target is not only AI-assisted coding. The target is an AI product delivery
operating system:

```text
Idea -> PM Breakdown -> Issue -> Branch -> Code -> Test -> PR
-> Automated Review -> Human Review / Merge -> Release -> Feedback Loop
```

## Product Standard

Full-flow AI delivery is complete only when a non-specialist can express an
idea, the system can turn it into controlled engineering work, and every step
leaves enough evidence for a human to trust or stop it.

The system should optimize for:

- Clear user intent.
- Small milestone-aligned slices.
- Traceable decisions.
- Reproducible checks.
- Safe local execution boundaries.
- Visible cost, data, security, and release impact.
- Human approval at irreversible gates.

## Stage Contract

| Stage | Input | AI output | Required evidence | Human gate |
| --- | --- | --- | --- | --- |
| Idea | Plain-language user request | Restated outcome, affected users, risk flags | Conversation or source doc note | Scope-changing ideas |
| PM Breakdown | Idea plus product docs | Problem, user story, non-goals, acceptance criteria | Spec section or design doc update | High-impact product choices |
| Issue | Approved slice | GitHub issue with labels, milestone, Project fields | Issue body, labels, Project item | High-risk or roadmap-changing issue |
| Branch | Issue | Named branch linked to issue | Git branch and PR head | None for normal M0 work |
| Code | Issue, docs, plan | Scoped code/docs changes | Commit diff | Security/billing/local execution changes |
| Test | Changed behavior | Automated and manual verification | Test output, smoke logs, screenshots when UI | Missing or flaky required tests |
| PR | Branch and evidence | Reviewable PR with issue links | PR body, checks, linked issues | Before merge |
| Automated Review | PR | Governance, CI, docs, smoke, issue hygiene, visual QA where needed | Check runs and logs | Failed or bypassed checks |
| Human Review / Merge | Passing PR | Approval or requested changes | Review record and merge commit | Always for merge |
| Release | Merged changes | Release notes and rollback notes | Release draft, version, changelog | Always for production/desktop/billing |
| Feedback Loop | User/demo/ops feedback | Bug, risk, ADR, or roadmap update | Issue or doc update | Product direction changes |

## Current Capability

Already implemented:

- GitHub Issues, labels, milestones, Project fields, and issue templates.
- M0 vision and engineering source documents.
- Branch-based development and PR template.
- Local pnpm workspace with server, web, desktop bridge, protocol packages, and
  demo agent.
- Local M0 invocation smoke test.
- CI workflow for install, repo/docs checks, typecheck, and tests.
- Governance workflow for PR evidence and issue hygiene.
- `tools/github` governance CLI for local checks, issue hygiene, PR checks,
  branch protection probing, and Project field drift sync.
- `tools/ai` helper CLI for deterministic intake brief and work manifest
  drafts, branch plans, and feedback conversion drafts.
- Model-driven `tools/ai` commands for PM briefs, code plans, PR review drafts,
  and issue-to-branch work runner evidence through explicit providers.
- PM brief to issue tree dry-run/apply command with governance labels,
  milestone, acceptance criteria, and Project field metadata.
- Trusted coding adapter contract slots for Codex, Claude, Qwen Code,
  OpenClaw-like, QClaw-like, generic command, and deterministic mock adapters.
- Scope drift and Testing skills planning commands for AI work evidence.
- A first trusted coding wrapper contract path at
  `tools/ai/src/coding-wrapper.mjs`.
- `tools/release` helper CLI for release process checks and release note drafts.
- `tools/deploy` helper CLI for deployment checks, plans, preflight, and dry-run
  or adapter-backed publish.
- Release retrospective command and feedback-to-issue-tree handoff for
  post-release learning.
- GitHub AI Review, Release, and Deploy workflows.
- Design contract and visual QA guidance for product-facing UI work.

## Gaps To True Product Autodelivery

### 1. Idea Intake And PM Breakdown

Implemented first slice:

- `pnpm ai:pm -- --idea "..." --provider openai|command|mock` returns a
  structured model PM brief.
- The PM brief classifies scope, risk, platform, agent target, labels, and
  source docs.
- The prompt requires a non-professional user path.
- `pnpm ai:issue-tree -- --idea "..." --provider openai|command|mock` turns a
  PM brief into governed issue specs and can apply them with explicit
  `--apply`. High-risk, security/data/privacy, billing/cost, local execution,
  roadmap-changing, or release/deploy issue creation also requires
  `--human-approved "reason"` or `MYAGENTTOOL_HUMAN_APPROVED`.

Needed:

- Rules for when AI may create issues directly and when it must ask approval.

### 2. Issue Creation And Project Sync

Partially implemented:

- Issue hygiene checks.
- Project field dry-run and explicit apply.
- Issue tree creation includes `## Project Fields` metadata for Project sync.

Missing:

- Parent/child issue linkage or a consistent fallback convention.
- Automatic status transitions from PR/check events.

Needed:

- Project field apply in CI only when explicitly authorized.
- Backlog health report.

### 3. Branch And Implementation Orchestration

Implemented first slice:

- `pnpm ai:code-plan -- --issue 123 --provider openai|command|mock` generates a
  model implementation plan.
- `pnpm ai:work-runner -- --issue 123 --provider openai|command|mock` connects
  issue, branch, plan, and run evidence.
- Work runner apply mode is explicit and writes evidence under
  `.myagenttool/runs`.
- Work runner apply mode refuses dirty worktrees, writes a coding adapter
  contract, runs a registry-selected adapter, captures adapter evidence, and
  runs repository verification unless skipped explicitly.
- `pnpm ai:scope-check -- --plan-file .myagenttool/runs/<run>/code-plan.json --base main`
  reports undeclared changed files and requires visible justification for high
  drift.
- `pnpm ai:testing-plan -- --change web --risk high` maps change type and risk
  to required test evidence.
- Work runner run evidence includes a Testing skills plan, and apply mode adds
  scope drift evidence for PR review.
- `tools/ai/src/coding-wrapper.mjs` validates the production wrapper contract
  path without executing model-proposed shell commands.

Missing:

- Agent-specific production wrappers for Codex, Claude, Qwen Code,
  OpenClaw/QClaw-style CLIs beyond the shared contract wrapper.
- Technical enforcement that blocks every broad change in CI before human
  review.

Needed:

- Work manifest, scope drift, Testing skills, adapter contract, and
  verification evidence should remain linked in PR bodies.
- Promote high-risk scope drift and missing Testing skills evidence from local
  evidence to governance checks where appropriate.

### 4. Automated Review

Partially implemented:

- CI.
- Governance checks.
- Docs checks.
- Smoke test.

Implemented first slice:

- `pnpm ai:review -- --pr 123 --provider openai|command|mock` generates a
  findings-first PR review draft.
- The AI Review workflow can comment on PRs.
- PR governance now warns when changed files imply missing visual QA,
  desktop/local execution, protocol, adapter, security/data/billing, or
  release/deploy evidence.

Missing:

- Visual QA automation for web UI screenshots.
- Cross-platform desktop runner checks on Windows, macOS, and Linux.
- Technical enforcement that fails PRs for every missing risk-specific evidence
  route.

Needed:

- Playwright screenshot workflow for UI changes.
- Cross-platform process execution/cancellation tests.

### 5. Human Review And Merge

Partially implemented:

- PR template and review policy.
- Branch protection risk tracked.

Missing:

- Enforced required checks on `main`.
- CODEOWNERS or required reviewer rules.
- Clear merge queue or squash/rebase policy.

Blocked:

- Current private repository entitlement may not allow branch protection. Track
  through issue #32 until resolved.

### 6. Release

Implemented first slice:

- Release process document.
- `pnpm release:draft` release note generator.
- `pnpm deploy:plan`, `pnpm deploy:preflight`, and `pnpm deploy:publish`.
- Manual GitHub Release and Deploy workflows.
- M0 `docs/preview` built-in deploy adapter that creates preview artifact and
  deployment evidence.
- GitHub `preview`, `staging`, and `production` environments exist.

Missing:

- Versioning policy applied in package metadata.
- Required reviewer/wait-timer enforcement for staging and production,
  currently blocked by repository entitlement.
- Real cloud/server/desktop deploy adapters beyond the M0 docs preview target.
- Rollback evidence from hosted or distributed deployments.

Needed:

- Environment-specific approvals and secrets.

### 7. Feedback Loop

Implemented first slice:

- Feedback intake template.
- `pnpm ai:feedback -- --feedback "..." --target bug|risk|roadmap|documentation`
  drafts feedback triage.
- `pnpm ai:feedback -- --feedback "..." --target bug --issue-tree` produces a
  PM brief JSON that can feed `pnpm ai:issue-tree -- --brief-file ...`.
- `pnpm release:retrospective -- --pr 123` creates a release/demo review
  checklist with feedback, rollback, follow-up issue prompts, and any supplied
  PR/deploy/feedback evidence.
- Release notes can reference retrospective, PR, deploy, and feedback evidence
  through `--evidence-file` or `--evidence-dir`, and explicitly call out missing
  evidence.

Needed:

- Real support/telemetry ingestion remains out of scope before product launch.
- Feedback issue creation still requires explicit `ai:issue-tree --apply`.

## Maturity Levels

| Level | Meaning | Current status |
| --- | --- | --- |
| L0 | Docs only | Completed earlier |
| L1 | Issues and Project exist | **Gate met** — measured 2026-07-02: label coverage 100%, milestone 100%, 0 stale (`pnpm github:backlog`, 30 open issues) |
| L2 | Branch, PR, CI, and smoke tests work | Measured 2026-07-02: median PR lead time 0.02h, ~19 merges/week (`pnpm github:dora`). **CI activated 2026-07-02** (runner variable on, CI workflow re-enabled; first live run green: verify 1m12s + eval-gates 19s + smoke 44s ≈ 2.2 min/PR, well inside the 2,000 free private-repo minutes). CI-green gate first reading: **40.2% (33/82; 47 merged with no checks)** vs ≥95% — the honest pre-activation gap; every merge from #237 on carries live CI, so the rate climbs as the window rolls. Red-merge *enforcement* (branch protection) is plan-gated on private Free — needs Pro, a public repo, or `gh pr checks --watch` merge discipline |
| L3 | Governance checks and Project drift checks work | **Measured 2026-07-02 (`pnpm github:governance`, 30-day window): risk-evidence coverage 29.1% (23/79 merged PRs) vs 100% target; 56 silent-bypass commits vs 0 target** — the gate exists (check-pr) but was not enforced on merges; scope-drift FP rate not instrumented. The previous "mostly complete" tick was qualitative and is retracted |
| L4 | AI can create PM brief, issue, branch, code, PR, and review evidence | **Measured 2026-07-02: 87.5% (7/8) held-out pass rate** with the Claude Code CLI (8-case snapshot, file-level oracle; measures the branch/code/PR slice — PM-brief and issue-creation apply mode are NOT exercised by this gate) |
| L5 | Human-approved merge and release can be generated with rollback notes | Partially complete |
| L6 | Feedback automatically becomes tracked bugs/risks/roadmap updates | Not complete |

Statuses above cite measured numbers where instrumentation exists; the gates
and thresholds live in [MATURITY_CALIBRATION.md](MATURITY_CALIBRATION.md), and
the L4 harness is documented in [L4_HELDOUT_EVAL.md](L4_HELDOUT_EVAL.md).

Current target:

```text
Hold the L4 held-out pass rate at or above the gate (--min-pass-rate 0.6;
baseline 87.5% on the 8-case snapshot) while the set grows and behavior probes
tighten; keep the L1 coverage gate at 100% (met 2026-07-02); and extend
measurement to the L4 sub-capabilities the held-out gate does not exercise
(PM brief quality, issue-creation apply mode, review-evidence generation).
```

M0 closeout is recorded in [AI_DELIVERY_CLOSEOUT.md](AI_DELIVERY_CLOSEOUT.md).
That document distinguishes accepted M0 operating scaffolding from M1/M2
follow-up candidates.

## Acceptance For "Automatic Product Delivery"

Do not claim true automatic product delivery until:

- A fresh idea can produce a PM brief and issue tree.
- AI can create a branch from an issue and produce a scoped PR.
- Automated checks include CI, governance, docs, smoke, and relevant UI/security
  checks.
- A human can approve merge with all required evidence in one place.
- Release notes and rollback notes can be generated from merged work.
- Feedback can be captured and converted into tracked work.
- All high-risk gates are either technically enforced or explicitly documented
  as manual gates.

## Near-term Build Order

1. Issue intake and PM brief generator.
2. Issue-to-branch and work manifest command.
3. PR self-review command.
4. Release note generator.
5. Feedback intake template and converter.
6. Branch protection or repository ruleset enforcement when available.

## Current Commands

```text
pnpm ai:intake -- --idea "..."
pnpm ai:pm -- --idea "..." --provider openai|command|mock
pnpm ai:issue-tree -- --idea "..." --provider openai|command|mock
pnpm ai:branch -- --issue 123 --title "short title"
pnpm ai:code-plan -- --issue 123 --provider openai|command|mock
pnpm ai:scope-check -- --plan-file .myagenttool/runs/<run>/code-plan.json --base main
pnpm ai:testing-plan -- --change web --risk high
pnpm ai:work-runner -- --issue 123 --provider openai|command|mock
pnpm ai:manifest -- --issue 123 --pr 456
pnpm ai:review -- --pr 456 --provider openai|command|mock
pnpm ai:feedback -- --feedback "..." --target bug
pnpm ai:feedback -- --feedback "..." --target bug --issue-tree
pnpm release:draft -- --pr 456
pnpm release:retrospective -- --pr 456
pnpm deploy:plan -- --target docs --environment preview
pnpm deploy:preflight -- --target web --environment staging
```

Most commands generate drafts. `ai:work-runner` and `deploy:publish` require
explicit `--apply` before they create branches, open PRs, or call a deployment
adapter. `ai:issue-tree --apply` additionally blocks high-risk issue creation
until human approval evidence is provided. None of these commands replace human
approval.
