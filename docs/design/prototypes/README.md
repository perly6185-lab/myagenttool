# Design Prototypes

This folder contains low-fidelity, repo-owned prototypes used before production
Web Console implementation.

## Prototype Canvas

[canvas/](canvas/) defines the planned infinite-canvas workflow for reviewing
ASCII-derived prototypes before implementation. The required path for
non-trivial UI work becomes:

```text
Product Flow -> ASCII sketch -> Prototype Canvas -> HTML prototype -> Visual QA
```

The canvas phase is a review surface, not production UI. It must preserve role,
scenario, owner surface, prototype states, acceptance signals, and
what-not-to-show boundaries from [PRODUCT_FLOWS.md](../PRODUCT_FLOWS.md).

## Managed Session Context Rail

Files:

- [managed-session-context-rail.html](managed-session-context-rail.html)
- [managed-session-context-rail.css](managed-session-context-rail.css)
- [managed-session-context-rail.js](managed-session-context-rail.js)
- [managed-session-context-rail.spec.json](managed-session-context-rail.spec.json)

Source:

- `.myagenttool/runs/flow-validation-managed-session-history/ascii-prototype.md`

Open the HTML file directly in a browser. Use the state tabs to review:

- Ready
- Running
- Approval
- Succeeded

Acceptance checks:

- The task composer stays focused on task input, computer, agent, session mode,
  and run/cancel.
- Latest Managed Codex session appears in the right context rail.
- Session turns and Add follow-up appear in session detail, not in the task
  composer.
- Evidence Center remains an advanced context entry, not task input.
- Raw JSONL, hook names, imported evidence, and integration builder controls do
  not appear in the task composer.
- Mobile layout stacks task, status, latest session, and attention without
  overlap.

Run prototype QA:

```text
pnpm prototype:qa
```

The command writes:

```text
.myagenttool/prototype-qa/latest.json
.myagenttool/prototype-qa/latest.md
```

Figma path:

1. Review the HTML prototype in browser.
2. Capture desktop and mobile screenshots.
3. Import screenshots or recreate frames in Figma from
   `managed-session-context-rail.spec.json`.
4. Preserve the Product Flow ownership and what-not-to-show rules when turning
   this into a high-fidelity design.
