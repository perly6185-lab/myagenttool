import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUrlNavigationSync } from "@/app/url-navigation-sync";
import { useUiStore } from "@/store/ui-store";

function SyncHarness() {
  useUrlNavigationSync();
  return null;
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  useUiStore.setState({
    section: "dashboard",
    selectedInvocationId: null,
    selectedApplicationId: null,
    selectedApplicationRun: null,
    selectedApplicationResultId: null,
    selectedApplicationEventLevel: "all",
    selectedApplicationAutomationId: null,
    selectedEvidenceId: null,
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("useUrlNavigationSync", () => {
  it("hydrates store navigation from the current URL", () => {
    window.history.replaceState(null, "", "/?section=applications&application=app_docs&routine=routine_docs&run=inv_docs&applicationResult=app_render_docs&eventLevel=warning&automation=atm_docs&evidence=ev_docs");

    render(<SyncHarness />);

    expect(useUiStore.getState().section).toBe("applications");
    expect(useUiStore.getState().selectedApplicationId).toBe("app_docs");
    expect(useUiStore.getState().selectedApplicationRun).toEqual({
      applicationId: "app_docs",
      routineId: "routine_docs",
      invocationId: "inv_docs",
    });
    expect(useUiStore.getState().selectedApplicationResultId).toBe("app_render_docs");
    expect(useUiStore.getState().selectedApplicationEventLevel).toBe("warning");
    expect(useUiStore.getState().selectedApplicationAutomationId).toBe("atm_docs");
    expect(useUiStore.getState().selectedEvidenceId).toBe("ev_docs");
  });

  it("writes store navigation changes back to the URL", async () => {
    render(<SyncHarness />);

    useUiStore.getState().setSelectedInvocationId("inv_result");
    useUiStore.getState().setSelectedEvidenceId("ev_result");
    useUiStore.setState({ selectedApplicationId: "app_result", selectedApplicationResultId: "app_render_result" });
    useUiStore.getState().setSelectedApplicationEventLevel("error");
    useUiStore.getState().setSection("applications");

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get("section")).toBe("applications");
      expect(params.get("invocation")).toBe("inv_result");
      expect(params.get("application")).toBe("app_result");
      expect(params.get("applicationResult")).toBe("app_render_result");
      expect(params.get("eventLevel")).toBe("error");
      expect(params.get("evidence")).toBe("ev_result");
    });
  });

  it("applies popstate URL changes without keeping stale run or evidence selections", () => {
    window.history.replaceState(null, "", "/?section=applications&application=app_docs&routine=routine_docs&run=inv_docs&applicationResult=app_render_docs&eventLevel=error&automation=atm_docs&evidence=ev_docs");
    render(<SyncHarness />);

    window.history.replaceState(null, "", "/?section=applications&application=app_other");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(useUiStore.getState().section).toBe("applications");
    expect(useUiStore.getState().selectedApplicationId).toBe("app_other");
    expect(useUiStore.getState().selectedApplicationRun).toBeNull();
    expect(useUiStore.getState().selectedApplicationResultId).toBeNull();
    expect(useUiStore.getState().selectedApplicationEventLevel).toBe("all");
    expect(useUiStore.getState().selectedApplicationAutomationId).toBeNull();
    expect(useUiStore.getState().selectedEvidenceId).toBeNull();
  });
});
