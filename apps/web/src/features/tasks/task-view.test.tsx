import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskView, shouldShowWorkItemCost } from "@/features/tasks/task-view";

const mocks = vi.hoisted(() => ({
  listWorkItems: vi.fn(),
  listWorkItemAttention: vi.fn(),
  updateWorkItemAttention: vi.fn(),
  listGithubItems: vi.fn(),
  createWorkItem: vi.fn(),
  getWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
  bulkUpdateWorkItems: vi.fn(),
  transitionWorkItem: vi.fn(),
  listWorkItemComments: vi.fn(),
  createWorkItemComment: vi.fn(),
  updateWorkItemComment: vi.fn(),
  deleteWorkItemComment: vi.fn(),
  listWorkItemActivity: vi.fn(),
  createWorkItemWorktree: vi.fn(),
  startWorkItemAutoRun: vi.fn(),
  syncWorkItemGithubIssue: vi.fn(),
  listAutoRuns: vi.fn(),
  listPlanningProjects: vi.fn(),
  getPlanningProject: vi.fn(),
  createPlanningProject: vi.fn(),
  updatePlanningProject: vi.fn(),
  setPlanningProjectArchived: vi.fn(),
  addPlanningProjectItem: vi.fn(),
  removePlanningProjectItem: vi.fn(),
  reorderPlanningProjectItems: vi.fn(),
  updatePlanningProjectItems: vi.fn(),
  executePlanningRecommendedAction: vi.fn(),
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

describe("work-item cost visibility", () => {
  it("shows a reserved budget before the first ledger entry exists", () => {
    expect(shouldShowWorkItemCost({
      nextAction: "monitor_execution",
      attention: [],
      latestRun: null,
      activeClaim: null,
      cost: {
        knownUsd: 0,
        unknownEntries: 0,
        entryCount: 0,
        projectBudget: null,
        teamBudget: {
          budgetId: "bud_team",
          limitUsd: 50,
          spentUsd: 0,
          reservedUsd: 20,
          admissionUsd: 20,
          remainingUsd: 30,
          policy: "block",
          over: false,
          admissionOver: false,
        },
      },
      alerts: { queued: 0, failed: 0, sent: 0, skipped: 0 },
    })).toBe(true);
  });
});
vi.mock("@/data/use-console-actions", () => ({
  useAsyncAction: () => ({ execute: mocks.execute, pending: false, error: null }),
  api: {
    listWorkItems: mocks.listWorkItems,
    listWorkItemAttention: mocks.listWorkItemAttention,
    updateWorkItemAttention: mocks.updateWorkItemAttention,
    listGithubItems: mocks.listGithubItems,
    createWorkItem: mocks.createWorkItem,
    getWorkItem: mocks.getWorkItem,
    updateWorkItem: mocks.updateWorkItem,
    bulkUpdateWorkItems: mocks.bulkUpdateWorkItems,
    transitionWorkItem: mocks.transitionWorkItem,
    listWorkItemComments: mocks.listWorkItemComments,
    createWorkItemComment: mocks.createWorkItemComment,
    updateWorkItemComment: mocks.updateWorkItemComment,
    deleteWorkItemComment: mocks.deleteWorkItemComment,
    listWorkItemActivity: mocks.listWorkItemActivity,
    createWorkItemWorktree: mocks.createWorkItemWorktree,
    startWorkItemAutoRun: mocks.startWorkItemAutoRun,
    syncWorkItemGithubIssue: mocks.syncWorkItemGithubIssue,
    listAutoRuns: mocks.listAutoRuns,
    listPlanningProjects: mocks.listPlanningProjects,
    getPlanningProject: mocks.getPlanningProject,
    createPlanningProject: mocks.createPlanningProject,
    updatePlanningProject: mocks.updatePlanningProject,
    setPlanningProjectArchived: mocks.setPlanningProjectArchived,
    addPlanningProjectItem: mocks.addPlanningProjectItem,
    removePlanningProjectItem: mocks.removePlanningProjectItem,
    reorderPlanningProjectItems: mocks.reorderPlanningProjectItems,
    updatePlanningProjectItems: mocks.updatePlanningProjectItems,
    executePlanningRecommendedAction: mocks.executePlanningRecommendedAction,
  },
}));
vi.mock("@/store/ui-store", () => ({
  useUiStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    setSection: vi.fn(),
    setSelectedProjectId: vi.fn(),
    selectedPlanningProjectId: null,
    planningProjectView: "list",
    planningProjectFilters: { status: "all", priority: "all", milestone: "", due: "all" },
    setSelectedPlanningProjectId: vi.fn(),
    setPlanningProjectView: vi.fn(),
    setPlanningProjectFilters: vi.fn(),
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
    mocks.listAutoRuns.mockResolvedValue({ autoRuns: [] });
    mocks.listWorkItemAttention.mockResolvedValue({ items: [] });
  });
  it("shows local work items as the default source", async () => {
    mocks.listWorkItemAttention.mockResolvedValue({ items: [{
      id: "github_conflict:lwi_1", kind: "github_conflict", severity: "high",
      workItemId: "lwi_1", localRef: "LOCAL-1", title: "Plan offline",
      createdAt: "2026-07-24T00:00:00.000Z", dueAt: "2026-07-24T04:00:00.000Z",
      slaStatus: "within_sla", history: [], details: { fields: ["title"] },
      handling: null, resolution: null,
    }] });
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
    expect((await screen.findAllByText("Plan offline")).length).toBe(2);
    expect(screen.getAllByText("LOCAL-1")).toHaveLength(2);
    expect(screen.getByText("Feature")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("1 pending")).toBeTruthy();
    expect(screen.getAllByText("Conflict")).toHaveLength(2);
  });

  it("creates a local issue from the modal", async () => {
    mocks.listWorkItems.mockResolvedValue({ workItems: [], count: 0 });
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_2" } });
    render(<TaskView />);
    fireEvent.click(screen.getByRole("button", { name: /New local issue/i }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Build local board" } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-08-15" } });
    fireEvent.change(screen.getByLabelText("Milestone"), { target: { value: "M3" } });
    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));
    await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "prj_1",
      title: "Build local board",
      type: "task",
      priority: "p2",
      dueDate: "2026-08-15",
      milestone: "M3",
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
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select LOCAL-1" }));
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
    mocks.bulkUpdateWorkItems.mockResolvedValue({ workItems: [{ ...item, status: "ready", revision: 2 }], count: 1 });
    mocks.updatePlanningProjectItems.mockResolvedValue({ project });
    render(<TaskView />);
    fireEvent.click(await screen.findByRole("button", { name: /Planning projects/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Board" }));
    const status = await screen.findByLabelText("Change status for LOCAL-1");
    fireEvent.change(status, { target: { value: "ready" } });
    await waitFor(() => expect(mocks.updateWorkItem).toHaveBeenCalledWith("lwi_1", {
      expectedRevision: 1,
      status: "ready",
    }));
    fireEvent.click(screen.getByLabelText("Select LOCAL-1"));
    fireEvent.click(screen.getByRole("button", { name: "Apply status" }));
    await waitFor(() => expect(mocks.bulkUpdateWorkItems).toHaveBeenCalledWith({
      items: [{ id: "lwi_1", expectedRevision: 1 }],
      changes: { status: "ready" },
    }));
    fireEvent.click(screen.getByLabelText("Select LOCAL-1"));
    fireEvent.change(screen.getByLabelText("Bulk field"), { target: { value: "priority" } });
    fireEvent.change(screen.getByLabelText("Bulk value"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply status" }));
    await waitFor(() => expect(mocks.bulkUpdateWorkItems).toHaveBeenLastCalledWith({
      items: [{ id: "lwi_1", expectedRevision: 1 }],
      changes: { priority: "p1" },
    }));
    fireEvent.click(screen.getByLabelText("Select LOCAL-1"));
    fireEvent.change(screen.getByLabelText("Bulk field"), { target: { value: "remove" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply status" }));
    await waitFor(() => expect(mocks.updatePlanningProjectItems).toHaveBeenCalledWith("ppj_1", [], ["lwi_1"]));
  });

  it("reorders members inside a planning project", async () => {
    const first = {
      id: "lwi_1", localRef: "LOCAL-1", projectId: "prj_1", title: "First",
      body: "", type: "task", status: "backlog", priority: "p2", state: "open",
      labels: [], assigneeIds: [], acceptanceCriteria: [], revision: 1, archivedAt: null,
      dueDate: "2026-08-15", milestone: "M3", updatedAt: "2026-07-24T00:00:00.000Z",
      executionBindings: [{ kind: "auto_run", targetId: "aur_1", worktreeId: null, createdAt: "2026-07-24T00:00:00.000Z" }],
    };
    const second = {
      ...first, id: "lwi_2", localRef: "LOCAL-2", title: "Second",
      status: "done", dueDate: "2026-07-10", executionBindings: [],
    };
    const project = {
      id: "ppj_1", name: "Ordered", description: "", revision: 2, archivedAt: null,
      startDate: "2026-07-01", targetDate: "2026-07-31",
      daysRemaining: 7, projectOverdue: false,
      ownerId: "usr_release", unowned: false,
      status: "active",
      tags: ["release", "backend"],
      statusSummary: "Ready for rollout", daysSinceStatusUpdate: 2, staleStatus: false,
      checkIns: [{ id: "ppc_1", summary: "Scope approved", authorId: "usr_release", createdAt: "2026-07-22T00:00:00.000Z" }],
      pinned: true, updatedAt: "2026-07-24T00:00:00.000Z",
      watching: true,
      recommendedActions: [
        { code: "recover_schedule", count: 3, risk: "medium", approvalRequired: false },
        { code: "refresh_status", count: 15, risk: "low", approvalRequired: false },
      ],
      itemCount: 2, openItemCount: 2, completedItemCount: 0,
      statusCounts: { backlog: 2, ready: 0, in_progress: 0, review: 0, blocked: 0, done: 0 },
      priorityCounts: { p0: 0, p1: 0, p2: 2, p3: 0 },
      items: [
        { membership: { position: 1000 }, workItem: first },
        { membership: { position: 2000 }, workItem: second },
      ],
    };
    mocks.listWorkItems.mockResolvedValue({ workItems: [first, second], count: 2 });
    mocks.listAutoRuns.mockResolvedValue({ autoRuns: [{ id: "aur_1", status: "awaiting_approval" }] });
    mocks.listPlanningProjects.mockResolvedValue({ projects: [project] });
    mocks.getPlanningProject.mockResolvedValue({ project });
    mocks.reorderPlanningProjectItems.mockResolvedValue({ project });
    mocks.startWorkItemAutoRun.mockResolvedValue({ autoRun: { id: "aur_planning" } });
    mocks.updatePlanningProject.mockResolvedValue({ project: { ...project, revision: 3 } });
    mocks.createPlanningProject.mockResolvedValue({ project: { ...project, id: "ppj_copy", name: "Ordered copy" } });
    render(<TaskView />);
    fireEvent.click(await screen.findByRole("button", { name: /Planning projects/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Move LOCAL-2 up" }));
    await waitFor(() => expect(mocks.reorderPlanningProjectItems).toHaveBeenCalledWith(
      "ppj_1", 2, ["lwi_2", "lwi_1"],
    ));
    fireEvent.click(screen.getByRole("button", { name: "Roadmap" }));
    expect((await screen.findAllByText("M3")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("2026-08-15").length).toBeGreaterThan(0);
    expect(screen.getByText("50% complete")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Current month" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Current quarter" })).toBeTruthy();
    expect(screen.getByText("Project health")).toBeTruthy();
    expect(screen.getByText(/Owner: usr_release/)).toBeTruthy();
    expect(screen.getByRole("option", { name: "usr_release" })).toBeTruthy();
    expect(screen.getByText("release · backend")).toBeTruthy();
    expect(screen.getByRole("option", { name: "backend" })).toBeTruthy();
    expect(screen.getByText(/Ready for rollout/)).toBeTruthy();
    expect(screen.getByText(/Updated 2 days ago/)).toBeTruthy();
    expect(screen.getByText("Status history (1)")).toBeTruthy();
    expect(screen.getByText("Scope approved")).toBeTruthy();
    expect(screen.getByTitle("Unpin project")).toBeTruthy();
    expect(screen.getByTitle("Unwatch project")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Watched projects" })).toBeTruthy();
    expect(screen.getByText("Recover schedule (3 days)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Automate" }));
    await waitFor(() => expect(mocks.executePlanningRecommendedAction).toHaveBeenCalledWith(
      "ppj_1", "refresh_status",
      { expectedRevision: 2, idempotencyKey: "ppj_1:refresh_status:2", confirmed: true },
    ));
    expect(screen.getByText("Create project")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Target date" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear portfolio filters" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Executions" }));
    expect(screen.getByText("Awaiting approval")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Review" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Evidence" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Insights" }));
    expect(await screen.findByText("Status distribution")).toBeTruthy();
    expect(screen.getByText("Milestone progress")).toBeTruthy();
    expect(screen.getByText("2026-07-01 → 2026-07-31")).toBeTruthy();
    expect(screen.getByText("7 days remaining")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Roadmap" }));
    fireEvent.change(screen.getByLabelText("View name"), { target: { value: "Quarter roadmap" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    await waitFor(() => expect(mocks.updatePlanningProject).toHaveBeenCalledWith(
      "ppj_1",
      expect.objectContaining({
        expectedRevision: 2,
        savedViews: [expect.objectContaining({ name: "Quarter roadmap", view: "roadmap" })],
      }),
    ));
    fireEvent.click(screen.getAllByTitle("Start Auto-run")[0]);
    await waitFor(() => expect(mocks.startWorkItemAutoRun).toHaveBeenCalledWith("lwi_2"));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(mocks.createPlanningProject).toHaveBeenCalledWith({
      name: "Ordered copy",
      templateProjectId: "ppj_1",
    }));
  });

  it("opens details, saves fields, and posts a comment", async () => {
    const item = {
      id: "lwi_1", localRef: "LOCAL-1", projectId: "prj_1",
      title: "Editable issue", body: "Before", type: "task", status: "backlog",
      priority: "p2", state: "open", labels: [], assigneeIds: [],
      businessState: "open", planningStatus: "backlog", executionState: "claimed",
      externalBindings: [{
        kind: "github_issue", number: 42, url: "https://github.test/issues/42",
        lastSyncedAt: "2026-07-24T00:00:00.000Z",
        conflict: { fields: ["title"], local: { title: "Editable issue" }, remote: { title: "Remote issue" } },
      }],
      acceptanceCriteria: ["Tests pass"], revision: 1, archivedAt: null,
      acceptanceResults: [{ criterion: "Tests pass", status: "passed", note: "321 tests", verificationId: "wvr_1" }],
      verificationRecords: [{
        id: "wvr_1", kind: "test", status: "passed", command: "pnpm test", summary: "All suites",
        evidence: [{ kind: "run", ref: "run:test-1", summary: "Test output" }],
        recordedAt: "2026-07-24T00:00:00.000Z", recordedBy: "usr_a",
      }],
      completionGate: { ready: true, missingCriteria: [], verificationRequired: false },
      parentId: null, parent: null, subIssues: [],
      subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
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
    expect(screen.getByText("Business: Open")).toBeTruthy();
    expect(screen.getByText("Planning: Backlog")).toBeTruthy();
    expect(screen.getByText("Execution: Claimed")).toBeTruthy();
    expect(screen.getByText("GitHub #42 · Conflict")).toBeTruthy();
    expect(screen.getByText("Conflicting fields: title")).toBeTruthy();
    expect(screen.getByText("Tests pass · 321 tests")).toBeTruthy();
    expect(screen.getByText("test · All suites")).toBeTruthy();
    expect(screen.getByText("run: run:test-1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep local" }));
    await waitFor(() => expect(mocks.syncWorkItemGithubIssue).toHaveBeenCalledWith(
      "lwi_1", { expectedRevision: 1, direction: "resolve_local" },
    ));
    expect(screen.getByText("No sub-issues")).toBeTruthy();
    expect(screen.getByLabelText("Parent issue")).toBeTruthy();
    fireEvent.change(title, { target: { value: "Edited issue" } });
    fireEvent.click(screen.getByRole("button", { name: "Create worktree" }));
    expect(mocks.createWorkItemWorktree).not.toHaveBeenCalled();
    const safetyDialog = screen.getAllByRole("dialog").at(-1);
    fireEvent.click(within(safetyDialog as HTMLElement).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.updateWorkItem).toHaveBeenCalledWith("lwi_1", expect.objectContaining({
      expectedRevision: 1,
      title: "Edited issue",
    })));
    await waitFor(() => expect(mocks.createWorkItemWorktree).toHaveBeenCalledWith("lwi_1"));
    fireEvent.change(screen.getByPlaceholderText("Add a comment…"), { target: { value: "Looks good" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(mocks.createWorkItemComment).toHaveBeenCalledWith("lwi_1", "Looks good"));
    expect(screen.getByText("Created")).toBeTruthy();
  });
});
