# AI Development Workflow

This document defines how this repository should turn a user idea into
reviewable, tested, and releasable software with AI assistance.

For the broader product-delivery operating system, use
[FULL_FLOW_AI_DELIVERY.md](FULL_FLOW_AI_DELIVERY.md).
M0 acceptance and follow-up boundaries are recorded in
[AI_DELIVERY_CLOSEOUT.md](AI_DELIVERY_CLOSEOUT.md).

The goal is not to let AI silently build everything. The goal is to make AI a
disciplined development operator that follows the project context, creates
traceable work, asks for approval at the right points, and leaves evidence.

## Operating Principle

AI may accelerate drafting, planning, implementation, testing, review, and
release notes, but it must preserve human control over product direction,
architecture decisions, security boundaries, billing behavior, and release
approval.

## End-to-End Flow

```text
Idea -> Clarification -> Spec -> Issue -> ADR/Risk -> Plan -> Branch -> Code
-> Tests -> PR -> Review -> Merge -> Release -> Feedback
```

## Stage Rules

### 1. Idea

Input:

- A user describes what they want in natural language.

AI should:

- Restate the desired outcome in plain language.
- Identify affected users.
- Identify whether the idea changes product scope, architecture, security,
  billing, data handling, or user experience.
- Propose the smallest milestone-aligned slice.

Output:

- A short problem statement.
- Draft acceptance criteria.
- Suggested milestone, area, type, risk, platform, and agent target.

Human approval:

- Required before creating high-impact roadmap changes.

### 2. Clarification

AI should ask only the minimum questions needed to avoid unsafe assumptions.

Default assumptions should favor:

- Non-professional users first.
- Explicit local approval for risky local actions.
- Data minimization.
- Clear audit and traceability.
- Small M0/M1 slices instead of broad platform promises.

### 3. Spec

AI should create or update the relevant source document in `docs/vision` or
`docs/engineering`.

Spec output should include:

- Problem.
- User outcome.
- Non-goals.
- Acceptance criteria.
- Security, data, billing, audit, and UX implications.
- Open questions.

### 4. Issue

AI should create or update GitHub Issues with:

- Milestone.
- Area.
- Type.
- Status.
- Risk.
- Acceptance.
- Platform.
- Agent Target.
- Source Doc.

Issue bodies should contain enough context that another AI or human can pick up
the work without reading the entire repository.

Use the governed issue-tree path for PM-derived work:

```text
pnpm ai:issue-tree -- --idea "..." --provider openai|command|mock
pnpm ai:issue-tree -- --brief-file brief.json --repo OWNER/REPO --apply
pnpm ai:issue-tree -- --brief-file brief.json --repo OWNER/REPO --apply --human-approved "approved by NAME in ISSUE/COMMENT"
```

The command is dry-run by default. Apply mode is appropriate only when the PM
brief has acceptance criteria, source docs, labels, milestone, and Project field
metadata. High-risk roadmap, security, billing, release, or local execution
issues require explicit human approval before creation. Pass
`--human-approved "reason"` or set `MYAGENTTOOL_HUMAN_APPROVED` only after that
approval exists; the approval evidence is written into the generated issue body.

### 5. ADR and Risk

Create an ADR when the work chooses a durable technical direction.

Create a risk issue when:

- The behavior can lose user data.
- Local execution could continue after cancellation.
- Costs can be incurred unexpectedly.
- Security or privacy guarantees are unclear.
- Cross-platform behavior is inconsistent.

### 6. Plan

Before editing code, AI should produce a short plan when the change is more than
a trivial documentation or formatting change.

The plan should mention:

- Files or modules likely to change.
- Tests to run.
- Risks or assumptions.
- Whether user approval is required before privileged actions.

### 7. Branch and Code

AI should work from a GitHub issue whenever possible.

Code changes should:

- Follow existing repo structure and style.
- Keep scope tied to the issue.
- Avoid unrelated refactors.
- Add tests based on risk.
- Keep user-facing flows understandable without internal terminology.

### 8. Tests

AI should run the smallest useful verification set before opening or updating a
PR.

For AI-generated or agent-written work, first generate the deterministic
Testing skills plan:

```text
pnpm ai:testing-plan -- --change docs|web|server|desktop|protocol|security|release|adapter --risk low|medium|high|critical
pnpm ai:testing-plan -- --changes "server,security,release" --risk high
```

`ai:work-runner` infers all matching change routes from the planned files and
merges their evidence requirements. Mixed changes such as server plus security
or release plus docs must list every matched route in the generated evidence.

