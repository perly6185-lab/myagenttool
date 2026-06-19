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
- `tools/release` helper CLI for release process checks and release note drafts.
- Design contract and visual QA guidance for product-facing UI work.

## Gaps To True Product Autodelivery

### 1. Idea Intake And PM Breakdown

Missing:

- A structured intake command that turns a plain-language idea into a PM brief.
- Automatic classification of scope, risk, platform, agent target, and affected
  source docs.
- A required "non-professional user outcome" field for product-facing issues.

Needed:

- `pnpm ai:intake -- --idea "..."` as the deterministic brief generator, then a
  future model-backed agent workflow.
- PM brief template.
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

Missing:

- A standard issue-to-branch command.
- AI execution manifest recording issue, branch, files touched, commands run,
  risks found, and follow-up issues created.
- Guardrails that stop broad changes when the issue scope is narrow.

Needed:

- `pnpm ai:manifest` as the deterministic work manifest generator, then a
  future issue-to-branch command.
- Work manifest stored in PR body or `.agents/runs`.
- Scope drift check.

### 4. Automated Review

Partially implemented:

- CI.
- Governance checks.
- Docs checks.
- Smoke test.

Missing:

- AI code-review bot that comments findings on PRs.
- Security review checklists for local execution and billing changes.
- Visual QA automation for web UI screenshots.
- Cross-platform desktop runner checks on Windows, macOS, and Linux.

Needed:

- PR review command that produces findings-first output.
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

Partially implemented:

- Release process document.

Missing:

- Release notes generator.
- Versioning policy applied in package metadata.
- Release checklist command.
- Staging/preview/prod deployment environments.
- Rollback evidence.

Needed:

- `pnpm release:draft` to generate a draft release note from PR and issue
  metadata.
- Environment-specific deployment docs and approvals.

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
| L4 | AI can create PM brief, issue, branch, code, PR, and review evidence | Not complete |
| L5 | Human-approved merge and release can be generated with rollback notes | Not complete |
| L6 | Feedback automatically becomes tracked bugs/risks/roadmap updates | Not complete |

Current target:

```text
Reach L3 solidly, then build L4 in small slices.
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
pnpm ai:branch -- --issue 123 --title "short title"
pnpm ai:manifest -- --issue 123 --pr 456
pnpm ai:feedback -- --feedback "..." --target bug
pnpm release:draft -- --pr 456
```

These commands generate drafts. They do not replace human approval, and they do
not merge, deploy, publish, or run local user commands.
