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
- Trusted coding adapter contract slots for Codex, Claude, Qwen Code,
  OpenClaw-like, QClaw-like, generic command, and deterministic mock adapters.
- `tools/release` helper CLI for release process checks and release note drafts.
- `tools/deploy` helper CLI for deployment checks, plans, preflight, and dry-run
  or adapter-backed publish.
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

Needed:

- Issue tree creation from a PM brief.
- Rules for when AI may create issues directly and when it must ask approval.

### 2. Issue Creation And Project Sync

Partially implemented:

- Issue hygiene checks.
- Project field dry-run and explicit apply.

Missing:

- A seed/create command that can create one issue or an issue tree from a PM
  brief.
- Parent/child issue linkage or a consistent fallback convention.
- Automatic status transitions from PR/check events.

Needed:

- Issue creation CLI with dry-run/apply.
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

Missing:

- Production wrapper commands for each trusted coding agent adapter.
- Guardrails that stop broad changes when the issue scope is narrow.

Needed:

- Work manifest stored in PR body and `.myagenttool/runs`.
- Scope drift check.

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

Missing:

- Security review checklists for local execution and billing changes.
- Visual QA automation for web UI screenshots.
- Cross-platform desktop runner checks on Windows, macOS, and Linux.

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

Missing:

- Feedback intake template.
- Automatic conversion from feedback to bug/risk/roadmap issue.
- Post-release review report.

Needed:

- Feedback issue template.
- Release retrospective checklist.
- Telemetry and support signal policy before product launch.

## Maturity Levels

| Level | Meaning | Current status |
| --- | --- | --- |
| L0 | Docs only | Completed earlier |
| L1 | Issues and Project exist | Completed |
| L2 | Branch, PR, CI, and smoke tests work | Mostly complete |
| L3 | Governance checks and Project drift checks work | Mostly complete |
| L4 | AI can create PM brief, issue, branch, code, PR, and review evidence | Partially complete |
| L5 | Human-approved merge and release can be generated with rollback notes | Partially complete |
| L6 | Feedback automatically becomes tracked bugs/risks/roadmap updates | Not complete |

Current target:

```text
Reach L4 with a trusted coding adapter and issue creation apply mode.
```

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
pnpm ai:branch -- --issue 123 --title "short title"
pnpm ai:code-plan -- --issue 123 --provider openai|command|mock
pnpm ai:work-runner -- --issue 123 --provider openai|command|mock
pnpm ai:manifest -- --issue 123 --pr 456
pnpm ai:review -- --pr 456 --provider openai|command|mock
pnpm ai:feedback -- --feedback "..." --target bug
pnpm release:draft -- --pr 456
pnpm deploy:plan -- --target docs --environment preview
pnpm deploy:preflight -- --target web --environment staging
```

Most commands generate drafts. `ai:work-runner` and `deploy:publish` require
explicit `--apply` before they create branches, open PRs, or call a deployment
adapter. None of these commands replace human approval.
