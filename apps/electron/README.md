# MyAgentTool Electron Desktop

This workspace packages the existing local stack into a Windows desktop app:

- `apps/server` runs the local API.
- `apps/desktop` runs the Local Agent Bridge.
- `apps/web/dist` is served by the Electron-owned static web server.

The packaged app keeps the repository layout inside Electron so existing
relative imports and bridge wrapper paths keep working. Runtime state is stored
under Electron's user data directory, not in the install directory.

## Commands

```sh
pnpm desktop:dev
pnpm desktop:pack
pnpm desktop:dist
```

`desktop:pack` creates an unpacked Windows app for smoke checks. `desktop:dist`
creates the NSIS installer under `apps/electron/release/`.

## Smoke Check

After `pnpm desktop:pack`, run the packaged stack without opening a window:

```powershell
$env:ELECTRON_RUN_AS_NODE = $null
$env:MYAGENTTOOL_ELECTRON_SMOKE = "1"
.\apps\electron\release\win-unpacked\MyAgentTool.exe
```

The smoke mode starts the packaged server, desktop bridge, and web static
server, waits for the bridge to register as online, then exits.
