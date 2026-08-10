import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardView, eventsForInvocation } from "@/features/dashboard/dashboard-view";
import { listAllDashboardWorkItems } from "@/features/dashboard/dashboard-work-items";
import { i18n } from "@/lib/i18n";
import { useUiStore } from "@/store/ui-store";

const mocks = vi.hoisted(() => ({
  useConsoleState: vi.fn(),
  useAsyncAction: vi.fn(),
  createInvocation: vi.fn(),
  uploadWorktreeAttachments: vi.fn(),
  listWorkItems: vi.fn(),
  assignWorkItemToMe: vi.fn(),
  getLocalScheduleCapacity: vi.fn(),
  getLocalSchedulePreview: vi.fn(),
  applyLocalSchedulePlan: vi.fn(),
  getLocalScheduleRollover: vi.fn(),
  applyLocalScheduleRollover: vi.fn(),
  getLocalScheduleUrgent: vi.fn(),
  applyLocalScheduleUrgent: vi.fn(),
  request: vi.fn(),
  autoRunReadiness: vi.fn(),
}));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: mocks.useConsoleState }));
vi.mock("@/data/use-console-actions", () => ({
  useAsyncAction: mocks.useAsyncAction,
  api: {
    createInvocation: mocks.createInvocation,
    uploadWorktreeAttachments: mocks.uploadWorktreeAttachments,
    listWorkItems: mocks.listWorkItems,
    assignWorkItemToMe: mocks.assignWorkItemToMe,
    autoRunReadiness: mocks.autoRunReadiness,
  },
}));
vi.mock("@/features/dashboard/local-schedule-api", () => ({
  localScheduleApi: {
    capacity: mocks.getLocalScheduleCapacity,
    preview: mocks.getLocalSchedulePreview,
    applyPlan: mocks.applyLocalSchedulePlan,
    rolloverPreview: mocks.getLocalScheduleRollover,
    applyRollover: mocks.applyLocalScheduleRollover,
    urgentPreview: mocks.getLocalScheduleUrgent,
    applyUrgent: mocks.applyLocalScheduleUrgent,
  },
}));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  request: mocks.request,
}));
vi.mock("@/features/invocations/run-transcript", () => ({ RunTranscriptSection: () => null }));

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  useUiStore.setState({
    section: "dashboard",
    selectedInvocationId: null,
    selectedProjectId: null,
    selectedWorktreeId: null,
    selectedAgentId: null,
    invocationStatusFilter: "all",
    composerDraftTask: null,
    resumeFromInvocationId: null,
    selectedWorkItemId: null,
    selectedWorkItemMode: "summary",
    workItemDetailPreference: "summary",
    selectedWorkItemSection: "overview",
  });
  mocks.listWorkItems.mockResolvedValue({ workItems: [], count: 0 });
  mocks.autoRunReadiness.mockResolvedValue({ readiness: { ready: true, checks: [] } });
  mocks.getLocalScheduleCapacity.mockResolvedValue({
    terminal: { bridgeAvailable: false },
    capacity: { maxConcurrency: 1, availableSlots: 1, queueDepth: 0, worktreeLocks: 0 },
  });
  mocks.getLocalSchedulePreview.mockResolvedValue({
    planRevision: "0123456789abcdef01234567",
    days: [],
    attention: [],
    unscheduled: [],
  });
  mocks.applyLocalSchedulePlan.mockResolvedValue({ applied: 0 });
  mocks.getLocalScheduleRollover.mockResolvedValue({
    rolloverRevision: "0123456789abcdef01234567",
    moves: [],
    confirmationRequired: [],
    unscheduled: [],
  });
  mocks.applyLocalScheduleRollover.mockResolvedValue({ applied: 0 });
  mocks.getLocalScheduleUrgent.mockResolvedValue({
    urgentRevision: "0123456789abcdef01234567",
    insertions: [],
    displacements: [],
    confirmationRequired: [],
    unscheduled: [],
  });
  mocks.applyLocalScheduleUrgent.mockResolvedValue({ inserted: 0 });
  mocks.request.mockResolvedValue({
    generatedAt: "2026-07-31T04:00:00.000Z",
    horizon: { today: "2026-07-31", tomorrow: "2026-08-01" },
    summary: {
      total: 0, needsAttention: 0, waitingMe: 0, approvals: 0, aiFailed: 0, dueToday: 0, reviewReady: 0,
      byRelation: { boss: 0, manager: 0, customer: 0, child: 0, colleague: 0, self: 0, unknown: 0 },
      byWaitingOn: { me: 0, requester: 0, internal: 0, ai: 0, none: 0 },
    },
    items: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

function setup() {
  mocks.useConsoleState.mockReturnValue({
    data: { projects: [], worktrees: [], events: [], invocations: [], agents: [], device: { status: "offline" } },
  });
  mocks.useAsyncAction.mockReturnValue({ execute: vi.fn(), pending: false, error: null });
}

describe("DashboardView surfaces (#927)", () => {
  it("loads every cursor page instead of treating the first 100 local issues as complete", async () => {
    mocks.listWorkItems
      .mockResolvedValueOnce({ workItems: [{ id: "first" }], count: 2, hasMore: true, nextCursor: "page-2" })
      .mockResolvedValueOnce({ workItems: [{ id: "second" }], count: 2, hasMore: false, nextCursor: null });

    const rows = await listAllDashboardWorkItems();

    expect(rows.map((item) => item.id)).toEqual(["first", "second"]);
    expect(mocks.listWorkItems).toHaveBeenNthCalledWith(1, { limit: "100" });
    expect(mocks.listWorkItems).toHaveBeenNthCalledWith(2, { limit: "100", cursor: "page-2" });
  });

  it("keeps Home usable when the workbench returns an incomplete success payload", async () => {
    setup();
    mocks.request.mockResolvedValueOnce({});

    render(<DashboardView surface="overview" />);

    expect(await screen.findByTestId("home-task-composer-inline")).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toContain("1 Home data source");
  });

  it("uses the server current project instead of a stale local project selection", async () => {
    useUiStore.setState({ selectedProjectId: "project-stale" });
    mocks.useConsoleState.mockReturnValue({
      data: {
        currentProjectId: "project-current",
        projects: [
          { id: "project-current", name: "Current customer" },
          { id: "project-stale", name: "Old customer" },
        ],
        worktrees: [], events: [], invocations: [], agents: [], device: { status: "offline" },
      },
    });
    mocks.useAsyncAction.mockReturnValue({ execute: vi.fn(), pending: false, error: null });

    render(<DashboardView surface="overview" />);

    expect((await screen.findByRole("combobox", { name: "Current project" }) as HTMLSelectElement).value).toBe("project-current");
  });

  it("prioritizes incomplete setup before task entry and removes the temporary run entry", async () => {
    setup();
    render(<DashboardView surface="overview" />);
    expect(screen.getByText(/Prepare this computer/i)).toBeTruthy();
    expect(screen.getByText(/Prepare this computer/i).closest(".order-first")).toBeTruthy();
    expect((await screen.findByTestId("daily-work-board")).className).toContain("min-w-0");
    expect((await screen.findByTestId("my-work-section")).className).toContain("min-w-0");
    const brief = await screen.findByTestId("daily-coordination-brief");
    const createLayout = await screen.findByTestId("daily-brief-create-layout");
    expect(within(createLayout).getByTestId("home-task-composer-inline")).toBeTruthy();
    expect(createLayout.className).toContain("lg:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.9fr)]");
    expect(brief.parentElement?.parentElement).toBe(createLayout);
    expect(screen.queryByText("Advanced: run AI without adding a tracked task")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Task journey" })).toBeNull();
  });

  it("keeps concurrent task events isolated even when both tasks use the same Agent", () => {
    const state = {
      events: [
        { id: "one", invocationId: "run-one", createdAt: "2026-01-01T00:00:00.000Z", data: { agentId: "agent-a" } },
        { id: "two", invocationId: "run-two", createdAt: "2026-01-01T00:00:01.000Z", data: { agentId: "agent-a" } },
      ],
    };

    expect(eventsForInvocation(state as never, { id: "run-one" } as never).map((event) => event.id)).toEqual(["one"]);
  });

  it("omits the onboarding checklist on the workspace surface but keeps the composer", () => {
    setup();
    render(<DashboardView surface="workspace" />);
    // The home/onboarding card is a first-run concern — not duplicated into Workspace.
    expect(screen.queryByText(/Getting started/i)).toBeNull();
    // You can still start a task from Workspace: the composer is retained.
    expect(screen.getByText("Run an Agent on this computer")).toBeTruthy();
  });

  it("carries exact Auto-run, approval, and refusal targets into their native surfaces", async () => {
    const states = {
      pending_decision: { count: 0, items: [] },
      in_progress: { count: 0, items: [] },
      waiting: { count: 0, items: [] },
      done: { count: 0, items: [] },
      failed: { count: 0, items: [] },
      follow_up: {
        count: 3,
        items: [
          {
            id: "autorun:aur_real",
            state: "follow_up",
            kind: "auto_run",
            title: "Real failed task",
            section: "autoRuns",
            targetId: "aur_real",
          },
          {
            id: "refusal:ref_real",
            state: "follow_up",
            kind: "refusal",
            title: "Real refusal",
            section: "evidence",
            targetId: "inv_real",
          },
          {
            id: "home:approval",
            state: "follow_up",
            kind: "home_open_approval",
            title: "Exact approval",
            section: "approvals",
            targetId: "apr_real",
          },
        ],
      },
    };
    mocks.useConsoleState.mockReturnValue({
      data: {
        projects: [],
        worktrees: [],
        events: [],
        invocations: [],
        agents: [],
        device: { status: "offline" },
        workBoard: { generatedAt: Date.now(), states },
      },
    });
    mocks.useAsyncAction.mockReturnValue({ execute: vi.fn(), pending: false, error: null });

    const { unmount } = render(<DashboardView surface="overview" />);
    fireEvent.click(await screen.findByRole("button", { name: /Real failed task/ }));
    expect(new URLSearchParams(window.location.search).get("autoRun")).toBe("aur_real");

    unmount();
    window.history.replaceState({}, "", "/");
    render(<DashboardView surface="overview" />);
    fireEvent.click(await screen.findByRole("button", { name: /Real refusal/ }));
    expect(new URLSearchParams(window.location.search).get("refusal")).toBe("ref_real");

    unmount();
    window.history.replaceState({}, "", "/");
    render(<DashboardView surface="overview" />);
    const otherCompletion = (await screen.findAllByTestId("other-completion-column")).at(-1)!;
    fireEvent.click(within(otherCompletion).getByRole("button", { name: "Show 1 more" }));
    fireEvent.click((await screen.findAllByRole("button", { name: /Exact approval/ }))[0]);
    expect(new URLSearchParams(window.location.search).get("approval")).toBe("apr_real");
  });

  it("opens an ordinary task detail in place without replacing Home with the task list", async () => {
    mocks.useConsoleState.mockReturnValue({
      data: {
        projects: [], worktrees: [], events: [], invocations: [], agents: [], device: { status: "offline" },
        workBoard: {
          generatedAt: Date.now(),
          states: {
            pending_decision: { count: 0, items: [] },
            in_progress: { count: 0, items: [] },
            waiting: { count: 0, items: [] },
            done: { count: 0, items: [] },
            failed: { count: 0, items: [] },
            follow_up: {
              count: 1,
              items: [{
                id: "local:lwi_home",
                state: "follow_up",
                kind: "local_work_item",
                title: "Review the customer task",
                section: "task",
                targetId: "lwi_home",
              }],
            },
          },
        },
      },
    });
    mocks.useAsyncAction.mockReturnValue({ execute: vi.fn(), pending: false, error: null });

    render(<DashboardView surface="overview" />);
    fireEvent.click(await screen.findByRole("button", { name: /Review the customer task/ }));

    expect(useUiStore.getState().section).toBe("dashboard");
    expect(useUiStore.getState().selectedWorkItemId).toBe("lwi_home");
    expect(useUiStore.getState().selectedWorkItemMode).toBe("summary");
  });

  it("keeps the last successful Home slices when a later refresh partially fails", async () => {
    setup();
    const view = render(<DashboardView surface="overview" />);
    expect(await screen.findByText("This terminal is unavailable")).toBeTruthy();
    expect(screen.queryByRole("alert", { name: /Home data/ })).toBeNull();

    mocks.getLocalScheduleCapacity.mockRejectedValueOnce(new Error("capacity unavailable"));
    mocks.useConsoleState.mockReturnValue({
      data: {
        projects: [], worktrees: [], events: [], invocations: [], agents: [], device: { status: "offline" },
        workItemSummary: { total: 0, open: 0, blocked: 0, activeExecutions: 0, updatedAt: null, homeWorkbenchUpdatedAt: "2026-08-01T00:00:00.000Z" },
      },
    });
    view.rerender(<DashboardView surface="overview" />);

    expect((await screen.findByRole("alert")).textContent).toContain("1 Home data source");
    expect(screen.getByText("This terminal is unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(mocks.getLocalScheduleCapacity).toHaveBeenCalledTimes(3));
  });

  it("refreshes both Home board projections when a task detail changes", async () => {
    setup();
    render(<DashboardView surface="overview" />);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));

    fireEvent(window, new Event("myagenttool:state-change"));

    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(mocks.listWorkItems).toHaveBeenCalledTimes(2);
  });

  it("keeps a secondary new-run control while current progress and cancellation take priority", () => {
    mocks.useConsoleState.mockReturnValue({
      data: {
        projects: [{ id: "p1", name: "Example" }],
        worktrees: [],
        events: [],
        invocations: [{ id: "run-1", projectId: "p1", status: "running", createdAt: "2026-07-27T00:00:00Z", input: { task: "Check the project" } }],
        agents: [{ id: "agent-1", name: "Local runner", status: "ready", health: { status: "healthy" } }],
        device: { status: "online" },
        pendingDecisions: [],
        evidenceLedger: [],
      },
    });
    mocks.useAsyncAction.mockReturnValue({ execute: vi.fn(), pending: false, error: null });

    render(<DashboardView surface="overview" />);
    expect(screen.queryByRole("button", { name: "Run on this computer" })).toBeNull();
    expect(screen.getByRole("button", { name: "View progress" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel task" })).toBeTruthy();
    expect(document.querySelectorAll("[data-home-primary-action]")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "View progress" }));
    expect(useUiStore.getState().section).toBe("invocations");
    expect(useUiStore.getState().invocationStatusFilter).toBe("active");
    expect(useUiStore.getState().selectedInvocationId).toBe("run-1");
  });

  it("opens a tracked running task in simple details instead of sending ordinary users to Trace", async () => {
    mocks.useConsoleState.mockReturnValue({
      data: {
        projects: [{ id: "p1", name: "Example" }],
        worktrees: [],
        events: [],
        invocations: [{ id: "run-tracked", projectId: "p1", status: "running", createdAt: "2026-08-05T00:00:00Z", input: { task: "Prepare the customer brief" } }],
        agents: [{ id: "agent-1", name: "Local runner", status: "ready", health: { status: "healthy" } }],
        device: { status: "online" },
        pendingDecisions: [],
        evidenceLedger: [],
      },
    });
    mocks.useAsyncAction.mockReturnValue({ execute: vi.fn(), pending: false, error: null });
    mocks.request.mockResolvedValue({
      generatedAt: "2026-08-05T00:00:00Z",
      horizon: { today: "2026-08-05", tomorrow: "2026-08-06" },
      summary: {
        total: 1, needsAttention: 0, waitingMe: 0, approvals: 0, aiFailed: 0, dueToday: 1, reviewReady: 0,
        byRelation: { boss: 0, manager: 0, customer: 0, child: 0, colleague: 0, self: 1, unknown: 0 },
        byWaitingOn: { me: 0, requester: 0, internal: 0, ai: 1, none: 0 },
      },
      items: [{
        workItemId: "lwi-tracked", localRef: "LOCAL-7", title: "Prepare the customer brief", projectId: "p1", revision: 1,
        priority: "p2", assignees: [], requester: { relation: "self", name: null, organization: null },
        planningStatus: "in_progress", executionState: "running", waitingOn: "ai", attentionReason: "ai_running", secondaryReasons: [],
        needsAttention: false, dueDate: "2026-08-05", plannedDate: "2026-08-05", commitmentDate: null, nextFollowUpAt: null, report: null,
        nextAction: { kind: "open_run", label: "Open run", targetId: "run-tracked", section: "invocations" },
        ai: { autoRunId: "aur-tracked", invocationId: "run-tracked", agentId: "agent-1", agentName: "Local runner", status: "running", updatedAt: "2026-08-05T00:00:00Z" },
      }],
    });

    render(<DashboardView surface="overview" />);
    fireEvent.click(await screen.findByRole("button", { name: "Open task" }));

    expect(useUiStore.getState().section).toBe("dashboard");
    expect(useUiStore.getState().selectedWorkItemId).toBe("lwi-tracked");
    expect(useUiStore.getState().selectedWorkItemMode).toBe("summary");
  });

  it("consumes a reused task draft into the Home composer", async () => {
    setup();
    useUiStore.setState({ composerDraftTask: "Repair the failing checks" });

    render(<DashboardView surface="workspace" />);

    const taskInput = screen.getByRole("textbox", { name: "Task" }) as HTMLTextAreaElement;
    await waitFor(() => expect(taskInput.value).toBe("Repair the failing checks"));
    expect(useUiStore.getState().composerDraftTask).toBeNull();
  });

  it("runs from an explicit worktree with the selected permission and uploaded attachments", async () => {
    mocks.useConsoleState.mockReturnValue({
      data: {
        projects: [{ id: "p1", name: "Example", path: "D:\\repo" }],
        worktrees: [{
          id: "wt1",
          projectId: "p1",
          branch: "feat/demo",
          path: "D:\\repo-wt",
          agentId: "agent-1",
        }],
        events: [],
        invocations: [],
        agents: [{
          id: "agent-1",
          name: "Codex CLI",
          status: "ready",
          health: { status: "healthy" },
          adapter: {
            type: "cli",
            command: "codex",
            permissionMode: "auto",
            models: ["gpt-5.6-sol", "gpt-5.6-terra"],
            defaultModel: "gpt-5.6-terra",
          },
        }],
        device: { id: "device-1", name: "This computer", status: "online" },
        pendingDecisions: [],
        evidenceLedger: [],
      },
    });
    mocks.useAsyncAction.mockReturnValue({
      execute: vi.fn((operation: () => Promise<unknown>) => operation()),
      pending: false,
      error: null,
    });
    mocks.uploadWorktreeAttachments.mockResolvedValue({
      attachments: [{ name: "notes.txt", path: ".myagenttool/attachments/notes.txt" }],
    });
    mocks.createInvocation.mockResolvedValue({ invocation: { id: "inv-new" } });
    useUiStore.setState({
      selectedProjectId: "p1",
      selectedWorktreeId: "wt1",
      selectedAgentId: "agent-1",
    });

    const { container } = render(<DashboardView surface="workspace" />);

    expect(screen.getByText("Run an Agent in this worktree")).toBeTruthy();
    expect(screen.getAllByText("D:\\repo-wt").length).toBeGreaterThan(0);
    const permission = screen.getByRole("combobox", { name: "Permission level" }) as HTMLSelectElement;
    await waitFor(() => expect(permission.value).toBe("auto"));
    fireEvent.change(permission, { target: { value: "full" } });
    const model = screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement;
    expect(model.value).toBe("");
    expect(screen.getByRole("option", { name: "Agent default (gpt-5.6-terra)" })).toBeTruthy();
    expect(Array.from(model.options).map((option) => option.value)).toContain("gpt-5.6-sol");
    fireEvent.change(model, { target: { value: "gpt-5.6-sol" } });

    const fileInput = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"]')).at(-1) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] },
    });
    expect(await screen.findByText("notes.txt")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Review the current change" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run on this computer" }));

    await waitFor(() => expect(mocks.uploadWorktreeAttachments).toHaveBeenCalledWith(
      "wt1",
      [{ name: "notes.txt", dataBase64: "aGVsbG8=" }],
      expect.any(String),
    ));
    const attachmentBatchId = mocks.uploadWorktreeAttachments.mock.calls[0]?.[2];
    expect(mocks.createInvocation).toHaveBeenCalledWith(
      "Review the current change\n\nAttached files (in the worktree):\n- .myagenttool/attachments/notes.txt",
      "agent-1",
      "p1",
      "wt1",
      { permissionLevel: "full", model: "gpt-5.6-sol" },
      attachmentBatchId,
    );
    await waitFor(() => expect(screen.queryByText("notes.txt")).toBeNull());
  });

  it.each([
    { status: "waiting_for_local_approval", expected: null, approval: true },
    { status: "failed", expected: null, approval: false },
    { status: "succeeded", expected: null, approval: false },
  ])("keeps only active or approval state on Home for $status", ({ status, expected, approval }) => {
    mocks.useConsoleState.mockReturnValue({
      data: {
        projects: [{ id: "p1", name: "Example" }],
        worktrees: [],
        events: [],
        invocations: [{
          id: "run-1",
          projectId: "p1",
          status,
          createdAt: "2026-07-27T00:00:00Z",
          input: { task: "Check the project" },
        }],
        agents: [{
          id: "agent-1",
          name: "Local runner",
          status: "ready",
          health: { status: "healthy" },
        }],
        device: { status: "online" },
        pendingDecisions: status === "waiting_for_local_approval"
          ? [{
              id: "decision-1",
              kind: "invocation_approval",
              title: "Approve",
              section: "approvals",
              ref: { invocationId: "run-1" },
            }]
          : [],
        evidenceLedger: [],
      },
    });
    mocks.useAsyncAction.mockReturnValue({ execute: vi.fn(), pending: false, error: null });

    render(<DashboardView surface="overview" />);
    if (approval) {
      expect(screen.getByTestId("ai-approval-card")).toBeTruthy();
    }
    if (expected) {
      expect(screen.getByRole("button", { name: expected })).toBeTruthy();
    }
    expect(document.querySelectorAll("[data-home-primary-action]")).toHaveLength(expected ? 1 : 0);
  });

  it("keeps terminal transcripts in Workspace and out of Home", () => {
    mocks.useConsoleState.mockReturnValue({
      data: {
        projects: [{ id: "p1", name: "Example" }],
        worktrees: [],
        events: [],
        invocations: [{ id: "run-1", projectId: "p1", status: "failed", createdAt: "2026-07-27T00:00:00Z", input: { task: "Check the project" } }],
        agents: [{ id: "agent-1", name: "Local runner", status: "ready", health: { status: "healthy" } }],
        device: { status: "online" },
        pendingDecisions: [],
        evidenceLedger: [],
      },
    });
    mocks.useAsyncAction.mockReturnValue({ execute: vi.fn(), pending: false, error: null });

    const { unmount } = render(<DashboardView surface="overview" />);
    expect(screen.queryByText("Activity")).toBeNull();
    unmount();

    render(<DashboardView surface="workspace" />);
    expect(screen.getByText("Activity")).toBeTruthy();
  });

  it("uses ordinary zh-CN terms while preserving a provider-defined assistant name", async () => {
    await i18n.changeLanguage("zh-CN");
    mocks.useConsoleState.mockReturnValue({
      data: {
        projects: [{ id: "p1", name: "示例项目" }],
        worktrees: [],
        events: [],
        invocations: [],
        agents: [{ id: "agent-1", name: "Codex CLI", status: "enabled", health: { status: "healthy" } }],
        device: { id: "device-1", name: "这台电脑", status: "online" },
        pendingDecisions: [],
        evidenceLedger: [],
      },
    });
    mocks.useAsyncAction.mockReturnValue({ execute: vi.fn(), pending: false, error: null });

    render(<DashboardView surface="workspace" />);
    expect(screen.getByRole("combobox", { name: "任务助手" })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Codex CLI/ })).toBeTruthy();
    expect(screen.getByText("追踪编号（Trace ID）")).toBeTruthy();
    expect(screen.queryByText("Agent")).toBeNull();
  });
});
