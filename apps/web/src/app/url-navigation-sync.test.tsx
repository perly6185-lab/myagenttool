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
    selectedEvidenceId: null,
    selectedWorkItemId: null,
    selectedWorkItemMode: "summary",
    selectedWorkItemSection: "overview",
    taskArea: "overview",
    settingsDialogOpen: false,
    settingsCategory: null,
    settingsQuery: "",
    selectedPlanningProjectId: null,
    planningProjectView: "list",
    planningProjectFilters: { status: "all", priority: "all", milestone: "", due: "all" },
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("useUrlNavigationSync", () => {
  it("hydrates store navigation from the current URL", () => {
    window.history.replaceState(null, "", "/?section=applications&application=app_docs&routine=routine_docs&run=inv_docs&evidence=ev_docs");

    render(<SyncHarness />);

    expect(useUiStore.getState().section).toBe("applications");
    expect(useUiStore.getState().selectedApplicationId).toBe("app_docs");
    expect(useUiStore.getState().selectedApplicationRun).toEqual({
      applicationId: "app_docs",
      routineId: "routine_docs",
      invocationId: "inv_docs",
    });
    expect(useUiStore.getState().selectedEvidenceId).toBe("ev_docs");
  });

  it("writes store navigation changes back to the URL", async () => {
    render(<SyncHarness />);

    useUiStore.getState().setSelectedInvocationId("inv_result");
    useUiStore.getState().setSelectedEvidenceId("ev_result");
    useUiStore.getState().setSection("invocations");

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get("section")).toBe("invocations");
      expect(params.get("invocation")).toBe("inv_result");
      expect(params.get("evidence")).toBe("ev_result");
    });
  });

  it("keeps an in-place task detail in the current surface URL", async () => {
    render(<SyncHarness />);

    useUiStore.getState().openWorkItem("lwi_home", { mode: "expert", section: "process" });

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get("section")).toBe("dashboard");
      expect(params.get("task")).toBe("lwi_home");
      expect(params.get("taskMode")).toBe("expert");
      expect(params.get("taskView")).toBe("process");
    });
  });

  it("restores and writes the Tasks workspace area", async () => {
    window.history.replaceState(null, "", "/?section=task&taskArea=assets");
    render(<SyncHarness />);
    expect(useUiStore.getState().taskArea).toBe("assets");

    useUiStore.getState().setTaskArea("verification");
    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get("section")).toBe("task");
      expect(params.get("taskArea")).toBe("verification");
    });
  });

  it("restores and replaces the My settings context in its deep link", async () => {
    window.history.replaceState(null, "", "/?section=settings&settingsCategory=connections&settingsQuery=channel");
    render(<SyncHarness />);
    expect(useUiStore.getState().settingsCategory).toBe("connections");
    expect(useUiStore.getState().settingsQuery).toBe("channel");

    useUiStore.getState().setSettingsCategory("diagnostics");
    useUiStore.getState().setSettingsQuery("run record");
    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get("settingsCategory")).toBe("diagnostics");
      expect(params.get("settingsQuery")).toBe("run record");
    });
  });

  it("keeps a contextual professional page inside the settings dialog across refresh", async () => {
    window.history.replaceState(null, "", "/?section=autoRuns&settingsOpen=true&settingsCategory=automation");
    render(<SyncHarness />);
    expect(useUiStore.getState().section).toBe("autoRuns");
    expect(useUiStore.getState().settingsDialogOpen).toBe(true);

    useUiStore.getState().setSection("approvals");
    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get("section")).toBe("approvals");
      expect(params.get("settingsOpen")).toBe("true");
    });
  });

  it("applies popstate URL changes without keeping stale run or evidence selections", () => {
    window.history.replaceState(null, "", "/?section=applications&application=app_docs&routine=routine_docs&run=inv_docs&evidence=ev_docs");
    render(<SyncHarness />);

    window.history.replaceState(null, "", "/?section=applications&application=app_other");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(useUiStore.getState().section).toBe("applications");
    expect(useUiStore.getState().selectedApplicationId).toBe("app_other");
    expect(useUiStore.getState().selectedApplicationRun).toBeNull();
    expect(useUiStore.getState().selectedEvidenceId).toBeNull();
  });

  it("restores and writes planning workspace selection", async () => {
    window.history.replaceState(null, "", "/?section=planning&planningProject=ppj_1&planningView=board");
    render(<SyncHarness />);
    expect(useUiStore.getState().selectedPlanningProjectId).toBe("ppj_1");
    expect(useUiStore.getState().planningProjectView).toBe("board");

    useUiStore.getState().setSelectedPlanningProjectId("ppj_2");
    useUiStore.getState().setPlanningProjectView("list");
    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get("planningProject")).toBe("ppj_2");
      expect(params.get("planningView")).toBe("list");
    });
  });
});
