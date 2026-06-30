# Prototype Canvas Visual QA Checklist

Generated: 2026-06-21T08:12:01.580Z
Source scene: docs/design/prototypes/canvas/agent-workspace.imported.scene.json
Exported HTML: docs/design/prototypes/canvas/agent-workspace.export.html

## Product Flow

- Role flow: ordinary developer, advanced developer, team administrator, auditor
- Scenario: navigate a managed agent workspace without mixing task input, session supervision, runtime terminal, evidence, approval, or setup concerns
- Frequency: high for Run, medium for Session/Diff/Terminal, low but critical for Evidence/Approval/Setup
- Owner surface: Agent Workspace shell with Run-first center surface and contextual right rail
- Usability task: Review the Run-first workspace shell and confirm advanced surfaces stay separated.

## Viewports

- [ ] desktop: 1366 x 768
- [ ] mobile: 390 x 844

## Surface Checks

### Run Workspace

- [ ] Confirm Run Workspace is findable for ordinary developer.
- [ ] Confirm states are represented: ready, running, approval_needed, succeeded_with_changes.
- [ ] Confirm owner surface remains Run-first Agent Workspace shell.
- [ ] Confirm Findable: Run is the default active surface.
- [ ] Confirm Understandable: task, status, and context rail are separated.
- [ ] Confirm Actionable: run, cancel, approve/deny, review diff, and open session appear only when relevant.
- [ ] Confirm Traceable: session and evidence summaries are reachable from the context rail.

#### Workspace Navigation

- [ ] Confirm Workspace Navigation appears only in Left workspace navigation.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "raw terminal" is not shown in Workspace Navigation.
- [ ] Confirm "raw JSONL" is not shown in Workspace Navigation.
- [ ] Confirm "approval inbox content" is not shown in Workspace Navigation.
- [ ] Confirm "private keys" is not shown in Workspace Navigation.

#### Run Task Composer

- [ ] Confirm Run Task Composer appears only in Run surface.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "raw terminal" is not shown in Run Task Composer.
- [ ] Confirm "raw JSONL" is not shown in Run Task Composer.
- [ ] Confirm "hook names" is not shown in Run Task Composer.
- [ ] Confirm "imported evidence workflow" is not shown in Run Task Composer.
- [ ] Confirm "integration builder" is not shown in Run Task Composer.
- [ ] Confirm "full session turns" is not shown in Run Task Composer.
- [ ] Confirm "approval inbox" is not shown in Run Task Composer.
- [ ] Confirm "private Codex files" is not shown in Run Task Composer.

#### Run Status And Result

- [ ] Confirm Run Status And Result appears only in Run surface.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "raw terminal stream" is not shown in Run Status And Result.
- [ ] Confirm "raw JSONL" is not shown in Run Status And Result.
- [ ] Confirm "hook names" is not shown in Run Status And Result.
- [ ] Confirm "private Codex files" is not shown in Run Status And Result.

#### Workspace Context Rail

- [ ] Confirm Workspace Context Rail appears only in Right context rail.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "raw JSONL" is not shown in Workspace Context Rail.
- [ ] Confirm "hook names" is not shown in Workspace Context Rail.
- [ ] Confirm "unfiltered evidence registry" is not shown in Workspace Context Rail.
- [ ] Confirm "private Codex files" is not shown in Workspace Context Rail.

### Session Surface

- [ ] Confirm Session Surface is findable for advanced developer.
- [ ] Confirm states are represented: no_session, running_session, completed_session, continuation_guidance.
- [ ] Confirm owner surface remains Session workspace surface.
- [ ] Confirm Findable: Session Surface is reachable from workspace navigation.
- [ ] Confirm Understandable: Session Surface states are distinct from Run.
- [ ] Confirm Actionable: Session Surface exposes only role-relevant actions.
- [ ] Confirm Traceable: Session Surface preserves managed session context where relevant.

#### Session Surface

