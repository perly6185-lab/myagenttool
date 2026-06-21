# Prototype Canvas

Prototype Canvas is the planned infinite-canvas review surface for turning
low-fidelity AI drafts into visible, editable prototypes before production UI
implementation.

## Phase 1 Scope

Phase 1 focuses on ASCII-to-canvas review. Image restoration is intentionally
deferred to a later phase because ASCII preserves structure more reliably and
fits the current Product Flow gate.

Input:

- `.myagenttool/runs/flow-validation-managed-session-history/ascii-prototype.md`
- role, scenario, owner surface, prototype states, and what-not-to-show rules
  from [PRODUCT_FLOWS.md](../../PRODUCT_FLOWS.md)

Output:

- editable three-column infinite-canvas preview
- live HTML prototype preview
- exported HTML prototype artifact
- generated Visual QA checklist

## Gate 1 Artifacts

Gate 1 defines the contract that later import, editing, and export work must
honor:

- [scene-graph.schema.json](scene-graph.schema.json)
- [managed-session-history.scene.json](managed-session-history.scene.json)

## Gate 2 Artifacts

Gate 2 imports the current ASCII prototype into the scene graph contract:

- [managed-session-history.imported.scene.json](managed-session-history.imported.scene.json)
- `tools/dev/import-ascii-prototype.mjs`

## Gate 3 Artifacts

Gate 3 renders the imported scene in an editable canvas preview:

- [prototype-canvas.html](prototype-canvas.html)
- [prototype-canvas.css](prototype-canvas.css)
- [prototype-canvas.js](prototype-canvas.js)

Open `prototype-canvas.html` through a local static server so the browser can
load `managed-session-history.imported.scene.json`. The preview supports:

- surface switching
- pan and zoom
- dragging regions
- editing region and element labels
- boundary validation for task-composer forbidden content

## Gate 4 Artifacts

Gate 4 exports the imported scene into implementation evidence:

- [managed-session-history.export.html](managed-session-history.export.html)
- [managed-session-history.visual-qa.json](managed-session-history.visual-qa.json)
- [managed-session-history.visual-qa.md](managed-session-history.visual-qa.md)
- `tools/dev/export-prototype-canvas.mjs`

The exported HTML is standalone and can be opened directly in a browser. The
Visual QA checklist is generated from scene graph Product Flow metadata,
prototype states, acceptance signals, owner surfaces, and what-not-to-show
rules.

Run the contract check through:

```text
pnpm prototype:qa
```

The command writes:

```text
.myagenttool/prototype-qa/canvas-contract-latest.json
.myagenttool/prototype-qa/canvas-contract-latest.md
```

## Product Workflow

```text
Idea
-> Product Flow
-> ASCII sketch
-> Prototype Canvas visual review
-> HTML clickable prototype
-> Visual QA screenshots/checklist
-> Code Plan
-> implementation
```

The canvas phase exists to stop AI-assisted development from jumping directly
from requirements to code. A user should be able to see and adjust the proposed
interaction model before implementation begins.

## Phase 1 Requirements

- Import the current ASCII prototype as the initial source.
- Render a three-column canvas preview for task intent, execution state, and
  context rail.
- Support panning and zooming on an unbounded canvas.
- Support dragging panels without changing their Product Flow ownership.
- Support editing panel titles, button labels, and field labels.
- Preserve role, scenario, owner surface, prototype states, acceptance signals,
  and what-not-to-show metadata.
- Export an HTML prototype under `docs/design/prototypes/`.
- Generate a Visual QA checklist covering desktop, mobile, role ownership,
  prototype states, and forbidden content boundaries.

## Non-Goals

- No production Web Console changes in Phase 1.
- No screenshot or hand-drawn image restoration in Phase 1.
- No Figma export in Phase 1.
- No multi-user collaboration in Phase 1.
- No use of raw screenshots as the source of truth.

## Acceptance

- The imported ASCII prototype is visible as editable canvas regions.
- The ordinary developer task composer does not show Evidence Center, raw JSONL,
  hook names, imported evidence, integration builders, or full session turns.
- Full session detail remains a separate detail surface opened from the context
  rail.
- HTML export can be opened directly in a browser.
- Generated Visual QA checklist names the role, scenario, owner surface,
  prototype states, and what-not-to-show checks.
- `pnpm prototype:qa`, `pnpm docs:check`, and `pnpm repo:check` pass.

## Deferred Phase 2

Phase 2 may add screenshot, sketch, or Figma-image restoration through an
overlay editing model:

```text
image background + editable structured overlay -> scene graph -> prototype
```

The restored image remains source material. The editable scene graph and
Product Flow metadata remain the source of truth.
