# Visual QA

This document defines the M0 visual QA path for the Web Console.

Use the repo-level [DESIGN.md](../../DESIGN.md) as the visual consistency
baseline for product-facing Web Console changes. Use
[PRODUCT_FLOWS.md](../design/PRODUCT_FLOWS.md) to choose the role flow,
scenario, prototype state, and usability task that the screenshot or visual
artifact must prove.

## Automated Browser Level

The repository uses its project-managed Playwright dependency for repeatable
browser screenshots. Build the Web Console, then run:

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
pnpm --filter @myagenttool/web build
pnpm visual:qa
pnpm visual:qa:browser
```

`pnpm visual:qa` writes repeatable local artifacts:

```text
.myagenttool/visual-qa/latest.json
.myagenttool/visual-qa/latest.md
```

`visual:qa:browser` starts an isolated local API and static Web server, injects
deterministic state through the normal `/api/state` boundary, and captures 12
screenshots: empty, ready, running, succeeded, approval, and disconnected at
1366 x 768 and 390 x 844. It fails on a blank page, horizontal overflow, missing
task/project/agent controls, or missing Safety, Data, Cost, and Computer panels.
The ready and run states use a Codex CLI agent so selector and session-oriented
task controls remain in coverage.

Generated screenshots remain under the gitignored
`.myagenttool/visual-qa/screenshots/` directory. Attach the relevant files and
`.myagenttool/visual-qa/latest.md` to the PR instead of committing routine output.

## Manual Screenshot Checklist

Before closing a UI issue, capture or inspect:

- Desktop viewport around 1366 x 768.
- Mobile viewport around 390 x 844.
- The role flow and owner surface from
  [PRODUCT_FLOWS.md](../design/PRODUCT_FLOWS.md).
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

## Follow-up Coverage

Issue #136 tracks Visual QA and Design Mode for AI-assisted frontend work.
