import { describe, expect, it } from "vitest";

import { formatDuration, formatTokens } from "@/lib/format";

describe("formatTokens", () => {
  it("thousands-separates and defaults non-finite to 0", () => {
    expect(formatTokens(1234567)).toBe((1234567).toLocaleString());
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(undefined)).toBe("0");
    expect(formatTokens(null)).toBe("0");
  });
});

describe("formatDuration", () => {
  it("renders ms, seconds, and minutes; null/negative → em dash", () => {
    expect(formatDuration(820)).toBe("820ms");
    expect(formatDuration(5000)).toBe("5.0s");
    expect(formatDuration(45000)).toBe("45s");
    expect(formatDuration(72000)).toBe("1m 12s");
    expect(formatDuration(120000)).toBe("2m");
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
  });
});
