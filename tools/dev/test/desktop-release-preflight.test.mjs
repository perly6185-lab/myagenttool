import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DESKTOP_RELEASE_CONTRACT } from "../../../apps/electron/desktop-release-contract.mjs";
import { evaluateDesktopReleasePreflight } from "../desktop-release-preflight.mjs";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

test("development packaging stays credential-free on every configured platform", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const architecture = platform === "darwin" ? "arm64" : "x64";
    const result = evaluateDesktopReleasePreflight({ mode: "development", platform, architecture, environment: {} });
    assert.equal(result.ok, true);
    assert.match(result.message, /credential-free and ad-hoc/);
  }
});

test("Windows release preflight fails closed and reports names only", () => {
  const missing = evaluateDesktopReleasePreflight({ mode: "release", platform: "win32", architecture: "x64", environment: {} });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missingCredentialNames, ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"]);

  const certificate = "certificate-secret-marker";
  const password = "password-secret-marker";
  const ready = evaluateDesktopReleasePreflight({
    mode: "release",
    platform: "win32",
    architecture: "x64",
    environment: { WIN_CSC_LINK: certificate, WIN_CSC_KEY_PASSWORD: password },
  });
  assert.equal(ready.ok, true);
  assert.doesNotMatch(JSON.stringify(ready), new RegExp(`${certificate}|${password}`));
});

test("macOS release preflight accepts either complete notarization group", () => {
  const signing = { CSC_LINK: "ignored", CSC_KEY_PASSWORD: "ignored", APPLE_TEAM_ID: "ignored" };
  const incomplete = evaluateDesktopReleasePreflight({ mode: "release", platform: "darwin", architecture: "arm64", environment: signing });
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.message, /APPLE_API_KEY/);
  assert.match(incomplete.message, /APPLE_KEYCHAIN_PROFILE/);

  const apiKey = evaluateDesktopReleasePreflight({
    mode: "release",
    platform: "darwin",
    architecture: "arm64",
    environment: { ...signing, APPLE_API_KEY: "ignored", APPLE_API_KEY_ID: "ignored", APPLE_API_ISSUER: "ignored" },
  });
  assert.equal(apiKey.ok, true);

  const keychain = evaluateDesktopReleasePreflight({
    mode: "release",
    platform: "darwin",
    architecture: "arm64",
    environment: { ...signing, APPLE_KEYCHAIN: "ignored", APPLE_KEYCHAIN_PROFILE: "ignored" },
  });
  assert.equal(keychain.ok, true);
});

test("Linux release preflight requires no platform signing credential", () => {
  const result = evaluateDesktopReleasePreflight({ mode: "release", platform: "linux", architecture: "arm64", environment: {} });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missingCredentialNames, []);
});

test("canonical artifact matrix stays aligned with electron-builder and package commands", () => {
  assert.equal(DESKTOP_RELEASE_CONTRACT.distribution.runtimeUpdateChecks, false);
  assert.equal(DESKTOP_RELEASE_CONTRACT.distribution.automaticUpdate, false);
  assert.equal(DESKTOP_RELEASE_CONTRACT.distribution.automaticDowngrade, false);
  assert.deepEqual(
    DESKTOP_RELEASE_CONTRACT.targets.map(({ platform, architecture, artifacts }) => ({ platform, architecture, artifacts })),
    [
      { platform: "win32", architecture: "x64", artifacts: ["nsis"] },
      { platform: "darwin", architecture: "arm64", artifacts: ["dmg"] },
      { platform: "linux", architecture: "x64", artifacts: ["AppImage", "deb"] },
      { platform: "linux", architecture: "arm64", artifacts: ["AppImage", "deb"] },
    ],
  );

  const builder = readFileSync(resolve(root, "apps/electron/electron-builder.yml"), "utf8");
  for (const fragment of ["target: nsis", "target: dmg", "target: AppImage", "target: deb", "- x64", "- arm64"]) {
    assert.match(builder, new RegExp(fragment));
  }
  assert.doesNotMatch(builder, /^\s*publish:/m);

  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies?.["electron-updater"], undefined);
  assert.match(packageJson.scripts["desktop:dist"], /--win nsis --x64/);
  assert.match(packageJson.scripts["desktop:dist:mac"], /--mac dmg --arm64/);
  assert.match(packageJson.scripts["desktop:dist:linux"], /--linux AppImage deb --x64/);
  assert.match(packageJson.scripts["desktop:dist:linux:arm64"], /--linux AppImage deb --arm64/);

  const macSigning = readFileSync(resolve(root, "tools/dev/macos-code-signing.mjs"), "utf8");
  assert.match(macSigning, /process\.env\.APPLE_TEAM_ID/);

  const documentation = readFileSync(resolve(root, DESKTOP_RELEASE_CONTRACT.documentation), "utf8");
  const normalizedDocumentation = documentation.replace(/\s+/g, " ");
  for (const row of [
    "| Windows | x64 | NSIS |",
    "| macOS | arm64 | DMG |",
    "| Linux | x64 | AppImage, deb |",
    "| Linux | arm64 | AppImage, deb |",
  ]) {
    assert.equal(documentation.includes(row), true, `missing documented artifact row: ${row}`);
  }
  for (const policy of ["manual download", "no runtime release check", "auto-update", "automatic downgrade", "last verified artifact"]) {
    assert.equal(normalizedDocumentation.includes(policy), true, `missing documented distribution policy: ${policy}`);
  }
});
