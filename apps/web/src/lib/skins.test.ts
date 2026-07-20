import { afterEach, describe, expect, it } from "vitest";
import {
  applySkin,
  DEFAULT_MODE,
  DEFAULT_SKIN,
  isSkinId,
  isSkinMode,
  resolveMode,
  skinById,
  SKIN_IDS,
  SKINS,
} from "./skins";

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

afterEach(() => {
  document.documentElement.removeAttribute("data-skin");
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

describe("skin registry", () => {
  it("has unique ids and the default is registered", () => {
    expect(new Set(SKIN_IDS).size).toBe(SKIN_IDS.length);
    expect(SKIN_IDS).toContain(DEFAULT_SKIN);
    expect(isSkinMode(DEFAULT_MODE)).toBe(true);
  });

  it("every skin declares 3 swatches and valid light/dark chrome hex", () => {
    for (const skin of SKINS) {
      expect(skin.swatch).toHaveLength(3);
      expect(skin.chrome.light).toMatch(HEX_RE);
      expect(skin.chrome.dark).toMatch(HEX_RE);
    }
  });

  it("guards ids and modes", () => {
    expect(isSkinId("ocean")).toBe(true);
    expect(isSkinId("nope")).toBe(false);
    expect(isSkinMode("system")).toBe(true);
    expect(isSkinMode("bright")).toBe(false);
    expect(skinById("ocean").id).toBe("ocean");
    expect(skinById("missing" as never).id).toBe(DEFAULT_SKIN);
  });
});

describe("resolveMode", () => {
  it("passes concrete modes through", () => {
    expect(resolveMode("light")).toBe("light");
    expect(resolveMode("dark")).toBe("dark");
  });
});

describe("applySkin", () => {
  it("writes data-skin, the dark class, and color-scheme", () => {
    applySkin("ocean", "light");
    expect(document.documentElement.dataset.skin).toBe("ocean");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");

    applySkin("ink", "dark");
    expect(document.documentElement.dataset.skin).toBe("ink");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
