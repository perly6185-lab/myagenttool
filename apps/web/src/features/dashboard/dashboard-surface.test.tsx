import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardView, eventsForInvocation } from "@/features/dashboard/dashboard-view";
import { listAllDashboardWorkItems } from "@/features/dashboard/dashboard-work-items";
import { i18n } from "@/lib/i18n";
import { useUiStore } from "@/store/ui-store";

const mocks = vi.hoisted(() => ({
  useConsoleState: vi.fn(),
  useAsyncAction: vi.fn(),
  listWorkItems: vi.fn(),
  assignWorkItemToMe: vi.fn(),
  getLocalScheduleCapacity: vi.fn(),
  getLocalSchedulePreview: vi.fn(),
  applyLocalSchedulePlan: vi.fn(),
  getLocalScheduleRollover: vi.fn(),
  applyLocalScheduleRollover: vi.fn(),
  getLocalScheduleUrgent: vi.fn(),
  applyLocalScheduleUrgent: vi.fn(),
}));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: mocks.useConsoleState }));
vi.mock("@/data/use-console-actions", () => ({
  useAsyncAction: mocks.useAsyncAction,
  api: {
    listWorkItems: mocks.listWorkItems,
    assignWorkItemToMe: mocks.assignWorkItemToMe,
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
vi.mock("@/features/invocations/run-transcript", () => ({ RunTranscriptSection: () => null }));

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  useUiStore.setState({
    section: "dashboard",
    selectedInvocationId: null,
    invocationStatusFilter: "all",
    composerDraftTask: null,
    resumeFromInvocationId: null,
  });
  mocks.listWorkItems.mockResolvedValue({ workItems: [], count: 0 });
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

  it("prioritizes incomplete setup before task entry and removes the redundant journey", async () => {
    setup();
    render(<DashboardView surface="overview" />);
    expect(screen.getByText(/Prepare this computer/i)).toBeTruthy();
    expect(screen.getByText("What should your computer do?").closest(".order-1")).toBeTruthy();
    expect(screen.getByText(/Prepare this computer/i).closest(".order-first")).toBeTruthy();
    expect((await screen.findByTestId("daily-work-board")).closest(".order-3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Trace" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Inspect this project" }));
    const taskInput = screen.getByRole("textbox", { name: "Task" }) as HTMLTextAreaElement;
    expect(taskInput.value).toBe(
      "Inspect this project, explain its structure, and report risks without changing files.",
    );
    expect(screen.queryByRole("navigation", { name: "Task journey" })).toBeNull();
    expect((screen.getByText("What to know before running").closest("details") as HTMLDetailsElement).open).toBe(false);
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
    expect(screen.getByText("What should your computer do?")).toBeTruthy();
  });

  it("carries exact Auto-run and refusal targets into their native surfaces", () => {
    const states = {
      pending_decision: { count: 0, items: [] },
      in_progress: { count: 0, items: [] },
      waiting: { count: 0, items: [] },
      done: { count: 0, items: [] },
      failed: { count: 0, items: [] },
      follow_up: {
        count: 2,
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
    fireEvent.click(screen.getByRole("button", { name: /Real failed task/ }));
    expect(new URLSearchParams(window.location.search).get("autoRun")).toBe("aur_real");

    unmount();
    window.history.replaceState({}, "", "/");
    render(<DashboardView surface="overview" />);
    fireEvent.click(screen.getByRole("button", { name: /Real refusal/ }));
    expect(new URLSearchParams(window.location.search).get("refusal")).toBe("ref_real");
  });

  it("shows one obvious run control and swaps it for cancellation while running", () => {
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

  it("consumes a reused task draft into the Home composer", async () => {
    setup();
    useUiStore.setState({ composerDraftTask: "Repair the failing checks" });

    render(<DashboardView surface="overview" />);

    const taskInput = screen.getByRole("textbox", { name: "Task" }) as HTMLTextAreaElement;
    await waitFor(() => expect(taskInput.value).toBe("Repair the failing checks"));
    expect(useUiStore.getState().composerDraftTask).toBeNull();
  });

  it.each([
    { status: "waiting_for_local_approval", expected: "Handle approval" },
    { status: "failed", expected: "Run on this computer" },
    { status: "succeeded", expected: "Run on this computer" },
  ])("keeps only active or approval state on Home for $status", ({ status, expected }) => {
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
    expect(screen.getByRole("button", { name: expected })).toBeTruthy();
    expect(document.querySelectorAll("[data-home-primary-action]")).toHaveLength(1);
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

    render(<DashboardView surface="overview" />);
    expect(screen.getByText("任务助手")).toBeTruthy();
    expect(screen.getByRole("option", { name: /Codex CLI/ })).toBeTruthy();
    expect(screen.getByText("追踪编号（Trace ID）")).toBeTruthy();
    expect(screen.queryByText("Agent")).toBeNull();
  });
});
