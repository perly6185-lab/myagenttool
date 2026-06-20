# Open Design Workflow

This document defines how M0 Web Console design work can use open-design-style
prototype generation without treating generated output as production code.

## Inputs

Design agents should consume:

- `docs/design/MYAGENTTOOL_DESIGN.md`
- `docs/vision/USER_EXPERIENCE.md`
- `docs/vision/IDEA_TO_OUTCOME.md`
- `docs/engineering/VISUAL_QA.md`

The design request should describe the target user, primary task, required
states, and safety/cost/data/audit visibility.

## Prototype Location

Generated prototypes and screenshots should live outside runtime app code until
reviewed. Recommended locations:

```text
.myagenttool/design-runs/
docs/design/prototypes/
```

Do not import generated prototype assets or dependencies into `apps/web` until
the design has been reviewed and the repository owner chooses the production
implementation path.

## Review Rules

Before Codex converts design direction into runtime code, reviewers should
confirm:

- The first screen is the task workspace, not a marketing page.
- Task, computer, agent, safety, data, cost, cancellation, activity, result, and
  audit are visible in the main workflow.
- Protocol ids, adapter names, raw states, queues, and trace details are hidden
  by default behind progressive disclosure.
- Empty, offline, queued, running, success, failure, cancellation, and timeout
  states are understandable in plain language.
- Long task text and logs do not overflow on desktop or mobile.
- Generated output does not introduce unreviewed network calls, secrets,
  tracking scripts, or production dependencies.

## Codex Implementation Path

Codex should translate approved design direction into:

- `apps/web/public/index.html`
- `apps/web/public/app.js`
- `apps/web/public/styles.css`
- `apps/web/src/index.mjs` self-check expectations
- Supporting docs and verification notes

Runtime code should remain repository-owned, minimal, reviewable, and covered by
the local web self-check plus `pnpm smoke:local`.

## Dogfood Boundary

Open-design can later become a manually registered agent candidate in the Agent
Registry. For M0, it remains an external reference workflow and is not a
production dependency of MyAgentTool.
