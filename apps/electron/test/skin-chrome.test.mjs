import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  DEFAULT_CHROME,
  readSkinSettings,
  registerSkinChrome,
  sanitizeChrome,
  skinSettingsPath,
  writeSkinSettings,
} from "../src/skin-chrome.mjs";

test("sanitizeChrome accepts valid hex + theme source, rejects the rest", () => {
  assert.deepEqual(sanitizeChrome({ bg: "#0a1522", themeSource: "dark" }), {
    bg: "#0a1522",
    themeSource: "dark",
  });
  assert.deepEqual(sanitizeChrome({ bg: "#fff", themeSource: "system" }), {
    bg: "#fff",
    themeSource: "system",
  });
  assert.equal(sanitizeChrome({ bg: "red", themeSource: "dark" }), null);
  assert.equal(sanitizeChrome({ bg: "#0a1522; drop", themeSource: "dark" }), null);
  assert.equal(sanitizeChrome({ bg: "#0a1522", themeSource: "neon" }), null);
  assert.equal(sanitizeChrome(null), null);
});

test("read falls back to default until something is written, then round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "skin-chrome-"));
  try {
    assert.deepEqual(readSkinSettings(dir), DEFAULT_CHROME);
    writeSkinSettings(dir, { bg: "#f4f8fb", themeSource: "light" });
    assert.deepEqual(readSkinSettings(dir), { bg: "#f4f8fb", themeSource: "light" });
    assert.equal(JSON.parse(readFileSync(skinSettingsPath(dir), "utf8")).bg, "#f4f8fb");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("read ignores a corrupt or unsafe settings file", () => {
  const dir = mkdtempSync(join(tmpdir(), "skin-chrome-"));
  try {
    writeSkinSettings(dir, { bg: "not-a-color", themeSource: "dark" });
    // writeSkinSettings persists verbatim; read must still reject the bad bg.
    assert.deepEqual(readSkinSettings(dir), DEFAULT_CHROME);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("registerSkinChrome drives the window + persists on a valid message", () => {
  const dir = mkdtempSync(join(tmpdir(), "skin-chrome-"));
  try {
    const calls = [];
    const listeners = new Map();
    const ipcMain = {
      on: (channel, fn) => listeners.set(channel, fn),
      removeListener: (channel) => listeners.delete(channel),
    };
    const nativeTheme = {};
    const win = { isDestroyed: () => false, setBackgroundColor: (bg) => calls.push(bg) };
    const dispose = registerSkinChrome({
      ipcMain,
      nativeTheme,
      stateDir: dir,
      getWindow: () => win,
    });

    listeners.get("skin:apply-chrome")(null, { bg: "#131316", themeSource: "system" });
    assert.equal(nativeTheme.themeSource, "system");
    assert.deepEqual(calls, ["#131316"]);
    assert.deepEqual(readSkinSettings(dir), { bg: "#131316", themeSource: "system" });

    // A malformed message is a no-op: no window call, no persisted change.
    listeners.get("skin:apply-chrome")(null, { bg: "javascript:alert(1)", themeSource: "dark" });
    assert.deepEqual(calls, ["#131316"]);
    assert.deepEqual(readSkinSettings(dir), { bg: "#131316", themeSource: "system" });

    dispose();
    assert.equal(listeners.has("skin:apply-chrome"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
