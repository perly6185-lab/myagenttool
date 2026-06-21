# Visual QA

This document defines the M0 visual QA path for the Web Console.

Use the repo-level [DESIGN.md](../../DESIGN.md) as the visual consistency
baseline for product-facing Web Console changes.

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
pnpm visual:qa
pnpm visual:qa:browser
pnpm test
```

`pnpm visual:qa` writes repeatable local artifacts:

```text
.myagenttool/visual-qa/latest.json
.myagenttool/visual-qa/latest.md
```

The current tool records desktop and mobile viewport metadata, key Web Console
state markers, column ownership checks, overflow guards, and a scripted IA
violation fixture. Browser screenshot automation is still optional until a
project-managed browser dependency is added.

Use `pnpm visual:qa:browser` when closing work that explicitly requires browser
screenshot automation. It fails until Playwright or Puppeteer is installed, so a
phase that requires screenshots should not be marked fully verified from the
lightweight artifact alone.

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
