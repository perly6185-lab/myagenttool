# MyAgentTool Electron Desktop

This workspace packages the existing local stack into Windows and Apple Silicon
macOS desktop apps:

- `apps/server` runs the local API.
- `apps/desktop` runs the Local Agent Bridge.
- `apps/web/dist` is served by the Electron-owned static web server.

The packaged app keeps the repository layout inside Electron so existing
relative imports and bridge wrapper paths keep working. Runtime state is stored
under Electron's user data directory, not in the install directory.

The Windows x64 package also carries pinned Codex CLI, Claude Code, and
PortableGit runtimes.
At startup the desktop shell prefers an existing system CLI. When one is not on
`PATH`, it gives the Local Agent Bridge an absolute path to the packaged copy.
This fallback does not install Node/npm globally and does not modify the user's
`PATH`. Authentication state remains in each CLI's normal user profile location.

Git Bash follows the same system-first rule and falls back to the packaged
PortableGit without changing `PATH`. WSL remains a Windows prerequisite; its
approved setup plan probes first and may require a restart or first distribution
launch after Windows enables it.

## Commands

```sh
pnpm desktop:dev
pnpm desktop:pack
pnpm desktop:dist
pnpm desktop:pack:mac
pnpm desktop:dist:mac
```

`desktop:pack` creates an unpacked Windows app for smoke checks. `desktop:dist`
creates the NSIS installer under `apps/electron/release/`.

The `:mac` commands intentionally skip `desktop:prepare-assets`: PortableGit is
a Windows-only fallback and its self-extractor cannot run on macOS. The macOS
package uses system Git and emits an ARM64 app/DMG under
`apps/electron/release/`. Local development builds are unsigned; signing,
notarization, and the branded icon are release prerequisites.

## Smoke Check

After `pnpm desktop:pack`, run the packaged stack without opening a window:

```powershell
$env:ELECTRON_RUN_AS_NODE = $null
$env:MYAGENTTOOL_ELECTRON_SMOKE = "1"
.\apps\electron\release\win-unpacked\MyAgentTool.exe
```

The smoke mode starts the packaged server, desktop bridge, and web static
server, waits for the bridge to register as online, then exits.
