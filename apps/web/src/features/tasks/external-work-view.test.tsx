import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalWorkView } from "./external-work-view";

const mocks = vi.hoisted(() => ({
  listGithubItems: vi.fn(),
  listWorkItems: vi.fn(),
  createWorkItemFromExternal: vi.fn(),
  openWorkItem: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({ data: {
    projects: [{ id: "prj_1", name: "Demo", status: "active" }],
    projectTargets: [{ projectId: "prj_1", state: "ready" }],
    worktrees: [],
  } }),
}));

vi.mock("@/data/use-console-actions", () => ({
  api: {
    listGithubItems: mocks.listGithubItems,
    listWorkItems: mocks.listWorkItems,
    createWorkItemFromExternal: mocks.createWorkItemFromExternal,
  },
  useAsyncAction: () => ({
    execute: async (action: () => Promise<unknown>) => { await action(); return true; },
    pending: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-page-navigation", () => ({ usePageNavigation: () => mocks.navigate }));
vi.mock("@/store/ui-store", () => ({
  useUiStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    openWorkItem: mocks.openWorkItem,
    setSelectedProjectId: vi.fn(),
    setSelectedWorktreeId: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ExternalWorkView", () => {
  it("separates incoming issues from change requests and turns an issue into a task", async () => {
    mocks.listWorkItems.mockResolvedValue({ workItems: [], nextCursor: null });
    mocks.listGithubItems.mockResolvedValue({
      available: true,
      message: "",
      items: [
        { type: "issue", number: 42, title: "Fix sign in", headRefName: null, author: "alice", url: "https://example.test/issues/42", state: "open" },
        { type: "pr", number: 43, title: "Fix sign in", headRefName: "fix/sign-in", author: "alice", url: "https://example.test/pulls/43", state: "open" },
      ],
    });
    const workItem = { id: "wi_1", localRef: "TASK-1" };
    mocks.createWorkItemFromExternal.mockResolvedValue({ workItem });

    render(<ExternalWorkView />);

    expect((await screen.findAllByText("Fix sign in")).length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "Issue inbox 1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Change requests 1" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Turn into task" })[0]);

    await waitFor(() => expect(mocks.createWorkItemFromExternal).toHaveBeenCalledWith({
      projectId: "prj_1",
      provider: "github",
      issueNumber: 42,
      relation: "source",
      isPrimary: true,
      syncPolicy: "manual",
    }));
    expect(mocks.openWorkItem).toHaveBeenCalledWith("wi_1", { mode: "summary", section: "overview" });
    expect(mocks.navigate).toHaveBeenCalledWith("task");
  });

  it("shows PRs as change requests without an import action", async () => {
    mocks.listWorkItems.mockResolvedValue({ workItems: [], nextCursor: null });
    mocks.listGithubItems.mockResolvedValue({
      available: true,
      message: "",
      items: [{ type: "pr", number: 43, title: "Review sign in", headRefName: "fix/sign-in", author: "alice", url: "https://example.test/pulls/43", state: "open" }],
    });

    render(<ExternalWorkView />);
    fireEvent.click(await screen.findByRole("tab", { name: "Change requests 1" }));
    expect((await screen.findAllByText("Review sign in")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Turn into task" })).toBeNull();
  });
});
