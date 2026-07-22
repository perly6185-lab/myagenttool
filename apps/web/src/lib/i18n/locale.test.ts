import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyDocumentLocale,
  detectInitialLocale,
  detectLocale,
  localeDirection,
  normalizeLocale,
} from "@/lib/i18n/locale";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("locale resolution", () => {
  it("normalizes supported English and Simplified Chinese tags", () => {
    expect(normalizeLocale("en")).toBe("en-US");
    expect(normalizeLocale("en-GB")).toBe("en-US");
    expect(normalizeLocale("zh")).toBe("zh-CN");
    expect(normalizeLocale("zh_Hans")).toBe("zh-CN");
    expect(normalizeLocale("zh-SG")).toBe("zh-CN");
    expect(normalizeLocale("zh-CN-u-nu-hanidec")).toBe("zh-CN");
  });

  it("does not silently map unsupported locales or Chinese variants", () => {
    expect(normalizeLocale("fr-FR")).toBeNull();
    expect(normalizeLocale("zh-TW")).toBeNull();
    expect(normalizeLocale("zh-Hant")).toBeNull();
    expect(normalizeLocale(null)).toBeNull();
  });

  it("uses the first supported browser preference and otherwise English", () => {
    expect(detectLocale(["fr-FR", "zh-Hans", "en-US"])).toBe("zh-CN");
    expect(detectLocale(["de-DE", "zh-TW"])).toBe("en-US");
    expect(detectLocale([])).toBe("en-US");
  });

  it("prefers a valid persisted locale and ignores corrupt snapshots", () => {
    expect(detectInitialLocale({ getItem: () => JSON.stringify({ state: { locale: "zh-CN" } }) })).toBe("zh-CN");
    expect(detectInitialLocale({ getItem: () => "not-json" })).toBe("en-US");
  });
});

describe("document locale", () => {
  it("sets the resolved language and extensible direction mapping", () => {
    applyDocumentLocale("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.documentElement.dir).toBe("ltr");
    expect(localeDirection("en-US")).toBe("ltr");
  });
});
