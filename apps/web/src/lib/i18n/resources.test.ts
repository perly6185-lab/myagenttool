import { describe, expect, it } from "vitest";
import { resources } from "@/lib/i18n/resources";

function flatten(value: unknown, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") result.set(path, child);
    else resultForChild(child, path, result);
  }
  return result;
}

function resultForChild(value: unknown, prefix: string, target: Map<string, string>): void {
  for (const [key, child] of flatten(value, prefix)) target.set(key, child);
}

function variables(value: string): string[] {
  return [...value.matchAll(/{{\s*([^},\s]+).*?}}/g)].map((match) => match[1]).sort();
}

describe("translation resources", () => {
  it("keeps both locales complete, non-empty, and interpolation-compatible", () => {
    const english = flatten(resources["en-US"].common);
    const chinese = flatten(resources["zh-CN"].common);
    expect([...chinese.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [key, value] of english) {
      const translated = chinese.get(key);
      expect(value.trim(), `${key} English`).not.toBe("");
      expect(translated?.trim(), `${key} Chinese`).not.toBe("");
      expect(variables(translated ?? ""), `${key} variables`).toEqual(variables(value));
    }
  });
});
