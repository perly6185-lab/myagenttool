import { describe, expect, it } from "vitest";
import {
  applicationRecoveryDeepLink,
  applicationResultDeepLink,
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

  it("builds application result links", () => {
    const url = new URL(applicationResultDeepLink("app_docs", "app_render_123", "https://console.example.test/control?keep=yes&applicationResult=old"));

    expect(url.searchParams.get("section")).toBe("applications");
    expect(url.searchParams.get("application")).toBe("app_docs");
    expect(url.searchParams.get("applicationResult")).toBe("app_render_123");
    expect(url.searchParams.get("keep")).toBe("yes");
  });

  it("builds application recovery links from a run and recovery request", () => {
    const url = new URL(applicationRecoveryDeepLink({
      applicationId: "app_docs",
      routineId: "routine_docs",
      invocationId: "inv_docs",
    }, "app_rec_123", "https://console.example.test/control?keep=yes&recovery=old"));

    expect(url.searchParams.get("section")).toBe("applications");
    expect(url.searchParams.get("application")).toBe("app_docs");
    expect(url.searchParams.get("routine")).toBe("routine_docs");
    expect(url.searchParams.get("run")).toBe("inv_docs");
    expect(url.searchParams.get("recovery")).toBe("app_rec_123");
    expect(url.searchParams.get("keep")).toBe("yes");
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
      query: "?section=applications&application=app_docs&routine=routine_docs&run=inv_docs&applicationResult=app_render_docs&recovery=app_rec_docs&eventLevel=error&automation=atm_docs&evidence=ev_docs",
    }, "https://console.example.test/control?keep=yes&section=invocations&invocation=old&applicationResult=old_result&recovery=old_rec&evidence=old_ev#pane"));

    expect(url.origin).toBe("https://console.example.test");
    expect(url.pathname).toBe("/control");
    expect(url.hash).toBe("#pane");
    expect(url.searchParams.get("keep")).toBe("yes");
    expect(url.searchParams.get("section")).toBe("applications");
    expect(url.searchParams.get("invocation")).toBeNull();
    expect(url.searchParams.get("application")).toBe("app_docs");
    expect(url.searchParams.get("routine")).toBe("routine_docs");
    expect(url.searchParams.get("run")).toBe("inv_docs");
    expect(url.searchParams.get("applicationResult")).toBe("app_render_docs");
    expect(url.searchParams.get("recovery")).toBe("app_rec_docs");
    expect(url.searchParams.get("eventLevel")).toBe("error");
    expect(url.searchParams.get("automation")).toBe("atm_docs");
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
        applicationResult: "app_render_docs",
        recovery: "app_rec_docs",
        eventLevel: "warning",
        automation: "atm_docs",
      },
    })).toEqual({
      section: "applications",
      selectedApplicationId: "app_docs",
      selectedApplicationRun: {
        applicationId: "app_docs",
        routineId: "routine_docs",
        invocationId: "inv_docs",
      },
      selectedApplicationResultId: "app_render_docs",
      selectedApplicationRecoveryId: "app_rec_docs",
      selectedApplicationEventLevel: "warning",
      selectedApplicationAutomationId: "atm_docs",
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