- [ ] Confirm Session Surface appears only in Session workspace surface.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "private Codex files" is not shown in Session Surface.
- [ ] Confirm "integration setup controls" is not shown in Session Surface.
- [ ] Confirm "imported evidence as managed proof" is not shown in Session Surface.

#### Session Surface Context

- [ ] Confirm Session Surface Context appears only in Session workspace surface context rail.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "private Codex files" is not shown in Session Surface Context.
- [ ] Confirm "integration setup controls" is not shown in Session Surface Context.
- [ ] Confirm "imported evidence as managed proof" is not shown in Session Surface Context.

### Diff Surface

- [ ] Confirm Diff Surface is findable for advanced developer.
- [ ] Confirm states are represented: diff_review, review_pending, changes_requested.
- [ ] Confirm owner surface remains Diff workspace surface.
- [ ] Confirm Findable: Diff Surface is reachable from workspace navigation.
- [ ] Confirm Understandable: Diff Surface states are distinct from Run.
- [ ] Confirm Actionable: Diff Surface exposes only role-relevant actions.
- [ ] Confirm Traceable: Diff Surface preserves managed session context where relevant.

#### Diff Surface

- [ ] Confirm Diff Surface appears only in Diff workspace surface.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "raw event flood" is not shown in Diff Surface.
- [ ] Confirm "approval inbox" is not shown in Diff Surface.
- [ ] Confirm "integration setup controls" is not shown in Diff Surface.

#### Diff Surface Context

- [ ] Confirm Diff Surface Context appears only in Diff workspace surface context rail.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "raw event flood" is not shown in Diff Surface Context.
- [ ] Confirm "approval inbox" is not shown in Diff Surface Context.
- [ ] Confirm "integration setup controls" is not shown in Diff Surface Context.

### Terminal Surface Placeholder

- [ ] Confirm Terminal Surface Placeholder is findable for advanced developer.
- [ ] Confirm states are represented: runtime_not_connected, managed_pty_pending, ssh_pending.
- [ ] Confirm owner surface remains Terminal workspace surface.
- [ ] Confirm Findable: Terminal Surface Placeholder is reachable from workspace navigation.
- [ ] Confirm Understandable: Terminal Surface Placeholder states are distinct from Run.
- [ ] Confirm Actionable: Terminal Surface Placeholder exposes only role-relevant actions.
- [ ] Confirm Traceable: Terminal Surface Placeholder preserves managed session context where relevant.

#### Terminal Surface Placeholder

- [ ] Confirm Terminal Surface Placeholder appears only in Terminal workspace surface.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "raw local terminal as managed evidence" is not shown in Terminal Surface Placeholder.
- [ ] Confirm "unmanaged shell access" is not shown in Terminal Surface Placeholder.
- [ ] Confirm "private keys" is not shown in Terminal Surface Placeholder.

#### Terminal Surface Placeholder Context

- [ ] Confirm Terminal Surface Placeholder Context appears only in Terminal workspace surface context rail.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "raw local terminal as managed evidence" is not shown in Terminal Surface Placeholder Context.
- [ ] Confirm "unmanaged shell access" is not shown in Terminal Surface Placeholder Context.
- [ ] Confirm "private keys" is not shown in Terminal Surface Placeholder Context.

### Evidence Surface

- [ ] Confirm Evidence Surface is findable for auditor.
- [ ] Confirm states are represented: managed_jsonl_evidence, approval_evidence, file_change, imported_evidence, export_summary.
- [ ] Confirm owner surface remains Evidence workspace surface.
- [ ] Confirm Findable: Evidence Surface is reachable from workspace navigation.
- [ ] Confirm Understandable: Evidence Surface states are distinct from Run.
- [ ] Confirm Actionable: Evidence Surface exposes only role-relevant actions.
- [ ] Confirm Traceable: Evidence Surface preserves managed session context where relevant.

#### Evidence Surface

- [ ] Confirm Evidence Surface appears only in Evidence workspace surface.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "unredacted secrets" is not shown in Evidence Surface.
- [ ] Confirm "imported evidence as managed proof" is not shown in Evidence Surface.
- [ ] Confirm "private Codex auth files" is not shown in Evidence Surface.

