# Idea to Outcome

myagenttool should help users turn an idea into a working result without
requiring them to understand agent engineering.

The user may know what they want:

```text
I want to summarize these files.
I want to build a small tool.
I want to clean up this folder.
I want to connect this agent I already have.
I want to run my coding assistant on another computer.
```

They should not need to know:

- Which adapter type to choose.
- Which protocol is involved.
- Which device is online.
- Which agent capability tag applies.
- How queue, cancellation, tracing, or audit works.
- How AI usage, cost, revenue, or retention records are modeled.

## Product Promise

```text
Tell the product what you want to accomplish. The product helps clarify the
goal, proposes a safe plan, picks or connects the right agent, runs the work,
and shows what happened.
```

This repository still does not implement business agents. It implements the
control, guidance, and execution path around existing agents.

## Core Flow

```text
idea -> clarify -> plan -> select or connect agent -> review risk/cost/data ->
run -> observe -> finish -> explain result -> next step
```

### 1. Idea

The user expresses an outcome in plain language.

Examples:

- "Make a README for this project."
- "Run my local coding agent against this repo."
- "Find an agent that can inspect this folder."
- "Connect my research-agent command."
- "Stop anything running on my laptop."

### 2. Clarify

The product asks only the questions needed to make the request actionable.

Good clarification questions:

- Which device should do this?
- Which folder or data should the agent use?
- Should this only read files, or may it edit files?
- Is spending money allowed?
- Should outputs or logs be retained?

Bad clarification questions:

- Which transport protocol should this use?
- Which queue state should this enter?
- Which internal capability enum applies?
- Which ledger source type should be used?

### 3. Plan

The product turns the idea into a proposed plan.

The plan should include:

- Plain-language task summary.
- Proposed device.
- Proposed agent or agent search.
- Required permissions.
- Risk summary.
- Estimated cost or unknown-cost warning.
- Data access and retention summary.
- Cancellation behavior.
- Expected result.

### 4. Select or Connect Agent

If a suitable agent already exists, the product recommends it.

If no suitable agent exists, the product can guide the user to:

- Register an existing CLI or HTTP agent.
- Discover a local agent.
- Generate an adapter config through Integration Builder.
- Install or update an approved agent in later milestones.

The user should not have to know the difference between these paths upfront.

### 5. Review

Before execution, the product shows a short confirmation:

```text
This will run "Local Codex" on "Workstation".
It may read and edit files in D:\github\example.
Estimated cost: unknown.
Logs and final output will be stored.
You can cancel, but cancellation may be best-effort.
```

High-risk, destructive, budget-spending, credential-using, or generated-code
actions require explicit approval.

### 6. Run

The platform creates the invocation, handles delivery, watches status, and
streams events. These details should be available, but not required for normal
use.

### 7. Observe

The default progress view should answer:

- Is it waiting, running, done, failed, cancelled, or offline?
- What is happening now?
- Can I stop it?
- Is there anything I need to approve?

Advanced users can open logs, traces, state transitions, and raw events.

### 8. Finish

The final result should include:

- Output or artifact.
- Plain-language summary.
- Whether anything changed.
- Whether any cost was recorded.
- Where logs and artifacts were stored.
- What to do next.

### 9. Next Step

The product should help the user continue:

- Run again.
- Retry with changes.
- Save as a repeatable task.
- Connect a better agent.
- Fix a failed integration.
- Export or delete related data.

## Idea Session

An `IdeaSession` can group the user's intent, plan, invocations, generated
artifacts, approvals, results, and follow-up actions.

Recommended fields:

```text
id
workspaceId
createdBy
title
originalIntent
clarifiedIntent
status
selectedDeviceId
selectedAgentId
planSummary
riskSummary
costSummary
dataSummary
invocationIds
artifactIds
approvalIds
createdAt
updatedAt
```

Supported statuses:

```text
draft
clarifying
planned
needs_agent
needs_approval
running
completed
failed
cancelled
archived
```

M0 does not need a full `IdeaSession` database model. It can start with an
invocation form that captures a task description and presents a plain-language
review.

## Relationship to Existing Documents

- Agent Registry answers: what agents exist?
- Agent Gateway answers: how do we call them?
- Local Bridge answers: how does local execution happen safely?
- State Machine answers: what is the technical status?
- Economic Ledger answers: what cost or revenue happened?
- User Experience answers: how does the user understand it?
- Idea to Outcome answers: how does a user get from intent to result?

## Milestone Boundary

### M0

M0 should support:

- A plain-language task field.
- A guided selection of one registered device and agent.
- A pre-run review of device, agent, risk, cost, data handling, and cancellation.
- A result view that explains success, failure, cancellation, offline, or queued
  status without requiring internal terminology.

### M1

M1 should support:

- Suggested agents based on capability and device availability.
- Guided discovery when no suitable agent is registered.
- Troubleshooting explanations for failed invocations.
- Saved task drafts or recent task reuse.

### M2

M2 should support:

- Intent-to-integration when no suitable agent exists.
- Generated connection plans for unsupported agents.
- Plain-language review of generated config, tests, risk, retention, and cost.
- A platform agent that helps clarify intent and propose safe next steps.

### M3

M3 should support:

- Guided install, update, or lifecycle action when a needed agent is missing or
  outdated.
- Repeatable task templates.
- Billing, chargeback, and settlement explanations tied to user outcomes.
- Organization-approved paths for common idea-to-outcome workflows.

## Acceptance Gates

- The user can start from "what I want" instead of "which agent/protocol/config I
  need".
- The product asks only necessary clarifying questions.
- The product recommends a safe path and explains tradeoffs.
- The user can approve, run, cancel, and understand the result.
- Advanced implementation details are available but not required.
- If the product cannot proceed, it explains what is missing and how to fix it.
