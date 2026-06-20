# AI Delivery Closeout

This document closes the M0 AI-assisted delivery operating-system line and
records what moves forward into M1/M2.

## M0 Acceptance Coverage

| Issue | Acceptance | Evidence |
| --- | --- | --- |
| #19 | AI development starts from `AI_CONTEXT.md` and workflow docs | `AI_CONTEXT.md`, `AI_DEVELOPMENT_WORKFLOW.md`, `PROJECT_MANAGEMENT.md` |
| #19 | M0 work can start from docs, Project fields, and acceptance | Issue templates, `tools/github`, `tools/ai issue-tree`, `M0_ACCEPTANCE_CLOSEOUT.md` |
| #19 | AI autonomy is separated from human approval | `AI_DEVELOPMENT_WORKFLOW.md`, `FULL_FLOW_AI_DELIVERY.md`, PR template risk gates |
| #19 | First-week operating rhythm is documented | `PROJECT_MANAGEMENT.md`, `GITHUB_SETUP.md`, `M0_GOVERNANCE_CLOSEOUT.md` |
| #34 | PM skill usage is documented for M0 UI/product work | `PM_DESIGN_SKILLS.md`, `OPEN_DESIGN_WORKFLOW.md`, `MYAGENTTOOL_DESIGN.md` |
| #34 | Issue and PR practices reference PM/design checks | `AI_DEVELOPMENT_WORKFLOW.md`, PR template, `tools/github` risk routing |
| #34 | PM output becomes acceptance criteria and tests | `tools/ai pm-brief`, `tools/ai issue-tree`, `tools/ai testing-plan` |
| #34 | External PM skills are not vendored into runtime code | `PM_DESIGN_SKILLS.md`, no runtime PM dependency |
| #39 | Idea-to-feedback stage contract is documented | `FULL_FLOW_AI_DELIVERY.md` |
| #39 | Current capability and gaps are visible | `FULL_FLOW_AI_DELIVERY.md`, this closeout |
| #39 | Human approval gates are explicit | `AI_DEVELOPMENT_WORKFLOW.md`, `M0_GOVERNANCE_CLOSEOUT.md` |

## Current Executable Commands

```text
pnpm ai:intake -- --idea "..."
pnpm ai:pm -- --idea "..." --provider openai|command|mock
pnpm ai:issue-tree -- --idea "..." --provider openai|command|mock
pnpm ai:branch -- --issue 123 --title "short title"
pnpm ai:code-plan -- --issue 123 --provider openai|command|mock
pnpm ai:testing-plan -- --change web --risk high
pnpm ai:work-runner -- --issue 123 --provider openai|command|mock
pnpm ai:review -- --pr 456 --provider openai|command|mock
pnpm ai:feedback -- --feedback "..." --target bug --issue-tree
pnpm release:draft -- --pr 456
pnpm release:retrospective -- --pr 456
```

All mutation paths are explicit. Issue creation, work-runner apply mode, PR
opening, deployment publish, and Project field updates require apply flags or
human approval evidence.

## M0 Human Gates

Human approval remains required for:

- Merge to `main`.
- Release and deployment.
- Billing or cost policy changes.
- Security, privacy, credential, or data-retention changes.
- Local execution permission changes.
- Roadmap-changing issue creation.

If required checks cannot be technically enforced because of repository
entitlement, use the manual gate in
[M0_GOVERNANCE_CLOSEOUT.md](M0_GOVERNANCE_CLOSEOUT.md).

## Follow-up Candidates

Move these beyond M0:

- M1: promote missing risk-specific evidence from PR warnings to failing checks
  where practical.
- M1: create CODEOWNERS or reviewer routing if repository entitlement supports
  it.
- M1: add browser screenshot automation for Web Console visual QA.
- M1: improve backlog health reporting for Project views and stale fields.
- M2: integrate richer PM intake and interview-style clarification loops.
- M2: connect feedback intake to real support, telemetry, or demo notes.
- M3: enforce release/deploy approvals for production environments when
  repository entitlement allows it.

## Closeout Decision

The M0 AI delivery line is accepted as an operating scaffold, not as fully
autonomous product delivery. It provides traceable PM, issue, code-plan,
testing-plan, review, release, and feedback helper paths with human approval at
irreversible gates.
