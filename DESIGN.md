# MyAgentTool Design System

This file is the AI-readable design baseline for MyAgentTool UI work. Read it
before changing `apps/web/public/index.html`, `apps/web/public/app.js`, or
`apps/web/public/styles.css`.

Source documents:

- `docs/design/MYAGENTTOOL_DESIGN.md`
- `docs/vision/USER_EXPERIENCE.md`
- `docs/engineering/VISUAL_QA.md`

External design references such as `awesome-design-md` may inform this file's
structure. They must not override MyAgentTool's product tone, safety model, or
visual language.

## Product Feel

MyAgentTool should feel like a calm task command center. It helps a person ask
their own computer to run an agent, understand the risk, watch progress, and
inspect what happened.

The interface should be:

- Calm, reliable, operational, and human-readable.
- Useful on the first screen, not a marketing landing page.
- Clear for non-professional users before it is powerful for experts.
- Honest about unknown cost, data access, cancellation, and local execution.

Avoid:

- Brand-heavy design language borrowed from another product.
- Purple-heavy gradients, decorative orbs, and hero sections.
- Dense developer-console first impressions.
- Nested cards or panels inside panels.
- Raw protocol terms in the primary workflow.

## First Screen

The first viewport should be the real task workspace. It should answer:

- What task do I want done?
- Which computer will run it?
- Which agent or capability will run?
- What are the safety, data, cost, and cancellation implications?
- What is happening now?
- What result or explanation came back?

The primary order is:

1. Task intent input.
2. Device and agent readiness.
3. Safety, data, cost, and cancellation review.
4. Run controls.
5. Activity timeline.
6. Result summary.
7. Audit and technical details.

As Codex governance work grows, the first screen must stay organized around the
high-frequency task flow instead of exposing every capability as an equal
choice. The homepage is always the task workspace:

- describe the task;
- choose the computer and agent;
- review safety, data, cost, and cancellation;
- run, approve, cancel, and read the result.

Lower-frequency or expert workflows are secondary tools:

- `Codex supervision`: inspect session registry, effective policy, evidence,
  hooks, and approval broker state for Codex runs.
- `Import evidence`: import user-authorized Codex evidence after the fact for
  review. Imported evidence is not the same as a managed compliance session.
- `Connect agent`: discover local agents or draft an unsupported-agent
  integration.

Do not present these expert tools as first-class alternatives to running a
task. They should be behind an "Advanced tools" disclosure, a secondary
navigation surface, or a dedicated management view. Selecting Codex CLI should
show only the Codex controls needed for the task, such as session behavior and a
small supervision summary; the full evidence and policy chain belongs in the
advanced supervision view.

Each column owns its own world:

- The task composer column is only for task intent, target selection, run
  controls, pre-run review, and narrowly scoped technical disclosure for the
  selected run.
- The activity column is only for current task status, approval prompts, and
  timeline/result progress.
- The context rail is for selected computer, selected agent, current result,
  audit, and low-frequency management tools.

Do not place agent discovery, integration builders, evidence import, or
supervision navigation inside the task composer. These are management or audit
workflows, not task-entry controls.

Change review belongs to the managed session detail and evidence workflow. The
task composer may summarize that a result has changes, but file lists, diff
previews, reviewer comments, approvals, rejections, and feedback prompts stay in
the supervision context so high-frequency task entry remains clean.

Approval broker requests need an attention surface outside raw logs. Pending
PermissionRequest items appear in the supervision rail as a compact queue with
tool, risk, timeout, session, workspace, and approve/deny controls. The task
composer should never become an approval inbox.

Evidence Center is a low-frequency audit product surface. It may aggregate
managed JSONL events, hooks, approval broker records, runtime warnings, change
reviews, and explicitly imported evidence, but it must keep source and marker
visible. Imported records must read as `imported_after_the_fact`, not as managed
session proof.

