import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./task-view", () => ({
  TaskView: ({ localOnly }: { localOnly?: boolean }) => (
    <div data-testid="task-view" data-local-only={String(Boolean(localOnly))} />
  ),
}));

import { LocalTasksView } from "./local-tasks-view";

describe("LocalTasksView", () => {
  it("reuses the complete task workflow in local-only mode", () => {
    render(<LocalTasksView />);
    expect(screen.getByTestId("task-view").getAttribute("data-local-only")).toBe("true");
  });
});
