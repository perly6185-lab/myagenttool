# M1 Acceptance Closeout

Date: 2026-06-20

M1 Local Agent Management is accepted for the current demo product slice.

## Outcome

Users can discover, enable, disable, and health-check local agents with
plain-language guidance and local approval for high-risk actions.

## Accepted Scope

| Acceptance | Evidence |
| --- | --- |
| Conservative local discovery is available without aggressive OS scanning. | #77, PR #86 |
| Users can enable and disable registered agents. | #78, PR #85 |
| Disabled agents cannot receive new invocations. | #78, PR #85 |
| Health checks are visible and understandable. | #79, #80, PR #85 |
| Capability risk tags are visible and can drive local approval. | #81, PR #87 |
| First troubleshooting platform agent can summarize failed invocations. | #82, PR #88 |
| Usage count and cost owner metadata are visible where implemented. | #83, PR #88 |

## Issue And PR Closure

| Work item | Status | Merge evidence |
| --- | --- | --- |
| #78 Agent Enable Disable | Closed | PR #85 `eebd1bf` |
| #79 Agent Health Check | Closed | PR #85 `eebd1bf` |
| #80 Web Agent Management States | Closed | PR #85 `eebd1bf` |
| #77 Conservative Local Agent Discovery | Closed | PR #86 `0a48122` |
| #81 Capability Risk Tags and Local Approval | Closed | PR #87 `6f4d1fe` |
| #82 Invocation Troubleshooter Platform Agent | Closed | PR #88 `65daaca` |
| #83 Usage Count and Cost Owner Metadata | Closed | PR #88 `65daaca` |

## Verification

Local acceptance baseline:

```text
pnpm docs:check
pnpm repo:check
pnpm typecheck
pnpm test
pnpm smoke:local
git diff --check
```

CI acceptance baseline:

- `verify`
- `desktop-smoke (ubuntu-latest)`
- `desktop-smoke (macos-latest)`
- `desktop-smoke (windows-latest)`
- `markdown-basic`
- `pull-request-governance`
- `ai-review`

## Non-Goals Preserved

- No full-system aggressive discovery.
- No silent install or uninstall.
- No production billing automation.
- No enterprise approval queues.
- No automatic remediation by the troubleshooting platform agent.

## Residual Follow-Up

- M2 can add Integration Builder prompts for generated adapter config, tests,
  economics, and retention.
- M2 can promote troubleshooting output into richer trace views and reviewable
  remediation plans.
- M2 or later can add estimated cost and revenue records beyond M1 usage
  counters.
