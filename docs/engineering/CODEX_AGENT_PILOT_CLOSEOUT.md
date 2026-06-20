# Codex Agent Pilot Closeout

Date: 2026-06-20

The Codex agent pilot validates a real coding-agent-shaped path before M3. The
pilot keeps M0, M1, and M2 boundaries intact while replacing the simple demo CLI
assumption with a Codex-style adapter flow.

## Delivered Stages

### Stage 1: M0-M2 Readiness Audit

- Added `docs/engineering/CODEX_AGENT_PILOT.md`.
- Confirmed the pilot must reuse M0 invocation/audit, M1 discovery/lifecycle, and
  M2 review/probe/disabled-registration gates.
- Added local tooling checks for the four-stage plan and Codex non-interactive
  requirements.

Acceptance evidence:

- `pnpm --filter @myagenttool/tools-dev test`
- `pnpm docs:check`
- `pnpm repo:check`

### Stage 2: Codex Discovery And Adapter Config

- Explicit user-provided `codex` discovery now produces a Codex-specific
  candidate instead of a generic payload-JSON CLI candidate.
- Generated Codex adapter config uses `codex exec`, JSONL output, read-only
  sandbox by default, and no shell wrapper.
- Codex risk tags include repository context and code-change risks.

Acceptance evidence:

- `pnpm --filter @myagenttool/server test`
- `pnpm --filter @myagenttool/desktop test`
- `pnpm smoke:local`

### Stage 3: Probe, Registration, And Enable Flow

- Codex probe uses `codex exec --help` only.
- Probe does not run prompts, install scripts, generated commands, or broad
  scans.
- Passing probe marks the adapter config tested.
- Registering a tested artifact creates a disabled Codex agent.
- Enabling is explicit, and high-risk invocation still requires local approval.

Acceptance evidence:

- `pnpm --filter @myagenttool/server test`
- `pnpm --filter @myagenttool/desktop test`
- `pnpm smoke:local`

### Stage 4: Invocation, Cancellation, And Evidence

- Desktop Bridge parses Codex JSONL into `agent_output` events.
- Codex-shaped invocation records result summary, trace, audit, policy, and
  usage evidence through the normal M0 loop.
- Cancellation terminates the local process tree and records cancellation
  events.
- A deterministic Codex fixture validates the product loop without requiring a
  live model call during repository checks.

Acceptance evidence:

- `pnpm docs:check`
- `pnpm repo:check`
- `pnpm typecheck`
- `pnpm test`

## Safety Boundaries Preserved

- Codex is discovered only when explicitly supplied by the user.
- Codex adapter configs are reviewable before probe.
- Probe is restricted to local CLI surface validation.
- Registration creates disabled agents.
- Enablement is explicit.
- Invocation requires local approval because Codex is high risk.
- Default Codex sandbox is read-only.
- No M3 billing automation, marketplace, extension distribution, automatic
  install, or automatic enablement was added.

## Residual Follow-Up

- Replace the fixture-only smoke with an optional manual run against the user's
  authenticated Codex CLI for richer evidence.
- Add UI copy that makes Codex read-only sandbox, JSONL evidence, and local
  approval more visible in the Web Console.
- Decide whether write-capable Codex tasks belong in a later M3/M4 governed
  workflow rather than this pilot.

