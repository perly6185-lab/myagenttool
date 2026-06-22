# Agent Workspace IA

This document defines the Orca-inspired Agent Workspace direction for
MyAgentTool. It borrows interaction organization, not product identity or
runtime implementation.

## Purpose

MyAgentTool needs a workspace model that keeps high-frequency task execution
clear while still making advanced agent, terminal, evidence, approval, and
setup workflows findable.

This is the UI/IA line. Runtime terminal, PTY, SSH, and remote relay work is
tracked separately by #144-#150.

## Borrowed Patterns

| Pattern | Borrow | MyAgentTool Use |
| --- | --- | --- |
| Workspace shell | Yes | One task/session owns a bounded workspace with context. |
| Tabs or panes | Yes | Run, Session, Diff, Terminal, Evidence, Approval, Setup surfaces. |
| Terminal as surface | Yes | Terminal is an advanced/session surface, not task composer content. |
| Setup surface | Yes | Connect Agent, runtime setup, and SSH setup belong outside the task flow. |
| Context side rail | Yes | Current device, agent, repo, session, policy, attention, and evidence summary. |
| Split pane density | Limited | Use only after role/task fit is proven; avoid dense first-screen IDE feel. |
| Exact visual style | No | Keep MyAgentTool's calm command-center design system. |
| Unmanaged terminal freedom | No | Terminal UI must attach only to managed runtime sessions. |

## Role Mapping

| Role | Primary Job | Primary Workspace Surface | Secondary Surface |
| --- | --- | --- | --- |
| Ordinary developer | Run a task and understand result | Run | Result summary, compact session context |
| Advanced developer | Manage session, diff, terminal, continuation | Session, Diff, Terminal | Run |
| Team administrator | Approve risk and configure runtime/agents | Approval, Setup | Context rail |
| Auditor | Trace managed evidence and export proof | Evidence | Session |

## Workspace Surfaces

| Surface | Frequency | Owner | Contains | Must Not Contain |
| --- | --- | --- | --- | --- |
| Run | High | Ordinary developer | task input, computer, agent, session mode, safety/data/cost/cancel, run/cancel, result summary | raw terminal, raw JSONL, hooks, imported evidence workflow, integration builder, full turns |
| Session | Medium | Advanced developer | managed session summary, turns, continuation guidance, approval/evidence counts | private Codex files, integration setup |
| Diff | Medium | Advanced developer | changed files, review state, accept/reject/feedback placeholder | raw event flood |
| Terminal | Medium | Advanced developer | terminal placeholder or managed terminal attach, shell/cwd/policy summary | unmanaged terminal as managed proof, ordinary task input |
| Evidence | Low critical | Auditor | managed/imported distinction, filters, export summary | imported evidence promoted as managed proof, unredacted secrets |
| Approval | Low critical | Team administrator | pending requests, risk, timeout, approve/deny consequences | unclear allow buttons, raw policy internals as primary copy |
| Setup | Low critical | Team administrator | Connect Agent, runtime setup, SSH target setup placeholders | auto-enabled integrations, private keys |

## Layout Model

Desktop:

```text
Top context bar:
  device / repo / branch / agent / session / policy status

Left workspace nav:
  Run
  Session
  Diff
  Terminal
  Evidence
  Approval
  Setup

Center surface:
  active surface content

Right context rail:
  selected session
  needs attention
  evidence summary
  policy facts
```

Mobile:

```text
Run first
-> current status/result
-> compact session summary
-> surface switcher
-> selected advanced surface
```

## Default First Screen

The default first screen remains task-first:

1. Task input.
2. Computer and agent.
3. Session mode when relevant.
4. Safety, data, cost, and cancellation review.
5. Run/cancel.
6. Current status/result.
7. Compact context rail summary.

The first screen must not become a general IDE dashboard.

## Surface Rules

- Run is the only high-frequency surface.
- Terminal must be a surface, never an inline section of task composer.
- Evidence Center is a surface and/or right-rail entry, never a task input
  control.
- Setup owns Connect Agent and runtime configuration.
- Approval has its own attention surface. Task status may show that approval is
  needed, but the task composer does not become an approval inbox.
- Session owns full turns and follow-up. Run may show only compact continuation
  controls.

## Product Flow Acceptance

Findable:

- Ordinary developer finds task input and run action first.
- Advanced developer finds Session, Diff, and Terminal surfaces.
- Administrator finds Approval and Setup.
- Auditor finds Evidence.

Understandable:

- Each surface states its current role, session, repo/device context, and next
  action.
- Terminal placeholder clearly says runtime is not connected until #144-#150.

Actionable:

- Run/cancel, approve/deny, continue, review diff, export summary, and setup
  actions describe consequences.

Traceable:

- Evidence and session surfaces link to managed session registry and distinguish
  managed evidence from imported evidence.

## What Not To Borrow

- Do not make dense terminal/editor workspace the default for ordinary users.
- Do not hide MyAgentTool approval/evidence behind terminal output.
- Do not treat unmanaged SSH or terminal output as managed proof.
- Do not introduce split panes until the selected role task needs them.
- Do not copy Orca's visual identity, only its workspace organization ideas.

## Prototype Requirements

Phase B must produce:

- ASCII prototype.
- Prototype Canvas scene graph.
- Editable canvas preview.
- Standalone HTML export.
- Visual QA checklist.

The prototype must cover:

- empty/ready Run surface
- running state
- approval needed
- succeeded with changes
- Session detail
- Diff placeholder
- Terminal placeholder
- Evidence placeholder
- Approval placeholder
- Setup placeholder
- mobile task-first layout

## Runtime Join

The Terminal surface is a placeholder until #157 defines the join contract and
#145-#150 implement managed runtime protocols. The UI may show unavailable or
blocked states, but it must not imply unmanaged shell access is governed.
