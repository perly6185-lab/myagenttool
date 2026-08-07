import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalTasksView } from "./local-tasks-view";

const mocks = vi.hoisted(() => ({
  listWorkItems: vi.fn(),
  openWorkItem: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({ data: {
    projects: [{ id: "prj_1", name: "Demo", status: "active" }],
    users: [],
  } }),
}));

vi.mock("@/data/use-console-actions", () => ({
  api: { listWorkItems: mocks.listWorkItems },
}));

vi.mock("@/hooks/use-page-navigation", () => ({ usePageNavigation: () => mocks.navigate }));

vi.mock("@/store/ui-store", () => ({
  useUiStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    openWorkItem: mocks.openWorkItem,
    workItemDetailPreference: "summary",
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LocalTasksView", () => {
  it("shows only local tasks and treats external bindings as source metadata", async () => {
    mocks.listWorkItems.mockResolvedValue({
      workItems: [{
        id: "wi_1",
        localRef: "TASK-1",
        projectId: "prj_1",
        title: "Fix sign in",
        body: "",
        type: "bug",
        status: "in_progress",
        priority: "p1",
        state: "open",
        labels: [],
        assigneeIds: [],
        requesterRelation: "self",
        requesterName: null,
        requesterOrganization: null,
        requesterUserId: null,
        intakeChannel: "github",
        externalReference: null,
        waitingOn: "none",
        commitmentDate: null,
        nextFollowUpAt: null,
        lastProgressAt: null,
        lastProgressSummary: null,
        acceptanceCriteria: [],
        followUpSchemaVersion: 1,
        externalBindings: [{ kind: "github_issue", provider: "github", number: 42, url: null, lastSyncedAt: "2026-08-07T00:00:00Z", conflict: null }],
        createdAt: "2026-08-07T00:00:00Z",
        updatedAt: "2026-08-07T00:00:00Z",
      }],
      nextCursor: null,
    });

    render(<LocalTasksView />);

    expect((await screen.findAllByText("Fix sign in")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("GitHub #42").length).toBeGreaterThan(0);
    expect(screen.queryByRole("tab", { name: /Issues/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^PR/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "External work" }));
    expect(mocks.navigate).toHaveBeenCalledWith("externalWork");

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(mocks.openWorkItem).toHaveBeenCalledWith("wi_1", { mode: "summary", section: "overview" });
  });

  it("filters local tasks by ordinary-user status", async () => {
    mocks.listWorkItems.mockResolvedValue({ workItems: [], nextCursor: null });
    render(<LocalTasksView />);
    await waitFor(() => expect(mocks.listWorkItems).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: "All 0" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Active 0" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Waiting 0" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Done 0" })).toBeTruthy();
  });
});
