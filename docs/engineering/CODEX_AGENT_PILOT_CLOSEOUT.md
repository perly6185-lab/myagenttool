# Codex Agent Pilot Closeout

Date: 2026-06-20

The Codex agent pilot validates a real coding-agent-shaped path before M3. The
pilot keeps M0, M1, and M2 boundaries intact while replacing the simple demo CLI
assumption with a Codex-style adapter flow.

## Delivered Stages

### Stage 1: M0-M2 Readiness Audit

- Added `docs/engineering/CODEX_AGENT_PILOT.md`.
- Confirmed the pilot must reuse M0 invocation/audit and M2 review/probe gates,
  while Codex CLI permissions remain native to the installed CLI.
- Added local tooling checks for the four-stage plan and Codex non-interactive
  requirements.

Acceptance evidence:

- `pnpm --filter @myagenttool/tools-dev test`
- `pnpm docs:check`
- `pnpm repo:check`

### Stage 2: Codex Discovery And Adapter Config

- Explicit user-provided `codex` discovery now produces a Codex-specific
  candidate instead of a generic payload-JSON CLI candidate.
- Generated Codex adapter config uses `codex exec`, JSONL output, no shell
  wrapper, and no MyAgentTool sandbox override.
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
- Registering a tested artifact creates an available Codex agent when the
  Desktop Bridge is online.
- Invocation relies on Codex CLI native permission, sandbox, and approval
  controls instead of a Web Console enablement gate.

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
- Real authenticated Codex CLI validation is tracked in #109 with local
  evidence under `.myagenttool/runs/issue-109-real-codex/`.

Acceptance evidence:

- `pnpm docs:check`
- `pnpm repo:check`
- `pnpm typecheck`
- `pnpm test`

## Safety Boundaries Preserved

- Codex is discovered only when explicitly supplied by the user.
- Codex adapter configs are reviewable before probe.
- Probe is restricted to local CLI surface validation.
- Default Codex CLI entry is available when the Desktop Bridge is online and
  the installed CLI is already authenticated.
- MyAgentTool records JSONL evidence, trace, audit, policy, and usage metadata.
- Codex CLI owns repository permission, sandbox, and approval behavior.
- No M3 billing automation, marketplace, extension distribution, automatic
  install, or Codex authorization layer was added.

## Residual Follow-Up

- Keep the optional authenticated Codex CLI validation path documented from
  #109 so it can be repeated without making normal CI depend on a live model.
- Add optional UI display of the effective Codex CLI sandbox/approval mode when
  the CLI exposes it; tracked in #121.
- Decide whether organization-level policy should observe Codex tasks without
  duplicating Codex CLI authorization; tracked in #122.
- Design richer Codex session history and named continuation beyond the current
  `continue_last` baseline; tracked in #123.
- Plan persistent storage for demo state, Codex evidence, and session metadata
  before production-like use; tracked in #124.
- Add browser screenshot automation for Web Console visual QA; tracked in #125.

