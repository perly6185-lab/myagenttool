# Project Management

This repository should turn product vision into executable engineering work
through GitHub Issues, Milestones, Projects, Pull Requests, and lightweight
automation.

The source of product intent is `docs/vision`. The source of delivery execution
is GitHub.

AI-assisted delivery is governed by:

- [AI_CONTEXT.md](AI_CONTEXT.md): the entry context for AI agents.
- [AI_DEVELOPMENT_WORKFLOW.md](AI_DEVELOPMENT_WORKFLOW.md): the full idea to
  release workflow.
- [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md): completion rules.
- [AUTOMATION_PLAN.md](AUTOMATION_PLAN.md): GitHub and repository automation
  roadmap.
- [PR_REVIEW_POLICY.md](PR_REVIEW_POLICY.md): AI and human review boundaries.
- [LOCAL_DEV_ENV.md](LOCAL_DEV_ENV.md): target local development experience.
- [TEST_STRATEGY.md](TEST_STRATEGY.md): test expectations by risk and milestone.
- [RELEASE_PROCESS.md](RELEASE_PROCESS.md): release and rollback rules.
- [ADR_INDEX.md](ADR_INDEX.md): accepted architecture decision records.

## Management Model

```text
Idea -> Vision doc -> Initiative -> Epic -> Task / ADR / Risk / Bug
-> Pull Request -> Release -> Feedback
```

Mapping:

- Vision document: product, architecture, security, or acceptance source.
- Initiative: milestone-sized outcome.
- Epic: coherent capability under an initiative.
- Task: small implementation, research, or documentation unit.
- ADR: architecture decision.
- Risk: tracked uncertainty or failure mode.
- Bug: confirmed broken behavior.
- Pull Request: reviewed change that moves an issue toward acceptance.
- Release: shipped artifact with notes, known limitations, and rollback plan.
- Feedback: user or operational learning turned into issues, risks, ADRs, or
  docs.

## GitHub Project Fields

Recommended fields:

```text
Milestone: M0 / M1 / M2 / M3 / M4
Area: web / server / desktop / protocol / security / billing / docs / cross-cutting
Type: initiative / epic / task / adr / risk / bug
Status: backlog / ready / in progress / review / blocked / done
Risk: low / medium / high / critical
Acceptance: not defined / defined / verified
Platform: all / macos / windows / linux / server / web / none
Agent Target: all / cli / http / mcp / a2a / platform / lifecycle / none
Source Doc: path to the source vision or engineering document
```

Recommended views:

- Roadmap by Milestone.
- Board by Status.
- Risks by Severity.
- M0 Execution Board.
- Platform Coverage by Platform.
- Agent Adapter Work by Agent Target.
- Acceptance Gaps.

## Issue Types

Use the issue forms in `.github/ISSUE_TEMPLATE`.

### Initiative

Use for milestone-sized outcomes, such as:

- M0: Remote Invocation Loop.
- M1: Local Agent Management.
- M2: Integration Builder and Governance.

### Epic

Use for product capabilities that need multiple tasks:

- Device registration.
- Invocation delivery.
- Cancellation propagation.
- Local discovery.

### Task

Use for small work items with clear acceptance.

### ADR

Use when the project must choose an architecture direction:

- Realtime transport.
- Desktop app shell.
- Server runtime.
- Database and queue.

### Risk

Use for tracked uncertainty:

- Durable bridge acknowledgement.
- Process-tree cancellation differences across platforms.
- Generated integration safety.

### Bug

Use only for confirmed broken behavior or documentation contradiction.

## Workflow

1. Create or update the source vision document.
2. Create an initiative issue for the milestone outcome.
3. Create epics for major capabilities.
4. Create tasks, ADRs, and risks under each epic.
5. Mark acceptance criteria before moving work to `ready`.
6. Open PRs that reference issues.
7. Run tests and AI self-review.
8. Verify acceptance before closing issues.
9. Release with notes and rollback plan when applicable.

For initial setup, follow [GITHUB_SETUP.md](GITHUB_SETUP.md).
For copy-ready M0 issue drafts, use [M0_ISSUE_SEED.md](M0_ISSUE_SEED.md).
For initial architecture decision drafts, use [ADR_SEED.md](ADR_SEED.md).
For accepted decisions, use [ADR_INDEX.md](ADR_INDEX.md).
For AI engineering execution seed issues, use
[AI_ENGINEERING_ISSUE_SEED.md](AI_ENGINEERING_ISSUE_SEED.md).

For AI-assisted implementation, start with
[AI_CONTEXT.md](AI_CONTEXT.md) and
[AI_DEVELOPMENT_WORKFLOW.md](AI_DEVELOPMENT_WORKFLOW.md).

## Definition of Ready

An issue is ready when:

- It has a milestone.
- It has an area.
- It has a type.
- It has clear acceptance criteria.
- It links to a source doc or explains why none exists.
- Security, data, cost, lifecycle, and UX impact are considered when relevant.
- Blocking ADRs or risks are linked.

## Definition of Done

An issue is done when:

- Acceptance criteria are satisfied.
- The PR is merged.
- Relevant docs are updated.
- User-facing behavior is understandable without internal terminology.
- Security, data, cost, and audit implications are handled or explicitly
  deferred.
- Follow-up risks or tasks are filed.

## M0 Execution Rule

M0 should stay focused on proving the remote invocation loop with a
non-professional-user-first experience.

Do not pull these into M0 unless a later review deliberately changes scope:

- Automated install or uninstall.
- Marketplace publishing.
- Full MCP/A2A compatibility.
- Production SaaS billing.
- Multi-team RBAC.
- Silent generated code execution.

## Weekly Operating Rhythm

Each week, review:

- What M0 issues are `ready`?
- Which issues are missing acceptance criteria?
- Which risks block implementation?
- Which ADRs need a decision?
- Which docs changed and require backlog updates?

Keep the board small enough to act on. It is better to have 20 clear issues than
200 vague ones.

## AI Operating Rhythm

For each AI-assisted development task:

1. Read [AI_CONTEXT.md](AI_CONTEXT.md).
2. Read the linked source docs from the issue.
3. Confirm the issue is `ready` or explain why it must stay in `backlog`.
4. Produce a short implementation plan.
5. Make issue-scoped changes.
6. Run the relevant checks from [TEST_STRATEGY.md](TEST_STRATEGY.md).
7. Apply [PR_REVIEW_POLICY.md](PR_REVIEW_POLICY.md) before requesting review.
8. Update Project fields and follow-up risks.
