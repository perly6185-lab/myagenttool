# Local Development Environment

This document defines the desired local development experience.

The repository now contains the initial pnpm workspace scaffold. Application
behavior is still placeholder-only until the M0 skeleton issues are implemented.
This document sets the target local development experience and follows
[ADR 0001](ADR_0001_LOCAL_DEV_STACK.md).

## Target Experience

A contributor should be able to:

1. Clone the repository.
2. Install dependencies.
3. Start the web console, server, and Desktop Bridge in development mode.
4. Register a demo CLI agent.
5. Run a demo invocation.
6. See logs, status, result, and audit output.
7. Run tests.

## Planned Commands

Root commands should look like:

```text
pnpm install
pnpm dev
pnpm test
pnpm lint
pnpm typecheck
pnpm e2e
```

Current scaffold commands:

```text
pnpm repo:check
pnpm docs:check
```

The current `dev`, `test`, `lint`, and `typecheck` scripts are workspace
placeholders until application packages are implemented.

If the project later changes stack, keep the same intent:

- One dependency install command.
- One full local dev command.
- One verification command.

## Local Services

M0 local development should include:

- Web Console.
- API Server.
- Database.
- Queue or queue table.
- Desktop Bridge.
- Demo CLI agent.
- Optional mock HTTP agent.

## Planned Workspace Shape

```text
apps/
  web/
  server/
  desktop/

packages/
  protocol/
  adapters/
  shared/

tools/
  docs/
  github/
  release/
```

This structure now exists in the repository as the M0 scaffold.

M0 should keep package boundaries simple:

- `packages/protocol` owns shared schemas and event types.
- `packages/adapters` owns adapter contracts and CLI/HTTP adapter logic.
- `packages/shared` owns cross-package utilities that are not protocol.
- `apps/desktop` owns local execution and bridge connection behavior.
- `apps/server` owns auth, registry, queue, gateway, audit, and API behavior.
- `apps/web` owns user-facing console flows.

## Environment Files

Use local-only env files for development:

```text
.env.example
.env.local
apps/server/.env.example
apps/desktop/.env.example
```

Never commit secrets.

## Demo Agent

M0 should include a harmless demo CLI agent that:

- Accepts a plain text task.
- Emits progress lines.
- Can sleep long enough to test cancellation.
- Returns a structured result.
- Does not access user files by default.

## Debugging

Development logs should make it easy to trace:

- User request id.
- Invocation id.
- Device id.
- Agent id.
- Delivery attempt.
- Cancellation request.
- Final status.

## Cross-Platform Notes

Desktop Bridge development must consider:

- Process spawning.
- Process-tree cancellation.
- Credential storage.
- Auto-start behavior.
- Path handling.
- Shell differences.

M0 should test process execution and cancellation on Windows, macOS, and Linux
before claiming cross-platform support.

## Local Safety

Development mode should default to:

- Demo agents only.
- Explicit confirmation before running arbitrary commands.
- No silent startup of user-defined local agents.
- Clear logging of what command is executed.
