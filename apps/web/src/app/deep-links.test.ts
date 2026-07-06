import { describe, expect, it } from "vitest";
import {
  applicationRunDeepLink,
  evidenceDeepLink,
  invocationDeepLink,
  webNavigationLinkDeepLink,
  webNavigationStateFromLink,
} from "@/app/deep-links";

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

  it("builds evidence detail links from an evidence id", () => {
    const url = new URL(evidenceDeepLink("ev_123", "https://console.example.test/control?keep=yes&invocation=old#pane"));

    expect(url.origin).toBe("https://console.example.test");
    expect(url.pathname).toBe("/control");
    expect(url.hash).toBe("#pane");
    expect(url.searchParams.get("keep")).toBe("yes");
    expect(url.searchParams.get("section")).toBe("audit");
    expect(url.searchParams.get("invocation")).toBeNull();
    expect(url.searchParams.get("evidence")).toBe("ev_123");
  });

  it("builds links from server-provided relative Web navigation queries", () => {
    const url = new URL(webNavigationLinkDeepLink({
      query: "?section=applications&application=app_docs&routine=routine_docs&run=inv_docs&evidence=ev_docs",
    }, "https://console.example.test/control?keep=yes&section=invocations&invocation=old&evidence=old_ev#pane"));

    expect(url.origin).toBe("https://console.example.test");
    expect(url.pathname).toBe("/control");
    expect(url.hash).toBe("#pane");
    expect(url.searchParams.get("keep")).toBe("yes");
    expect(url.searchParams.get("section")).toBe("applications");
    expect(url.searchParams.get("invocation")).toBeNull();
    expect(url.searchParams.get("application")).toBe("app_docs");
    expect(url.searchParams.get("routine")).toBe("routine_docs");
    expect(url.searchParams.get("run")).toBe("inv_docs");
    expect(url.searchParams.get("evidence")).toBe("ev_docs");
  });

  it("maps server-provided structured targets to UI navigation state", () => {
    expect(webNavigationStateFromLink({
      query: "?section=applications&application=app_docs&routine=routine_docs&run=inv_docs",
      target: {
        section: "applications",
        application: "app_docs",
        routine: "routine_docs",
        run: "inv_docs",
      },
    })).toEqual({
      section: "applications",
      selectedApplicationId: "app_docs",
      selectedApplicationRun: {
        applicationId: "app_docs",
        routineId: "routine_docs",
        invocationId: "inv_docs",
      },
    });

    expect(webNavigationStateFromLink({
      query: "?section=audit&evidence=ev_docs",
      target: {
        section: "audit",
        evidence: "ev_docs",
      },
    })).toEqual({
      section: "audit",
      selectedApplicationRun: null,
      selectedEvidenceId: "ev_docs",
    });
  });
});
