import { beforeEach, describe, expect, it } from "vitest";
import {
  navigationFromSearch,
  searchFromNavigationState,
  useUiStore,
} from "@/store/ui-store";

beforeEach(() => localStorage.clear());

describe("ui-store persistence", () => {
  it("persists section + selections to localStorage, excluding setters", () => {
    useUiStore.getState().setSection("applications");
    useUiStore.getState().setSelectedApplicationId("app_123");
    useUiStore.getState().setSelectedApplicationRun({
      applicationId: "app_123",
      routineId: "routine_123",
      invocationId: "inv_123",
    });
    useUiStore.getState().setSelectedApplicationEventLevel("error");
    useUiStore.getState().setSelectedEvidenceId("ev_123");

    const raw = localStorage.getItem("myagenttool-ui");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.version).toBe(1);
    expect(parsed.state.section).toBe("applications");
    expect(parsed.state.selectedApplicationId).toBe("app_123");
    expect(parsed.state.selectedApplicationRun).toEqual({
      applicationId: "app_123",
      routineId: "routine_123",
      invocationId: "inv_123",
    });
    expect(parsed.state.selectedApplicationEventLevel).toBe("error");
    expect(parsed.state.selectedEvidenceId).toBe("ev_123");
    // Setter functions must never be serialized.
    expect(parsed.state.setSection).toBeUndefined();
    expect(parsed.state.setSelectedApplicationId).toBeUndefined();
    expect(parsed.state.setSelectedEvidenceId).toBeUndefined();
  });
});

describe("URL navigation helpers", () => {
  it("parses valid navigation params and ignores unknown sections", () => {
    expect(navigationFromSearch("?section=applications&application=app_1&routine=routine_1&run=inv_1&eventLevel=error&evidence=ev_1")).toEqual({
      section: "applications",
      selectedInvocationId: null,
      selectedApplicationId: "app_1",
      selectedApplicationRun: {
        applicationId: "app_1",
        routineId: "routine_1",
        invocationId: "inv_1",
      },
      selectedApplicationEventLevel: "error",
      selectedEvidenceId: "ev_1",
    });

    expect(navigationFromSearch("?section=missing&application=app_1&routine=routine_1")).toMatchObject({
      selectedInvocationId: null,
      selectedApplicationId: "app_1",
      selectedApplicationRun: null,
      selectedEvidenceId: null,
    });
    expect(navigationFromSearch("")).toEqual({});
  });

  it("serializes navigation state while preserving unrelated query params", () => {
    const search = searchFromNavigationState("?keep=yes&section=dashboard&invocation=old&evidence=old_ev", {
      section: "applications",
      selectedInvocationId: "inv_selected",
      selectedApplicationId: "app_selected",
      selectedApplicationRun: {
        applicationId: "app_run",
        routineId: "routine_run",
        invocationId: "inv_run",
      },
      selectedApplicationEventLevel: "warning",
      selectedEvidenceId: "ev_selected",
    });
    const params = new URLSearchParams(search);

    expect(params.get("keep")).toBe("yes");
    expect(params.get("section")).toBe("applications");
    expect(params.get("invocation")).toBe("inv_selected");
    expect(params.get("application")).toBe("app_run");
    expect(params.get("routine")).toBe("routine_run");
    expect(params.get("run")).toBe("inv_run");
    expect(params.get("eventLevel")).toBe("warning");
    expect(params.get("evidence")).toBe("ev_selected");
  });

  it("clears stale evidence params when evidence is absent from navigation state", () => {
    const search = searchFromNavigationState("?keep=yes&section=audit&evidence=old_ev", {
      section: "audit",
      selectedInvocationId: null,
      selectedApplicationId: null,
      selectedApplicationRun: null,
      selectedApplicationEventLevel: "all",
      selectedEvidenceId: null,
    });
    const params = new URLSearchParams(search);

    expect(params.get("keep")).toBe("yes");
    expect(params.get("section")).toBe("audit");
    expect(params.get("evidence")).toBeNull();
  });
});
