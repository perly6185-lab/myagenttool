# Excalidraw CLI Runtime

The optional **`excalidraw-cli` Runtime** (#1356) is a governed external binary that
gives the Canvas collaboration feature headless layout/export on the local device,
through the Desktop Bridge — a distinct track from the in-process `app_canvas`
scene capabilities (which never shell out). It is **optional**: when the binary is
absent the platform says so and Canvas falls back to browser export, never
pretending the runtime is there.

This document covers the runtime end to end. **PR1** shipped the governed
*scaffolding* — catalog, install contract, readiness/degradation, and the device
presence-probe. **PR2 (this slice)** wires the governed **`export`** write verb:
`excalidraw-cli <input.excalidraw> <output.png>`, approval-gated, `workspace_write`,
worktree-confined.

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
3. **Use**: the governed `export` capability runs `excalidraw-cli` in the
   invocation's worktree — `export <input.excalidraw> <output.png>` — writing the
   PNG in place so it is reviewable before promotion. It requires an approval grant.
   When the binary is absent, Canvas export stays browser-side (the PNG/SVG buttons
   in the Web editor).

## Security limits

- **No caller-controlled command/args/paths.** The argv base is fixed; caller
  input can only fill declared, typed inputs. A leading-`-` value is dropped;
  unknown capability prefixes are default-denied.
- **Two capability prefixes, never crossed.** The presence-only READ prefix
  (`app.app_excalidraw_cli.wrapper.`) still has **no** `wrapperArgsAllowed` branch —
  it exists only for the readiness probe, and any invocation under it is refused. The
  WRITE verb runs under a distinct prefix (`app.app_excalidraw_cli.apply.`) mapped to
  the `excalidrawCliApply` policy bucket; a read prefix can never resolve to the
  write policy, or vice versa.
- **Approval-gated write.** `export` carries `requiresApproval: true` — a single-use
  approval grant is enforced server-side before the wrapper plan is built.
- **Path containment.** The `export` positionals are worktree-safe RELATIVE paths —
  the input must end `.excalidraw`, the output `.png`, neither may traverse (`..`) or
  be absolute. The render runs under `cwdPolicy: invocation_root`, and the device
  refuses a write whose `--cwd` is not inside the invocation's worktree
  (`cwd_outside_approved_root`). Both allowlists (server + device) validate the paths
  independently.
- **No remote install.** Discrete pinned npm argv from `registry.npmjs.org`
  (no `@latest`), `execution.shell === false`, no URL-fetch/curl-pipe path.
- **Offline execution.** `networkPolicy: "forbidden"` — the approved binary needs
  no network; a runtime that reached out would be refused by the network policy.

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
  — the read prefix stays default-denied; the `export` write is allowed only under
  the apply prefix, worktree-confined, and refused when the binary is absent.
- `node --test apps/server/test/excalidraw-cli-application.test.mjs`
  — the `export` verb is workspace_write + approval-gated; unsafe/wrong-extension
  paths are dropped from the argv.

## Nonempty output & source-scene revision

The `export` verb renders a worktree `.excalidraw` FILE to a worktree `.png`, so
the artifact is associated with the **worktree revision** the invocation is pinned
to (branch/commit + source file), and "nonempty" is enforced by the CLI's exit
code — a failed render exits non-zero and fails the invocation honestly. Byte-level
server-side nonempty validation and association with a *durable* `app_canvas` scene
revision belong to a future in-process `render_export` capability on the scene
service (it would materialize the durable scene to the worktree, then invoke this
verb) — see Follow-ups.

## Follow-ups

- **`layout`.** The approved binary renders only; it has no DSL/JSON auto-layout.
  A layout verb needs a CLI that supports it (or an in-process layout pass); it is
  not wired here.
- **In-process `render_export`.** For byte-level nonempty validation and durable
  `app_canvas` scene-revision association, add an in-process capability on the scene
  service that materializes the scene, invokes this `export` verb, and reads the PNG
  back through a realpath-confinement guard.
