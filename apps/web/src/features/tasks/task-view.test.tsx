import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskView, shouldShowWorkItemCost } from "@/features/tasks/task-view";

const mocks = vi.hoisted(() => ({
  listWorkItems: vi.fn(),
  listWorkItemAttention: vi.fn(),
  getWorkItemExternalIssueFunnel: vi.fn(),
  updateWorkItemAttention: vi.fn(),
  listGithubItems: vi.fn(),
  createWorkItem: vi.fn(),
  inspectArticleImport: vi.fn(),
  startArticleImport: vi.fn(),
  listArticleImports: vi.fn(),
  getArticleImport: vi.fn(),
  cancelArticleImport: vi.fn(),
  analyzeArticleImport: vi.fn(),
  findSimilarArticleImports: vi.fn(),
  createArticleDerivative: vi.fn(),
  listArticleDerivatives: vi.fn(),
  getArticleDerivative: vi.fn(),
  getWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
  recordWorkItemProgress: vi.fn(),
  bulkUpdateWorkItems: vi.fn(),
  transitionWorkItem: vi.fn(),
  listWorkItemComments: vi.fn(),
  createWorkItemComment: vi.fn(),
  updateWorkItemComment: vi.fn(),
  deleteWorkItemComment: vi.fn(),
  listWorkItemActivity: vi.fn(),
  createWorkItemWorktree: vi.fn(),
  startWorkItemAutoRun: vi.fn(),
  deliverWorkItem: vi.fn(),
  autoRunReadiness: vi.fn(),
  syncWorkItemGithubIssue: vi.fn(),
  listAutoRuns: vi.fn(),
  listWorkItemAutoRunBatches: vi.fn(),
  createWorkItemAutoRunBatch: vi.fn(),
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
  listWorkItemReportDrafts: vi.fn(),
  generateWorkItemReportDraft: vi.fn(),
  updateWorkItemReportDraft: vi.fn(),
  confirmWorkItemReportDraft: vi.fn(),
  discardWorkItemReportDraft: vi.fn(),
  setSection: vi.fn(),
  setSelectedProjectId: vi.fn(),
  setSelectedWorktreeId: vi.fn(),
  setSelectedWorkItemId: vi.fn(),
  setSelectedWorkItemMode: vi.fn(),
  setSelectedWorkItemSection: vi.fn(),
  setSelectedExternalWorkTab: vi.fn(),
  setSettingsQuery: vi.fn(),
  setSettingsCategory: vi.fn(),
  setSettingsDialogOpen: vi.fn(),
  setSurfaceReturnSection: vi.fn(),
  setTaskArea: vi.fn(),
  recordRecentSettingsSection: vi.fn(),
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
    users: [
      { id: "usr_local", name: "Current user", teamId: "team_local", role: "member" },
      { id: "usr_manager", name: "Morgan Manager", teamId: "team_local", role: "manager" },
    ],
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
    getWorkItemExternalIssueFunnel: mocks.getWorkItemExternalIssueFunnel,
    updateWorkItemAttention: mocks.updateWorkItemAttention,
    listGithubItems: mocks.listGithubItems,
    createWorkItem: mocks.createWorkItem,
    inspectArticleImport: mocks.inspectArticleImport,
    startArticleImport: mocks.startArticleImport,
    listArticleImports: mocks.listArticleImports,
    getArticleImport: mocks.getArticleImport,
    cancelArticleImport: mocks.cancelArticleImport,
    analyzeArticleImport: mocks.analyzeArticleImport,
    findSimilarArticleImports: mocks.findSimilarArticleImports,
    createArticleDerivative: mocks.createArticleDerivative,
    listArticleDerivatives: mocks.listArticleDerivatives,
    getArticleDerivative: mocks.getArticleDerivative,
    getWorkItem: mocks.getWorkItem,
    updateWorkItem: mocks.updateWorkItem,
    recordWorkItemProgress: mocks.recordWorkItemProgress,
    bulkUpdateWorkItems: mocks.bulkUpdateWorkItems,
    transitionWorkItem: mocks.transitionWorkItem,
    listWorkItemComments: mocks.listWorkItemComments,
    createWorkItemComment: mocks.createWorkItemComment,
    updateWorkItemComment: mocks.updateWorkItemComment,
    deleteWorkItemComment: mocks.deleteWorkItemComment,
    listWorkItemActivity: mocks.listWorkItemActivity,
    createWorkItemWorktree: mocks.createWorkItemWorktree,
    startWorkItemAutoRun: mocks.startWorkItemAutoRun,
    deliverWorkItem: mocks.deliverWorkItem,
    autoRunReadiness: mocks.autoRunReadiness,
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

vi.mock("@/features/tasks/work-item-batch-api", () => ({
  workItemBatchApi: {
    list: mocks.listWorkItemAutoRunBatches,
    create: mocks.createWorkItemAutoRunBatch,
  },
}));

vi.mock("@/features/tasks/work-item-report-api", () => ({
  workItemReportApi: {
    list: mocks.listWorkItemReportDrafts,
    generate: mocks.generateWorkItemReportDraft,
    update: mocks.updateWorkItemReportDraft,
    confirm: mocks.confirmWorkItemReportDraft,
    discard: mocks.discardWorkItemReportDraft,
  },
}));

vi.mock("@/features/tasks/article-workflow-api", () => ({
  articleApi: {
    inspect: mocks.inspectArticleImport,
    startImport: mocks.startArticleImport,
    listImports: mocks.listArticleImports,
    getImport: mocks.getArticleImport,
    cancelImport: mocks.cancelArticleImport,
    analyze: mocks.analyzeArticleImport,
    findSimilar: mocks.findSimilarArticleImports,
    createDerivative: mocks.createArticleDerivative,
    listDerivatives: mocks.listArticleDerivatives,
    getDerivative: mocks.getArticleDerivative,
  },
}));
vi.mock("@/store/ui-store", () => ({
  useUiStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    section: "task",
    setSection: mocks.setSection,
    setSurfaceReturnSection: mocks.setSurfaceReturnSection,
    setTaskArea: mocks.setTaskArea,
    settingsDialogOpen: false,
    setSettingsDialogOpen: mocks.setSettingsDialogOpen,
    setSettingsCategory: mocks.setSettingsCategory,
    setSettingsQuery: mocks.setSettingsQuery,
    recordRecentSettingsSection: mocks.recordRecentSettingsSection,
    setSelectedProjectId: mocks.setSelectedProjectId,
    selectedWorkItemId: null,
    selectedWorkItemMode: "summary",
    workItemDetailPreference: "summary",
    setSelectedWorkItemId: mocks.setSelectedWorkItemId,
    setSelectedWorkItemMode: mocks.setSelectedWorkItemMode,
    setSelectedWorkItemSection: mocks.setSelectedWorkItemSection,
    setSelectedExternalWorkTab: mocks.setSelectedExternalWorkTab,
    selectedPlanningProjectId: null,
    planningProjectView: "list",
    planningProjectFilters: { status: "all", priority: "all", milestone: "", due: "all" },
    setSelectedPlanningProjectId: vi.fn(),
    setPlanningProjectView: vi.fn(),
    setPlanningProjectFilters: vi.fn(),
    setSelectedWorktreeId: mocks.setSelectedWorktreeId,
  }),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("TaskView local work items", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.listPlanningProjects.mockResolvedValue({ projects: [] });
    mocks.listAutoRuns.mockResolvedValue({ autoRuns: [] });
    mocks.listWorkItemAutoRunBatches.mockResolvedValue({ batches: [] });
    mocks.listWorkItemAttention.mockResolvedValue({ items: [] });
    mocks.getWorkItemExternalIssueFunnel.mockResolvedValue({ metrics: { total: 0, notStarted: 0, running: 0, review: 0, completed: 0, stalled: 0 }, stalls: [] });
    mocks.autoRunReadiness.mockResolvedValue({ readiness: { ready: true, checks: [] } });
    mocks.listArticleImports.mockResolvedValue({ jobs: [], latest: null });
    mocks.listArticleDerivatives.mockResolvedValue({ derivatives: [] });
    mocks.listWorkItemReportDrafts.mockResolvedValue({ reportDrafts: [], count: 0 });
  });

  async function openExpertDetails() {
    fireEvent.click(await screen.findByRole("button", { name: "Technical and audit details" }));
  }
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

  it("creates a task from the modal", async () => {
    mocks.listWorkItems.mockResolvedValue({ workItems: [], count: 0 });
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_2" } });
    render(<TaskView />);
    fireEvent.click(screen.getByRole("button", { name: /New task/i }));
    fireEvent.change(
      await screen.findByLabelText("Title", undefined, { timeout: 5_000 }),
      { target: { value: "Build local board" } },
    );
    fireEvent.change(screen.getByLabelText("Expected completion date"), { target: { value: "2026-08-15" } });
    fireEvent.change(screen.getByLabelText("Milestone"), { target: { value: "M3" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "prj_1",
      title: "Build local board",
      type: "task",
      priority: "p2",
      dueDate: "2026-08-15",
      milestone: "M3",
      requesterRelation: "self",
      intakeChannel: "manual",
      waitingOn: "me",
    })));
  });

  it("uses the same low-decision creator on the ordinary task page", async () => {
    mocks.listWorkItems.mockResolvedValue({ workItems: [], count: 0 });
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_simple" } });
    render(<TaskView localOnly />);

    expect(screen.getByText("Local").parentElement?.className).toContain("hidden");
    const moreTools = screen.getByText("More task tools");
    expect(moreTools).toBeTruthy();
    fireEvent.click(moreTools);
    fireEvent.click(screen.getByRole("button", { name: "Task status" }));
    expect(mocks.setSection).toHaveBeenCalledWith("workBoard");
    fireEvent.click(screen.getByRole("button", { name: /New task/i }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Create a task" }), {
      target: { value: "Prepare a short customer update" },
    });
    expect(screen.queryByLabelText("Priority")).toBeNull();
    expect(screen.queryByLabelText("Verification SOP")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create task only" }));

    await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "prj_1",
      title: "Prepare a short customer update",
      dueDate: null,
      priority: "p2",
      executionPolicy: "manual",
    })));
  });

  it("places External work after New task and opens the requested external-work tab", async () => {
    mocks.listWorkItems.mockResolvedValue({ workItems: [], count: 0 });
    render(<TaskView localOnly />);

    const newTask = screen.getByRole("button", { name: /New task/i });
    const externalWork = screen.getByRole("button", { name: "External work" });
    expect(newTask.compareDocumentPosition(externalWork) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(externalWork);
    fireEvent.click(screen.getByRole("menuitem", { name: /Change requests/ }));
    expect(mocks.setSelectedExternalWorkTab).toHaveBeenCalledWith("pr");
    expect(mocks.setSection).toHaveBeenCalledWith("externalWork");

    fireEvent.click(externalWork);
    fireEvent.click(screen.getByRole("menuitem", { name: /External issue settings/ }));
    expect(mocks.setSection).toHaveBeenCalledWith("settings");
    expect(mocks.setSettingsQuery).toHaveBeenCalledWith("external issue");
  });

  it("records customer source and follow-up when creating a task", async () => {
    mocks.listWorkItems.mockResolvedValue({ workItems: [], count: 0 });
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_customer" } });
    render(<TaskView />);
    fireEvent.click(screen.getByRole("button", { name: /New task/i }));
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Confirm launch scope" } });
    fireEvent.change(screen.getByLabelText("Expected completion date"), { target: { value: "2026-08-15" } });
    fireEvent.change(screen.getByLabelText("Requester relationship"), { target: { value: "customer" } });
    fireEvent.change(screen.getByLabelText("Requester name"), { target: { value: "Alex Client" } });
    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Intake channel"), { target: { value: "meeting" } });
    fireEvent.change(screen.getByLabelText("Currently waiting on"), { target: { value: "requester" } });
    fireEvent.click(screen.getByLabelText("Morgan Manager · manager"));
    fireEvent.change(screen.getByLabelText("Next follow-up"), { target: { value: "2099-08-05T10:00" } });
    fireEvent.change(screen.getByLabelText("External reference"), { target: { value: "Weekly sync 42" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      requesterRelation: "customer",
      requesterName: "Alex Client",
      requesterOrganization: "Acme",
      requesterUserId: null,
      intakeChannel: "meeting",
      externalReference: "Weekly sync 42",
      waitingOn: "requester",
      assigneeIds: ["usr_manager"],
      nextFollowUpAt: expect.stringMatching(/^2099-08-05T/),
    })));
  });

  it("inspects a public article and creates an automatically scheduled AI issue", async () => {
    mocks.listWorkItems.mockResolvedValue({ workItems: [], count: 0 });
    mocks.inspectArticleImport.mockResolvedValue({
      inspection: {
        canonicalUrl: "https://mp.weixin.qq.com/s/example",
        provider: "wechat",
        contentType: "article",
        title: "Imported WeChat article",
        author: "Author",
        publishedAt: "2026-07-27",
        publishedAtSource: "source",
        textLength: 962,
        mediaCounts: { images: 3, audio: 0, video: 0 },
      },
    });
    mocks.createWorkItem.mockResolvedValue({ workItem: { id: "lwi_article" } });
    render(<TaskView />);
    fireEvent.click(screen.getByRole("button", { name: /New task/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Import link" }));
    fireEvent.change(screen.getByLabelText("Public article URL"), {
      target: { value: "https://mp.weixin.qq.com/s/example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    expect(await screen.findByText("Imported WeChat article")).toBeTruthy();
    expect(screen.getByText(/3 images/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Expected completion date"), { target: { value: "2026-08-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and let AI handle it" }));
    await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "prj_1",
      title: "Imported WeChat article",
      labels: expect.arrayContaining(["source:wechat", "content:article"]),
      intakeChannel: "import",
      status: "ready",
      executionPolicy: "auto",
      waitingOn: "ai",
      plannedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })));
    expect(mocks.createWorkItem.mock.calls.at(-1)?.[0]).not.toHaveProperty("assigneeIds");
    expect(mocks.createWorkItemWorktree).not.toHaveBeenCalled();
    expect(mocks.startArticleImport).not.toHaveBeenCalled();
  });

  it("ignores a stale inspection response after the URL changes", async () => {
    mocks.listWorkItems.mockResolvedValue({ workItems: [], count: 0 });
    let resolveInspection!: (value: unknown) => void;
    mocks.inspectArticleImport.mockReturnValue(new Promise((resolve) => { resolveInspection = resolve; }));
    render(<TaskView />);
    fireEvent.click(screen.getByRole("button", { name: /New task/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Import link" }));
    const input = screen.getByLabelText("Public article URL");
    fireEvent.change(input, { target: { value: "https://example.com/a" } });
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    fireEvent.change(input, { target: { value: "https://example.com/b" } });
    resolveInspection({
      inspection: {
        canonicalUrl: "https://example.com/a",
        provider: "web",
        contentType: "article",
        title: "Stale article A",
        author: null,
        publishedAt: null,
        publishedAtSource: "imported",
        textLength: 10,
        mediaCounts: { images: 0, audio: 0, video: 0 },
      },
    });
    await waitFor(() => expect(mocks.inspectArticleImport).toHaveBeenCalled());
    expect(screen.queryByText("Stale article A")).toBeNull();
    expect((screen.getByRole("button", { name: "Create and let AI handle it" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("filters tasks by planning project and manages membership", async () => {
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
      followUpSchemaVersion: 1, requesterRelation: "customer",
      requesterName: "Alex Client", requesterOrganization: "Acme", requesterUserId: null,
      intakeChannel: "meeting", externalReference: "Weekly sync 42", waitingOn: "requester",
      commitmentDate: "2099-08-07T09:00:00.000Z", nextFollowUpAt: "2099-08-05T02:00:00.000Z",
      lastProgressAt: "2026-07-24T01:00:00.000Z", lastProgressSummary: "Draft sent for review",
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
    expect(await screen.findByTestId("work-item-summary-view")).toBeTruthy();
    await openExpertDetails();
    expect(screen.getByRole("dialog", { name: "Local issue details" }).className).toContain("max-w-7xl");
    const cockpit = (await screen.findByText("Task cockpit")).closest("section");
    expect(cockpit?.querySelector(".grid")?.className).toContain("xl:grid-cols-4");
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Report" })).toBeTruthy();
    expect(await screen.findByText("Customer · Alex Client")).toBeTruthy();
    expect(screen.getByText("Draft sent for review")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record progress" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Assets" }));
    expect(screen.getByRole("tab", { name: "Assets" }).getAttribute("aria-selected")).toBe("true");
    expect(cockpit?.hasAttribute("hidden")).toBe(true);
    const title = await screen.findByDisplayValue("Editable issue");
    expect(title.closest("[hidden]")).toBeNull();
    expect(screen.getByText("Business: Open")).toBeTruthy();
    expect(screen.getByText("Planning: Backlog")).toBeTruthy();
    expect(screen.getByText("Execution: Claimed")).toBeTruthy();
    expect(screen.getByText("GitHub #42 · Conflict")).toBeTruthy();
    expect(screen.getByText("Conflicting fields: title")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Verification" }));
    expect(await screen.findByText("Tests pass · 321 tests")).toBeTruthy();
    expect(await screen.findByText("test · All suites")).toBeTruthy();
    expect(await screen.findByText("run: run:test-1")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Trace" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep local" }));
    await waitFor(() => expect(mocks.syncWorkItemGithubIssue).toHaveBeenCalledWith(
      "lwi_1", { expectedRevision: 1, direction: "resolve_local" },
    ));
    fireEvent.click(screen.getByRole("tab", { name: "Assets" }));
    expect(screen.getByText("No sub-issues")).toBeTruthy();
    expect(screen.getByLabelText("Parent issue")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Currently waiting on"), { target: { value: "ai" } });
    fireEvent.change(title, { target: { value: "Edited issue" } });
    fireEvent.click(screen.getByRole("tab", { name: "Process" }));
    expect(mocks.createWorkItemWorktree).not.toHaveBeenCalled();
    const safetyDialog = screen.getAllByRole("dialog").at(-1);
    fireEvent.click(within(safetyDialog as HTMLElement).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.updateWorkItem).toHaveBeenCalledWith("lwi_1", expect.objectContaining({
      expectedRevision: 1,
      title: "Edited issue",
      requesterRelation: "customer",
      requesterName: "Alex Client",
      waitingOn: "ai",
    })));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Process" }).getAttribute("aria-selected")).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Create worktree" }));
    await waitFor(() => expect(mocks.createWorkItemWorktree).toHaveBeenCalledWith("lwi_1"));
    fireEvent.click(screen.getByRole("tab", { name: "Trace" }));
    fireEvent.change(screen.getByPlaceholderText("Add a comment…"), { target: { value: "Looks good" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(mocks.createWorkItemComment).toHaveBeenCalledWith("lwi_1", "Looks good"));
    expect(screen.getByText("Created")).toBeTruthy();
  });

  it("guards section navigation and detail close when the report has unsaved edits", async () => {
    const item = {
      id: "lwi_report_guard", localRef: "LOCAL-88", projectId: "prj_1",
      title: "Guard report edits", body: "", type: "task", status: "review",
      priority: "p1", state: "open", labels: [], assigneeIds: [],
      followUpSchemaVersion: 1, requesterRelation: "customer",
      requesterName: "Alex", requesterOrganization: "Acme", requesterUserId: null,
      intakeChannel: "meeting", externalReference: null, waitingOn: "me",
      commitmentDate: null, nextFollowUpAt: null, lastProgressAt: null, lastProgressSummary: null,
      acceptanceCriteria: [], revision: 4, archivedAt: null,
      parentId: null, parent: null, subIssues: [], subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
      updatedAt: "2026-08-03T12:00:00.000Z",
    };
    const reportDraft = {
      id: "wrd_guard", schemaVersion: 1, workItemId: item.id, status: "draft", revision: 1,
      audience: { relation: "customer", name: "Alex", organization: "Acme", userId: null },
      tone: "concise", content: "Original report", stale: false, canEdit: true, canConfirm: true,
      source: {
        workItemRevision: 4, capturedAt: item.updatedAt, contextDigest: "digest",
        progressActivities: [], executionResults: [],
      },
      generation: {
        generator: "structured", policyVersion: "work-item-report-v1", modelVersion: null,
        locale: "en-US", inputDigest: "input",
      },
      createdBy: "usr_local", updatedBy: "usr_local", createdAt: item.updatedAt, updatedAt: item.updatedAt,
      confirmedAt: null, confirmedBy: null, confirmedSnapshot: null,
    };
    mocks.listWorkItems.mockResolvedValue({ workItems: [item], count: 1 });
    mocks.getWorkItem.mockResolvedValue({ workItem: item, observability: null });
    mocks.listWorkItemComments.mockResolvedValue({ comments: [] });
    mocks.listWorkItemActivity.mockResolvedValue({ activities: [] });
    mocks.listWorkItemReportDrafts.mockResolvedValue({ reportDrafts: [reportDraft], count: 1 });

    render(<TaskView />);
    fireEvent.click(await screen.findByText("Guard report edits"));
    await openExpertDetails();
    fireEvent.click(await screen.findByRole("tab", { name: "Report" }));
    fireEvent.change(await screen.findByDisplayValue("Original report"), { target: { value: "Protected edit" } });

    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    const navigationDialog = await screen.findByText(/Return to the Report tab to save them/);
    expect(screen.getByRole("tab", { name: "Report" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(navigationDialog.closest('[role="dialog"]') as HTMLElement).getByRole("button", { name: "Cancel" }));

    const detailDialog = screen.getByRole("dialog", { name: "Local issue details" });
    fireEvent.click(within(detailDialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getAllByRole("dialog", { name: "Local issue details" })).toHaveLength(2));
    expect(screen.getByDisplayValue("Protected edit")).toBeTruthy();
  });

  it("opens an imported Markdown output directly from its local Issue", async () => {
    const item = {
      id: "lwi_article", localRef: "LOCAL-12", projectId: "prj_1",
      title: "Imported article", body: "", type: "task", status: "review",
      priority: "p2", state: "open", labels: ["source:wechat"], assigneeIds: [],
      acceptanceCriteria: [], revision: 2, archivedAt: null,
      executionBindings: [{
        kind: "article_import", targetId: "article_import_12", worktreeId: "wtr_article",
        createdAt: "2026-07-28T00:00:00.000Z",
      }],
      outputAssets: [{
        id: "asset_md",
        path: "docs/imported/wechat/2026/07/article/article.md",
        family: "markdown",
        terminalId: "dev_1",
        hash: null,
        version: "v1",
        worktreeId: "wtr_article",
        capabilities: [],
        readiness: { state: "ready", reason: "available_on_owning_terminal" },
      }, {
        id: "asset_html",
        path: "docs/imported/wechat/2026/07/article/article.html",
        family: "unknown",
        terminalId: "dev_1",
        hash: null,
        version: "v2",
        worktreeId: "wtr_article",
        capabilities: [],
        readiness: { state: "ready", reason: "available_on_owning_terminal" },
      }],
      updatedAt: "2026-07-28T00:00:00.000Z",
    };
    mocks.listWorkItems.mockResolvedValue({ workItems: [item], count: 1 });
    mocks.getWorkItem.mockResolvedValue({ workItem: item, observability: null });
    mocks.listWorkItemComments.mockResolvedValue({ comments: [] });
    mocks.listWorkItemActivity.mockResolvedValue({ activities: [] });
    mocks.listArticleImports.mockResolvedValueOnce({ jobs: [{
      id: "article_import_12",
      worktreeId: "wtr_article",
      canonicalUrl: "https://mp.weixin.qq.com/s/example",
      state: "failed",
      progress: { stage: "failed", completed: 0, total: 1 },
      error: "article_import_interrupted",
    }], latest: null }).mockResolvedValue({ jobs: [{
      id: "article_import_12",
      worktreeId: "wtr_article",
      canonicalUrl: "https://mp.weixin.qq.com/s/example",
      state: "completed",
      progress: { stage: "completed", completed: 1, total: 1 },
      error: null,
    }], latest: null });
    mocks.startArticleImport.mockResolvedValue({ job: { id: "article_import_retry", state: "queued" } });
    mocks.analyzeArticleImport.mockResolvedValue({
      analysisPath: "docs/imported/wechat/2026/07/article/analysis.md",
      analysis: {
        schemaVersion: 1,
        title: "一个链接进去，播客、故事书、视频都出来了",
        generatedAt: "2026-07-28T00:00:00.000Z",
        method: "local-extractive-v1",
        coreIdeas: ["把任何内容变成任何格式。", "平台把内容生产方法打包进流程。"],
        framework: [{
          order: 1,
          heading: "一个输入，多种产出",
          role: "development",
          summary: "文章先展开产品支持的输入和输出。",
        }, {
          order: 2,
          heading: "没解决的",
          role: "boundary",
          summary: "文章最后说明模板感和中文质量等局限。",
        }],
        argumentPath: [],
        keyConcepts: ["播客", "Storybook"],
      },
    });
    mocks.findSimilarArticleImports.mockResolvedValue({
      method: "local-lexical-v1",
      indexedCount: 2,
      skippedCount: 0,
      matches: [{
        articleId: "article_import_related",
        workItemId: "lwi_related",
        localRef: "LOCAL-13",
        worktreeId: "wtr_related",
        markdownPath: "docs/imported/wechat/2026/07/related/article.md",
        canonicalUrl: "https://mp.weixin.qq.com/s/related",
        title: "Related article",
        author: "Author B",
        provider: "wechat",
        publishedAt: "2026-07-20",
        score: 0.63,
        reasons: ["core_ideas", "body", "same_provider"],
        sharedConcepts: ["播客", "内容工作流"],
        signals: { coreIdeas: 0.7, titleStructure: 0.4, body: 0.6, metadata: 0.5 },
      }],
    });
    mocks.createArticleDerivative.mockResolvedValue({
      derivative: {
        id: "article_derivative_1",
        invocationId: "inv_derivative_1",
        sourceJobId: "article_import_12",
        workItemId: "lwi_article",
        worktreeId: "wtr_article",
        kind: "video_script",
        tone: "conversational",
        length: "short",
        audiencePreset: "custom",
        agePreset: "50_plus",
        ageDetails: "正在尝试 AI 内容工具",
        targetAge: "50 岁以上；补充说明：正在尝试 AI 内容工具",
        angle: "平台替普通用户做了多少内容生产决策",
        audience: "内容创作者",
        outputPath: "docs/imported/wechat/2026/07/article/derivatives/video-script-001.md",
        state: "queued",
        error: null,
        agentId: "agt_codex_cli",
        createdAt: "2026-07-28T00:05:00.000Z",
        completedAt: null,
      },
    });
    render(<TaskView />);
    fireEvent.click(await screen.findByText("Imported article"));
    await openExpertDetails();
    fireEvent.click(await screen.findByRole("tab", { name: "Process" }));
    expect(await screen.findByText(/server restarted during import/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry import" }));
    await waitFor(() => expect(mocks.startArticleImport).toHaveBeenCalledWith("lwi_article", {
      url: "https://mp.weixin.qq.com/s/example",
      worktreeId: "wtr_article",
    }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Markdown" }));
    expect(mocks.setSelectedProjectId).toHaveBeenCalledWith("prj_1");
    expect(mocks.setSelectedWorktreeId).toHaveBeenCalledWith("wtr_article");
    expect(mocks.setSection).toHaveBeenCalledWith("documents");
    expect(new URL(window.location.href).searchParams.get("document")).toBe(
      "docs/imported/wechat/2026/07/article/article.md",
    );
    fireEvent.click(screen.getByRole("button", { name: "Open HTML" }));
    expect(new URL(window.location.href).searchParams.get("document")).toBe(
      "docs/imported/wechat/2026/07/article/article.html",
    );
    fireEvent.click(await screen.findByRole("button", { name: "Find similar articles" }));
    await waitFor(() => expect(mocks.findSimilarArticleImports).toHaveBeenCalledWith(
      "lwi_article", "article_import_12",
    ));
    expect(await screen.findByText("Searched 2 local article(s) and found 1 match(es).")).toBeTruthy();
    expect(screen.getByText("Similar core ideas")).toBeTruthy();
    expect(screen.getByText("Shared concepts: 播客、内容工作流")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Related article" }));
    expect(mocks.setSelectedWorktreeId).toHaveBeenCalledWith("wtr_related");
    expect(new URL(window.location.href).searchParams.get("document")).toBe(
      "docs/imported/wechat/2026/07/related/article.md",
    );
    fireEvent.click(await screen.findByRole("button", { name: "Create derivative" }));
    const derivativeDialog = screen.getAllByRole("dialog").at(-1) as HTMLElement;
    fireEvent.change(within(derivativeDialog).getByLabelText("Format"), { target: { value: "video_script" } });
    fireEvent.change(within(derivativeDialog).getByLabelText("Tone"), { target: { value: "conversational" } });
    fireEvent.change(within(derivativeDialog).getByLabelText("Length"), { target: { value: "short" } });
    fireEvent.change(within(derivativeDialog).getByLabelText("Audience group"), { target: { value: "custom" } });
    fireEvent.change(within(derivativeDialog).getByLabelText("Custom audience"), { target: { value: "内容创作者" } });
    fireEvent.change(within(derivativeDialog).getByLabelText("Age range"), { target: { value: "50_plus" } });
    fireEvent.change(within(derivativeDialog).getByLabelText("Age context (optional)"), {
      target: { value: "正在尝试 AI 内容工具" },
    });
    fireEvent.change(within(derivativeDialog).getByLabelText("Creative angle (optional)"), {
      target: { value: "平台替普通用户做了多少内容生产决策" },
    });
    fireEvent.click(within(derivativeDialog).getByRole("button", { name: "Start creation" }));
    await waitFor(() => expect(mocks.createArticleDerivative).toHaveBeenCalledWith(
      "lwi_article",
      "article_import_12",
      {
        kind: "video_script",
        tone: "conversational",
        length: "short",
        audiencePreset: "custom",
        audience: "内容创作者",
        agePreset: "50_plus",
        ageDetails: "正在尝试 AI 内容工具",
        angle: "平台替普通用户做了多少内容生产决策",
        idempotencyKey: expect.any(String),
      },
    ));
    expect(await screen.findByText("Queued")).toBeTruthy();
    expect(screen.getByText("Target audience")).toBeTruthy();
    expect(screen.getByText("Target age")).toBeTruthy();
    expect(screen.getByText("50 岁以上；补充说明：正在尝试 AI 内容工具")).toBeTruthy();
    fireEvent.click(within(screen.getAllByRole("dialog").at(-1) as HTMLElement)
      .getByRole("button", { name: "Close" }));
    fireEvent.click(await screen.findByRole("button", { name: "View analysis" }));
    await waitFor(() => expect(mocks.analyzeArticleImport).toHaveBeenCalledWith(
      "lwi_article", "article_import_12",
    ));
    expect(await screen.findByText("Core ideas")).toBeTruthy();
    expect(screen.getByText("把任何内容变成任何格式。")).toBeTruthy();
    expect(screen.getByText("Article framework")).toBeTruthy();
    expect(screen.getByText("Limits")).toBeTruthy();
  });

  it("keeps a completed local run in review until an approved delivery is confirmed", async () => {
    const item = {
      id: "lwi_delivery", localRef: "LOCAL-9", projectId: "prj_1",
      title: "Deliver approved work", body: "", type: "feature", status: "review",
      priority: "p1", state: "open", labels: [], assigneeIds: [],
      acceptanceCriteria: [], verificationRecords: [], completionGate: {
        ready: true, missingCriteria: [], verificationRequired: false,
      },
      revision: 3, archivedAt: null, updatedAt: "2026-07-27T00:00:00.000Z",
      executionBindings: [{
        kind: "auto_run", targetId: "aur_9", worktreeId: "wtr_9",
        createdAt: "2026-07-27T00:00:00.000Z",
      }],
    };
    const observability = {
      nextAction: "review_delivery",
      attention: [],
      latestRun: {
        id: "aur_9", status: "done", updatedAt: "2026-07-27T00:00:00.000Z",
        localDelivery: { worktreeId: "wtr_9", branchName: "local-9" },
      },
      delivery: {
        state: "awaiting_review", mode: "local_merge", worktreeId: "wtr_9",
        branchName: "local-9", remoteUrl: null,
        review: {
          verdict: "approved", reviewedCommit: "abc", reviewedBy: "usr_a",
          createdAt: "2026-07-27T00:00:00.000Z",
        },
      },
      activeClaim: null,
      cost: { knownUsd: 0, unknownEntries: 0, entryCount: 0, projectBudget: null, teamBudget: null },
      alerts: { queued: 0, failed: 0, sent: 0, skipped: 0, items: [] },
    };
    mocks.listWorkItems.mockResolvedValue({ workItems: [item], count: 1 });
    mocks.getWorkItem.mockResolvedValue({ workItem: item, observability });
    mocks.listWorkItemComments.mockResolvedValue({ comments: [] });
    mocks.listWorkItemActivity.mockResolvedValue({ activities: [] });
    mocks.deliverWorkItem.mockResolvedValue({ workItem: { ...item, status: "done", state: "closed" } });
    render(<TaskView />);

    fireEvent.click(await screen.findByText("Deliver approved work"));
    await openExpertDetails();
    fireEvent.click(await screen.findByRole("tab", { name: "Process" }));
    expect(await screen.findByText("Ready for delivery")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    mocks.getWorkItem.mockResolvedValue({
      workItem: { ...item, revision: 4, updatedAt: "2026-07-27T00:01:00.000Z" },
      observability,
    });
    const callsBeforeRefresh = mocks.getWorkItem.mock.calls.length;
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(mocks.getWorkItem).toHaveBeenCalledTimes(callsBeforeRefresh + 1));
    fireEvent.click(screen.getByRole("button", { name: "Merge into base" }));
    const dialog = screen.getAllByRole("dialog").at(-1);
    fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: "Merge into base" }));
    await waitFor(() => expect(mocks.deliverWorkItem).toHaveBeenCalledWith("lwi_delivery", "local_merge", 4));
  });

  it("shows task run history only when the server reports a failure or rerun", async () => {
    const item = {
      id: "lwi_history", localRef: "LOCAL-60", projectId: "prj_1",
      title: "Retry a local task", body: "", type: "task", status: "in_progress",
      priority: "p1", state: "open", labels: [], assigneeIds: [],
      acceptanceCriteria: [], verificationRecords: [], completionGate: {
        ready: false, missingCriteria: [], verificationRequired: false,
      },
      revision: 2, archivedAt: null, updatedAt: "2026-08-07T02:00:00.000Z",
      executionBindings: [{
        kind: "auto_run", targetId: "aur_history", worktreeId: "wtr_history",
        createdAt: "2026-08-07T01:00:00.000Z",
      }],
    };
    const observability = {
      nextAction: "monitor_execution",
      attention: [],
      latestRun: {
        id: "aur_history", status: "running", updatedAt: "2026-08-07T02:00:00.000Z",
        invocationId: "inv_retry",
      },
      runHistory: [],
      activeClaim: null,
      cost: { knownUsd: 0, unknownEntries: 0, entryCount: 0, projectBudget: null, teamBudget: null },
      alerts: { queued: 0, failed: 0, sent: 0, skipped: 0, items: [] },
    };
    mocks.listWorkItems.mockResolvedValue({ workItems: [item], count: 1 });
    mocks.getWorkItem.mockResolvedValue({ workItem: item, observability });
    mocks.listWorkItemComments.mockResolvedValue({ comments: [] });
    mocks.listWorkItemActivity.mockResolvedValue({ activities: [] });
    render(<TaskView />);

    fireEvent.click(await screen.findByText("Retry a local task"));
    await openExpertDetails();
    fireEvent.click(await screen.findByRole("tab", { name: "Process" }));
    expect(screen.queryByLabelText("Run history")).toBeNull();

    mocks.getWorkItem.mockResolvedValue({
      workItem: item,
      observability: {
        ...observability,
        runHistory: [{
          invocationId: "inv_first", autoRunId: "aur_history", attempt: 1, status: "failed",
          createdAt: "2026-08-07T01:00:00.000Z", startedAt: "2026-08-07T01:00:01.000Z",
          completedAt: "2026-08-07T01:05:00.000Z", errorCode: "transport_closed",
          summary: "The local connection closed.", current: false,
        }, {
          invocationId: "inv_retry", autoRunId: "aur_history", attempt: 2, status: "running",
          createdAt: "2026-08-07T02:00:00.000Z", startedAt: "2026-08-07T02:00:01.000Z",
          completedAt: null, errorCode: null, summary: null, current: true,
        }],
      },
    });
    document.dispatchEvent(new Event("visibilitychange"));

    const history = await screen.findByLabelText("Run history");
    expect(within(history).getByText("Attempt 1")).toBeTruthy();
    expect(within(history).getByText("Attempt 2")).toBeTruthy();
    expect(within(history).getByText("The local connection closed.")).toBeTruthy();
    expect(within(history).getByText("Reason: transport_closed")).toBeTruthy();
    expect(within(history).getByText("Current")).toBeTruthy();
  });

  it("shows the external issue funnel and plain-language stalled recovery", async () => {
    mocks.listWorkItems.mockResolvedValue({ workItems: [], count: 0 });
    mocks.getWorkItemExternalIssueFunnel.mockResolvedValue({
      metrics: { total: 3, notStarted: 1, running: 1, review: 0, completed: 1, stalled: 1 },
      stalls: [{
        kind: "writeback_pending", workItemId: "lwi_88", localRef: "LOCAL-88", title: "Ship external fix",
        provider: "gitlab", issueNumber: 88, since: "2026-08-01T00:00:00.000Z",
      }],
    });
    render(<TaskView />);
    const funnel = await screen.findByLabelText("External issue execution funnel");
    expect(funnel.textContent).toContain("1 not started");
    expect(funnel.textContent).toContain("writeback pending");
    expect(within(funnel).getByRole("button", { name: "Continue" })).toBeTruthy();
  });
});
