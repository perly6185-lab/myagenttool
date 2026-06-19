# GitHub Setup

This guide turns the repository documents into a working GitHub execution
system.

## Current Repository Setup

As of 2026-06-19, the GitHub side has been initialized:

- Repository: `perly6185-lab/myagenttool`
- Project: [myagenttool Roadmap](https://github.com/users/perly6185-lab/projects/1)
- Milestones: M0, M1, M2, M3, M4
- Labels: type, status, area, risk, acceptance, platform, agent target, and
  priority labels
- Project fields: GitHub native `Milestone`, `Status`, `Area`, `Type`, `Risk`,
  `Acceptance`, `Platform`, `Agent Target`, `Priority`, and `Source Doc`
- Seed issues: #1 through #18 imported into the Project

Remaining manual setup:

- Create or tune Project views in the GitHub web UI.
- Move only the first 2-3 issues from `backlog` to `ready` after reviewing
  dependencies.

It assumes the repository already contains:

- `.github/ISSUE_TEMPLATE`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/workflows/docs.yml`
- `docs/engineering`
- `docs/vision`

## 1. Create Milestones

Create or verify these GitHub Milestones:

```text
M0 - Remote Invocation Loop
M1 - Local Agent Management
M2 - Integration Builder and Governance
M3 - Lifecycle Automation and Billing
M4 - Marketplace and Ecosystem
```

Use [MILESTONES.md](MILESTONES.md) for descriptions.

## 2. Create Labels

Create or verify the labels listed in [LABELS.md](LABELS.md).

Minimum labels before importing issues:

```text
type/initiative
type/epic
type/task
type/adr
type/risk
type/bug
status/backlog
status/ready
status/in-progress
status/review
status/blocked
status/done
area/web
area/server
area/desktop
area/protocol
area/security
area/billing
area/docs
area/cross-cutting
risk/low
risk/medium
risk/high
risk/critical
acceptance/not-defined
acceptance/defined
acceptance/verified
platform/all
platform/macos
platform/windows
platform/linux
platform/server
platform/web
agent/all
agent/cli
agent/http
agent/mcp
agent/a2a
agent/platform
agent/lifecycle
agent/none
```

## 3. Create a GitHub Project

Create or verify one project for the repository:

```text
myagenttool Roadmap
```

Create fields from [PROJECT_FIELDS.md](PROJECT_FIELDS.md):

```text
Milestone (GitHub native issue milestone field)
Status
Area
Type
Risk
Acceptance
Platform
Agent Target
Priority
Source Doc
```

Recommended default:

```text
Status = backlog
Acceptance = not defined
Risk = medium
```

## 4. Create Project Views

Create these views:

```text
Roadmap
M0 Execution
Acceptance Gaps
Risks
Adapter Work
Platform Coverage
```

Use [PROJECT_FIELDS.md](PROJECT_FIELDS.md) for filters and grouping.

## 5. Import Initial Issues

The initial M0 import should start with:

1. [M0_ISSUE_SEED.md](M0_ISSUE_SEED.md)
2. [ADR_SEED.md](ADR_SEED.md)
3. Initial risks from [BACKLOG_SEED.md](BACKLOG_SEED.md)

Recommended order:

```text
1. Initiative: M0 Remote Invocation Loop
2. ADR: Realtime Transport
3. ADR: Desktop Bridge Runtime
4. ADR: Server Runtime and Storage
5. Epic: M0 Device Registration
6. Epic: M0 Manual CLI Agent Registration
7. Epic: M0 Invocation Delivery State Machine
8. Risk: Durable Delivery Acknowledgement
```

Do not import every possible future issue. Keep M0 small enough to review.

Current imported seed range:

```text
#1  [Initiative]: M0 Remote Invocation Loop
#2  [Epic]: M0 Device Registration
#3  [Epic]: M0 Manual CLI Agent Registration
#4  [Epic]: M0 Manual HTTP Agent Registration
#5  [Epic]: M0 Idea-to-Outcome Task Entry
#6  [Epic]: M0 Invocation Delivery State Machine
#7  [Epic]: M0 Offline Queue and Reconnect Dispatch
#8  [Epic]: M0 Cancellation Propagation
#9  [Epic]: M0 Device Unlink Behavior
#10 [Epic]: M0 Basic Audit and Trace
#11 [Epic]: M0 Agent Economics Metadata
#12 [ADR]: Realtime Transport for Desktop Bridge Dispatch
#13 [ADR]: Desktop Bridge Runtime and Packaging Path
#14 [ADR]: Server Runtime, Storage, and Queue for M0
#15 [ADR]: Web Console App Shell for M0
#16 [Risk]: Durable Delivery Acknowledgement
#17 [Risk]: Cross-platform Process Cancellation
#18 [Risk]: Non-professional User Confusion
```

## 6. Project Hygiene

Before moving an issue to `ready`, ensure:

- Milestone is set.
- Area is set.
- Type is set.
- Acceptance is `defined`.
- Source Doc is filled.
- Risks or ADRs are linked when relevant.

Before closing an issue, ensure:

- Acceptance is `verified`.
- PR is merged or the issue is explicitly closed as not planned.
- Follow-up issues are filed for deferred work.

## 7. First Week Checklist

- [x] Create milestones.
- [x] Create labels.
- [x] Create project fields.
- [ ] Create project views.
- [x] Import M0 initiative.
- [x] Import 5-8 M0 epics.
- [x] Import 3 ADRs.
- [x] Import 3 initial risks.
- [x] Mark issues without acceptance as `acceptance/not-defined`.
- [ ] Move only the first 2-3 issues to `ready`.

## 8. Operating Rule

If a new idea appears, do not immediately code it.

First decide whether it is:

```text
initiative / epic / task / adr / risk / bug
```

Then link it to a source document or create the missing source document.