At minimum:

- Markdown/docs checks for documentation-only changes.
- Unit tests for local logic.
- Integration tests for protocol, queue, bridge, billing, and audit behavior.
- E2E tests for core user workflows.
- Visual QA evidence for product-facing web changes.
- Cross-platform process and cancellation evidence for Desktop Bridge or local
  execution changes.
- Adapter contract evidence for generated or trusted adapter changes.

### 9. Pull Request

Every PR should:

- Link the issue.
- Explain what changed.
- List acceptance criteria satisfied.
- List tests run.
- Link Testing skills evidence when AI generated or agent-written code changed.
- Link scope drift evidence for work-runner apply mode or broad manual changes.
- State deferred work and residual risk.

AI may draft the PR body, but human review is required before merging risky
changes.

### 10. Review

AI should perform a self-review before human review.

Review focus:

- Behavior regressions.
- Missing acceptance coverage.
- Security and data handling.
- Billing and cost side effects.
- Cross-platform assumptions.
- UX clarity for non-professional users.

### 10A. PM And Design Review

For product-facing UI changes, AI should also use
[PM_DESIGN_SKILLS.md](PM_DESIGN_SKILLS.md) and
[MYAGENTTOOL_DESIGN.md](../design/MYAGENTTOOL_DESIGN.md).

Review focus:

- Does the change prioritize non-professional users?
- Is the first screen a usable task workspace?
- Are safety, data, cost, cancellation, and audit visible in plain language?
- Are technical identifiers and protocol terms kept out of the primary flow?
- Is visual QA evidence attached when layout or copy changes?

### 11. Release

AI may draft release notes from merged PRs.

Human approval is required before:

- Production deployment.
- Desktop Bridge distribution.
- Billing behavior changes.
- Any release that changes local execution permissions.

### 12. Feedback

After release or demo, feedback should become:

- Bug issues for confirmed broken behavior.
- Risk issues for uncertainty.
- ADR updates for technical decision changes.
- Vision document updates for product direction changes.

## AI Autonomy Levels

| Level | AI may do | Human must approve |
| --- | --- | --- |
| A0 | Summarize docs, explain code, draft ideas | Nothing beyond conversation |
| A1 | Edit docs, create issue drafts | Scope changes |
| A2 | Create issues, labels, milestones, project fields | High-risk issue movement |
| A3 | Modify code, run local tests, draft PRs | Merge and release |
| A4 | Run deployment scripts in approved environments | Production release |
| A5 | Operate production and billing automation | Major incidents and billing policy |

M0 should operate mostly at A1-A3.

## Required Evidence

For each non-trivial AI-assisted change, keep evidence in one or more of:

- GitHub issue.
- Pull request.
- Test output.
- ADR.
- Risk issue.
- Audit or cost note.

If evidence cannot be preserved, do not treat the work as complete.

## Executable M0 Workflow

For M0 repository work, AI should use this command sequence before asking for
review:

```text
git status --short --branch
pnpm docs:check
pnpm repo:check
pnpm github:check
pnpm ai:scope-check -- --base main
pnpm ai:testing-plan -- --change docs --risk medium
pnpm typecheck
pnpm test
pnpm github:check:pr
```

When GitHub access is available, AI should also run:

```text
pnpm github:check:issues
node tools/github/src/index.mjs sync-project-fields --owner perly6185-lab --project 1
pnpm github:check:branch
```

The Project field sync command is dry-run by default. Use `--apply` only when
the user has approved Project mutation for that turn.

## Merge Boundary

AI may create commits, push branches, open PRs, update issues, and attach
verification evidence when authorized. AI must not merge into `main`, publish a
release, deploy production, or change billing/local execution permissions
without explicit approval.

If GitHub branch protection is unavailable because of repository entitlement,
the manual merge rule is:

- Merge only after `Docs`, `CI`, and `Governance` checks pass.
- Confirm the PR links or closes issues.
- Confirm residual risks are filed before merge.
- Keep the entitlement limitation tracked as a risk until technical enforcement
  is available.

## Skill-Assisted Work

Use local integration docs to choose external skill influence deliberately:

- [PM_DESIGN_SKILLS.md](PM_DESIGN_SKILLS.md) for PM framing, open-design
  workflow, and visual QA expectations.
- [CODING_SKILLS_INTEGRATION.md](CODING_SKILLS_INTEGRATION.md) for coding, QA,
  security, agent, and OSS maintenance skill guidance.

External skill output is source material. Repository docs, tests, PR governance,
and human approval remain the source of truth.