Visual QA for frontend changes must cover desktop and mobile viewport metadata,
empty/running/approval/succeeded/failed states when applicable, Codex
supervision, Connect Agent, Evidence Center, text overflow, hidden primary
controls, raw logs dominance, and column ownership. Attach
`.myagenttool/visual-qa/latest.md` or browser screenshots when closing UI work.

## AI Development Acceptance

Every AI-assisted frontend or workflow phase must answer these before it is
marked verified:

- Who is this for: ordinary user, advanced user, operator, or admin?
- Is the capability high-frequency task work, low-frequency configuration,
  supervision evidence, or advanced governance?
- Which column or mode owns it, and what must not appear there?
- What is the real click path from empty state to completion?
- What happens on approve, deny, timeout, cancel, failed, and imported states?
- Which evidence is managed proof, and which evidence is imported after the
  fact?
- Which acceptance item is only partially done, and which follow-up issue owns
  it?

Do not mark a phase verified just because markers exist, smoke passes, or a
surface is visible. Verified means the intended user can complete the workflow
and the stated acceptance criteria are actually satisfied.

## Layout

Desktop:

- Use a three-area workspace when space allows:
  - command area for task input, selectors, and run controls;
  - activity/result area for status, progress, and output;
  - context area for device, agent, safety, cost, and audit.
- Keep the shell constrained around `1360px` with modest page padding.
- Use `8px` radius for panels and controls unless an existing component uses a
  pill badge.
- Keep panels shallow. A panel may contain repeated cards, but do not place
  broad page sections inside decorative cards.

Tablet:

- Collapse to two columns when the right context rail would become cramped.
- Put context sections below the primary workspace if needed.

Mobile:

- Use one column.
- Task input comes first.
- Run controls remain reachable.
- Details, logs, and audit can collapse after the main status and result.

## Color Tokens

Use the existing quiet, warm-neutral base with restrained teal, green, amber,
and red state colors.

Current runtime colors:

```text
page background: #f5f6f4
surface:         #ffffff
soft surface:    #fbfcfb
field surface:   #fcfdfb
text strong:     #17201d
text body:       #2d3935
text muted:      #5f6d68 / #65716d / #687671
border:          #d9dfdc / #e1e6e2
field border:    #bdc7c2
primary:         #2f6f73
focus ring:      #d8ecea
success bg:      #eef8ef
success text:    #176037
warning bg:      #fff8e4 / #fff9ed
warning text:    #715015 / #6f4a12
danger bg:       #fff0f0
danger text:     #8b1d1d
selected bg:     #f3fbfa
selected border: #7aa2a4
```

Do not turn the application into a one-hue theme. New colors should serve
state, hierarchy, or accessibility.

## Typography

- Use the system sans stack already defined in CSS.
- Keep letter spacing at `0`, including headings and labels.
- Use compact headings inside panels. Reserve large type for the page title.
- Labels may be uppercase at small sizes when they act as scanning aids.
- Long task text, agent names, command paths, IDs, logs, and results must wrap
  or truncate intentionally.

Current scale:

```text
page title:      30px desktop, 24px mobile
section heading: 17px
card heading:    15px
body:            inherited / 14-16px
metadata:        12-13px
```

## Components

### Page Shell

- `.shell` centers the app and controls page padding.
- `.topbar` contains the product heading and connection state.
- The title should describe the task workspace, not sell the product.

### Workspace Panels

- `.command-panel`, `.run-panel`, and `.context-section` are the main surfaces.
- Use white surfaces, subtle borders, `8px` radius, and compact padding.
- Avoid adding visual decoration that does not support the user task.

### Mode Navigation

- Do not put expert modes ahead of the task composer on the homepage.
- Use a compact secondary control inside "Advanced tools" or a management view
  for low-frequency workflows.
- Prefer the context rail or a dedicated management view for advanced tools;
  do not place the secondary navigation inside the task composer.
- The task workspace remains the default even when a Codex agent is selected.
- Avoid presenting mode selection as a protocol choice. Use user-facing labels
  such as "Codex supervision", "Import evidence", and "Connect agent".
