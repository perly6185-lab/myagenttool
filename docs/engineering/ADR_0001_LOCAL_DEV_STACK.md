# ADR 0001: Local Development Stack and Monorepo Tooling

Status: accepted

Date: 2026-06-19

Related issue: [#23](https://github.com/perly6185-lab/myagenttool/issues/23)

## Context

M0 needs the first executable foundation for:

- Web Console.
- Server control plane.
- Desktop Bridge.
- Shared protocol schemas.
- Agent adapters.
- Demo CLI and HTTP agents.
- Local smoke tests.

The project is currently documentation-first, so the first stack decision should
optimize for fast M0 implementation, shared schemas, simple AI-assisted edits,
and cross-platform development.

## Decision

Use a TypeScript monorepo with pnpm workspaces for M0.

Initial workspace shape:

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

Initial runtime direction:

- Web Console: React-based single-page application.
- Server: Node.js/TypeScript API server.
- Desktop Bridge: Node.js/TypeScript CLI/service-style process for M0.
- Protocol: shared TypeScript schemas and event types.
- Adapters: TypeScript adapter contracts and CLI/HTTP adapter implementations.
- Scripts: PowerShell-first local scripts for Windows compatibility, with a
  path to add shell equivalents later.

## Rationale

TypeScript monorepo is the best M0 default because:

- Web, server, desktop bridge, protocol, and adapters can share types early.
- AI-assisted development can work across one language and one workspace model.
- pnpm workspaces support clear package boundaries without heavy tooling.
- Node.js process APIs are sufficient for an M0 CLI/service bridge.
- The project can still add Tauri, Electron, or native platform helpers later.

pnpm is preferred over npm workspaces for:

- Better workspace ergonomics.
- Faster dependency installs.
- Stronger dependency isolation.
- Common use in TypeScript monorepos.

## Consequences

Positive:

- Fast path to executable M0 scaffold.
- Shared protocol package can become the contract between apps.
- Local scripts and GitHub Actions can use one package manager.
- Desktop Bridge can start simple before adding tray/native UX.

Tradeoffs:

- Native credential storage, notifications, auto-start, and process-tree
  cancellation may need platform-specific helpers.
- Desktop packaging is deferred until after the first invocation loop.
- Browser, server, and desktop packages must avoid leaking environment-specific
  dependencies across boundaries.

## Non-Goals

This decision does not commit to:

- Production desktop packaging technology.
- Final SaaS deployment architecture.
- Final database choice.
- Final UI component library.
- Full MCP/A2A implementation.
- Marketplace extension packaging.

## Implementation Notes

M0 scaffold should include:

- `pnpm-workspace.yaml`
- root `package.json`
- root TypeScript config
- `apps/web`
- `apps/server`
- `apps/desktop`
- `packages/protocol`
- `packages/adapters`
- `packages/shared`
- `tools/docs`
- `tools/github`

Root commands should target:

```text
pnpm install
pnpm dev
pnpm test
pnpm lint
pnpm typecheck
```

## Acceptance Impact

This ADR unblocks future issues for:

- Repository scaffold.
- Shared protocol package.
- Server skeleton.
- Web Console skeleton.
- Desktop Bridge skeleton.
- Demo CLI agent.
- Local invocation smoke test.
