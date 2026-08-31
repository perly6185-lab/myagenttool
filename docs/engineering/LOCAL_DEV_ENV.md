# Local Development Environment

This document defines the desired local development experience.

The repository now contains the initial pnpm workspace scaffold and a local M0
demo loop. This document sets the local development experience and follows
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

## Commands

Root commands:

```text
pnpm install
pnpm system:check
pnpm dev
pnpm dev:restart-changed
pnpm test
pnpm lint
pnpm typecheck
pnpm repo:check
pnpm docs:check
pnpm github:check
pnpm github:check:issues
pnpm github:check:pr
pnpm github:check:branch
pnpm smoke:local
```

`pnpm dev` starts the local server, Desktop Bridge, and web console. It also
starts a localhost-only development control endpoint on `127.0.0.1:5999`.
After a validation pass, run `pnpm dev:restart-changed` to inspect changed git
paths and restart only affected local services:

- `apps/web/**` restarts the Web Console.
- `apps/server/**` restarts the API server.
- `apps/desktop/**` restarts the Desktop Bridge.
- shared package or workspace metadata changes restart the affected service set.

`pnpm test` runs workspace checks plus the local invocation smoke test.
GitHub governance commands are read-only by default. Project sync is a dry-run
unless `--apply` is explicitly passed.

```text
pnpm github:sync-project -- --repo perly6185-lab/myagenttool --owner perly6185-lab --project 1 --milestone M2
```

If the project later changes stack, keep the same intent:

- One dependency install command.
- One full local dev command.
- One verification command.

## System dependencies

Audio and video output acceptance uses `ffprobe` to derive duration, dimensions,
codec, sampling rate, and channel count. `pnpm install` includes a platform
specific project fallback, so local development does not require administrator
access. The runtime prefers a system `ffprobe` from `PATH` and then falls back
to the installed project binary.

Run `pnpm system:check` after installation. For a shared machine, the preferred
system installation is:

```text
# macOS (Homebrew)
brew install ffmpeg

# Debian / Ubuntu
sudo apt-get update && sudo apt-get install ffmpeg

# Windows (WinGet)
winget install Gyan.FFmpeg.Shared
```

Set `MYAGENTTOOL_FFPROBE_PATH` only when the binary is installed at a custom
location. Probing is isolated to the project file path, uses fixed arguments,
and times out after five seconds. If probing fails or `ffprobe` is unavailable,
file-level output checks still run, but media quality gates that require
duration or dimensions remain unverified rather than being silently accepted.

## Local Services

M0 local development should include:

- Web Console.
- API Server.
- In-memory demo queue.
- Desktop Bridge.
- Demo CLI agent.
- Optional mock HTTP agent.

Current local URLs:

```text
Web Console: http://127.0.0.1:5000
API Server:  http://127.0.0.1:5001
Health:      http://127.0.0.1:5001/health
```

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

M0 includes a harmless demo CLI agent that:

- Accepts a plain text task.
- Emits progress lines.
- Can sleep long enough to test cancellation.
- Returns a structured result.
- Does not access user files by default.

The smoke test asserts the demo invocation succeeds, emits logs, returns a
structured result, and does not claim to touch user files.

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

## State backing, reset, and export (SQLite)

The server's durable state lives in SQLite by default (`<MYAGENTTOOL_STATE_PATH sans
.json>.sqlite`, WAL mode). JSON is a rollback/export format, not the backing. See
`PERSISTENT_STORAGE_DESIGN.md` §7–§9.

- **Reset local state:** stop the server, then remove the SQLite files:
  ```
  rm -f .myagenttool/state/local-demo-state.sqlite*
  ```
  (and the `.json` if you also want to drop the export). The next boot seeds fresh.
- **Export / import:** a clean shutdown writes `…local-demo-state.json` automatically
  for inspection or one-time import. It is never served as the live backing.
- **Restore a JSON export:** stop the server, move the current `.sqlite`, `-wal`, and
  `-shm` files to a recovery directory, then boot normally. A new SQLite database
  imports the JSON once. Keep the moved database until the import is verified.
- **Check JSON↔SQLite parity:** against a stopped instance (or a copied state dir):
  ```
  pnpm store:parity .myagenttool/state/local-demo-state.json
  ```
- **Startup failure:** SQLite unavailability aborts startup. An integrity failure
  first copies the database and any WAL/SHM sidecars into a timestamped
  `…sqlite.recovery-*` directory; the server never silently resets or loads JSON.
  Existing zero-byte files, invalid schema stamps, and stamped-current databases
  missing required tables/indexes are treated as partial state, not as fresh stores.
- **Test scope:** `--check` and `MYAGENTTOOL_STATE_DISABLED=1` disable persistence
  and may use the in-memory adapter. `MYAGENTTOOL_STORE=memory` is rejected when
  persistence is enabled.
