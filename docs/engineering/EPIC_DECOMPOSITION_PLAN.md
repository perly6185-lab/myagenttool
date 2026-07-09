# Epic / Initiative Decomposition — plan

Extend the autonomy line from **one issue → one PR** to **one initiative/epic →
a validated tree of scoped child issues → (human-approved) fan-out → coordinated
child runs → rollup**. This is the next autonomy frontier: the decision agent
already triages a *single* issue; decomposition triages a *body of work*.

**Status (2026-07-08): S1–S5 COMPLETE + live-validated.** S1 shared engine (#593),
S2 propose (#595), S3 approve → fan-out (#597), S4 rollup (#599) + S4.1 issue-state
reconcile (#601), S5 overlap scoring (this PR). The capability runs end-to-end: epic
→ decompose → plan_proposed → human Approve → N governed child issues → each child
runs through the EXISTING pipeline once a human labels it `auto` → the epic rolls up
its children's status live. **Live-validated** on devdemo #25 → 5 children proposed →
4 merged (a feature shipped); the run surfaced two real fixes now landed (S4.1
reconcile; S5 overlap score — which flags the exact #language↔#hardening overlap that
made a child judge-block). Live operation (running real epics, labelling children) is
intentionally manual.

## Current state — most of the engine already exists (wire, don't rebuild)

- **`tools/ai/src/legacy/issue-tree.mjs` (335 lines)** — the decomposition engine,
  today reachable only via the `ai:issue-tree` CLI, NOT the server:
  - `issueTreeFromBrief(brief)` → a tree of issue specs (title, acceptanceCriteria,
    projectFields, milestone).
  - `issueTreeApplyFailures` / `validateIssueTreeForApply` → per-spec governance
    gate (title not TODO, milestone present, acceptance criteria present, Product
    Flow required for UI/workflow issues, human-approval-required reasons).
  - `issueTreeWithHumanApproval(tree, evidence)` → attaches the human sign-off.
- **`apps/server/src/services/auto-run-spawn.mjs`** — governed child-issue spawning:
  `childIssueBody` (depth-1 marker `<!-- myagent:autorun:child-of:#N -->`, parent
  Project Fields inherited), `childIssueTitle`, `runChildIssueCreate`,
  `isSpawnedChildBody` (blocks recursive decomposition), one-child dedup.
- **Decision agent** (`auto-run-decision.mjs`) — paths develop|design|prototype|
  clarify. No "decompose" path yet; an epic labeled `auto` today mis-routes to
  develop and tries to open a single PR for a whole epic.
- **Orchestration primitives already built** — `globalMaxConcurrent` + per-project
  cap, `autonomyKillSwitch`, circuit breaker, budget brake, auto-trigger label
  scan. The child runs need no new orchestration machinery.
- **pr-governance** already treats `type/initiative` as a non-work parent (a PR
  must link a dedicated non-initiative issue) — so an epic must NEVER get its own
  PR; it gets a rollup instead.

## Guardrails (same posture as the rest of the line)

- **Opt-in, default off** — new setting `epicDecomposition`. Disabled ⇒ an epic
  behaves exactly as today.
- **Human approval BEFORE the fan-out** — the tree is *proposed*, never
  auto-spawned. Spawning N issues + N runs is a large, outward, potentially paid
  action; a human approves the plan first (reuse `issueTreeWithHumanApproval`; the
  click is the authorization, same pattern as D4 design approval).
- **Depth-1 only** — children carry the child marker; `isSpawnedChildBody` already
  stops a child from decomposing again. No unbounded recursion.
- **Bounded fan-out** — cap children per epic (`epicMaxChildren`, default small,
  e.g. 8); the decision records the plan but refuses to spawn beyond the cap.
- **Governance-clean children** — `validateIssueTreeForApply` runs BEFORE any
  spawn, so every child carries Project Fields + acceptance and its later auto-PR
  passes pr-governance. A tree with a TODO title / missing milestone is rejected,
  not spawned.
- **The epic never gets a PR** — it parks at a rollup state; only children open PRs.
- **All existing brakes apply to the child runs** — kill switch, breaker, budget,
  concurrency caps gate the fan-out exactly as normal auto-runs.

## Slices (each a PR, testable in isolation)

### Slice 1 — promote the decomposition engine to a shared, server-importable module
Move the pure generation + validation out of `legacy/` into a side-effect-free
module the server can import (twin `.mjs`, no CLI deps), keeping the `ai:issue-tree`
CLI working on top of it. Pure functions only; no behavior change. Tests:
`issueTreeFromBrief`, `issueTreeApplyFailures` (each failure class), depth/marker.

### Slice 2 — a `decompose` route that PROPOSES a plan (no spawn)
Detect an epic/initiative auto-run — by `type/epic`|`type/initiative` label, or a
new decision path `decompose` — behind `epicDecomposition`. The agent expands the
epic body (+ codebase) into a structured brief; `issueTreeFromBrief` turns it into
a tree; `validateIssueTreeForApply` gates it. Record the proposed tree on the
auto-run and park at a new **`plan_proposed`** state. NOTHING is spawned. The epic
issue gets a comment with the proposed children (titles + acceptance). Opt-in;
disabled ⇒ epics route as today.

### Slice 3 — human approval → governed fan-out
A console control (mirroring `DesignApproval`) on a `plan_proposed` run: **Approve
plan** → re-validate → spawn the N child issues via `runChildIssueCreate` (depth
marker, inherited Project Fields, dedup), up to `epicMaxChildren`; **Request
changes** → feedback back to the epic. The click is the authorization. Record the
spawned child numbers on the epic run; move it to **`decomposed`**.

### Slice 4 — coordinated child runs + rollup
Optionally auto-trigger each spawned child (label or direct trigger), respecting
concurrency caps + kill switch + breaker + budget. Group the children under the
epic in the Auto-runs console; roll up status (`X/N children merged`) to the epic
issue as an updating comment. Dependency ordering (if the tree carries deps) is a
stretch within this slice.

### Slice 5 (stretch) — decomposition evaluation
Metrics: children-merged rate per epic, human edits to the proposed tree (a proxy
for decomposition quality), child re-open rate. Feeds the same Capability panel.

## Non-goals (for now)
- Recursive/multi-level trees (depth-1 only).
- Cross-repo epics.
- Auto-approval of the fan-out (always human-gated).
- Dependency-DAG scheduling beyond simple ordering (stretch in S4).

## Reuse map (why this is mostly wiring)
| Need | Reuse |
|------|-------|
| brief → child specs | `issueTreeFromBrief` (S1 promote) |
| per-child governance gate | `validateIssueTreeForApply` |
| human sign-off on the plan | `issueTreeWithHumanApproval` + a `DesignApproval`-style control |
| spawn a governed child | `runChildIssueCreate` + `childIssueBody` |
| stop recursion | `isSpawnedChildBody` (depth-1 marker) |
| run + brake the children | concurrency caps, kill switch, breaker, budget (all built) |
| rollup surface | Auto-runs console group + an issue comment (`runIssueComment`) |
