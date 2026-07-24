import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanningProjectsView } from "@/features/planning/planning-projects-view";

vi.mock("@/features/tasks/task-view", () => ({
  PlanningProjectsPanel: () => <div>Planning panel content</div>,
}));

afterEach(cleanup);

describe("PlanningProjectsView", () => {
  it("renders the dedicated planning workspace around the shared panel", () => {
    render(<PlanningProjectsView />);
    expect(screen.getByText("Planning Projects")).toBeTruthy();
    expect(screen.getByText("Organize local work into durable lists and status boards.")).toBeTruthy();
    expect(screen.getByText("Planning panel content")).toBeTruthy();
  });
});
