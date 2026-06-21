# Prototype Canvas Visual QA Checklist

Generated: 2026-06-21T03:49:37.159Z
Source scene: docs/design/prototypes/canvas/managed-session-history.imported.scene.json
Exported HTML: docs/design/prototypes/canvas/managed-session-history.export.html

## Product Flow

- Role flow: ordinary developer
- Scenario: find and continue the latest Managed Codex session from the Web Console context rail
- Frequency: high
- Owner surface: right rail: context, history, and governance
- Usability task: Inspect the imported UI structure, verify ownership boundaries, and prepare it for visual editing.

## Viewports

- [ ] desktop: 1366 x 768
- [ ] mobile: 390 x 844

## Surface Checks

### Home Workspace

- [ ] Confirm Home Workspace is findable for ordinary developer.
- [ ] Confirm states are represented: ready, running, approval_needed, succeeded, mobile_stacked.
- [ ] Confirm owner surface remains Home task workspace with right context rail.
- [ ] Confirm Findable: user can find the previous Codex session in the right rail.
- [ ] Confirm Understandable: user can tell whether the session can continue or only be inspected.
- [ ] Confirm Actionable: user can continue, open result, review diff, or cancel with clear consequence.
- [ ] Confirm Traceable: evidence remains reachable from context without dominating the ordinary developer task flow.

#### Current Task Intent

- [ ] Confirm Current Task Intent appears only in Left column: current task intent.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "Evidence Center" is not shown in Current Task Intent.
- [ ] Confirm "Import evidence" is not shown in Current Task Intent.
- [ ] Confirm "raw JSONL" is not shown in Current Task Intent.
- [ ] Confirm "hook names" is not shown in Current Task Intent.
- [ ] Confirm "integration builder" is not shown in Current Task Intent.
- [ ] Confirm "session turns" is not shown in Current Task Intent.
- [ ] Confirm "Add follow-up" is not shown in Current Task Intent.

#### Current Task Execution

- [ ] Confirm Current Task Execution appears only in Middle column: current task execution.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "raw JSONL flood" is not shown in Current Task Execution.
- [ ] Confirm "hook event names before summaries" is not shown in Current Task Execution.
- [ ] Confirm "private Codex session files" is not shown in Current Task Execution.

#### Context, History, Governance

- [ ] Confirm Context, History, Governance appears only in Right rail: context, history, and governance.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "raw JSONL" is not shown in Context, History, Governance.
- [ ] Confirm "hook event names" is not shown in Context, History, Governance.
- [ ] Confirm "unfiltered evidence registry" is not shown in Context, History, Governance.
- [ ] Confirm "private Codex auth files" is not shown in Context, History, Governance.

### Session Detail

- [ ] Confirm Session Detail is findable for advanced developer.
- [ ] Confirm states are represented: session_open, initial_task, follow_up, feedback.
- [ ] Confirm owner surface remains Session detail opened from context rail.
- [ ] Confirm Findable: session detail opens from the right rail.
- [ ] Confirm Understandable: turns are labeled as initial task, follow-up, or feedback.
- [ ] Confirm Actionable: user can send follow-up or attach diff context.
- [ ] Confirm Traceable: follow-ups reuse managed session context and create evidence.

#### Session Turns

- [ ] Confirm Session Turns appears only in Session detail.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "raw JSONL flood" is not shown in Session Turns.
- [ ] Confirm "private Codex session files" is not shown in Session Turns.
- [ ] Confirm "imported evidence as managed proof" is not shown in Session Turns.

#### Add Follow-up

- [ ] Confirm Add Follow-up appears only in Session detail follow-up composer.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "Evidence Center as task input" is not shown in Add Follow-up.
- [ ] Confirm "raw JSONL" is not shown in Add Follow-up.
- [ ] Confirm "hook names" is not shown in Add Follow-up.
- [ ] Confirm "private Codex auth files" is not shown in Add Follow-up.
