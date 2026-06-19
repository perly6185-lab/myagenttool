# MyAgentTool Design Contract

This document defines the M0 product experience direction for MyAgentTool.

It should guide human designers, open-design prototypes, and Codex
implementation work.

## Product Promise

MyAgentTool helps a person safely ask their own computer to run an agent and
understand what happened.

The product should feel like a calm task command center, not a developer demo.

## Primary User

M0 prioritizes non-professional users:

- They know what outcome they want.
- They may not know what an agent, bridge, invocation, protocol, audit, or
  queue means.
- They need confidence before allowing local execution.
- They need plain-language progress and results.

Professional users are secondary in M0. They can see more detail, but expert
controls should not dominate the first screen.

## First Screen

The first screen must be the actual task workspace.

It should answer, without explanation text blocks:

- What do I want done?
- Which device will do it?
- Which agent will run?
- Is it safe, costly, or data-sensitive?
- What is happening now?
- What result came back?

Do not build a marketing landing page for M0.

## Information Hierarchy

Use this priority order:

1. Task intent input.
2. Device and agent readiness.
3. Pre-run review: safety, data, cost, cancellation.
4. Run status and progress.
5. Result summary.
6. Audit and trace details.
7. Technical metadata.

Technical identifiers should be visible only where useful for debugging.

## Core Layout

Desktop layout:

- Left or top command area for task input and run controls.
- Primary center area for status, progress timeline, and result.
- Secondary right or lower area for device, agent, safety, cost, and audit.
- Avoid nested cards.
- Avoid decorative dashboard clutter.

Mobile layout:

- Single-column workflow.
- Task input first.
- Device/agent readiness second.
- Run/review controls remain reachable.
- Logs and audit details can collapse behind clear controls.

## Visual Tone

The interface should feel:

- Calm.
- Reliable.
- Helpful.
- Operational.
- Human-readable.

Avoid:

- One-color monochrome themes.
- Purple-heavy gradient dashboards.
- Oversized hero sections.
- Dense developer console first impressions.
- Decorative cards that do not support the task.

## State Model In UI

Represent these states clearly:

| State | User meaning |
| --- | --- |
| No device | Connect a computer before running tasks |
| Device online | This computer can receive work |
| Agent ready | This capability can run now |
| Queued | Waiting for the computer or agent |
| Running | The agent is working locally |
| Cancelling | Stop request sent |
| Succeeded | Result returned |
| Failed | The task could not finish |
| Offline | Task can be saved and delivered when device returns |

Use user-facing state names in the UI. Keep protocol state names in developer
details.

## Copy Rules

Prefer:

- "Task" over "invocation".
- "Computer" or "device" over "bridge target".
- "Agent" only when it is clearly a selectable capability.
- "Activity" or "timeline" over "trace".
- "Safety review" over "policy evaluation".
- "Cost estimate" over "economic ledger".

Every action button should make the consequence clear:

- Run on this computer.
- Cancel task.
- Review details.
- Copy result.

## Required Panels

M0 web console should include:

- Task composer.
- Device selector.
- Agent selector or selected demo agent summary.
- Safety and data review.
- Cost summary.
- Run timeline.
- Result summary.
- Audit details.

Panels can be compact, but they must exist in the main workflow.

## Visual QA Acceptance

Before claiming M0 UI acceptance:

- Desktop viewport screenshot shows task input, selected device, agent,
  progress, and result without scrolling on a common laptop viewport.
- Mobile viewport screenshot shows a clear linear workflow.
- Long task text does not overflow.
- Logs do not push primary controls off screen unexpectedly.
- Safety, cost, and audit information are visible before or after run.
- The page still works when no device is online.

## Open Design Usage

Open-design may generate:

- Web console prototypes.
- Alternate layouts for the task workspace.
- Visual language explorations.
- State diagrams or product walkthroughs.

Generated design output must be reviewed before implementation. The final
runtime implementation lives in this repository.
