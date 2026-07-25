import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_COLLAPSED_NAV_GROUPS,
  navigationFromSearch,
  searchFromNavigationState,
  useUiStore,
} from "@/store/ui-store";

beforeEach(() => {
  localStorage.clear();
  useUiStore.setState({ collapsedNavGroups: [...DEFAULT_COLLAPSED_NAV_GROUPS], locale: "en-US" });
});

describe("ui-store persistence", () => {
  it("persists section + selections to localStorage, excluding setters", () => {
    useUiStore.getState().setSection("applications");
    useUiStore.getState().setSelectedApplicationId("app_123");
    useUiStore.getState().setSelectedApplicationRun({
      applicationId: "app_123",
      routineId: "routine_123",
      invocationId: "inv_123",
    });
    useUiStore.getState().setSelectedEvidenceId("ev_123");
    useUiStore.getState().setLocale("zh-CN");

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
    expect(parsed.state.selectedEvidenceId).toBe("ev_123");
    expect(parsed.state.locale).toBe("zh-CN");
    // Setter functions must never be serialized.
    expect(parsed.state.setSection).toBeUndefined();
    expect(parsed.state.setSelectedApplicationId).toBeUndefined();
    expect(parsed.state.setSelectedEvidenceId).toBeUndefined();
  });

  it("restores a valid locale and rejects stale unsupported values", async () => {
    useUiStore.setState({ locale: "en-US" });
    // setState persists, so write the simulated previous-session blob after it.
    localStorage.setItem("myagenttool-ui", JSON.stringify({ version: 1, state: { locale: "zh-CN" } }));
    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState().locale).toBe("zh-CN");

    useUiStore.setState({ locale: "en-US" });
    localStorage.setItem("myagenttool-ui", JSON.stringify({ version: 1, state: { locale: "fr-FR" } }));
    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState().locale).toBe("en-US");
  });
});

describe("nav group collapse (#928)", () => {
  it("starts with Settings and Trace collapsed and persists toggles", () => {
    expect(useUiStore.getState().collapsedNavGroups).toEqual(["settings", "trace"]);

    useUiStore.getState().toggleNavGroup("settings"); // expand
    expect(useUiStore.getState().collapsedNavGroups).toEqual(["trace"]);

    useUiStore.getState().toggleNavGroup("entry"); // collapse the primary surface
    expect(useUiStore.getState().collapsedNavGroups).toEqual(["trace", "entry"]);

    const parsed = JSON.parse(localStorage.getItem("myagenttool-ui") as string);
    expect(parsed.state.collapsedNavGroups).toEqual(["trace", "entry"]);
  });

  it("migrates stale workflow group keys to the new surface defaults", async () => {
    localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: { section: "documents", collapsedNavGroups: ["run", "configure"] },
    }));
    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState().section).toBe("documents");
    expect(useUiStore.getState().collapsedNavGroups).toEqual(["settings", "trace"]);
  });
});

describe("URL navigation helpers", () => {
  it("parses valid navigation params and ignores unknown sections", () => {
    expect(navigationFromSearch("?section=applications&application=app_1&routine=routine_1&run=inv_1&evidence=ev_1")).toEqual({
      section: "applications",
      selectedInvocationId: null,
      selectedApplicationId: "app_1",
      selectedApplicationRun: {
        applicationId: "app_1",
        routineId: "routine_1",
        invocationId: "inv_1",
      },
      selectedEvidenceId: "ev_1",
      // A focused schedule is part of navigation now (#849) — an attention badge
      // that cannot be linked to is a dead end.
      selectedAutomationId: null,
    });

    expect(navigationFromSearch("?section=missing&application=app_1&routine=routine_1")).toMatchObject({
      selectedInvocationId: null,
      selectedApplicationId: "app_1",
      selectedApplicationRun: null,
      selectedEvidenceId: null,
      selectedAutomationId: null,
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
      selectedEvidenceId: "ev_selected",
      selectedAutomationId: null,
    });
    const params = new URLSearchParams(search);

    expect(params.get("keep")).toBe("yes");
    expect(params.get("section")).toBe("applications");
    expect(params.get("invocation")).toBe("inv_selected");
    expect(params.get("application")).toBe("app_run");
    expect(params.get("routine")).toBe("routine_run");
    expect(params.get("run")).toBe("inv_run");
    expect(params.get("evidence")).toBe("ev_selected");
  });

  it("round-trips a planning project and its active view", () => {
    expect(navigationFromSearch("?section=planning&planningProject=ppj_1&planningView=roadmap&planningStatus=blocked&planningPriority=p1&planningMilestone=M3&planningDue=overdue")).toMatchObject({
      section: "planning",
      selectedPlanningProjectId: "ppj_1",
      planningProjectView: "roadmap",
      planningProjectFilters: { status: "blocked", priority: "p1", milestone: "M3", due: "overdue" },
    });
    const search = searchFromNavigationState("", {
      section: "planning",
      selectedInvocationId: null,
      selectedApplicationId: null,
      selectedApplicationRun: null,
      selectedEvidenceId: null,
      selectedAutomationId: null,
      selectedPlanningProjectId: "ppj_1",
      planningProjectView: "roadmap",
      planningProjectFilters: { status: "blocked", priority: "p1", milestone: "M3", due: "overdue" },
    });
    const params = new URLSearchParams(search);
    expect(params.get("section")).toBe("planning");
    expect(params.get("planningProject")).toBe("ppj_1");
    expect(params.get("planningView")).toBe("roadmap");
    expect(params.get("planningStatus")).toBe("blocked");
    expect(params.get("planningPriority")).toBe("p1");
    expect(params.get("planningMilestone")).toBe("M3");
    expect(params.get("planningDue")).toBe("overdue");
  });

  it("clears stale evidence params when evidence is absent from navigation state", () => {
    const search = searchFromNavigationState("?keep=yes&section=audit&evidence=old_ev", {
      section: "audit",
      selectedInvocationId: null,
      selectedApplicationId: null,
      selectedApplicationRun: null,
      selectedEvidenceId: null,
      selectedAutomationId: null,
    });
    const params = new URLSearchParams(search);

    expect(params.get("keep")).toBe("yes");
    expect(params.get("section")).toBe("audit");
    expect(params.get("evidence")).toBeNull();
  });
});
