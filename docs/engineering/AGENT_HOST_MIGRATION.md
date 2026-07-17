# Agent Host Migration

Use `tools/dev/migrate-agent-host.sh` to copy a prepared agent environment to
another Linux x86_64 machine. The script can run on the source itself or on a
third control host that can SSH to both endpoints.

## What It Copies

- Mihomo binary, the complete `/etc/mihomo` tree, and `mihomo.service`.
- User-local Node 22 runtime from `~/.local/opt/node-v22`.
- These managed CLI package directories under `~/.local/lib/node_modules`:
  - Claude Code
  - Codex CLI
  - Gemini CLI
- `tools/dev/init-agent-proxy.sh`, then regenerates local wrappers:
  - `~/.local/bin/claude`
  - `~/.local/bin/codex`
  - `~/.local/bin/gemini`
  - `~/.local/bin/with-agent-proxy`

The install replaces the source-managed Node runtime and the three managed CLI
package directories. It preserves other global package directories already on
the target, so a target-only global package is not removed. Back up local
changes inside the managed runtime or managed package directories before a
migration.

It does not copy CLI login tokens or browser sessions. Authenticate each CLI on
the target after migration.

## Sensitive Proxy Configuration

`/etc/mihomo` is copied in full. Depending on the source configuration, it can
contain subscription URLs, provider credentials, private endpoints, or other
secrets. The statement above about login tokens does not mean the migration is
credential-free.

- Treat the control host and target staging directory as sensitive.
- Use `--keep-temp` only for debugging and remove the retained staging directory
  when finished.
- Protect SSH logs and terminal transcripts if they can reveal configuration or
  credential-bearing URLs.
- Back up a target-specific `/etc/mihomo` separately; the system payload replaces
  it with the source configuration.

## Prerequisites

- SSH login to the target works.
- The target is a Linux x86_64 host.
- When installing the system payload, the target is a systemd host and the
  target user can run `sudo`.
- A requested source payload is available either on the machine running the
  script or on the host named by `--source`.
- The target has enough free space to stage and install the requested payloads.

The migration preflight always checks that the target is Linux x86_64. Checks
for `tar` are required only when copying a payload; `sudo` and `systemctl` are
required only when installing the system payload. When `--skip-home` is used,
the target must already have an executable
`~/myagenttool/tools/dev/init-agent-proxy.sh`.

Each requested payload is staged and its required executable/configuration is
checked before existing target files are replaced. These checks catch an
immediately incompatible Mihomo or Node executable, but they cannot prove that
every native Node dependency is compatible. Prefer source and target hosts with
comparable Linux distributions and C library versions.

## SSH Key Topology

The machine running `migrate-agent-host.sh` makes every SSH connection.

- When the script runs on the prepared source, authorize that source/control
  machine's public key on the target.
- With `--source source.example`, authorize the separate control host's public
  key on both the source and the target. The source does not SSH directly to the
  target, so adding the source host's key to the target is neither necessary nor
  sufficient for this mode.

Confirm both host keys from the control host before migration. The target sudo
prompt, when needed, is relayed to the control host's terminal.

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

## Refresh Wrappers And Verify

If the target is already provisioned and you only want to refresh wrappers and
verify the proxy:

```bash
tools/dev/migrate-agent-host.sh --skip-system --skip-home devagent@10.10.10.NEW
```

With both payloads skipped, the source is not contacted and no payload is
copied. This mode is not read-only: it runs the existing target
`init-agent-proxy.sh --install-only` to refresh wrappers and shell setup, then
runs one final CLI and proxy verification pass.

Add `--skip-verify` to suppress that final pass. Wrapper refresh still runs, but
there are no proxy network probes or CLI version checks:

```bash
tools/dev/migrate-agent-host.sh \
  --skip-system --skip-home --skip-verify \
  devagent@10.10.10.NEW
```

For a strictly read-only check, log in to the target and run the commands below
directly; `init-agent-proxy --check-only` checks the proxy without rewriting
wrappers or shell files.

On the target, this should pass:

```bash
init-agent-proxy --check-only
claude --version
codex --version
gemini --version
```

Expected proxy checks include a US exit and reachable Google, ChatGPT, Gemini,
AI Studio, Gemini API, and Anthropic API endpoints.
