import { describe, expect, it } from "vitest";
import { sourceSummary } from "@/features/applications/application-source-summary";

describe("sourceSummary", () => {
  it("summarizes each application source type", () => {
    expect(sourceSummary({ type: "git", url: "github.com/acme/web" })).toBe("github.com/acme/web");
    expect(sourceSummary({ type: "local", path: "/path/to/app" })).toBe("/path/to/app");
    expect(sourceSummary({ type: "npm", package: "@scope/pkg", version: "1.0.0" })).toBe("@scope/pkg@1.0.0");
    expect(sourceSummary({ type: "npm", package: "left-pad" })).toBe("left-pad");
    expect(sourceSummary({ type: "manual", uri: "https://example.com" })).toBe("https://example.com");
    expect(sourceSummary({ type: "manual" })).toBe("manual manifest");
  });
});
