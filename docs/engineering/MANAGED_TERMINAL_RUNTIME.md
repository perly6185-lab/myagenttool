# Managed Terminal Runtime

This document records the Phase E local managed terminal runtime behavior.

## Scope

Phase E implements a local managed PTY path:

- Web Console Terminal surface requests terminal sessions.
- Server owns the terminal session registry, action queue, and evidence store.
- Desktop Bridge executes local PTY actions through `node-pty`.
- Evidence Center receives summary-first managed terminal evidence.

Phase E does not implement SSH, remote relay, multi-pane terminals, or
remote Codex over SSH.

## Shell Resolver

Windows candidates:

- `cmd.exe`
- `powershell.exe`
- `pwsh.exe`
- `wsl.exe`
- Git Bash from `C:\Program Files\Git\bin\bash.exe` when present

POSIX candidates:

- `bash`
- `zsh`
- `sh`
- `SHELL` environment fallback

## Lifecycle

The server queues bridge actions:

```text
create -> input -> resize -> close
```

The Desktop Bridge emits runtime events:

```text
terminal.session.attached
terminal.input.submit
terminal.output.chunk
terminal.resize
terminal.exit
terminal.close
terminal.runtime.warning
```

The server records:

- terminal session registry metadata
- summary-first terminal evidence
- Evidence Center records
- high-level audit timeline events

## Managed Codex Terminal Mode

Terminal sessions may link to a managed Codex session through
`ownerCodexSessionId`. This preserves the boundary between:

- terminal session id: local PTY lifecycle
- Codex session registry id: managed Codex work context
- imported evidence: after-the-fact supplement, not managed proof

Terminal output remains summary-first evidence. Codex JSONL remains the primary
Codex evidence source when available. Hooks and approval broker records remain
associated with the managed Codex session registry.

The runtime does not read `~/.codex/auth.json` and does not replace Codex CLI
native authorization.

## Cancellation And Close

Phase E supports close by sending a managed close action to the Desktop Bridge.
The bridge calls `pty.kill()` and reports `terminal.close`; `node-pty` may also
emit `terminal.exit` afterward. The server treats both as managed lifecycle
events.

Process-tree cancellation is intentionally conservative:

- local PTY close is supported through `pty.kill()`
- full descendant process-tree cleanup is not guaranteed by Phase E
- future hardening should add platform-specific cleanup where needed

## Windows Note

On Windows, `node-pty` may print an `AttachConsole failed` message from its
console process-list helper while the PTY session itself still attaches and
continues. Phase E treats this as runtime stderr noise unless the terminal
session fails to attach, produce output, resize, or close in smoke tests.

## Verification

Use:

```text
pnpm smoke:terminal
pnpm --filter @myagenttool/desktop test
pnpm --filter @myagenttool/server test
pnpm --filter @myagenttool/web test
pnpm visual:qa
```

The terminal smoke starts a local server and Desktop Bridge, creates a PTY
session, sends input, verifies output evidence, resizes, and closes the session.

## SSH Target Connector

Phase G adds SSH target registration and safety preflight. It records host,
port, user, auth method, known host policy, workspace root, credential reference,
agent forwarding, and key selection. It does not enable remote relay PTY and
does not treat an SSH target as managed terminal evidence.

See [SSH_RUNTIME_TARGET_CONNECTOR.md](SSH_RUNTIME_TARGET_CONNECTOR.md).
