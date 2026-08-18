# MyAgentTool Electron Desktop

This workspace packages the existing local stack into Windows, Linux, and Apple
Silicon macOS desktop apps:

- `apps/server` runs the local API.
- `apps/desktop` runs the Local Agent Bridge.
- `apps/web/dist` is served by the Electron-owned static web server.

The packaged app keeps the repository layout inside Electron so existing
relative imports and bridge wrapper paths keep working. Runtime state is stored
under Electron's user data directory, not in the install directory.

The Windows x64 package also carries pinned Codex CLI, Claude Code, and
PortableGit runtimes. Linux and macOS use their native platform packages and
the host's Git installation.
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
pnpm desktop:pack:linux
pnpm desktop:dist:linux
```

`desktop:pack` creates an unpacked native Windows app for smoke checks and
`desktop:dist` creates the NSIS installer under `apps/electron/release/`.
`desktop:pack:linux` creates an unpacked native Linux x64 app;
`desktop:dist:linux` creates Linux x64 AppImage and deb artifacts.

Builds are intentionally native. The preflight rejects a Windows or Linux
target when the host platform/architecture does not match, because Codex,
Claude, Canvas, and node-pty contain native binaries. Run the Linux commands
on Linux and the Windows commands on Windows after `pnpm install --frozen-lockfile`.
ARM64 Linux has equivalent `:arm64` pack and dist commands.

The `:mac` and `:linux` commands intentionally skip `desktop:prepare-assets`:
PortableGit is a Windows-only fallback and its self-extractor cannot run on
POSIX systems. macOS uses system Git and emits an ARM64 app/DMG under
`apps/electron/release/`. Local development builds are unsigned; signing,
notarization, Linux branding, and the branded icon are release prerequisites.

## Smoke Check

After `pnpm desktop:pack`, run the packaged stack without opening a window:

```powershell
$env:ELECTRON_RUN_AS_NODE = $null
$env:MYAGENTTOOL_ELECTRON_SMOKE = "1"
.\apps\electron\release\win-unpacked\MyAgentTool.exe
```

The smoke mode starts the packaged server, desktop bridge, and web static
server, waits for the bridge to register as online, then exits.
