import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useUiStore } from "@/store/ui-store";

beforeEach(() => {
  localStorage.clear();
  useUiStore.setState({
    section: "settings",
    surfaceReturnSection: null,
    taskArea: "overview",
    settingsDialogOpen: false,
    settingsCategory: null,
    recentSettingsSections: [],
  });
});

describe("usePageNavigation", () => {
  it("keeps the five most recent professional settings destinations", () => {
    const { result } = renderHook(() => usePageNavigation());
    act(() => result.current("invocations"));
    act(() => result.current("evidence"));
    act(() => result.current("invocations"));

    expect(useUiStore.getState().recentSettingsSections.slice(0, 2)).toEqual(["invocations", "evidence"]);
  });

  it("keeps task queue navigation contextual for ordinary task work", () => {
    useUiStore.setState({ section: "task", settingsDialogOpen: false });
    const { result } = renderHook(() => usePageNavigation());

    act(() => result.current("autoRuns"));

    expect(useUiStore.getState()).toMatchObject({
      section: "autoRuns",
      settingsDialogOpen: false,
      surfaceReturnSection: "task",
    });
  });

  it("keeps shared operational pages inside My settings when entered there", () => {
    useUiStore.setState({
      section: "settings",
      settingsDialogOpen: true,
      surfaceReturnSection: "dashboard",
    });
    const { result } = renderHook(() => usePageNavigation());

    act(() => result.current("autoRuns"));

    expect(useUiStore.getState()).toMatchObject({
      section: "autoRuns",
      settingsDialogOpen: true,
      settingsCategory: "automation",
      surfaceReturnSection: "dashboard",
    });
  });
});
