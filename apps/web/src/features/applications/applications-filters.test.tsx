import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationsView } from "@/features/applications/applications-view";

const stateMock = vi.hoisted(() => ({ useConsoleState: vi.fn() }));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: stateMock.useConsoleState }));
// The register modal is closed here; stub it so the test needs no query/action providers.
vi.mock("@/features/applications/register-application-modal", () => ({ RegisterApplicationModal: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ApplicationsView filters (#930)", () => {
  it("hides the status/kind filter row when there are no applications", () => {
    stateMock.useConsoleState.mockReturnValue({ data: { applications: [], applicationHealthSweepStatus: null } });
    render(<ApplicationsView />);
    // No controls before there's anything to filter.
    expect(screen.queryByText("All statuses")).toBeNull();
    expect(screen.queryByText("All kinds")).toBeNull();
    // The empty state (with its Register CTA) still carries the screen.
    expect(screen.getByText("No applications registered")).toBeTruthy();
  });
});
