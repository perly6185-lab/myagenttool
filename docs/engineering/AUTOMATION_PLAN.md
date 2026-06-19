# Automation Plan

This document describes the automation needed to support full-flow AI
development.

Automation should start boring and reliable. Add intelligence only after the
basic workflow is trustworthy.

## Automation Layers

### Layer 1: Repository Checks

Purpose:

- Keep documents and code from drifting.

Initial checks:

- Markdown files are non-empty.
- Relative markdown links are valid.
- Issue templates exist.
- PR template exists.

Future checks:

- Markdown lint.
- Docs terminology consistency.
- Link checks against moved vision documents.

### Layer 2: Issue Hygiene

Purpose:

- Ensure GitHub Issues remain executable work items.

Checks:

- Every open issue has a milestone.
- Every open issue has type, area, risk, acceptance, platform, and agent target
  labels.
- Issues moving to `ready` have acceptance criteria.
- Risks and ADRs are linked from implementation issues where relevant.

Implementation options:

- GitHub Actions with `gh`.
- A repository script under `tools/github`.
- A future GitHub App for richer Project field enforcement.

### Layer 3: Project Field Sync

Purpose:

- Keep labels, issue body metadata, and Project fields aligned.

Initial behavior:

- Parse `## Project Fields` from issue body.
- Set Project fields.
- Warn when labels and Project fields disagree.

Future behavior:

- Sync field changes back to labels when desired.
- Auto-route issues to views based on fields.
- Generate weekly board health reports.

### Layer 4: AI Issue Generation

Purpose:

- Turn user intent into structured issues.

AI should generate:

- Problem statement.
- User outcome.
- Acceptance criteria.
- Risk notes.
- Suggested milestone and project fields.
- Related source docs.

Human approval:

- Required before creating roadmap-changing initiatives.
- Required before high-risk automation or billing issues.

Implemented M0 entry point:

```text
pnpm ai:issue-tree -- --idea "..." --provider openai|command|mock
pnpm ai:issue-tree -- --brief-file brief.json --repo OWNER/REPO --apply
pnpm ai:issue-tree -- --brief-file brief.json --repo OWNER/REPO --apply --human-approved "approved by NAME in ISSUE/COMMENT"
```

The command is dry-run by default and writes labels, milestone, acceptance
criteria, source docs, and `## Project Fields` metadata. After apply, run issue
hygiene and Project field sync dry-run before moving generated work to `ready`.
High-risk, security/data/privacy, billing/cost, local execution,
roadmap-changing, or release/deploy issue creation is blocked until approval
evidence is passed with `--human-approved` or `MYAGENTTOOL_HUMAN_APPROVED`.

### Layer 5: AI Development Execution

Purpose:

- Let AI implement issue-scoped changes with evidence.

Workflow:

1. Read linked source docs.
2. Produce implementation plan.
3. Create branch.
4. Edit code or docs.
5. Generate Testing skills evidence.
6. Run scope drift check.
7. Run checks.
8. Draft PR.
9. Attach verification evidence.

Current executable helpers:

```text
pnpm ai:code-plan -- --issue 123 --provider openai|command|mock
pnpm ai:testing-plan -- --change web --risk high
pnpm ai:scope-check -- --plan-file .myagenttool/runs/<run>/code-plan.json --base main
pnpm ai:work-runner -- --issue 123 --provider openai|command|mock
```

`ai:work-runner --apply` writes the code plan, run manifest, coding adapter
contract, Testing skills plan, and scope drift evidence under
`.myagenttool/runs/<run>`. Trusted coding adapters must use JSON argv
configuration and produce `adapter-result.json`; they must not execute
model-proposed shell commands directly.

### Layer 6: AI Review

Purpose:

- Catch common defects before human review.

AI review should check:

- Acceptance coverage.
- Missing tests.
- Security and data handling.
- Cost and billing side effects.
- Cross-platform assumptions.
- UX clarity.
- State machine consistency.

### Layer 7: Release Automation

Purpose:

- Make releases traceable and reversible.

Release automation should:

- Generate release notes from merged PRs.
- List issues shipped.
- List known limitations.
- Attach migration notes.
- Attach rollback notes.

## Implemented Scripts

The first executable governance layer now lives in `tools/github`:

```text
pnpm github:check
pnpm github:check:issues
pnpm github:check:pr
pnpm github:check:branch
node tools/github/src/index.mjs sync-project-fields --owner perly6185-lab --project 1
```

Default behavior is read-only. `sync-project-fields` is dry-run by default and
requires `--apply` before mutating Project fields.

Current checks:

- Local governance files and PR template sections exist.
- Open issues have milestone plus type, status, area, risk, acceptance,
  platform, and agent target labels.
- Ready issues have acceptance criteria.
- PRs link or close issues and include verification evidence.
- Project fields can be compared against `## Project Fields` body metadata.
- Branch protection availability can be probed, with entitlement failures
  recorded as a governance risk.

## Suggested Scripts

Future repository scripts:

```text
tools/github/create-seed-issues.mjs
tools/docs/check-markdown-links.ps1
tools/release/generate-release-notes.ps1
```

## GitHub Actions Roadmap

### M0

- Docs check.
- Issue hygiene report.
- PR template enforcement.
- Basic test runner after code scaffold exists.
- PR governance check.
- Project field drift dry-run check.

### M1

- Cross-platform Desktop Bridge tests on macOS, Windows, and Linux runners.
- Agent adapter contract tests.
- State machine transition tests.

### M2

- Integration Builder artifact validation.
- Generated adapter safety checks.
- Redaction and schema checks.

### M3

- Billing ledger consistency checks.
- Release note generation.
- Signed extension/package verification.

## Guardrails

Automation must not:

- Merge PRs without approval.
- Deploy production without approval.
- Enable local execution permissions silently.
- Hide failed tests.
- Rewrite project scope without updating source docs.

## Success Metrics

- New issues have complete fields.
- Ready issues have acceptance criteria.
- PRs consistently link issues.
- Tests run before merge.
- Release notes can be generated from project metadata.
- AI-generated work leaves enough evidence for human review.

## Full-flow Delivery Roadmap

Use [FULL_FLOW_AI_DELIVERY.md](FULL_FLOW_AI_DELIVERY.md) as the system-level
definition.

Priority automation still missing:

- Issue to branch and work manifest.
- AI self-review with findings-first output.
- Release note and rollback note generation.
- Feedback to bug/risk/roadmap issue conversion.

These should be implemented as explicit commands with dry-run defaults before
they are wired into autonomous agent workflows.
