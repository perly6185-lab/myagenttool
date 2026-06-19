# Project Fields

This document defines the GitHub Project fields used by the execution board.

Current Project:

- [myagenttool Roadmap](https://github.com/users/perly6185-lab/projects/1)

## Fields

| Field | Type | Values |
| --- | --- | --- |
| Milestone | GitHub native milestone | M0, M1, M2, M3, M4 |
| Status | Single select | backlog, ready, in progress, review, blocked, done |
| Area | Single select | web, server, desktop, protocol, security, billing, docs, cross-cutting |
| Type | Single select | initiative, epic, task, adr, risk, bug |
| Risk | Single select | low, medium, high, critical |
| Acceptance | Single select | not defined, defined, verified |
| Platform | Single select | all, macos, windows, linux, server, web, none |
| Agent Target | Single select | all, cli, http, mcp, a2a, platform, lifecycle, none |
| Priority | Single select | p0, p1, p2, p3 |
| Source Doc | Text | docs/vision/... |

## Automation Ideas

Start simple:

- New issues default to `Status = backlog`.
- Issues with `acceptance/not-defined` show in the Acceptance Gaps view.
- Closed issues move to `done`.
- PRs linked to issues show in the Review view.

Avoid complex automation until the team has used the board for a few weeks.

## Required Views

### Roadmap

Group by Milestone. Sort by Type, then Status.

### M0 Execution

Filter:

```text
Milestone = M0
Status != done
```

Group by Status.

### Acceptance Gaps

Filter:

```text
Acceptance = not defined
Status != done
```

### Risks

Filter:

```text
Type = risk
Status != done
```

Group by Risk.

### Adapter Work

Group by Agent Target.

### Platform Coverage

Group by Platform.
