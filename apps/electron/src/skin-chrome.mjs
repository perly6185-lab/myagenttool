// Native window chrome for the active skin: validate the renderer's request,
// drive the window backing color + OS theme source, and persist the choice so a
// cold start paints the correct frame before the web app loads (no white flash,
// no mismatched title bar). See docs/design/SKIN_SYSTEM.md. Kept as a small,
// injectable module so the logic is unit-testable without booting Electron.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SKIN_HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SKIN_THEME_SOURCES = new Set(["light", "dark", "system"]);

export const DEFAULT_CHROME = { bg: "#0f1116", themeSource: "dark" };

/** Return a validated `{ bg, themeSource }`, or null if either field is unsafe. */
export function sanitizeChrome(input) {
  if (!input || typeof input !== "object") return null;
  const bg = SKIN_HEX_RE.test(input.bg) ? input.bg : null;
  const themeSource = SKIN_THEME_SOURCES.has(input.themeSource) ? input.themeSource : null;
  return bg && themeSource ? { bg, themeSource } : null;
}

export function skinSettingsPath(stateDir) {
  return join(stateDir, "skin-settings.json");
}

/** Read the persisted chrome, falling back to the default on any problem. */
export function readSkinSettings(stateDir) {
  try {
    const path = skinSettingsPath(stateDir);
    if (!existsSync(path)) return { ...DEFAULT_CHROME };
    return sanitizeChrome(JSON.parse(readFileSync(path, "utf8"))) ?? { ...DEFAULT_CHROME };
  } catch {
    return { ...DEFAULT_CHROME };
  }
}

export function writeSkinSettings(stateDir, chrome, onError) {
  try {
    const path = skinSettingsPath(stateDir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(chrome));
  } catch (error) {
    onError?.(error);
  }
}

/**
 * Wire the `skin:apply-chrome` IPC channel. Injected `ipcMain` / `nativeTheme`
 * keep this Electron-free at import time. `getWindow()` returns the current
 * BrowserWindow (or null). Returns a disposer that removes the listener.
 */
export function registerSkinChrome({ ipcMain, nativeTheme, stateDir, getWindow, onError }) {
  const handler = (_event, input) => {
    const chrome = sanitizeChrome(input);
    if (!chrome) return;
    nativeTheme.themeSource = chrome.themeSource;
    const win = getWindow?.();
    if (win && !win.isDestroyed()) win.setBackgroundColor(chrome.bg);
    writeSkinSettings(stateDir, chrome, onError);
  };
  ipcMain.on("skin:apply-chrome", handler);
  return () => ipcMain.removeListener("skin:apply-chrome", handler);
}
