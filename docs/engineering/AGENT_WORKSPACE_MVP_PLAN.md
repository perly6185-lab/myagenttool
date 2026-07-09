# Agent Workspace MVP — plan (#158)

Deliver the smallest useful **interactive** Agent Workspace loop: select a local
project → browse its files → send a task from a bottom composer → watch Codex output
as a conversation **transcript** (not scattered cards) → review project-scoped
history → survive a restart. Three areas on one surface: **project nav | agent
transcript | inspector/history**. File access restricted to registered roots.

This is the interactive half of the product; the autonomous half (issue → PR →
merge, design, epic decomposition) is done. Per #151 the problem is that these
capabilities currently **compete across separate sections** — the MVP is to compose
them into ONE project-scoped workspace.

**Status (2026-07-09): MVP loop COMPLETE.** W1 git-metadata capture (#609), W2
three-pane shell (#611), W3 ignored badges + content search (#613), and this
finalize (empty-state CTA). **W4 (#162 interactive transcript) and W5 (#164 restart
recovery) were already satisfied by the reused pieces** — `DashboardView` clears the
composer + shows a user bubble + handles transcript scroll, and `ui-store` persists
the section (localStorage) while the server persists/restores `currentProjectId` — so
they needed no new slices, only verification. Remaining: a live browser visual check
(needs a running console).

## Current state — the pieces EXIST, scattered (compose, don't rebuild)

Recon found most primitives already built (mostly by the autonomous-line work):

| Need | Already built | Gap |
|------|---------------|-----|
| Project registry + selection (#160) | `state.projects`, `currentProjectId`, POST/GET/PATCH `/api/projects`, `features/projects/{projects-view,project-register-form,project-settings-form}` | project model fields (git remote, default branch, last-opened, active checkout); left-rail workspace presentation |
| Project file tree + git status (#161) | `GET /api/projects/:id/tree` → `readProjectTree` **with `gitStatus`/`gitSummary`** (modified/added/deleted), `searchProjectContent`, `safeProjectFile` (realpath containment), `features/projects/project-tree.tsx` | surface in a workspace pane; ignored-file badge; lazy-expand + refresh-after-run polish |
| Agent transcript (#162) | `features/invocations/transcript.tsx` (already `#162`: typed blocks — command output/warnings/approvals-inline/final-answer/diff-jump) | bind to the selected project; a fixed bottom composer; stream-without-scroll-jump; keep stderr separate |
| Session history / inspector | `features/invocations/{session-history,run-context-inspector}.tsx` | scope to project; "resume/use as context" entry |
| Task composer | `features/tasks/task-view.tsx` | reuse as the transcript's bottom composer |
| Restart recovery (#164) | `ui-store` persists to localStorage; server persists runs/sessions | persist the SELECTED project + recent session; verify restore |

**The real gap:** there is no single project-scoped **Workspace** section (a three-pane
shell) that assembles these and scopes them to the current project. Everything needed
exists as parts.

## Guardrails
- **Path access restricted to registered roots** — already enforced by
  `safeProjectFile` (realpath + containment) and `readProjectTree`; the MVP must not
  weaken it. Non-registered paths cannot be selected via arbitrary API calls (#160).
- **Read-only file browser** for the MVP (#161).
- **No raw terminal / pty in the composer** (#151 non-goal); the composer sends tasks,
  it is not a shell.
- **Reuse existing components** — do not fork project-tree / transcript / composer.
- Existing Demo CLI and Codex CLI run paths must keep working (#162).

## Slices (each a PR, testable)

### W1 — project model + selection completeness (#160)
Extend the project model with `gitRemote`, `defaultBranch`, `lastOpenedAt`,
`activeCheckoutId`; capture git metadata on register (best-effort, omitted if absent);
bump `lastOpenedAt` on select. Server + the register/settings forms + a small
`select project` API if missing. Local smoke over add/list/select/remove.

### W2 — the Workspace shell (#158 IA) — the heart
A new `workspace` section: a three-pane shell scoped to `currentProjectId`.
- LEFT: registered-project selector (rail) + the project file tree.
- CENTER: the transcript for the project's active session + a fixed bottom composer.
- RIGHT: session history + the run/context inspector.
Compose existing components; wire the project selection so all three panes follow it.
This slice delivers the visible MVP loop even before the gap-fills below.

### W3 — file tree in the workspace + git badges (#161)
Wire `project-tree.tsx` (with `gitStatus`) into the left pane: lazy directory
expansion, name/content search, refresh, and status badges (modified/added/deleted
/ignored). Refresh git status after a run completes. Mostly wiring existing data;
add the `ignored` classification to `gitStatusMap` if missing.

### W4 — interactive transcript + composer (#162)
The center pane: sending a task clears the composer and adds a stable user bubble;
running output appends in order without scroll-jump or ANSI/TUI scramble; approval and
failure blocks are actionable and linked to their invocation; stderr stays separate
from answer content. Refine `transcript.tsx` for live streaming; reuse the task
composer at the bottom. Demo + Codex CLI paths verified.

### W5 — persist + restart recovery (#164, #158)
The selected project + the most recent session survive refresh/restart (ui-store +
server session history). Mostly present — verify the full add-project → run-task →
restart → still-there loop and fill any gap.

### Validation (#158 acceptance)
Local smoke (add/select/tree/run) + one browser visual check across empty / normal /
dirty repo states (#161). Demo can go empty-browser-state → add-project → run-task →
see-history with no manual state editing.

## Non-goals (this MVP)
- Multi-agent compare, diff annotate, approval-broker notifications, evidence center,
  remote pty/terminal (later #128 phases / #144).
- Writing files from the browser (read-only).
- Replacing the autonomous auto-runs surface — the Workspace is the interactive peer.

## Reuse map (why this is mostly composition)
| Pane | Reuse |
|------|-------|
| project selector | `features/projects/projects-view` rail + `/api/projects` |
| file tree + git | `features/projects/project-tree.tsx` + `GET /api/projects/:id/tree` |
| transcript | `features/invocations/transcript.tsx` |
| composer | `features/tasks/task-view.tsx` composer |
| history/inspector | `features/invocations/{session-history,run-context-inspector}.tsx` |
| restart restore | `ui-store` localStorage + server run/session persistence |
