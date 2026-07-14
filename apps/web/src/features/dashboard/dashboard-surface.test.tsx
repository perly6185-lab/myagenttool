import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardView } from "@/features/dashboard/dashboard-view";

const mocks = vi.hoisted(() => ({ useConsoleState: vi.fn(), useAsyncAction: vi.fn() }));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: mocks.useConsoleState }));
vi.mock("@/data/use-console-actions", () => ({ useAsyncAction: mocks.useAsyncAction, api: {} }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup() {
  mocks.useConsoleState.mockReturnValue({
    data: { projects: [], worktrees: [], events: [], invocations: [], agents: [], device: { status: "offline" } },
  });
  mocks.useAsyncAction.mockReturnValue({ execute: vi.fn(), pending: false, error: null });
}

describe("DashboardView surfaces (#927)", () => {
  it("shows the onboarding checklist on the overview (home) surface", () => {
    setup();
    render(<DashboardView surface="overview" />);
    expect(screen.getByText(/Getting started/i)).toBeTruthy();
  });

  it("omits the onboarding checklist on the workspace surface but keeps the composer", () => {
    setup();
    render(<DashboardView surface="workspace" />);
    // The home/onboarding card is a first-run concern — not duplicated into Workspace.
    expect(screen.queryByText(/Getting started/i)).toBeNull();
    // You can still start a task from Workspace: the composer is retained.
    expect(screen.getByText("What should your computer do?")).toBeTruthy();
  });
});
