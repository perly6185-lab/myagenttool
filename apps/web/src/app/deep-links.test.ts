import { describe, expect, it } from "vitest";
import { applicationRunDeepLink, invocationDeepLink, webNavigationLinkDeepLink } from "@/app/deep-links";

describe("deep link helpers", () => {
  it("builds invocation links without dropping origin, path, hash, or unrelated params", () => {
    const url = new URL(invocationDeepLink("inv_123", "https://console.example.test/control?keep=yes#pane"));

    expect(url.origin).toBe("https://console.example.test");
    expect(url.pathname).toBe("/control");
    expect(url.hash).toBe("#pane");
    expect(url.searchParams.get("keep")).toBe("yes");
    expect(url.searchParams.get("section")).toBe("invocations");
    expect(url.searchParams.get("invocation")).toBe("inv_123");
  });

  it("builds application run links from the run selection", () => {
    const url = new URL(applicationRunDeepLink({
      applicationId: "app_docs",
      routineId: "routine_docs",
      invocationId: "inv_docs",
    }, "https://console.example.test/control?keep=yes"));

    expect(url.searchParams.get("section")).toBe("applications");
    expect(url.searchParams.get("application")).toBe("app_docs");
    expect(url.searchParams.get("routine")).toBe("routine_docs");
    expect(url.searchParams.get("run")).toBe("inv_docs");
  });

  it("builds links from server-provided relative Web navigation queries", () => {
    const url = new URL(webNavigationLinkDeepLink({
      query: "?section=applications&application=app_docs&routine=routine_docs&run=inv_docs",
    }, "https://console.example.test/control?keep=yes&section=invocations&invocation=old#pane"));

    expect(url.origin).toBe("https://console.example.test");
    expect(url.pathname).toBe("/control");
    expect(url.hash).toBe("#pane");
    expect(url.searchParams.get("keep")).toBe("yes");
    expect(url.searchParams.get("section")).toBe("applications");
    expect(url.searchParams.get("invocation")).toBeNull();
    expect(url.searchParams.get("application")).toBe("app_docs");
    expect(url.searchParams.get("routine")).toBe("routine_docs");
    expect(url.searchParams.get("run")).toBe("inv_docs");
  });
});
