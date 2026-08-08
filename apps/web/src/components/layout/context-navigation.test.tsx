import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextNavigation } from "@/components/layout/context-navigation";
import { useUiStore } from "@/store/ui-store";

afterEach(() => {
  cleanup();
  useUiStore.setState({ section: "dashboard", surfaceReturnSection: null, locale: "en-US" });
});

describe("ContextNavigation (#1505)", () => {
  it("shows the task-owned navigation contract", () => {
    useUiStore.setState({ section: "task" });
    const onTaskViewSectionChange = vi.fn();
    render(<ContextNavigation taskViewSection="task" onTaskViewSectionChange={onTaskViewSectionChange} />);
    expect(screen.getByRole("tablist", { name: "Task sections" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "Process" }));

    expect(onTaskViewSectionChange).toHaveBeenCalledWith("workBoard");
    expect(useUiStore.getState().section).toBe("task");
  });

  it("returns from Trace to the originating Entry page", () => {
    useUiStore.setState({ section: "invocations", surfaceReturnSection: "task" });
    render(<ContextNavigation taskViewSection="task" onTaskViewSectionChange={() => {}} />);
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
    render(<ContextNavigation taskViewSection="task" onTaskViewSectionChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Return to Projects" }));
    expect(useUiStore.getState()).toMatchObject({
      section: "projects",
      surfaceReturnSection: null,
      selectedProjectId: "project-42",
    });
  });

  it("returns from contextual Auto-runs setup to the selected task", () => {
    useUiStore.setState({
      section: "autoRuns",
      surfaceReturnSection: "task",
      selectedWorkItemId: "lwi-42",
    });
    render(<ContextNavigation taskViewSection="task" onTaskViewSectionChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Return to Tasks" }));
    expect(useUiStore.getState()).toMatchObject({
      section: "task",
      surfaceReturnSection: null,
      selectedWorkItemId: "lwi-42",
    });
  });
});