- Discovery and integration-builder controls belong in `Connect Agent`, not in
  the default `Run Task` flow.
- Codex session controls belong only in Codex-capable modes or when the selected
  agent is Codex.

### Context Rail

- The right rail should be contextual instead of a permanent list of every
  governance feature.
- In `Run Task`, show computer, selected agent, result, and audit.
- When Codex is selected in the default task flow, show a concise session
  summary in the context rail.
- In `Codex supervision`, show session registry, effective policy, evidence
  chain, approval state, audit, and recent managed session history.
- Session history is a supervision/audit view, not a task-entry control. Keep it
  in the context rail or a dedicated history page, summarize entries by status,
  mode, time, repo, and thread/session id, and keep raw JSONL behind evidence
  drill-downs.
- Session history should support status filters, a selected-session detail
  panel, evidence and approval counts, result summary, and plain continuation
  guidance. The history list should not read Codex private session files; it
  should use MyAgentTool's session registry, invocation records, JSONL evidence,
  hook events, and approval broker records.
- In `Import evidence`, show local import source, redaction status, import
  preview, retention, and the imported-after-the-fact audit marker.
- In `Connect Agent`, show discovery status, candidate health, integration
  review state, and governance checklist.
- Keep raw IDs, trace IDs, and protocol payloads behind advanced disclosure.

### Task Composer

- The textarea is the primary control and should be visibly larger than other
  fields.
- Placeholder and surrounding copy should invite a plain-language task.
- Do not require agent terminology before the user can type intent.
- Multi-agent comparison is an advanced run option, not a separate primary
  workflow. When enabled, it should keep the same task text and create child
  invocations with independent session, workspace, evidence, and audit records.

### Selectors

- Device and agent selectors should be paired near the task.
- Selected values must handle long names and paths without overflow.
- Agent shortcuts or choice cards should explain availability in plain terms.

### Buttons

- Primary actions use the teal primary color.
- Secondary actions are white with a neutral border.
- Button text should name the consequence: "Run task", "Cancel task",
  "Run health check", "Approve", "Deny".
- Disabled buttons need nearby plain-language reason text when the reason is
  not obvious.

### Badges

- Use pill badges for compact status only.
- Green means ready or succeeded.
- Amber means queued, running, pending approval, warning, or unknown.
- Red means failed, rejected, disconnected, or blocked.
- Badges should not be the only explanation for risky states.

### Review Strips And Facts

- Use compact key/value facts for safety, data, cost, cancellation, device,
  agent, audit, and lifecycle details.
- Use plain labels first. Put protocol IDs in advanced sections.
- Key/value rows must collapse to one column on mobile.

### Timeline

- The activity timeline is the main evidence surface while a task runs.
- Empty states should explain the next useful action.
- Log and event text must wrap.
- Keep enough fixed or bounded height that logs do not push run controls away.

### Result

- Result summaries should be concise and readable.
- Troubleshooting or follow-up controls can appear after failed results.
- Do not bury the final result under raw logs.

### Advanced Details

- Use `<details>` or equivalent progressive disclosure for protocol IDs,
  traces, adapter configs, raw events, and other expert metadata.
- Advanced details should support debugging without dominating the first screen.

### Managed Codex

Managed Codex Mode is a supervised local Codex workflow. Its primary evidence
chain is:

```text
MyAgentTool-managed launch
-> session registry
-> Codex JSONL event stream
-> Codex hooks
-> MyAgentTool approval broker
-> audit and evidence store
```

UI for Managed Codex should make these facts visible:

- MyAgentTool starts or resumes the Codex session through a managed entry point.
- MyAgentTool records prompt metadata, JSONL events, hook events, command
  execution summaries, file-change summaries, approval requests, and outcomes.
