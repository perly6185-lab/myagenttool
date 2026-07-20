import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  DEFAULT_CHROME,
  overlayFromChrome,
  readSkinSettings,
  registerSkinChrome,
  sanitizeChrome,
  skinSettingsPath,
  TITLEBAR_HEIGHT,
  writeSkinSettings,
} from "../src/skin-chrome.mjs";

test("sanitizeChrome accepts valid input and derives the resolved mode", () => {
  assert.deepEqual(sanitizeChrome({ bg: "#0a1522", themeSource: "dark" }), {
    bg: "#0a1522",
    themeSource: "dark",
    resolved: "dark",
  });
  // themeSource=system carries no light/dark on its own -> explicit resolved wins.
  assert.deepEqual(sanitizeChrome({ bg: "#fff", themeSource: "system", resolved: "light" }), {
    bg: "#fff",
    themeSource: "system",
    resolved: "light",
  });
  // system without a resolved hint falls back to dark.
  assert.equal(sanitizeChrome({ bg: "#fff", themeSource: "system" }).resolved, "dark");
});

test("sanitizeChrome rejects unsafe bg / themeSource", () => {
  assert.equal(sanitizeChrome({ bg: "red", themeSource: "dark" }), null);
  assert.equal(sanitizeChrome({ bg: "#0a1522; drop", themeSource: "dark" }), null);
  assert.equal(sanitizeChrome({ bg: "#0a1522", themeSource: "neon" }), null);
  assert.equal(sanitizeChrome(null), null);
});

test("overlayFromChrome maps skin bg + resolved to caption colors", () => {
  assert.deepEqual(overlayFromChrome({ bg: "#0a1522", resolved: "dark" }), {
    color: "#0a1522",
    symbolColor: "#e6e6e6",
    height: TITLEBAR_HEIGHT,
  });
  assert.equal(overlayFromChrome({ bg: "#f4f8fb", resolved: "light" }).symbolColor, "#1f2328");
});

test("read falls back to default until something is written, then round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "skin-chrome-"));
  try {
    assert.deepEqual(readSkinSettings(dir), DEFAULT_CHROME);
    writeSkinSettings(dir, { bg: "#f4f8fb", themeSource: "light" });
    assert.deepEqual(readSkinSettings(dir), { bg: "#f4f8fb", themeSource: "light", resolved: "light" });
    assert.equal(JSON.parse(readFileSync(skinSettingsPath(dir), "utf8")).bg, "#f4f8fb");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("read ignores a corrupt or unsafe settings file", () => {
  const dir = mkdtempSync(join(tmpdir(), "skin-chrome-"));
  try {
    writeSkinSettings(dir, { bg: "not-a-color", themeSource: "dark" });
    assert.deepEqual(readSkinSettings(dir), DEFAULT_CHROME);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("registerSkinChrome drives the window + persists on a valid message", () => {
  const dir = mkdtempSync(join(tmpdir(), "skin-chrome-"));
  try {
    const bgCalls = [];
    const listeners = new Map();
    const ipcMain = {
      on: (channel, fn) => listeners.set(channel, fn),
      removeListener: (channel) => listeners.delete(channel),
    };
    const nativeTheme = {};
    const win = { isDestroyed: () => false, setBackgroundColor: (bg) => bgCalls.push(bg) };
    const dispose = registerSkinChrome({ ipcMain, nativeTheme, stateDir: dir, getWindow: () => win, overlay: false });

    listeners.get("skin:apply-chrome")(null, { bg: "#131316", themeSource: "system", resolved: "dark" });
    assert.equal(nativeTheme.themeSource, "system");
    assert.deepEqual(bgCalls, ["#131316"]);
    assert.deepEqual(readSkinSettings(dir), { bg: "#131316", themeSource: "system", resolved: "dark" });

    // A malformed message is a no-op: no window call, no persisted change.
    listeners.get("skin:apply-chrome")(null, { bg: "javascript:alert(1)", themeSource: "dark" });
    assert.deepEqual(bgCalls, ["#131316"]);
    assert.deepEqual(readSkinSettings(dir), { bg: "#131316", themeSource: "system", resolved: "dark" });

    dispose();
    assert.equal(listeners.has("skin:apply-chrome"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("registerSkinChrome recolors the caption overlay only when enabled", () => {
  const dir = mkdtempSync(join(tmpdir(), "skin-chrome-"));
  try {
    const overlayCalls = [];
    const listeners = new Map();
    const ipcMain = { on: (c, fn) => listeners.set(c, fn), removeListener: (c) => listeners.delete(c) };
    const win = {
      isDestroyed: () => false,
      setBackgroundColor: () => {},
      setTitleBarOverlay: (opts) => overlayCalls.push(opts),
    };
    registerSkinChrome({ ipcMain, nativeTheme: {}, stateDir: dir, getWindow: () => win, overlay: true });

    listeners.get("skin:apply-chrome")(null, { bg: "#f4f8fb", themeSource: "light", resolved: "light" });
    assert.deepEqual(overlayCalls, [{ color: "#f4f8fb", symbolColor: "#1f2328", height: TITLEBAR_HEIGHT }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
