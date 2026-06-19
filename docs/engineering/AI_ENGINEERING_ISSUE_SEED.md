# AI Engineering Issue Seed

This document records the first AI-assisted engineering execution issues.

These issues extend M0 beyond product vision into a repeatable development
operating system.

## Imported Issues

Current GitHub range:

```text
#19 [Epic]: M0 AI Development Workflow Bootstrap
#20 [Task]: M0 Issue Hygiene Automation
#21 [Task]: M0 Project Field Sync Script
#22 [Task]: M0 Local Engineering Scripts Baseline
#23 [ADR]: Local Development Stack and Monorepo Tooling for M0
#24 [Task]: M0 Repository Scaffold
#25 [Task]: M0 Shared Protocol Package Skeleton
#26 [Task]: M0 Server Skeleton
#27 [Task]: M0 Web Console Skeleton
#28 [Task]: M0 Desktop Bridge Skeleton
#29 [Task]: M0 Demo CLI Agent
#30 [Task]: M0 Local Invocation Smoke Test
```

## Issue Details

### Epic: M0 AI Development Workflow Bootstrap

Type: epic
Milestone: M0
Area: docs
Risk: medium
Acceptance: defined
Platform: all
Agent Target: platform
Source doc: `docs/engineering/AI_DEVELOPMENT_WORKFLOW.md`

Outcome:

```text
AI and human contributors can start M0 work from a consistent workflow:
project context, source docs, issue fields, acceptance criteria, approval
boundaries, and verification evidence.
```

### Task: M0 Issue Hygiene Automation

Type: task
Milestone: M0
Area: docs
Risk: medium
Acceptance: defined
Platform: server
Agent Target: platform
Source doc: `docs/engineering/AUTOMATION_PLAN.md`

Acceptance:

- Open issues are checked for required milestone and labels.
- Issues moving to `ready` are checked for acceptance criteria.
- The first M0 version reports problems without mutating GitHub state by
  default.

### Task: M0 Project Field Sync Script

Type: task
Milestone: M0
Area: docs
Risk: medium
Acceptance: defined
Platform: server
Agent Target: platform
Source doc: `docs/engineering/AUTOMATION_PLAN.md`

Acceptance:

- Parse `## Project Fields` from issue bodies.
- Update GitHub Project fields.
- Warn when labels and Project fields disagree.
- Run safely more than once.

### Task: M0 Local Engineering Scripts Baseline

Type: task
Milestone: M0
Area: docs
Risk: low
Acceptance: defined
Platform: all
Agent Target: platform
Source doc: `docs/engineering/LOCAL_DEV_ENV.md`

Acceptance:

- A local docs link checker exists.
- A basic repository health script exists or is specified.
- Scripts avoid production credentials.
- Scripts do not mutate GitHub state by default.

### ADR: Local Development Stack and Monorepo Tooling for M0

Type: adr
Milestone: M0
Area: cross-cutting
Risk: high
Acceptance: not defined
Platform: all
Agent Target: platform
Source doc: `docs/engineering/LOCAL_DEV_ENV.md`

Accepted decision:

```text
Use a TypeScript monorepo with pnpm workspaces for M0.
```

Decision record:

- `docs/engineering/ADR_0001_LOCAL_DEV_STACK.md`

Decision needed:

```text
Choose the initial local development stack and monorepo tooling path for Web
Console, Server, Desktop Bridge, shared protocol packages, and adapter packages.
```

Proposed default:

```text
Prefer a TypeScript monorepo with workspace packages unless M0 investigation
finds a stronger reason to split stacks.
```

## Suggested Next Split

After #23 is decided, create implementation issues for:

- Repository scaffold.
- Shared protocol package.
- Server skeleton.
- Web console skeleton.
- Desktop Bridge skeleton.
- Demo CLI agent.
- Local invocation smoke test.

These were imported as #24 through #30.

## Scaffold Implementation Issues

### Task: M0 Repository Scaffold

Type: task
Milestone: M0
Area: cross-cutting
Risk: medium
Acceptance: defined
Platform: all
Agent Target: platform
Source doc: `docs/engineering/ADR_0001_LOCAL_DEV_STACK.md`

Current status:

```text
Implemented locally. GitHub issue can move to review after validation.
```

Acceptance:

- `pnpm-workspace.yaml` exists.
- Root `package.json` defines workspace scripts.
- Root TypeScript configuration exists.
- Planned workspace directories exist.
- Local docs link check still passes.

### Task: M0 Shared Protocol Package Skeleton

Type: task
Milestone: M0
Area: protocol
Risk: high
Acceptance: defined
Platform: all
Agent Target: all
Source doc: `docs/vision/AGENT_PROTOCOL.md`

Current status:

```text
Implemented locally. GitHub issue can move to review after validation.
```

Acceptance:

- `packages/protocol` exists as a workspace package.
- Initial types cover device, agent, invocation, delivery event, cancellation
  event, audit summary, and economics metadata.
- Types align with `STATE_MACHINE.md` and `AGENT_PROTOCOL.md`.
- Typecheck passes.

### Task: M0 Server Skeleton

Type: task
Milestone: M0
Area: server
Risk: high
Acceptance: defined
Platform: server
Agent Target: all
Source doc: `docs/vision/ARCHITECTURE.md`

Acceptance:

- `apps/server` exists as a workspace package.
- Server can start locally with a health endpoint.
- Basic configuration loading exists with `.env.example`.
- Server imports shared protocol types.

### Task: M0 Web Console Skeleton

Type: task
Milestone: M0
Area: web
Risk: medium
Acceptance: defined
Platform: web
Agent Target: all
Source doc: `docs/vision/USER_EXPERIENCE.md`

Acceptance:

- `apps/web` exists as a workspace package.
- Local dev server can start.
- App shell contains M0 workflow areas.
- UI copy is understandable for non-professional users.

### Task: M0 Desktop Bridge Skeleton

Type: task
Milestone: M0
Area: desktop
Risk: high
Acceptance: defined
Platform: all
Agent Target: cli
Source doc: `docs/vision/PLATFORM_SUPPORT.md`

Acceptance:

- `apps/desktop` exists as a workspace package.
- CLI entry point can start locally.
- Process execution is not enabled for arbitrary commands by default.
- Desktop imports shared protocol types.

### Task: M0 Demo CLI Agent

Type: task
Milestone: M0
Area: desktop
Risk: low
Acceptance: defined
Platform: all
Agent Target: cli
Source doc: `docs/engineering/LOCAL_DEV_ENV.md`

Acceptance:

- Demo agent accepts a plain text task.
- Demo agent emits progress lines.
- Demo agent can sleep long enough to test cancellation.
- Demo agent returns a structured result.
- Demo agent does not access user files by default.

### Task: M0 Local Invocation Smoke Test

Type: task
Milestone: M0
Area: cross-cutting
Risk: high
Acceptance: defined
Platform: all
Agent Target: cli
Source doc: `docs/vision/ACCEPTANCE_CRITERIA.md`

Acceptance:

- A documented local command runs the demo invocation path.
- Smoke test records invocation id, device id, agent id, status, logs, result,
  and audit summary placeholder.
- Test does not require production credentials.
- Test does not run arbitrary user commands.
