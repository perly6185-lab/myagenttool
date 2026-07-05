import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/store/ui-store";

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
    // Setter functions must never be serialized.
    expect(parsed.state.setSection).toBeUndefined();
    expect(parsed.state.setSelectedApplicationId).toBeUndefined();
  });
});
