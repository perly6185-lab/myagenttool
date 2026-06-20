# M1 Issue Plan

This document plans the M1 Local Agent Management issue tree and recommended
development order.

## M1 Goal

Users can discover, enable, disable, and health-check local agents with
plain-language guidance and local approval for high-risk actions.

## Issue Tree

| Order | Issue | Scope | First-batch? |
| --- | --- | --- | --- |
| 1 | #76 M1 Local Agent Management | Initiative for the milestone outcome | No |
| 2 | #77 Conservative Local Agent Discovery | Discover known commands/endpoints without broad OS scanning | No |
| 3 | #78 Agent Enable / Disable | Registry state blocks new invocations and records audit | Yes |
| 4 | #79 Agent Health Check | Bridge/server can run and display basic health checks | Yes |
| 5 | #80 Web Agent Management States | Web Console shows disabled and health state clearly | Yes |
| 6 | #81 Capability Risk Tags And Local Approval | High-risk tags can require local approval before run | No |
| 7 | #82 Invocation Troubleshooter Platform Agent | First platform agent summarizes failed invocations | No |
| 8 | #83 M1 Usage And Cost Owner Metadata | Usage counts and cost owner metadata for agents | No |

## Recommended Development Order

### Batch 1

Implement the smallest M1 product slice:

- Agent disable/enable registry state.
- Health check endpoint and bridge response for registered agents.
- Web Console disabled/health state display.
- Smoke checks for disabled agent blocked and health check visible.

This batch should close the enable/disable, health-check, and web-state issues.

### Batch 2

Add conservative discovery:

- Known command allowlist.
- Known local HTTP endpoints.
- User-provided paths or endpoints.
- Discovery candidates visible but not auto-enabled.

### Batch 3

Add policy and approval:

- Capability risk tags surfaced in UI.
- Local approval required for high-risk invocation.
- Approval/audit events and refusal path.

### Batch 4

Add platform assistance and usage:

- Invocation troubleshooter platform agent.
- Usage counts by agent and invocation.
- Cost owner metadata.

## M1 Non-Goals

- Silent installation or uninstall.
- Full-system aggressive discovery.
- Production billing.
- MCP/A2A/container adapters.
- Full enterprise approval queues.

## Verification Baseline

Every M1 batch should run:

```text
pnpm docs:check
pnpm repo:check
pnpm typecheck
pnpm test
pnpm smoke:local
git diff --check
```

Desktop/local execution changes must also preserve the CI `desktop-smoke`
matrix on Ubuntu, macOS, and Windows.
