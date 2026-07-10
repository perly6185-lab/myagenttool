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
    useUiStore.getState().setSelectedApplicationResultId("app_result_123");
    useUiStore.getState().setSelectedApplicationRecoveryId("app_rec_123");
    useUiStore.getState().setSelectedApplicationEventLevel("error");
    useUiStore.getState().setSelectedApplicationAutomationId("atm_123");
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
    expect(parsed.state.selectedApplicationResultId).toBe("app_result_123");
    expect(parsed.state.selectedApplicationRecoveryId).toBe("app_rec_123");
    expect(parsed.state.selectedApplicationEventLevel).toBe("error");
    expect(parsed.state.selectedApplicationAutomationId).toBe("atm_123");
    expect(parsed.state.selectedEvidenceId).toBe("ev_123");
    // Setter functions must never be serialized.
    expect(parsed.state.setSection).toBeUndefined();
    expect(parsed.state.setSelectedApplicationId).toBeUndefined();
    expect(parsed.state.setSelectedApplicationResultId).toBeUndefined();
    expect(parsed.state.setSelectedEvidenceId).toBeUndefined();
  });

  it("clears the selected application result when switching applications", () => {
    useUiStore.setState({
      selectedApplicationId: "app_old",
      selectedApplicationResultId: "app_result_old",
      selectedApplicationRecoveryId: "app_rec_old",
    });

    useUiStore.getState().setSelectedApplicationId("app_new");

    expect(useUiStore.getState().selectedApplicationId).toBe("app_new");
    expect(useUiStore.getState().selectedApplicationResultId).toBeNull();
    expect(useUiStore.getState().selectedApplicationRecoveryId).toBeNull();
  });
});

describe("URL navigation helpers", () => {
  it("parses valid navigation params and ignores unknown sections", () => {
    expect(navigationFromSearch("?section=applications&application=app_1&routine=routine_1&run=inv_1&applicationResult=app_result_1&recovery=app_rec_1&eventLevel=error&automation=atm_1&evidence=ev_1")).toEqual({
      section: "applications",
      selectedInvocationId: null,
      selectedToolName: null,
      selectedToolFocus: null,
      selectedApplicationId: "app_1",
      selectedApplicationRun: {
        applicationId: "app_1",
        routineId: "routine_1",
        invocationId: "inv_1",
      },
      selectedApplicationResultId: "app_result_1",
      selectedApplicationRecoveryId: "app_rec_1",
      selectedApplicationEventLevel: "error",
      selectedApplicationAutomationId: "atm_1",
      selectedEvidenceId: "ev_1",
    });

    expect(navigationFromSearch("?section=missing&application=app_1&routine=routine_1")).toMatchObject({
      selectedInvocationId: null,
      selectedToolName: null,
      selectedToolFocus: null,
      selectedApplicationId: "app_1",
      selectedApplicationRun: null,
      selectedApplicationResultId: null,
      selectedApplicationRecoveryId: null,
      selectedApplicationAutomationId: null,
      selectedEvidenceId: null,
    });
    expect(navigationFromSearch("")).toEqual({});
    expect(navigationFromSearch("?section=tools&tool=codex&focus=ops")).toMatchObject({
      section: "tools",
      selectedToolName: "codex",
      selectedToolFocus: "ops",
    });
  });

  it("serializes navigation state while preserving unrelated query params", () => {
    const search = searchFromNavigationState("?keep=yes&section=dashboard&invocation=old&applicationResult=old_result&evidence=old_ev", {
      section: "applications",
      selectedInvocationId: "inv_selected",
      selectedToolName: "codex",
      selectedToolFocus: "ops",
      selectedApplicationId: "app_selected",
      selectedApplicationRun: {
        applicationId: "app_run",
        routineId: "routine_run",
        invocationId: "inv_run",
      },
      selectedApplicationResultId: "result_selected",
      selectedApplicationRecoveryId: "rec_selected",
      selectedApplicationEventLevel: "warning",
      selectedApplicationAutomationId: "atm_selected",
      selectedEvidenceId: "ev_selected",
    });
    const params = new URLSearchParams(search);

    expect(params.get("keep")).toBe("yes");
    expect(params.get("section")).toBe("applications");
    expect(params.get("invocation")).toBe("inv_selected");
    expect(params.get("tool")).toBeNull();
    expect(params.get("focus")).toBeNull();
    expect(params.get("application")).toBe("app_run");
    expect(params.get("routine")).toBe("routine_run");
    expect(params.get("run")).toBe("inv_run");
    expect(params.get("applicationResult")).toBe("result_selected");
    expect(params.get("recovery")).toBe("rec_selected");
    expect(params.get("eventLevel")).toBe("warning");
    expect(params.get("automation")).toBe("atm_selected");
    expect(params.get("evidence")).toBe("ev_selected");
  });

  it("clears stale evidence, application result, recovery, and automation params when absent from navigation state", () => {
    const search = searchFromNavigationState("?keep=yes&section=audit&applicationResult=old_result&recovery=old_rec&automation=old_atm&evidence=old_ev", {
      section: "audit",
      selectedInvocationId: null,
      selectedToolName: null,
      selectedToolFocus: null,
      selectedApplicationId: null,
      selectedApplicationRun: null,
      selectedApplicationResultId: null,
      selectedApplicationRecoveryId: null,
      selectedApplicationEventLevel: "all",
      selectedApplicationAutomationId: null,
      selectedEvidenceId: null,
    });
    const params = new URLSearchParams(search);

    expect(params.get("keep")).toBe("yes");
    expect(params.get("section")).toBe("audit");
    expect(params.get("applicationResult")).toBeNull();
    expect(params.get("recovery")).toBeNull();
    expect(params.get("automation")).toBeNull();
    expect(params.get("evidence")).toBeNull();
  });

  it("serializes tools deep links with selected tool focus", () => {
    const search = searchFromNavigationState("?keep=yes", {
      section: "tools",
      selectedInvocationId: null,
      selectedToolName: "codex",
      selectedToolFocus: "ops",
      selectedApplicationId: null,
      selectedApplicationRun: null,
      selectedApplicationResultId: null,
      selectedApplicationRecoveryId: null,
      selectedApplicationEventLevel: "all",
      selectedApplicationAutomationId: null,
      selectedEvidenceId: null,
    });
    const params = new URLSearchParams(search);

    expect(params.get("keep")).toBe("yes");
    expect(params.get("section")).toBe("tools");
    expect(params.get("tool")).toBe("codex");
    expect(params.get("focus")).toBe("ops");
  });
});
