# Research: Remote (SSH) Agent Execution

Status: research (not an accepted decision)

Date: 2026-06-23

## Motivation

Today the Desktop Bridge runs agents on the same machine it runs on. Many real
workflows want to run a coding agent on a **beefier remote box** (or a sandbox
VM) while keeping the cloud control plane and the local console unchanged — the
same value Orca exposes as "SSH worktrees". The control-plane contract (cloud
requests, the bridge owns execution, every run is attributable / cancellable /
auditable) should hold whether execution is local or remote.

## Current shape

- Cloud/server enqueues work; the bridge polls and executes locally via
  `createCliSpawnPlan` → `spawn`, streaming stdout/stderr back as events.
- Cancellation/timeout terminate the **local** process tree
  (`terminateProcessTree`: process-group SIGTERM → grace → SIGKILL; Windows
  `taskkill /t /f`).

## Options

1. **Bridge-on-remote (phase 1, simplest).** Run the existing bridge process on
   the remote host over SSH; it registers as a device like any other. No new
   transport — reuse the device/registration path. Good first proof; the remote
   box just needs Node + the agent CLIs installed.
2. **Remote exec channel (phase 2).** Keep one local bridge but proxy each
   spawn over an SSH session to the remote host (Orca's `relay/remote-cli-*`
   pattern): open a persistent SSH connection, run the agent there, stream
   stdio back. Lets one bridge fan out to several remotes and keeps secrets
   local.

Recommendation: ship **phase 1** first (it validates the device contract end to
end with near-zero new surface), then evaluate phase 2 when multi-remote or
secret-locality requirements appear.

## Hard problems (and where they're already half-solved)

- **Remote process-tree cancellation.** The local SIGTERM→SIGKILL escalation we
  just hardened must be reproduced *on the remote*. Over a plain SSH exec,
  killing the parent does not kill the remote tree. Run the agent in its own
  remote process group (e.g. `setsid`) and cancel with a remote
  `kill -TERM -- -<pgid>` then `kill -KILL`, mirroring `terminateProcessTree`.
  The forced-kill observability event applies equally to remote kills.
- **Remote environment/PATH.** Agent CLIs are often installed via nvm/mise/asdf;
  a non-login SSH shell won't have them on PATH. Orca solves this in
  `relay/remote-cli-env` and "Fix remote Node.js detection for nvm, mise, asdf,
  and volta" — detect and source the right environment before spawning.
- **Reconnection & port forwarding.** SSH drops; the channel must auto-reconnect
  and re-establish forwards without losing the invocation (Orca:
  `ssh-handler-reregistration-port-forwards`). Map this onto the existing
  queued/redelivery delivery states.
- **Auth & secret locality.** Where do provider credentials live — on the remote
  (phase 1) or proxied from local (phase 2)? This intersects the future
  accounts/auth work and the economics cost-owner attribution.
- **Cross-platform.** A Windows remote needs the `taskkill` path; a posix remote
  the process-group path. The same platform branch we have locally must be
  evaluated against the **execution host**, not the bridge host.

## Borrow list (from `~/projects/orca`, see [[orca-reference]])

- `src/relay/remote-cli-env.ts`, `remote-cli-stdin.ts`, `remote-cli-timeout.ts`
- `src/relay/pty-handler.ts`, `subprocess.ts` (process lifecycle + cancellation)
- `src/main/ssh-config-target` and SSH reconnection / port-forward handlers

## Next step

Prototype phase 1: a `BRIDGE_EXECUTION_HOST=ssh://user@host` mode that runs the
agent over `ssh ... setsid <cmd>` and cancels via a remote group kill, reusing
the current event/delivery/audit path. Gate behind a feature flag; keep
local-only as the default.
