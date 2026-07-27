import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntryJourney, entryJourneyContext } from "./entry-journey";
import type { ConsoleSnapshot } from "@/lib/console-state";
import { useUiStore } from "@/store/ui-store";

const stateMock = vi.hoisted(() => ({ useConsoleState: vi.fn() }));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: stateMock.useConsoleState }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useUiStore.setState({ section: "dashboard", selectedProjectId: null, selectedInvocationId: null });
});

describe("entryJourneyContext and navigation", () => {
  it("keeps the journey and attention inside the active project", () => {
    const state = {
      invocations: [
        { id: "other-new", projectId: "p2", createdAt: "2026-07-25T03:00:00Z" },
        { id: "mine", projectId: "p1", createdAt: "2026-07-25T02:00:00Z" },
      ],
      pendingDecisions: [
        { id: "d1", invocationId: "mine" },
        { id: "d2", invocationId: "other-new" },
      ],
      evidenceLedger: [
        { id: "e1", invocationId: "mine", attention: true },
        { id: "e2", invocationId: "other-new", attention: true },
      ],
    } as unknown as ConsoleSnapshot;
    const context = entryJourneyContext(state, "p1", "other-new");
    expect(context.invocation?.id).toBe("mine");
    expect(context.pending).toBe(1);
    expect(context.attention).toBe(1);
  });

  it("shows its project/run scope and preserves the scoped run when opening Trace", () => {
    stateMock.useConsoleState.mockReturnValue({
      data: {
        projects: [{ id: "p1", name: "Quarterly reporting" }],
        invocations: [
          { id: "other-new", projectId: "p2", status: "succeeded", createdAt: "2026-07-25T03:00:00Z" },
          { id: "mine", projectId: "p1", status: "succeeded", createdAt: "2026-07-25T02:00:00Z" },
        ],
        pendingDecisions: [],
        evidenceLedger: [],
      },
    });
    useUiStore.setState({ selectedProjectId: "p1", selectedInvocationId: "other-new" });
    render(<EntryJourney />);
    expect(screen.getByText("Scope: Quarterly reporting · run mine")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /4\. Result/ }));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().selectedInvocationId).toBe("mine");
  });

  it("keeps Create keyboard-actionable and delegates focus to the composer", () => {
    const onCreate = vi.fn();
    stateMock.useConsoleState.mockReturnValue({
      data: { projects: [], invocations: [], pendingDecisions: [], evidenceLedger: [] },
    });
    render(<EntryJourney onCreate={onCreate} />);
    const create = screen.getByRole("button", { name: /1\. Create/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    expect(onCreate).toHaveBeenCalledOnce();
  });
});
