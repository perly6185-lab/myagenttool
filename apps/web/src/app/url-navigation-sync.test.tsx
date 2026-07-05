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
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("useUrlNavigationSync", () => {
  it("hydrates store navigation from the current URL", () => {
    window.history.replaceState(null, "", "/?section=applications&application=app_docs&routine=routine_docs&run=inv_docs");

    render(<SyncHarness />);

    expect(useUiStore.getState().section).toBe("applications");
    expect(useUiStore.getState().selectedApplicationId).toBe("app_docs");
    expect(useUiStore.getState().selectedApplicationRun).toEqual({
      applicationId: "app_docs",
      routineId: "routine_docs",
      invocationId: "inv_docs",
    });
  });

  it("writes store navigation changes back to the URL", async () => {
    render(<SyncHarness />);

    useUiStore.getState().setSelectedInvocationId("inv_result");
    useUiStore.getState().setSection("invocations");

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get("section")).toBe("invocations");
      expect(params.get("invocation")).toBe("inv_result");
    });
  });

  it("applies popstate URL changes without keeping stale run selections", () => {
    window.history.replaceState(null, "", "/?section=applications&application=app_docs&routine=routine_docs&run=inv_docs");
    render(<SyncHarness />);

    window.history.replaceState(null, "", "/?section=applications&application=app_other");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(useUiStore.getState().section).toBe("applications");
    expect(useUiStore.getState().selectedApplicationId).toBe("app_other");
    expect(useUiStore.getState().selectedApplicationRun).toBeNull();
  });
});
