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
pnpm desktop:pack:linux:arm64
pnpm desktop:dist:linux:arm64
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
`apps/electron/release/`. With no Apple code-signing identity installed,
`pnpm desktop:pack:mac` keeps the development package ad-hoc signed and prints a
warning: macOS may ask for Keychain access again after the package changes.

For stable Keychain access during real-device validation, install an Apple-issued
`Apple Development` or `Developer ID Application` identity in the login
keychain, then run:

```sh
pnpm desktop:pack:mac:signed
```

The signing check auto-detects either supported identity, verifies the Team ID,
bundle requirement, hardened runtime entitlements, and final signature, and
fails rather than silently producing an unstable package. Set `CSC_NAME` when
more than one suitable identity exists. macOS may ask once when credentials are
migrated from an older ad-hoc build; packages signed for the same bundle by the
same Apple team can then reuse that approval.

Distribution-format builds are release candidates, not approved releases. The
initial channel uses human-approved manual downloads and has no runtime update
check, auto-update, or automatic downgrade. Before privileged release work, run
the credential-name-only preflight for the target platform:

```sh
pnpm desktop:release:preflight -- --platform win32 --arch x64
pnpm desktop:release:preflight -- --platform darwin --arch arm64
pnpm desktop:release:preflight -- --platform linux --arch x64
pnpm desktop:release:preflight -- --platform linux --arch arm64
```

Distribution builds still require the evidence and human approval defined in
[`docs/engineering/DESKTOP_RELEASE_CONTRACT.md`](../../docs/engineering/DESKTOP_RELEASE_CONTRACT.md).
Real Windows signing plus macOS Developer ID signing and notarization remain
blocked on #1617. Linux has no platform code-signing credential in the initial
contract; checksums and native package evidence are still required.

## Smoke Check

After `pnpm desktop:pack`, run the packaged stack without opening a window:

```powershell
$env:ELECTRON_RUN_AS_NODE = $null
$env:MYAGENTTOOL_ELECTRON_SMOKE = "1"
.\apps\electron\release\win-unpacked\MyAgentTool.exe
```

The smoke mode starts the packaged server, desktop bridge, and web static
server, waits for the bridge to register as online, then exits.