- MyAgentTool may enforce or request approval for organization policy checks.
- Codex CLI authentication still belongs to the user or enterprise Codex setup.
  MyAgentTool must not read, copy, or ask the user to paste
  `~/.codex/auth.json`.
- Effective Codex sandbox, approval, network, hooks, and managed requirements
  should be shown as policy facts when known. Unknown policy facts should be
  labeled as unknown, not hidden.
- Only sessions launched or resumed through the managed entry point should be
  shown as managed sessions.

Use "managed session" only for sessions that MyAgentTool launched or resumed
with the managed registry and evidence chain active.

Managed Codex workspaces should make repo scope explicit:

- The task composer may expose a Codex-only workspace policy: current repo, new
  isolated worktree, or existing worktree.
- Workspace registry records should link sessions to repo path, worktree path,
  branch, dirty state, last commit, status, and policy.
- The UI must label unknown or dirty state clearly.
- Creating or switching git worktrees is a local repository mutation and should
  require explicit user intent and audit. A phase may record pending worktree
  policy before implementing actual worktree creation.
- Workspace details belong in session detail and supervision views, not as raw
  git output in the task composer.

### Imported Codex Evidence

Imported Codex evidence is an explicit, user-authorized, after-the-fact review
workflow. It is useful for investigation, debugging, or voluntary audit, but it
is not the compliance source of truth for Managed Codex Mode.

UI for imported evidence should make these facts visible:

- The user chooses a local source and confirms import after preview.
- MyAgentTool shows a redaction preview before retaining imported content.
- Imported evidence is labeled `imported_after_the_fact`.
- Imported evidence may supplement a managed audit record, but must not be
  promoted to a managed session unless MyAgentTool controlled the launch path.
- Private Codex session files should not be read silently. Prefer stable Codex
  JSONL output, hook events, and platform-owned metadata as primary records.

## State Copy

Prefer user-facing language:

```text
task                  not invocation
computer or device    not bridge target
activity              not trace
safety review         not policy evaluation
cost estimate         not economic ledger
queued                waiting for the computer or agent
running               the agent is working locally
cancelling            stop request sent
succeeded             result returned
failed                the task could not finish
```

When showing Codex CLI behavior, be explicit that MyAgentTool records evidence
and dispatches through the Desktop Bridge, while Codex CLI owns its native
repository permissions, sandbox, and approval controls.

## Safety And Governance UI

Every run path should make these visible before or during execution:

- What will run.
- Where it will run.
- What data may be read, written, uploaded, or retained.
- Whether cost is known, unknown, free, or external.
- Whether cancellation is supported or best-effort.
- Whether local approval or external tool approval is required.
- Where audit evidence will be recorded.

Do not hide unknowns. Unknown cost, unknown data access, and best-effort
cancellation are product facts, not edge cases.

## Responsive And Overflow Rules

- No horizontal page overflow.
- Long words, paths, command lines, task text, logs, and IDs must wrap,
  truncate, or live in scrollable expert areas.
- Fixed-format UI elements should have stable dimensions so state changes do
  not cause jumpy layout.
- Mobile layout must remain a usable linear workflow.

## Visual QA

Before closing product-facing Web Console changes, inspect:

- Desktop around `1366 x 768`.
- Mobile around `390 x 844`.
- Empty state.
- Running state.
- Succeeded state.
- Failed or approval-required state when touched by the change.
- Server-offline or disconnected state when connection UI changes.

Confirm:

- Task input, computer, agent, safety, data, cost, activity, result, and audit
  are visible in the main workflow.
- Primary controls remain reachable.
- Technical IDs do not dominate.
- Long content does not overflow.
- The UI still matches the calm command-center tone.

## Change Rule

For any non-trivial frontend change:

1. Read this file first.
2. Check `docs/design/MYAGENTTOOL_DESIGN.md` for product intent.
3. Keep runtime implementation in `apps/web`.
4. Update this file when introducing a new reusable UI pattern, token, state,
   or copy convention.
5. Record visual QA evidence in the PR or handoff.
