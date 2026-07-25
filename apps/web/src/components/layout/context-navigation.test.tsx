import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ContextNavigation } from "@/components/layout/context-navigation";
import { useUiStore } from "@/store/ui-store";

afterEach(() => {
  cleanup();
  useUiStore.setState({ section: "dashboard", surfaceReturnSection: null, locale: "en-US" });
});

describe("ContextNavigation (#1505)", () => {
  it("shows the task-owned navigation contract", () => {
    useUiStore.setState({ section: "task" });
    render(<ContextNavigation />);
    expect(screen.getByRole("navigation", { name: "Task sections" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Process" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assets" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verification" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Trace" })).toBeTruthy();
  });

  it("returns from Trace to the originating Entry page", () => {
    useUiStore.setState({ section: "invocations", surfaceReturnSection: "task" });
    render(<ContextNavigation />);
    fireEvent.click(screen.getByRole("button", { name: "Return to Tasks" }));
    expect(useUiStore.getState().section).toBe("task");
    expect(useUiStore.getState().surfaceReturnSection).toBeNull();
  });

  it("preserves a project context while visiting Settings", () => {
    useUiStore.setState({
      section: "applications",
      surfaceReturnSection: "projects",
      selectedProjectId: "project-42",
    });
    render(<ContextNavigation />);
    fireEvent.click(screen.getByRole("button", { name: "Return to Projects" }));
    expect(useUiStore.getState()).toMatchObject({
      section: "projects",
      surfaceReturnSection: null,
      selectedProjectId: "project-42",
    });
  });
});
