# Desktop Release Contract

This document defines the credential-free release boundary for the Electron
desktop application. The machine-readable source is
`apps/electron/desktop-release-contract.mjs`; focused tests keep it aligned with
`apps/electron/electron-builder.yml` and the root packaging commands.

## Artifact Matrix

| Platform | Architecture | Distribution artifacts | Candidate evidence | Current release state |
| --- | --- | --- | --- | --- |
| Windows | x64 | NSIS | Native Windows candidate package | Pending real signing validation in #1617 |
| macOS | arm64 | DMG | Native Apple Silicon candidate package | Pending real signing and notarization validation in #1617 |
| Linux | x64 | AppImage, deb | Native Linux candidate package | Candidate-evidenced; release still needs human approval |
| Linux | arm64 | AppImage, deb | Native ARM64 package required | Configured; native candidate evidence not yet recorded |

`desktop:pack*` creates unpacked candidate applications. `desktop:dist*` creates
distribution-format candidates, but does not make them approved releases.
Development and candidate builds remain native because bundled runtimes include
platform-specific binaries.

## Initial Distribution And Update Path

The initial channel is a human-approved manual download. The application has no
runtime release check, auto-update, or automatic downgrade authority.

| Action | Authority |
| --- | --- |
| Check candidate evidence and propose a release | Release maintainer |
| Approve a public desktop release | Human repository release maintainer |
| Publish or withdraw release artifacts | Repository maintainer with release permission |
| Check and download an approved release | Local product operator, manually |
| Declare rollback and restore the last verified artifact | Human repository release maintainer |

No workflow in this contract receives `contents: write`, an update-service
credential, or an implicit publish trigger. Publishing must remain a separate,
explicitly approved action.

## Credential Names And Configuration Locations

Run the release preflight on the intended native release host before any
privileged packaging work:

```text
pnpm desktop:release:preflight -- --platform win32 --arch x64
pnpm desktop:release:preflight -- --platform darwin --arch arm64
pnpm desktop:release:preflight -- --platform linux --arch x64
pnpm desktop:release:preflight -- --platform linux --arch arm64
```

Development mode is explicitly credential-free:

```text
node tools/dev/desktop-release-preflight.mjs --mode development --platform darwin --arch arm64
```

Release credentials belong in an approved release host's secret store or a
protected GitHub Environment. Never place values in repository files, workflow
inputs, issue comments, logs, artifacts, or release notes.

| Platform | Required names | Configuration location |
| --- | --- | --- |
| Windows | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Release-host environment or protected environment secrets |
| macOS signing | `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_TEAM_ID` | Release-host environment or protected environment secrets |
| macOS notarization, API-key option | `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | One complete protected secret group |
| macOS notarization, Keychain option | `APPLE_KEYCHAIN`, `APPLE_KEYCHAIN_PROFILE` | One complete approved release-host profile group |
| Linux | No platform code-signing credential in the initial contract | Checksums and evidence are still mandatory |

The preflight examines environment variable names only. Its output contains
missing names and never secret values. Passing it means only that the names are
present; it does not prove certificate validity, sign, notarize, staple, upload,
publish, or contact an update service.

## Required Evidence And Rollback

| Platform | Evidence before approval | Rollback expectation |
| --- | --- | --- |
| Windows x64 | Native candidate manifest, package verification, NSIS checksum, Authenticode signer/chain verification from #1617, install/launch result, release notes | Withdraw the failed release and restore the last verified NSIS installer; operators reinstall manually |
| macOS arm64 | Native candidate manifest, package verification, DMG checksum, Developer ID signature, notarization/staple and Gatekeeper evidence from #1617, install/launch result, release notes | Withdraw the failed release and restore the last verified DMG; operators reinstall manually; never auto-downgrade |
| Linux x64 | Native candidate manifest, package verification, AppImage/deb checksums, install/launch result, release notes | Restore the last verified AppImage/deb pair; operators choose and install it manually |
| Linux arm64 | Native ARM64 candidate manifest, package verification, AppImage/deb checksums, install/launch result, release notes | Restore the last verified ARM64 pair only after ARM64 evidence exists; do not substitute x64 evidence |

Evidence must identify the product version, git commit, target, artifact name,
checksum, native runner, check result, approver, and rollback target. A missing,
stale, cross-architecture, or failed record blocks approval.

## Stop Boundary

Issue #1828 ends at contract, preflight, documentation, and credential-free
tests. Issue #1617 remains responsible for real certificates, signing,
notarization, stapling, native install evidence, and external validation. No
artifact may be uploaded or published from #1828.
