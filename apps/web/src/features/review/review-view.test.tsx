import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReviewView } from "./review-view";

const mocks = vi.hoisted(() => ({
  setSection: vi.fn(),
  setSelectedInvocationId: vi.fn(),
}));

vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({
    data: {
      reviewFindings: [],
      invocations: [],
    },
  }),
}));

vi.mock("@/store/ui-store", () => ({
  useUiStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    setSection: mocks.setSection,
    setSelectedInvocationId: mocks.setSelectedInvocationId,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReviewView", () => {
  it("clearly separates technical code findings from ordinary task-result review", () => {
    render(<ReviewView />);

    expect(screen.getByRole("heading", { name: "Code review findings" })).toBeTruthy();
    expect(screen.getByText(/not accepting a task result/)).toBeTruthy();
    expect(screen.getByText(/Open My tasks and choose Ready for you/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open My tasks" }));
    expect(mocks.setSection).toHaveBeenCalledWith("task");
  });

  it("keeps the technical empty-state action available", () => {
    render(<ReviewView />);

    fireEvent.click(screen.getByRole("button", { name: "Open Tools" }));
    expect(mocks.setSection).toHaveBeenCalledWith("tools");
  });
});
