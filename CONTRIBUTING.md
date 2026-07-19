# Contributing

myagenttool is an Agent Control Plane. Changes are governed, attributable, and
reversible. This file is the team-facing entry point; the deep process lives in
[`docs/engineering/AI_DEVELOPMENT_WORKFLOW.md`](docs/engineering/AI_DEVELOPMENT_WORKFLOW.md)
and the decisions in [`docs/engineering/ADR_INDEX.md`](docs/engineering/ADR_INDEX.md).

## The delivery loop, in one line

```text
Idea → Issue (with Project Fields) → Plan → Branch → Code → Tests → PR → Review → Merge
```

Every PR must link a work issue that carries a `## Project Fields` block and is
tracked on the Project board — the `pr-governance` check enforces this, and
branch protection (`enforce_admins`) applies it to everyone, admins included.
There is no bypass; make the required checks green.

## Automated risk gates (what already exists)

The repo classifies risk by file path and change type, and requires matching
evidence — you do not invent these, you satisfy them:

| Gate | What it does | Where |
| --- | --- | --- |
| `pnpm ai:scope-check` | Planned files vs. actual diff → scope-drift class | `tools/ai/src/legacy/scope-testing.mjs` |
| `pnpm ai:testing-plan` | change type (docs/web/server/desktop/protocol/security/adapter…) × risk → required test evidence | same |
| `pr-governance` risk routes | file globs (`touchesWebUi/Desktop/Adapter/Security/…`) → required PR evidence (visual QA, Product Flow, cross-platform, redaction) | `tools/github/src/pr-evidence.mjs` |
| loop human-gates | high-risk categories (security/data, billing, local execution, release, roadmap) trip an approval gate | `tools/ai/src/loop/registry.mjs` |
| ADR | durable decisions about runtime/transport/storage/security/lifecycle need an ADR | `docs/engineering/ADR_INDEX.md` |

## Required: Change Impact & Risk Assessment

The gates above answer *"what evidence/approval does this change need?"* — they do
**not** state *"does this change affect the business flow, and how much?"* Every
task that adds, edits, or deletes files closes with a short, uniform assessment
so impact is stated explicitly rather than assumed:

```text
Change Impact & Risk Assessment
- Changes: file · add/edit/delete · kind (docs/test/source/config)
- Touches business flow: yes/no (if yes → name the flow, e.g. invocation → dispatch → bridge → result)
- On the runtime import graph: yes/no
- Risk: low/medium/high (+ why)
- Blast radius: callers / affected modules
- Verification: what ran, result
- Rollback cost: low/medium/high
```

Ground it in the **real diff** (`git diff`), not intent. A comment-only edit to a
runtime file has zero business impact — say so, with evidence (tests green,
`--check` self-tests pass). Report faithfully: if a step was skipped or a check
failed, state it. Skip the assessment only for changes with no file diff.

**Where it lives:** put the assessment in the **PR body** — the
`## Change Impact & Risk Assessment` section of the PR template — so it is a
permanent part of the change record, and mirror it as a comment on the linked
issue before it closes. `pnpm pr:evidence` reports whether the section is present
(`changeImpact`). This is a **non-blocking** signal today: its absence does not
fail `pr-governance` — it is a convention, enforced by review and habit, not a
hard gate.

## Conventions

- Runtime code is `.mjs` (Node, no build step); `.ts` files are type contracts and the React web app.
- Commit style: Conventional Commits with a scope, e.g. `fix(bridge): …`, `docs: …`.
- Never bypass a failing required check or a local approval gate — autonomy never crosses an approval gate.
