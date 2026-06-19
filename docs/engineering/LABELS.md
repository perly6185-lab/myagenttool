# Labels

This document defines the recommended GitHub labels for the repository.

Labels should make issues sortable without turning issue titles into metadata.

## Type Labels

```text
type/initiative
type/epic
type/task
type/adr
type/risk
type/bug
type/docs
```

## Status Labels

```text
status/backlog
status/ready
status/in-progress
status/review
status/blocked
status/done
```

GitHub Projects should be the primary status source. Status labels are useful
for search and automation.

## Area Labels

```text
area/web
area/server
area/desktop
area/protocol
area/security
area/billing
area/docs
area/cross-cutting
```

## Risk Labels

```text
risk/low
risk/medium
risk/high
risk/critical
```

## Acceptance Labels

```text
acceptance/not-defined
acceptance/defined
acceptance/verified
```

## Platform Labels

```text
platform/all
platform/macos
platform/windows
platform/linux
platform/server
platform/web
platform/none
```

## Agent Target Labels

```text
agent/all
agent/cli
agent/http
agent/mcp
agent/a2a
agent/platform
agent/lifecycle
agent/none
```

## Priority Labels

```text
priority/p0
priority/p1
priority/p2
priority/p3
```

Use priority sparingly:

- `priority/p0`: blocks milestone acceptance or severe security issue.
- `priority/p1`: important for current milestone.
- `priority/p2`: useful but not blocking.
- `priority/p3`: future or cleanup.

## Recommended Initial Label Set

Create labels from each section before importing backlog seed issues.

Minimum useful set:

```text
type/initiative
type/epic
type/task
type/adr
type/risk
type/bug
status/backlog
status/ready
status/blocked
area/web
area/server
area/desktop
area/protocol
area/security
area/billing
area/docs
risk/high
risk/critical
acceptance/not-defined
acceptance/defined
acceptance/verified
```
