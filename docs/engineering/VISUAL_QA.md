# Visual QA

This document defines the M0 visual QA path for the Web Console.

## Current M0 Level

M0 uses lightweight visual QA until a browser automation dependency is added.

Automated checks currently verify:

- The Web Console serves successfully.
- The task workspace includes task, safety, data, cost, activity, result, and
  audit surfaces.
- Mobile layout CSS exists.
- Long text overflow guards exist.
- User-facing state and event mappers exist.

These checks run through:

```text
pnpm --filter @myagenttool/web test
pnpm test
```

## Manual Screenshot Checklist

Before closing a UI issue, capture or inspect:

- Desktop viewport around 1366 x 768.
- Mobile viewport around 390 x 844.
- Empty/no-result state.
- Running state.
- Succeeded state with result.
- Server-offline state.

Confirm:

- Task input, computer, agent, safety, data, cost, activity, result, and audit
  are visible in the main workflow.
- Primary controls remain reachable.
- Long task text and logs wrap instead of overflowing.
- Technical IDs do not dominate the first screen.
- Safety, data, cost, cancellation, and audit are described in plain language.

## Future Browser Automation

Issue #36 should add Playwright or an equivalent browser tool when the frontend
stack is stable enough.

Target automation:

- Start local demo services.
- Capture desktop and mobile screenshots.
- Assert no horizontal overflow.
- Assert key panels are visible.
- Attach screenshots or artifact paths to PR evidence.
