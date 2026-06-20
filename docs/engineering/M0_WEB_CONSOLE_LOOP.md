# M0 Web Console Loop

This document records the executable M0 Web Console task workspace behavior.

## Scope

M0 Web Console behavior covers:

- Plain-language task entry.
- One recommended computer and selectable registered agents.
- Pre-run safety, data, cost, and cancellation review.
- Run and cancel actions.
- Plain-language status, delivery, cancellation, result, and audit summaries.
- Activity timeline scoped to the selected task.
- Advanced protocol ids, adapter names, trace ids, and raw state hidden by
  default.
- Offline server state messaging.

## Current Implementation Boundary

The Web Console is a static local demo app served by `apps/web`. It talks to the
local M0 server API and does not yet include authentication, durable idea
sessions, or browser automation screenshots.

The UI keeps the first screen as the usable task workspace. Technical metadata
is available in a collapsed details section for debugging.

## Verification

The following checks cover this stage:

```text
pnpm --filter @myagenttool/web test
pnpm smoke:local
pnpm docs:check
pnpm repo:check
pnpm typecheck
pnpm test
git diff --check
```

Visual QA remains lightweight for M0 and follows
[VISUAL_QA.md](VISUAL_QA.md). Browser screenshot automation is still a future
follow-up.
