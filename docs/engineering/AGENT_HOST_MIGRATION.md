# Agent Host Migration

Use `tools/dev/migrate-agent-host.sh` to clone a prepared agent host environment
to another Linux x86_64 machine.

## What It Copies

- Mihomo binary, `/etc/mihomo`, and `mihomo.service`.
- User-local Node 22 runtime from `~/.local/opt/node-v22`.
- Global CLI packages under `~/.local/lib/node_modules`:
  - Claude Code
  - Codex CLI
  - Gemini CLI
- `tools/dev/init-agent-proxy.sh`, then regenerates local wrappers:
  - `~/.local/bin/claude`
  - `~/.local/bin/codex`
  - `~/.local/bin/gemini`
  - `~/.local/bin/with-agent-proxy`

It does not copy login tokens or browser sessions.

## Prerequisites

- SSH login to the target works.
- The target user can run `sudo`.
- The target is a Linux x86_64 systemd host.
- Run the script from a prepared source host, such as `10.10.10.122` or `10.10.10.60`.

If the source host cannot SSH to the target yet, add the source host public key
to the target user's `~/.ssh/authorized_keys`.

## One-Command Migration

From a prepared source host:

```bash
cd ~/myagenttool
tools/dev/migrate-agent-host.sh devagent@10.10.10.NEW
```

The target sudo password may be requested once while installing mihomo.

From another control host that can SSH to both source and target:

```bash
tools/dev/migrate-agent-host.sh \
  --source devagent@10.10.10.122 \
  devagent@10.10.10.NEW
```

## Verify Only

If the target is already provisioned and you only want to refresh wrappers and
verify the proxy:

```bash
tools/dev/migrate-agent-host.sh --skip-system --skip-home devagent@10.10.10.NEW
```

On the target, this should pass:

```bash
init-agent-proxy --check-only
claude --version
codex --version
gemini --version
```

Expected proxy checks include a US exit and reachable Google, ChatGPT, Gemini,
AI Studio, Gemini API, and Anthropic API endpoints.
