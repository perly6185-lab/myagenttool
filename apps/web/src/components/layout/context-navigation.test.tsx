import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextNavigation } from "@/components/layout/context-navigation";
import { useUiStore } from "@/store/ui-store";

afterEach(() => {
  cleanup();
  useUiStore.setState({ section: "dashboard", surfaceReturnSection: null, locale: "en-US", workItemDetailPreference: "summary" });
});

describe("ContextNavigation (#1505)", () => {
  it("shows the task-owned navigation contract", () => {
    useUiStore.setState({ section: "task", workItemDetailPreference: "expert" });
    const onTaskAreaChange = vi.fn();
    render(<ContextNavigation taskArea="overview" onTaskAreaChange={onTaskAreaChange} />);
    expect(screen.getByRole("tablist", { name: "Task sections" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "Process" }));

    expect(onTaskAreaChange).toHaveBeenCalledWith("process");
    expect(useUiStore.getState().section).toBe("task");
  });

  it("returns from Trace to the originating Entry page", () => {
    useUiStore.setState({ section: "invocations", surfaceReturnSection: "task" });
    render(<ContextNavigation taskArea="overview" onTaskAreaChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Return to My tasks" }));
    expect(useUiStore.getState().section).toBe("task");
    expect(useUiStore.getState().surfaceReturnSection).toBeNull();
  });

  it("preserves a project context while visiting Settings", () => {
    useUiStore.setState({
      section: "applications",
      surfaceReturnSection: "projects",
      selectedProjectId: "project-42",
    });
    render(<ContextNavigation taskArea="overview" onTaskAreaChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Return to My projects" }));
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
    render(<ContextNavigation taskArea="overview" onTaskAreaChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Return to My tasks" }));
    expect(useUiStore.getState()).toMatchObject({
      section: "task",
      surfaceReturnSection: null,
      selectedWorkItemId: "lwi-42",
    });
  });

  it("keeps the ordinary task overview free of permanent professional tabs", () => {
    useUiStore.setState({ section: "task", workItemDetailPreference: "summary" });
    const { container } = render(<ContextNavigation taskArea="overview" onTaskAreaChange={() => {}} />);

    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("keeps a compact return path for an ordinary-user deep link", () => {
    useUiStore.setState({ section: "task", workItemDetailPreference: "summary" });
    const onTaskAreaChange = vi.fn();
    render(<ContextNavigation taskArea="assets" onTaskAreaChange={onTaskAreaChange} />);

    expect(screen.getByText("Assets")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
    expect(onTaskAreaChange).toHaveBeenCalledWith("overview");
  });

  it("gives direct professional bookmarks a Me and My settings path", () => {
    useUiStore.setState({ section: "invocations", surfaceReturnSection: null });
    render(<ContextNavigation taskArea="overview" onTaskAreaChange={() => {}} />);
    expect(screen.getByRole("navigation", { name: "My settings" })).toBeTruthy();
    expect(screen.getByText("Invocations")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "My settings" }));
    expect(useUiStore.getState().section).toBe("settings");
  });

  it("does not render stale return controls after browser history restores the origin", () => {
    useUiStore.setState({ section: "me", surfaceReturnSection: "me" });
    render(<ContextNavigation taskArea="overview" onTaskAreaChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Return to Me" })).toBeNull();
    expect(screen.queryByRole("button", { name: "My settings" })).toBeNull();
  });
});
