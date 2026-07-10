# doocs/md Web Editor Handoff

This runbook covers the doocs/md web-editor path that sends rendered editor
content back into the MyAgentTool Application Result Center.

## Operator Flow

1. Start the local demo stack:

   ```powershell
   pnpm dev
   ```

2. Open the Web Console at `http://127.0.0.1:5000`.
3. In Applications, use `Register doocs/md` from the built-in Applications
   section. This registers the local `doocs-md/` checkout with the default
   path `doocs-md`, runs Probe, and opens the Application inspector.
4. If the checkout is elsewhere, open `Advanced setup`, choose `Use preset`,
   edit `Local path`, and register. The preset also runs Probe after
   registration.
5. In the Application inspector, use `Start editor`.
6. Open the editor URL. The Desktop Bridge should decorate the URL with:

   - `myagenttoolApplicationId`
   - `myagenttoolApi`

7. In doocs/md, edit the article and use the header handoff button.
8. Return to the Application Result Center and confirm:

   - the latest result shows `latest handoff`
   - the result history can filter `Result source` to `Web editor`
   - the result detail modal shows `Editor handoff`, post title, editor URL,
     Markdown length, and HTML byte length

## Automated Acceptance

Use the focused smoke for this path:

```powershell
pnpm smoke:doocs-md-editor
```

The smoke starts an isolated server, starts a Desktop Bridge, registers the
local doocs/md Application, queues the web editor start action, waits for Vite,
checks the handoff query parameters, posts a rendered editor result, reads it
back from the Result Center, and stops the editor.

The broader real MCP rehearsal remains:

```powershell
pnpm smoke:doocs-md-application
```

That path validates doocs/md MCP discovery, governed tool execution, render
result import, option-catalog artifacts, retention, and restart recovery.

## Failure Checks

When editor startup fails, the Application inspector should show an `editor
failed` diagnostic with:

- status
- bridge/server reason
- last error
- next step

Common cases:

- `desktop_bridge_unavailable`: start Desktop Bridge, then retry.
- `bridge_start_failed`: check the editor log and confirm `localhost:5173` is
  free, then retry.
- `bridge_reconnected_process_unverified`: restart the editor so the current
  bridge owns the process.

The doocs/md header handoff button is only shown when the editor URL carries a
handoff Application id. Failed result imports surface as a doocs/md toast.

## Review Slices

Recommended commit grouping for review:

1. Desktop Bridge editor lifecycle: bridge polling, allowlisted `pnpm run
   start`, Vite readiness, stop handling, and handoff URL decoration.
2. Server result import: `/web-editor/start|stop`, `/web-editor/results`,
   render-result metadata, and source filtering.
3. doocs/md UI handoff: header action, service client, result metadata, and
   success/failure toast strings.
4. Web Result Center: latest handoff card, result detail metadata, source
   filter, and failed-editor diagnostics.
5. Registration UX: built-in `Register doocs/md`, advanced preset, automatic
   probe, and inspector selection.
6. Verification: doocs editor smoke, server integration tests, and inspector
   tests.
