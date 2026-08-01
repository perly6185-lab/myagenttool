import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionHistory } from "@/features/invocations/session-history";
import { useUiStore } from "@/store/ui-store";
import { i18n } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({ useConsoleState: vi.fn() }));

vi.mock("@/data/use-console-state", () => ({ useConsoleState: mocks.useConsoleState }));

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  mocks.useConsoleState.mockReturnValue({
    data: {
      currentProjectId: "proj_history",
      invocations: [{
        id: "inv_history",
        status: "failed",
        projectId: "proj_history",
        worktreeId: "wt_history",
        agentId: "agt_history",
        createdAt: "2026-08-01T08:00:00.000Z",
        input: { task: "Historical task" },
      }],
    },
  });
  useUiStore.setState({
    section: "workspace",
    selectedInvocationId: null,
    selectedProjectId: null,
    selectedWorktreeId: null,
    selectedAgentId: null,
    resumeFromInvocationId: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionHistory navigation", () => {
  it("opens history in Run records but continues it in the execution composer", () => {
    render(<SessionHistory />);

    fireEvent.click(screen.getByRole("button", { name: /Historical task/ }));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("inv_history");

    fireEvent.click(screen.getByRole("button", { name: "Continue task" }));
    const ui = useUiStore.getState();
    expect(ui.section).toBe("dashboard");
    expect(ui.resumeFromInvocationId).toBe("inv_history");
    expect(ui.selectedProjectId).toBe("proj_history");
    expect(ui.selectedWorktreeId).toBe("wt_history");
    expect(ui.selectedAgentId).toBe("agt_history");
  });
});
