# Agent Adapter Matrix

myagenttool should manage existing agents through adapter paths instead of
reimplementing those agents.

This matrix documents likely integration routes for common agent families. It is
not a promise that every named tool is supported on day one.

## Adapter Types

```text
CLI
HTTP
MCP
A2A
Platform
Container
```

### Adapter status

- **CLI / HTTP / Platform** — shipped (M0+).
- **MCP** — *live over stdio.* The declarative slice
  (`packages/adapters/src/mcp.mjs`) is executed by the Desktop Bridge's client
  (`apps/desktop/src/mcp-client.mjs`): newline-delimited JSON-RPC handshake →
  `tools/list` → `tools/call` via the shared descriptor (allowlist enforced),
  server notifications forwarded as invocation events, cancellation mapped to
  `notifications/cancelled` + process stop, plus a real health probe
  (handshake + tool listing). `POST /api/agents {type:"mcp"}` registers a stdio
  server as a managed agent; validated end-to-end through the control plane.
  Remaining: the http transport (needs a server-side client, not the bridge).
- **A2A** — *live.* The declarative slice (`packages/adapters/src/a2a.mjs`) is
  executed by the bridge's client (`apps/desktop/src/a2a-client.mjs`): fetch the
  Agent Card, JSON-RPC `message/send` via the shared descriptor (skill allowlist
  enforced), poll `tasks/get` to a terminal state, cancellation mapped to
  `tasks/cancel`, plus a card-fetch health probe. The client runs on the bridge
  so agents reachable only from the user's network stay usable; it does not
  consume a bridge concurrency slot (the work happens on the remote agent).
  `POST /api/agents {type:"a2a"}` registers one; validated end-to-end through
  the control plane. Remaining: consume the `message/stream` SSE instead of
  polling.
- **Container** — *live.* The declarative slice
  (`packages/adapters/src/container.mjs`) is executed by the bridge's client
  (`apps/desktop/src/container-client.mjs`): a one-shot governed
  `docker|podman run` built from the shared descriptor (`--rm`, `--network`
  isolation, cpu/memory ceilings, task via the `TASK` env var), stdout/stderr
  streamed as invocation events, cancellation via `<runtime> kill` + child
  termination, and a `--version` health probe that also surfaces the
  digest-pinning stance. Counts toward the bridge concurrency cap (local
  compute). Validated against a fake runtime binary; a real docker/podman
  end-to-end needs a machine with the runtime installed.
- **Bridge-side live clients** — all three protocol adapters (MCP stdio, A2A,
  Container) now execute; the declarative layer above is what the server
  registers, validates, and audits. The three share one dispatch glue
  (`runClientInvocation`) for cancel-polling, event forwarding, and completion.

## Example Agent Families

| Agent family | Likely adapter | Early support | Notes |
| --- | --- | --- | --- |
| Codex-like local coding CLI | CLI | M0 manual registration | Bridge runs a configured command, streams output, and propagates cancellation to the process tree when possible. |
| Claude-like local coding CLI | CLI | M0 manual registration | Same CLI path; account, subscription, and provider terms remain external to myagenttool. |
| Claude/API-backed agent service | HTTP | M0 manual registration | Register a local or remote HTTP endpoint; AI provider billing may be external or platform-managed later. |
| OpenClaw-like local agent | CLI or HTTP | M0/M1 depending on interface | If exposed as a command, use CLI. If exposed as a service, use HTTP. Discovery can arrive in M1. |
| QClaw-like local agent | CLI or HTTP | M0/M1 depending on interface | Same adapter decision as OpenClaw-like agents. |
| MCP server | MCP | M3 governed adapter | Expose tools/resources as managed capabilities after MCP adapter support lands. |
| A2A-compatible agent | A2A | M3 governed adapter | Used for future agent-to-agent task delegation and interoperability. |
| Internal workflow system | HTTP or MCP | M0/M3 depending on interface | Start with HTTP registration; MCP can be added later where supported. |
| Containerized internal agent | Container or HTTP | M3 | Container adapter should remain governed by lifecycle, policy, and audit controls. |
| myagenttool platform agent | Platform | M1+ | Uses the same registry, gateway, permission, metering, and audit path as external agents. |

## Selection Rule

When the user describes an agent, the product should pick the simplest safe
adapter:

```text
Has a local command? -> CLI
Has an HTTP endpoint? -> HTTP
Speaks MCP? -> MCP
Speaks A2A? -> A2A
Runs as a container? -> Container
Is built into myagenttool? -> Platform
```

The user should not need to choose these terms first. The product can ask
ordinary questions:

- How do you usually run it?
- Is it a command, a local app, or a URL?
- Does it need a folder?
- Does it need an API key?
- Does it stream progress?
- Can it be stopped?

## Capability Mapping

Every adapter should map native behavior into the internal control-plane model:

- Invocation input.
- Status and progress events.
- Logs and artifacts.
- Cancellation support.
- Risk tags.
- Required credentials.
- Data access.
- Cost or revenue assumptions.
- Health check.
- Trace and audit events.

## Milestone Boundary

M0 should support:

- Manual CLI agent registration.
- Manual HTTP agent registration.
- Plain-language adapter guidance.

M1 should support:

- Conservative discovery of known local commands and endpoints.
- Enable, disable, and health checks for registered agents.
- Suggested agents based on task and capability.

M2 should support:

- Intent-to-configuration for unsupported CLI and HTTP agents.
- Generated adapter config, schemas, redaction rules, tests, and economic
  prompts.

M3 should support:

- MCP, A2A, and container adapters.
- Approved lifecycle recipes for install, update, and uninstall.
- Private extension catalog and signed adapter bundles.

M4 can support:

- Public marketplace listings.
- Public adapter compatibility badges.
- Marketplace payouts and settlement.
