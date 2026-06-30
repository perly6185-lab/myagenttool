# Prototype Canvas Phase 1

This phase adds Prototype Canvas to the AI-assisted development workflow as the
visual review step between ASCII sketches and implementation.

## Why

MyAgentTool should not let AI move directly from a product idea to production
UI code. For product-facing work, the user needs a visible intermediate artifact
that makes layout, role ownership, interaction states, and hidden advanced
concepts reviewable before implementation.

## Delivery Flow

```text
Need
-> Product Flow
-> ASCII sketch
-> Prototype Canvas
-> HTML clickable prototype
-> Visual QA checklist/screenshots
-> Code Plan
-> implementation
```

## Tracking Work

Create one epic and four implementation tasks:

- Epic: Prototype Canvas Phase 1: ASCII to editable visual prototype.
- Task: Define Prototype Canvas scene graph and Product Flow metadata contract.
- Task: Build ASCII import for the managed session history prototype.
- Task: Build canvas preview with pan, zoom, drag, and label editing.
- Task: Build HTML export and Visual QA checklist generation.

Each issue must include concrete Product Flow:

- Role flow: ordinary developer plus advanced developer for session detail.
- Scenario: review managed session history UI before implementation.
- Frequency: high for task composer, medium for session detail.
- Owner surface: Prototype Canvas and generated HTML prototype.
- Usability task: inspect the proposed UI, adjust layout/copy, and export the
  prototype for Visual QA.
- What not to show: raw JSONL, hook names, imported evidence, integration
  builders, and full session turns in the task composer.

## Phase Gates

### Gate 1: Product Contract

Done when:

- Scene graph schema exists.
- Product Flow metadata is part of every top-level region.
- What-not-to-show can be validated per region.
- Prototype states are represented explicitly.

Verification:

- schema fixture check
- docs check
- Product Flow drift check

### Gate 2: ASCII Import

Done when:

- The current managed session ASCII prototype imports into the scene graph.
- Left, middle, and right rail ownership are preserved.
- Session detail imports as a separate detail surface.

Verification:

- import fixture check
- generated artifact diff
- prototype QA boundary checks

### Gate 3: Canvas Editing

Done when:

- Canvas can pan and zoom.
- Panels can be dragged.
- Titles, button labels, and field labels can be edited.
- Editing cannot silently move forbidden content into the task composer.

Verification:

- browser/manual smoke
- canvas state fixture
- Product Flow boundary check

### Gate 4: Export And QA

Done when:

- Canvas exports browser-openable HTML under `docs/design/prototypes/`.
- A Visual QA checklist is generated from the scene graph.
- The exported prototype can be used as code-plan evidence.

Verification:

- `pnpm prototype:qa`
- `pnpm visual:qa`
- `pnpm docs:check`
- `pnpm repo:check`

## Code Plan Requirements

Any implementation plan for this phase must include:

- `productFlow`
- `affectedSurfaces`
- `prototypeStates`
- `acceptanceSignals`
- `whatNotToShow`
- `visualQaTasks`
- source ASCII artifact
- exported prototype artifact
- generated checklist artifact

## Non-Goals

- Image or screenshot restoration.
- Figma export.
- Production Web Console IA changes.
- Real-time collaboration.
- Replacing Product Flow with visual screenshots.

## Closeout Report

When all gates pass, the final report must include:

- issue IDs and Project sync status
- source ASCII artifact
- canvas scene graph artifact
- exported HTML prototype
- Visual QA checklist and screenshots if available
- commands run
- residual Phase 2 follow-ups
