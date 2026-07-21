# Excalidraw CLI Runtime

The optional **`excalidraw-cli` Runtime** (#1356) is a governed external binary that
gives the Canvas collaboration feature headless layout/export on the local device,
through the Desktop Bridge — a distinct track from the in-process `app_canvas`
scene capabilities (which never shell out). It is **optional**: when the binary is
absent the platform says so and Canvas falls back to browser export, never
pretending the runtime is there.

This document covers the runtime end to end. **PR1 (this slice)** ships the
governed *scaffolding* — catalog, install contract, readiness/degradation, and the
device presence-probe — with **no export verb wired yet**. The governed export
(`workspace_write`, approval-gated, non-empty + revision-validated) is **PR2**.

## Architecture

- **Approved binary.** `@tommywalkie/excalidraw-cli` (bin `excalidraw-cli`), an
  offline oclif CLI over `node-canvas` + `roughjs` — no headless browser, no
  network. Pinned exactly (`0.5.0`) like every other npm application. (The
  browser-driven `excalidraw-brute-export-cli` was rejected: it requires an output
  file and reaches `https://excalidraw.com/`, both incompatible with a
  `read_only` / `network: forbidden` runtime.)
- **No new bridge surface.** The runtime reuses the existing Application Wrapper
  path: the fixed `tools/agents/application-wrapper.mjs` runner, the `/api/bridge/*`
  endpoints, and the device identity = bearer token model in
  [`runtime/bridge-auth.mjs`](../../apps/server/src/runtime/bridge-auth.mjs). No new
  route, runner, or auth.
- **Dual allowlist.** The approved argv is declared independently in two places —
  the server plan builder ([`services/applications.mjs`](../../apps/server/src/services/applications.mjs))
  and the device gate ([`local-execution-policy.mjs`](../../apps/desktop/src/local-execution-policy.mjs)) —
  and the device re-validates the injected command/args/capability byte-for-byte.
  A buggy or compromised server still cannot make a device spawn something new.
- **Readiness.** The device probes `excalidraw-cli --version` (oclif, exit 0) at
  register time and every 5 minutes via
  [`application-binary-readiness.mjs`](../../apps/desktop/src/application-binary-readiness.mjs),
  reporting `available` + version or `absent`.

## Operator workflow

1. **Install** (optional): approve the governed install plan for `excalidraw-cli`.
   The plan is an immutable, fingerprinted, TTL-bound npm argv from
   [`application-install-plans.mjs`](../../apps/server/src/services/application-install-plans.mjs);
   the bridge re-derives and refuses any tampered/expired plan before spawn
   ([`application-installer.mjs`](../../apps/desktop/src/application-installer.mjs)).
2. **Detect**: once installed, the device readiness sweep flips the runtime to
   `available` with its version. No binary → `absent`.
3. **Use** (PR2): the Canvas export/layout capability runs the CLI in the
   invocation's worktree and returns the artifact. Until PR2 lands, Canvas export
   stays browser-side (the PNG/SVG buttons in the Web editor).

## Security limits

- **No caller-controlled command/args/paths.** The argv base is fixed; caller
  input can only fill declared, typed inputs. A leading-`-` value is dropped;
  unknown capability prefixes are default-denied.
- **Presence-only in PR1.** The device carries a probe entry for readiness but
  `wrapperArgsAllowed` has **no branch** for `app.app_excalidraw_cli.wrapper.`, so
  every invocation is refused (`args outside the local allowlist`). The runtime can
  be detected and installed, never executed, until the PR2 export slice.
- **No remote install.** Discrete pinned npm argv from `registry.npmjs.org`
  (no `@latest`), `execution.shell === false`, no URL-fetch/curl-pipe path.
- **Offline execution.** `networkPolicy: "forbidden"` — the approved binary needs
  no network; a runtime that reached out would be refused by the network policy.
- **Path containment (PR2).** Export writes will be confined to the invocation's
  worktree (`cwdPolicy: invocation_root`), with the output path server-derived
  (never caller-supplied) and read back through a realpath-confinement guard.

## Troubleshooting

- **Runtime shows `absent` after install.** The probe requires
  `excalidraw-cli --version` to exit 0 on the device PATH. Confirm the global npm
  bin is on PATH and the binary resolves; the readiness sweep re-runs every 5 min.
- **Install plan refused.** A plan is refused if it is expired (10-min TTL),
  tampered, or its fingerprint/argv does not match the current recipe. Re-request a
  fresh plan; never hand-edit one.
- **`RECIPE_VERSION` mismatch.** The server
  ([`application-install-plans.mjs`](../../apps/server/src/services/application-install-plans.mjs))
  and device ([`application-installer.mjs`](../../apps/desktop/src/application-installer.mjs))
  recipe versions must be identical; a mismatch refuses the plan by design. Bump
  both together with release evidence.

## Supply chain

| Platform | Provider | Command | Package |
|---|---|---|---|
| Windows | npm | `npm.cmd install --global --registry=… @tommywalkie/excalidraw-cli@0.5.0` | pinned, exact |
| macOS | npm | `npm install --global --registry=… @tommywalkie/excalidraw-cli@0.5.0` | pinned, exact |
| Linux | npm | `npm install --global --registry=… @tommywalkie/excalidraw-cli@0.5.0` | pinned, exact |

No elevation; identical argv on all three OSes; version bump = reviewed
`RECIPE_VERSION` change, never silent drift.

## Verification commands

- `node --test apps/server/test/application-install-plans.test.mjs apps/desktop/test/application-installer.test.mjs`
  — cross-platform immutable install contract (the `application-install-contract`
  gate, run on ubuntu + macos + windows).
- `node --test apps/desktop/test/application-binary-readiness.test.mjs`
  — readiness detects the runtime (available/absent).
- `node --test apps/desktop/test/local-execution-policy.test.mjs`
  — presence-only default-deny is enforced.

## Follow-ups

- **PR2 — governed export/layout.** Add the export verb(s) under the
  `workspace_write` apply policy (mirroring the OfficeCLI write slice): worktree-
  confined output, non-empty validation, source-scene-revision association, and an
  approval grant. Register the server Application + capability projection and the
  `wrapperArgsAllowed` branch at that point.