#### Evidence Surface Context

- [ ] Confirm Evidence Surface Context appears only in Evidence workspace surface context rail.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "unredacted secrets" is not shown in Evidence Surface Context.
- [ ] Confirm "imported evidence as managed proof" is not shown in Evidence Surface Context.
- [ ] Confirm "private Codex auth files" is not shown in Evidence Surface Context.

### Approval Surface

- [ ] Confirm Approval Surface is findable for team administrator.
- [ ] Confirm states are represented: approval_pending, approval_approved, approval_denied, approval_timed_out.
- [ ] Confirm owner surface remains Approval workspace surface.
- [ ] Confirm Findable: Approval Surface is reachable from workspace navigation.
- [ ] Confirm Understandable: Approval Surface states are distinct from Run.
- [ ] Confirm Actionable: Approval Surface exposes only role-relevant actions.
- [ ] Confirm Traceable: Approval Surface preserves managed session context where relevant.

#### Approval Surface

- [ ] Confirm Approval Surface appears only in Approval workspace surface.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "unclear allow buttons" is not shown in Approval Surface.
- [ ] Confirm "raw policy internals as primary copy" is not shown in Approval Surface.
- [ ] Confirm "approval inbox inside task composer" is not shown in Approval Surface.

#### Approval Surface Context

- [ ] Confirm Approval Surface Context appears only in Approval workspace surface context rail.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "unclear allow buttons" is not shown in Approval Surface Context.
- [ ] Confirm "raw policy internals as primary copy" is not shown in Approval Surface Context.
- [ ] Confirm "approval inbox inside task composer" is not shown in Approval Surface Context.

### Setup Surface

- [ ] Confirm Setup Surface is findable for team administrator.
- [ ] Confirm states are represented: discovery_empty, candidate_found, integration_artifact_needs_review, ssh_placeholder.
- [ ] Confirm owner surface remains Setup workspace surface.
- [ ] Confirm Findable: Setup Surface is reachable from workspace navigation.
- [ ] Confirm Understandable: Setup Surface states are distinct from Run.
- [ ] Confirm Actionable: Setup Surface exposes only role-relevant actions.
- [ ] Confirm Traceable: Setup Surface preserves managed session context where relevant.

#### Setup Surface

- [ ] Confirm Setup Surface appears only in Setup workspace surface.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "auto-enabled agents" is not shown in Setup Surface.
- [ ] Confirm "private keys" is not shown in Setup Surface.
- [ ] Confirm "unreviewed integrations as runnable agents" is not shown in Setup Surface.

#### Setup Surface Context

- [ ] Confirm Setup Surface Context appears only in Setup workspace surface context rail.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "auto-enabled agents" is not shown in Setup Surface Context.
- [ ] Confirm "private keys" is not shown in Setup Surface Context.
- [ ] Confirm "unreviewed integrations as runnable agents" is not shown in Setup Surface Context.

### Mobile Task-First Layout

- [ ] Confirm Mobile Task-First Layout is findable for ordinary developer.
- [ ] Confirm states are represented: mobile_ready, mobile_running, mobile_surface_switcher.
- [ ] Confirm owner surface remains Mobile Agent Workspace.
- [ ] Confirm Findable: Run appears first on mobile.
- [ ] Confirm Understandable: status and session summary follow Run.
- [ ] Confirm Actionable: More exposes advanced surfaces after the primary task flow.

#### Mobile Run Stack

- [ ] Confirm Mobile Run Stack appears only in Mobile Run surface.
- [ ] Confirm labels are understandable without raw implementation terms.
- [ ] Confirm "raw terminal" is not shown in Mobile Run Stack.
- [ ] Confirm "raw JSONL" is not shown in Mobile Run Stack.
- [ ] Confirm "hook names" is not shown in Mobile Run Stack.
- [ ] Confirm "imported evidence workflow" is not shown in Mobile Run Stack.
- [ ] Confirm "setup controls in Run composer" is not shown in Mobile Run Stack.
