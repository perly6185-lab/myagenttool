# Codex Agent Pilot

This document defines the four-stage Codex agent pilot before M3. It exists
because the demo CLI agent proves the local invocation loop, but it does not
represent a real coding agent with repository context, approval boundaries,
longer output, cancellation, and evidence needs.

## Source Basis

- Local product behavior: M0 remote invocation, M1 local agent management, and
  M2 Integration Builder closeout.
- Codex product behavior: Codex CLI non-interactive mode uses `codex exec`,
  supports explicit sandbox settings, and can emit JSONL events for machine
  consumption.

## Stage 1: M0-M2 Readiness Audit

Goal:

```text
Confirm the existing product slice can host a real Codex CLI pilot without
weakening M0, M1, or M2 safety boundaries.
```

Acceptance:

- M0 still owns durable local invocation, logs, result, cancellation, trace, and
  audit.
- M1 still owns conservative discovery, disabled registration, enable/disable,
  health check, and local approval for high-risk capabilities.
- M2 still owns reviewable adapter config, probe, disabled registration, and
  no automatic enablement.
- Codex CLI is treated as a high-risk local CLI, but its repository permission,
  sandbox, and approval behavior remain native to Codex CLI.
- The default Codex CLI entry is an exception to generic disabled-registration
  gates because it represents a CLI already installed and authenticated by the
  local user.

## Stage 2: Codex Discovery And Adapter Config

Goal:

```text
An explicitly supplied Codex CLI command can become a reviewable, high-risk
adapter config.
```

Acceptance:

- Discovery only surfaces Codex when the user supplies `codex` or an explicit
  Codex command path.
- Codex candidates are marked high risk with shell execution, repository read,
  repository write, and network risk tags.
- Generated adapter config uses `codex exec` in non-interactive mode, JSONL
  output, no shell wrapper, and no MyAgentTool sandbox override.
- Generated non-Codex artifacts remain reviewable and disabled until explicit
  action.

## Stage 3: Probe, Registration, And Enable Flow

Goal:

```text
Codex adapter config can be probed safely and registered as a local agent while
deferring permission control to the installed Codex CLI.
```

Acceptance:

- Probe checks the local Codex CLI surface without running model-proposed
  commands, install scripts, or broad scans.
- Passing probe marks the adapter config tested.
- Registering a tested Codex artifact creates an available Codex agent when the
  Desktop Bridge is online.
- Codex invocation does not add a Web Console approval gate; Codex CLI native
  controls own permissions.

## Stage 4: Real Invocation, Cancellation, And Evidence

Goal:

```text
Run a Codex-shaped local invocation through the same product loop and capture
usable evidence.
```

Acceptance:

- Codex JSONL output is parsed into user-visible logs and a result summary.
- Invocation records adapter evidence, trace, audit, policy decision, and usage.
- Cancellation requests terminate the local process tree and are visible as
  cancellation events.
- A final smoke command proves the pilot path without relying on the simple demo
  CLI agent.

## Non-Goals

- No M3 billing automation.
- No marketplace or extension distribution.
- No automatic install or update.
- No broad filesystem or network scan.
- No MyAgentTool sandbox override for Codex CLI.
