import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskView } from "@/features/tasks/task-view";

const mocks = vi.hoisted(() => ({
  listWorkItems: vi.fn(),
  listGithubItems: vi.fn(),
  createWorkItem: vi.fn(),
  getWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
  transitionWorkItem: vi.fn(),
  listWorkItemComments: vi.fn(),
  createWorkItemComment: vi.fn(),
  updateWorkItemComment: vi.fn(),
  deleteWorkItemComment: vi.fn(),
  listWorkItemActivity: vi.fn(),
  createWorkItemWorktree: vi.fn(),
  startWorkItemAutoRun: vi.fn(),
  listPlanningProjects: vi.fn(),
  getPlanningProject: vi.fn(),
  createPlanningProject: vi.fn(),
  updatePlanningProject: vi.fn(),
  setPlanningProjectArchived: vi.fn(),
  addPlanningProjectItem: vi.fn(),
  removePlanningProjectItem: vi.fn(),
  execute: vi.fn(async (fn: () => Promise<unknown>) => { await fn(); return true; }),
}));

vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({ data: {
    projects: [{ id: "prj_1", name: "Local repo", status: "active" }],
    projectTargets: [],
    worktrees: [],
    invocations: [],
    issueClaims: [],
    issueClaimEvents: [],
    agents: [],
  } }),
}));
vi.mock("@/data/use-console-actions", () => ({
  useAsyncAction: () => ({ execute: mocks.execute, pending: false, error: null }),
  api: {
    listWorkItems: mocks.listWorkItems,
    listGithubItems: mocks.listGithubItems,
    createWorkItem: mocks.createWorkItem,
    getWorkItem: mocks.getWorkItem,
    updateWorkItem: mocks.updateWorkItem,
    transitionWorkItem: mocks.transitionWorkItem,
    listWorkItemComments: mocks.listWorkItemComments,
    createWorkItemComment: mocks.createWorkItemComment,
    updateWorkItemComment: mocks.updateWorkItemComment,
    deleteWorkItemComment: mocks.deleteWorkItemComment,
    listWorkItemActivity: mocks.listWorkItemActivity,
    createWorkItemWorktree: mocks.createWorkItemWorktree,
    startWorkItemAutoRun: mocks.startWorkItemAutoRun,
    listPlanningProjects: mocks.listPlanningProjects,
    getPlanningProject: mocks.getPlanningProject,
    createPlanningProject: mocks.createPlanningProject,
    updatePlanningProject: mocks.updatePlanningProject,
    setPlanningProjectArchived: mocks.setPlanningProjectArchived,
    addPlanningProjectItem: mocks.addPlanningProjectItem,
    removePlanningProjectItem: mocks.removePlanningProjectItem,
  },
}));
vi.mock("@/store/ui-store", () => ({
  useUiStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    setSection: vi.fn(),
    setSelectedProjectId: vi.fn(),
    setSelectedWorktreeId: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskView local work items", () => {
  beforeEach(() => {
    mocks.listPlanningProjects.mockResolvedValue({ projects: [] });
  });
  it("shows local work items as the default source", async () => {
    mocks.listWorkItems.mockResolvedValue({
      workItems: [{
        id: "lwi_1", localRef: "LOCAL-1", projectId: "prj_1",
        title: "Plan offline", body: "", type: "feature", status: "ready",
        priority: "p1", state: "open", labels: ["local"], assigneeIds: [],
        updatedAt: "2026-07-24T00:00:00.000Z",
      }],
      count: 1,
    });
    render(<TaskView />);
    expect(await screen.findByText("Plan offline")).toBeTruthy();
    expect(screen.getByText("LOCAL-1")).toBeTruthy();
    expect(screen.getByText("Feature")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("creates a local issue from the modal", async () => {
    mocks.listWorkItems.mockResolvedValue({ workItems: [], count: 0 });
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_2" } });
    render(<TaskView />);
    fireEvent.click(screen.getByRole("button", { name: /New local issue/i }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Build local board" } });
    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));
    await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "prj_1",
      title: "Build local board",
      type: "task",
      priority: "p2",
    })));
  });

  it("filters local issues by planning project and manages membership", async () => {
    const item = {
      id: "lwi_1", localRef: "LOCAL-1", projectId: "prj_1", title: "Roadmap issue",
      body: "", type: "task", status: "backlog", priority: "p2", state: "open",
      labels: [], assigneeIds: [], acceptanceCriteria: [], revision: 1, archivedAt: null,
      updatedAt: "2026-07-24T00:00:00.000Z",
    };
    const project = { id: "ppj_1", name: "Q3 roadmap", description: "", revision: 1, archivedAt: null, itemCount: 0 };
    mocks.listWorkItems.mockResolvedValue({ workItems: [item], count: 1 });
    mocks.listPlanningProjects.mockResolvedValue({ projects: [project] });
    mocks.getPlanningProject.mockResolvedValue({ project: { ...project, items: [] } });
    mocks.addPlanningProjectItem.mockResolvedValue({ created: true });
    render(<TaskView />);
    const filter = await screen.findByLabelText("Filter by planning project");
    fireEvent.change(filter, { target: { value: "ppj_1" } });
    await waitFor(() => expect(mocks.listWorkItems).toHaveBeenCalledWith(expect.objectContaining({
      planningProjectId: "ppj_1",
    })));
    fireEvent.click(screen.getByRole("button", { name: /Planning projects/i }));
    const checkbox = await screen.findByRole("checkbox");
    fireEvent.click(checkbox);
    await waitFor(() => expect(mocks.addPlanningProjectItem).toHaveBeenCalledWith("ppj_1", "lwi_1"));
  });

  it("moves a planning project card from the status board", async () => {
    const item = {
      id: "lwi_1", localRef: "LOCAL-1", projectId: "prj_1", title: "Move this card",
      body: "", type: "task", status: "backlog", priority: "p2", state: "open",
      labels: [], assigneeIds: [], acceptanceCriteria: [], revision: 1, archivedAt: null,
      updatedAt: "2026-07-24T00:00:00.000Z",
    };
    const project = {
      id: "ppj_1", name: "Q3 roadmap", description: "", revision: 1, archivedAt: null,
      itemCount: 1, openItemCount: 1, completedItemCount: 0,
      statusCounts: { backlog: 1, ready: 0, in_progress: 0, review: 0, blocked: 0, done: 0 },
      priorityCounts: { p0: 0, p1: 0, p2: 1, p3: 0 },
    };
    mocks.listWorkItems.mockResolvedValue({ workItems: [item], count: 1 });
    mocks.listPlanningProjects.mockResolvedValue({ projects: [project] });
    mocks.getPlanningProject.mockResolvedValue({ project: { ...project, items: [{ workItem: item }] } });
    mocks.updateWorkItem.mockResolvedValue({ workItem: { ...item, status: "ready", revision: 2 } });
    render(<TaskView />);
    fireEvent.click(await screen.findByRole("button", { name: /Planning projects/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Board" }));
    const status = await screen.findByLabelText("Change status for LOCAL-1");
    fireEvent.change(status, { target: { value: "ready" } });
    await waitFor(() => expect(mocks.updateWorkItem).toHaveBeenCalledWith("lwi_1", {
      expectedRevision: 1,
      status: "ready",
    }));
  });

  it("opens details, saves fields, and posts a comment", async () => {
    const item = {
      id: "lwi_1", localRef: "LOCAL-1", projectId: "prj_1",
      title: "Editable issue", body: "Before", type: "task", status: "backlog",
      priority: "p2", state: "open", labels: [], assigneeIds: [],
      acceptanceCriteria: [], revision: 1, archivedAt: null,
      updatedAt: "2026-07-24T00:00:00.000Z",
    };
    mocks.listWorkItems.mockResolvedValue({ workItems: [item], count: 1 });
    mocks.getWorkItem.mockResolvedValue({ workItem: item });
    mocks.listWorkItemComments.mockResolvedValue({ comments: [] });
    mocks.listWorkItemActivity.mockResolvedValue({ activities: [{
      id: "wia_1", action: "created", actorId: "usr_local",
      createdAt: "2026-07-24T00:00:00.000Z", details: {},
    }] });
    mocks.updateWorkItem.mockResolvedValue({ workItem: { ...item, title: "Edited issue", revision: 2 } });
    mocks.createWorkItemComment.mockResolvedValue({ comment: { id: "wic_1" } });
    mocks.createWorkItemWorktree.mockResolvedValue({ worktree: { id: "wtr_1" } });
    mocks.startWorkItemAutoRun.mockResolvedValue({ autoRun: { id: "aur_1", worktreeId: "wtr_2" } });
    render(<TaskView />);
    fireEvent.click(await screen.findByText("Editable issue"));
    const title = await screen.findByDisplayValue("Editable issue");
    fireEvent.change(title, { target: { value: "Edited issue" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.updateWorkItem).toHaveBeenCalledWith("lwi_1", expect.objectContaining({
      expectedRevision: 1,
      title: "Edited issue",
    })));
    fireEvent.change(screen.getByPlaceholderText("Add a comment…"), { target: { value: "Looks good" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(mocks.createWorkItemComment).toHaveBeenCalledWith("lwi_1", "Looks good"));
    fireEvent.click(screen.getByRole("button", { name: "Create worktree" }));
    await waitFor(() => expect(mocks.createWorkItemWorktree).toHaveBeenCalledWith("lwi_1"));
    expect(screen.getByText("Created")).toBeTruthy();
  });
});
