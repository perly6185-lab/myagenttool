export const DESKTOP_RELEASE_CONTRACT = Object.freeze({
  schemaVersion: "desktop-release-contract/v1",
  builderConfig: "apps/electron/electron-builder.yml",
  documentation: "docs/engineering/DESKTOP_RELEASE_CONTRACT.md",
  distribution: Object.freeze({
    channel: "human-approved-manual-download",
    releaseCheckAuthority: "release-maintainer",
    downloadAuthority: "local-product-operator",
    publishAuthority: "repository-release-maintainer",
    rollbackAuthority: "repository-release-maintainer",
    runtimeUpdateChecks: false,
    automaticUpdate: false,
    automaticDowngrade: false,
    rollbackTarget: "last-verified-artifact",
  }),
  targets: Object.freeze([
    target("win32", "x64", ["nsis"], "native-windows-candidate", "pending-credential-validation"),
    target("darwin", "arm64", ["dmg"], "native-macos-candidate", "pending-credential-validation"),
    target("linux", "x64", ["AppImage", "deb"], "native-linux-candidate", "candidate-evidenced"),
    target("linux", "arm64", ["AppImage", "deb"], "native-linux-arm64-required", "configured"),
  ]),
  credentials: Object.freeze({
    win32: Object.freeze({
      required: Object.freeze(["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"]),
      alternatives: Object.freeze([]),
    }),
    darwin: Object.freeze({
      required: Object.freeze(["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_TEAM_ID"]),
      alternatives: Object.freeze([
        credentialGroup("app-store-connect-api-key", ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]),
        credentialGroup("notarytool-keychain-profile", ["APPLE_KEYCHAIN", "APPLE_KEYCHAIN_PROFILE"]),
      ]),
    }),
    linux: Object.freeze({
      required: Object.freeze([]),
      alternatives: Object.freeze([]),
    }),
  }),
});

function target(platform, architecture, artifacts, candidateEvidence, releaseState) {
  return Object.freeze({
    platform,
    architecture,
    artifacts: Object.freeze(artifacts),
    configured: true,
    candidateEvidence,
    releaseState,
  });
}

function credentialGroup(id, required) {
  return Object.freeze({ id, required: Object.freeze(required) });
}
