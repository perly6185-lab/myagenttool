import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor, within } from "@testing-library/react";
import {
  buildDailyWorkBoardModel,
  DailyWorkBoard,
} from "@/features/dashboard/daily-work-board";
import type { PendingDecision, WorkBoard, WorkItem, WorkReport, WorkState } from "@/lib/console-state";
import type { LocalWorkItem } from "@/features/tasks/task-view-types";
import type { HomeWorkbench, HomeWorkbenchItem } from "@/features/dashboard/home-workbench-types";
import { i18n } from "@/lib/i18n";

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
});
afterEach(cleanup);

const emptyStates = (): WorkBoard["states"] => ({
  pending_decision: { count: 0, items: [] },
  follow_up: { count: 0, items: [] },
  in_progress: { count: 0, items: [] },
  waiting: { count: 0, items: [] },
  failed: { count: 0, items: [] },
  done: { count: 0, items: [] },
});

function item(id: string, state: WorkState, updatedAt: string): WorkItem {
  return {
    id,
    state,
    kind: "auto_run",
    title: `Task ${id}`,
    section: "invocations",
    targetId: id,
    updatedAt,
  };
}

function report(completed: number, failed: number): WorkReport {
  const period = {
    key: "day" as const,
    label: "Today",
    windowStart: 0,
    startDate: "2026-07-31",
    flow: {
      opened: 0,
      completed,
      failed,
      refusals: 0,
      refusalsByCategory: {},
      refusalsPartial: false,
    },
    markdown: "",
  };
  return {
    generatedAt: 0,
    standing: {
      pending_decision: 0,
      follow_up: 0,
      in_progress: 0,
      waiting: 0,
      failed: 0,
      done: 0,
    },
    attention: { agingDecisions: [], stuckRuns: [] },
    refusalsAvailable: true,
    refusalDataSince: null,
    periods: { day: period, week: { ...period, key: "week" }, month: { ...period, key: "month" }, quarter: { ...period, key: "quarter" } },
  };
}

function localItem(overrides: Partial<LocalWorkItem> = {}): LocalWorkItem {
  return {
    id: "lwi-1",
    localRef: "LOCAL-1",
    projectId: "prj-1",
    title: "Plan the next release",
    body: "",
    type: "task",
    status: "ready",
    priority: "p1",
    state: "open",
    labels: [],
    assigneeIds: ["usr_local"],
    followUpSchemaVersion: 1,
    requesterRelation: "unknown",
    requesterName: null,
    requesterOrganization: null,
    requesterUserId: null,
    intakeChannel: "unknown",
    externalReference: null,
    waitingOn: "none",
    commitmentDate: null,
    nextFollowUpAt: null,
    lastProgressAt: null,
    lastProgressSummary: null,
    acceptanceCriteria: [],
    dueDate: null,
    milestone: "",
    estimatePoints: 0,
    revision: 1,
    archivedAt: null,
    updatedAt: "2026-07-31T02:00:00.000Z",
    ...overrides,
  };
}

function homeItem(overrides: Partial<HomeWorkbenchItem> = {}): HomeWorkbenchItem {
  return {
    workItemId: "lwi-1", localRef: "LOCAL-1", title: "Plan the next release", projectId: "prj-1",
    revision: 1, priority: "p1", assignees: [{ id: "usr_local", name: "Me" }],
    requester: { relation: "customer", name: "Alex", organization: "Acme" },
    planningStatus: "ready", executionState: "unclaimed", waitingOn: "me",
    executionKind: null, executionUpdatedAt: null,
    attentionReason: null, secondaryReasons: [], needsAttention: true,
    dueDate: null, plannedDate: null, commitmentDate: null, nextFollowUpAt: null,
    report: null,
    nextAction: { kind: "open_issue", label: "open_issue", targetId: "lwi-1", section: "task" },
    ai: null,
    ...overrides,
  };
}

function workbench(items: HomeWorkbenchItem[]): HomeWorkbench {
  const relations = ["boss", "manager", "customer", "child", "colleague", "self", "unknown"] as const;
  const waiting = ["me", "requester", "internal", "ai", "none"] as const;
  return {
    generatedAt: "2026-07-31T04:00:00.000Z",
    horizon: { today: "2026-07-31", tomorrow: "2026-08-01" },
    summary: {
      total: items.length,
      needsAttention: items.filter((item) => item.needsAttention).length,
      waitingMe: items.filter((item) => item.waitingOn === "me").length,
      approvals: items.filter((item) => item.attentionReason === "approval_required").length,
      aiFailed: items.filter((item) => item.attentionReason === "ai_failed").length,
      dueToday: items.filter((item) => item.dueDate === "2026-07-31").length,
      reviewReady: items.filter((item) => item.attentionReason === "review_ready").length,
      byRelation: Object.fromEntries(relations.map((relation) => [relation, items.filter((item) => item.requester.relation === relation).length])) as HomeWorkbench["summary"]["byRelation"],
      byWaitingOn: Object.fromEntries(waiting.map((value) => [value, items.filter((item) => item.waitingOn === value).length])) as HomeWorkbench["summary"]["byWaitingOn"],
    },
    items,
  };
}

function activateWorkTab(view: "my" | "ai") {
  fireEvent.click(screen.getByRole("tab", { name: view === "ai" ? /^Automated work/ : /^My tasks/ }));
}

function aiBinding(id: string, status = "queued"): NonNullable<HomeWorkbenchItem["ai"]> {
  return {
    autoRunId: `aur-${id}`,
    invocationId: `inv-${id}`,
    agentId: "agt-codex",
    agentName: "Codex",
    status,
    updatedAt: "2026-07-31T03:00:00.000Z",
  };
}

describe("DailyWorkBoard", () => {
  it("collapses an all-zero daily brief into one clear message", () => {
    render(
      <DailyWorkBoard
        board={{ generatedAt: 0, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={[]}
        workbench={workbench([])}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
      />,
    );
    expect(screen.getByTestId("daily-coordination-brief").getAttribute("data-compact")).toBe("true");
    expect(screen.getByText("Nothing needs your intervention now. Automated work will keep moving the plan forward.")).toBeTruthy();
    expect(screen.queryByTestId("daily-brief-metrics")).toBeNull();
  });

  it("does not turn running or completed automation into work that needs my action", () => {
    render(
      <DailyWorkBoard
        board={{ generatedAt: 0, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={[]}
        workbench={workbench([
          homeItem({ workItemId: "running", localRef: "LOCAL-R", executionState: "running", planningStatus: "in_progress", plannedDate: null, userStatus: "ai_working", ai: aiBinding("running", "running") }),
          homeItem({ workItemId: "completed", localRef: "LOCAL-D", executionState: "completed", planningStatus: "done", plannedDate: null, userStatus: "completed", ai: aiBinding("completed", "done") }),
        ])}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
      />,
    );

    const brief = screen.getByTestId("daily-coordination-brief");
    expect(within(brief).getByText("Today: 0 due, 0 need your action, automated work in progress: 1.")).toBeTruthy();
    expect(within(brief).queryByRole("button", { name: "Review needs my action" })).toBeNull();
  });

  it("keeps ownership in My tasks and uses AI execution only as a handed-off subset", async () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const task = localItem({
      id: "handoff",
      localRef: "LOCAL-H",
      title: "Implement the dashboard change",
      dueDate: "2026-07-31",
      plannedDate: "2026-07-31",
    });
    const beforeHandoff = homeItem({
      workItemId: task.id,
      localRef: task.localRef,
      title: task.title,
      dueDate: task.dueDate,
      plannedDate: task.plannedDate,
      waitingOn: "none",
    });
    const onStartAi = vi.fn().mockResolvedValue(undefined);
    const props = {
      board: { generatedAt: now, states: emptyStates() },
      report: report(0, 0),
      plannedItems: [task],
      onOpenItem: vi.fn(),
      onOpenTasks: vi.fn(),
      onStartAi,
      now,
    };
    const { rerender } = render(
      <DailyWorkBoard {...props} workbench={workbench([beforeHandoff])} />,
    );

    expect(within(screen.getByTestId("my-work-section")).getByText("LOCAL-H · Implement the dashboard change")).toBeTruthy();
    activateWorkTab("ai");
    expect(within(screen.getByTestId("ai-work-section")).queryByText("Implement the dashboard change")).toBeNull();

    activateWorkTab("my");
    fireEvent.click(within(screen.getByTestId("my-work-section")).getByRole("button", { name: "Hand off to AI" }));
    await waitFor(() => expect(onStartAi).toHaveBeenCalledWith(expect.objectContaining({ workItemId: "handoff" })));

    rerender(
      <DailyWorkBoard
        {...props}
        workbench={workbench([{ ...beforeHandoff, executionState: "claimed", ai: aiBinding("handoff") }])}
      />,
    );
    expect(within(screen.getByTestId("my-work-section")).getByText("LOCAL-H · Implement the dashboard change")).toBeTruthy();
    activateWorkTab("ai");
    expect(within(screen.getByTestId("ai-work-section")).getByText("Implement the dashboard change")).toBeTruthy();
  });

  it("includes an Issue-bound article import in automated work without labeling it as AI", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const imported = localItem({
      id: "article-import",
      localRef: "LOCAL-5",
      title: "Import a WeChat article",
      status: "done",
      state: "closed",
      plannedDate: "2026-07-31",
      completedAt: "2026-07-31T03:00:00.000Z",
    });
    const importedHome = homeItem({
      workItemId: imported.id,
      localRef: imported.localRef,
      title: imported.title,
      planningStatus: "done",
      executionState: "completed",
      executionKind: "article_import",
      executionUpdatedAt: imported.completedAt,
      userStatus: "completed",
      plannedDate: imported.plannedDate,
      completedAt: imported.completedAt,
      waitingOn: "none",
      needsAttention: false,
    });

    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={[imported]}
        workbench={workbench([importedHome])}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        now={now}
      />,
    );

    expect(screen.getByRole("tab", { name: /^Automated work 1$/ })).toBeTruthy();
    expect(within(screen.getByTestId("my-work-section")).getByText("Automation：Article import · Completed")).toBeTruthy();
    activateWorkTab("ai");
    const automatedWork = screen.getByTestId("ai-work-section");
    expect(within(automatedWork).getByRole("button", { name: "0 Review and report" })).toBeTruthy();
    expect(within(automatedWork).getByRole("button", { name: "1 Completed" })).toBeTruthy();
    expect(within(automatedWork).getByText("Import a WeChat article")).toBeTruthy();
    expect(within(automatedWork).getByText("Article import")).toBeTruthy();
    expect(automatedWork.textContent).not.toContain("Codex");
  });

  it("opens the simple task detail for a server-derived follow-up action", () => {
    const progressItem = localItem({
      id: "progress", localRef: "LOCAL-P", title: "Follow up with customer", dueDate: "2026-07-31", plannedDate: null,
    });
    const progressHome = homeItem({
      workItemId: progressItem.id,
      localRef: progressItem.localRef,
      title: progressItem.title,
      revision: 4,
      waitingOn: "requester",
      attentionReason: "follow_up_due",
      nextFollowUpAt: "2026-07-31T03:00:00.000Z",
      nextAction: { kind: "record_progress", label: "record_progress", targetId: progressItem.id, section: "task" },
    });
    const onOpenItem = vi.fn();
    render(
      <DailyWorkBoard
        board={{ generatedAt: Date.now(), states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={[progressItem]}
        workbench={workbench([progressHome])}
        onOpenItem={onOpenItem}
        onOpenTasks={vi.fn()}
        now={new Date(2026, 6, 31, 12).getTime()}
      />,
    );

    fireEvent.click(within(screen.getByTestId("my-work-section")).getByRole("button", { name: "Follow up" }));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({
      targetId: "progress",
      section: "task",
    }));
  });

  it("shows the same Issues by person and due date for me, then by execution date and state for AI", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const customer = localItem({ id: "customer", localRef: "LOCAL-C", title: "Confirm customer scope", dueDate: "2026-07-31", plannedDate: "2026-08-01" });
    const child = localItem({ id: "child", localRef: "LOCAL-K", title: "Review child learning plan", dueDate: "2026-07-31", plannedDate: null, requesterRelation: "child" });
    const customerHome = homeItem({
      workItemId: "customer", localRef: "LOCAL-C", title: customer.title,
      dueDate: "2026-07-31", plannedDate: "2026-08-01",
      attentionReason: "review_ready", executionState: "verifying", userStatus: "ready_for_review",
      result: { status: "available", summary: "The customer scope is ready to confirm.", updatedAt: "2026-07-31T03:00:00.000Z", needsReview: true },
      report: { id: "wrd_customer", status: "draft", stale: true, updatedAt: "2026-07-31T03:30:00.000Z" },
      nextAction: { kind: "review_result", label: "review_result", targetId: "customer", section: "task" },
      ai: { autoRunId: "aur_customer", invocationId: "inv_customer", agentId: "agt_1", agentName: "Codex", status: "report_posted", updatedAt: "2026-07-31T03:00:00.000Z" },
    });
    const childHome = homeItem({
      workItemId: "child", localRef: "LOCAL-K", title: child.title,
      dueDate: "2026-07-31", plannedDate: null,
      requester: { relation: "child", name: null, organization: null },
      waitingOn: "none", needsAttention: false,
      nextAction: { kind: "open_issue", label: "open_issue", targetId: "child", section: "task" },
    });
    const onOpenItem = vi.fn();

    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={[customer, child]}
        workbench={workbench([customerHome, childHome])}
        onOpenItem={onOpenItem}
        onOpenTasks={vi.fn()}
        now={now}
      />,
    );

    const myWork = screen.getByTestId("my-work-section");
    const aiWork = screen.getByTestId("ai-work-section");
    expect(within(myWork).getByText("Customer · Alex")).toBeTruthy();
    expect(within(myWork).getByText(/People：Waiting on me/)).toBeTruthy();
    expect(within(myWork).getByText("Automation：Agent · Result ready for human review")).toBeTruthy();
    expect(within(myWork).getByText("Report stale")).toBeTruthy();
    expect(myWork.textContent).not.toContain("Codex");
    expect(aiWork.textContent).toContain("Codex");
    expect(aiWork.textContent).toContain("Result ready for human review");
    expect(aiWork.textContent).not.toContain("report_posted");
    expect(screen.getAllByTestId("result-summary-customer").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/The customer scope is ready to confirm/).length).toBeGreaterThan(0);
    const myToday = within(myWork).getByRole("heading", { name: "Today" }).closest("section");
    activateWorkTab("ai");
    const aiTomorrow = within(aiWork).getByRole("heading", { name: "Tomorrow" }).closest("section");
    expect(myToday?.textContent).toContain("LOCAL-C · Confirm customer scope");
    expect(aiTomorrow?.textContent).toContain("LOCAL-C");
    expect(aiTomorrow?.textContent).toContain("Automated execution date：8/1");
    expect(aiTomorrow?.textContent).toContain("Expected completion：7/31");
    expect(within(myWork).getByText("Automated execution is after expected completion")).toBeTruthy();
    expect(within(aiWork).getByText("Automated execution is after expected completion")).toBeTruthy();

    activateWorkTab("my");
    fireEvent.click(within(myWork).getByRole("button", { name: "1 Child learning" }));
    expect(within(myWork).getAllByText("LOCAL-K · Review child learning plan").length).toBeGreaterThan(0);
    expect(within(myWork).getByText("Automation：Not automated yet")).toBeTruthy();
    expect(within(myWork).queryByText("LOCAL-C · Confirm customer scope")).toBeNull();
    expect(aiWork.textContent).toContain("LOCAL-C");

    activateWorkTab("ai");
    fireEvent.click(within(aiWork).getByRole("button", { name: "1 Review and report" }));
    expect(within(aiWork).getByText(/LOCAL-C/)).toBeTruthy();
    fireEvent.click(within(aiWork).getByRole("button", { name: "Review result" }));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ section: "task", targetId: "customer" }));
    activateWorkTab("my");
    fireEvent.click(within(myWork).getByRole("button", { name: "1 Customer" }));
    fireEvent.click(within(myWork).getByRole("button", { name: "Review report" }));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({
      kind: "home_report_review", section: "task", targetId: "customer",
    }));
  });

  it("keeps server attention order inside a schedule group", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const normal = localItem({ id: "normal", localRef: "LOCAL-N", title: "Normal task", dueDate: "2026-07-31", priority: "p0" });
    const overdue = localItem({ id: "overdue", localRef: "LOCAL-O", title: "Overdue promise", dueDate: "2026-07-31", priority: "p3" });
    const model = buildDailyWorkBoardModel(
      { generatedAt: now, states: emptyStates() },
      report(0, 0),
      now,
      [normal, overdue],
      [
        homeItem({ workItemId: "overdue", localRef: "LOCAL-O", title: overdue.title, attentionReason: "overdue", priority: "p3" }),
        homeItem({ workItemId: "normal", localRef: "LOCAL-N", title: normal.title, priority: "p0" }),
      ],
    );
    expect(model.today.map((row) => row.targetId)).toEqual(["overdue", "normal"]);
  });

  it("keeps a recently closed local task on the completion board", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const completed = localItem({
      id: "closed", localRef: "LOCAL-CLOSED", state: "closed", status: "review",
      dueDate: "2026-08-02", completedAt: "2026-07-31T08:00:00.000Z", updatedAt: "2026-07-31T08:00:00.000Z",
    });
    const model = buildDailyWorkBoardModel(
      { generatedAt: now, states: emptyStates() },
      report(0, 0),
      now,
      [completed],
      [homeItem({ workItemId: completed.id, localRef: completed.localRef, planningStatus: "done", executionState: "completed", waitingOn: "none", completedAt: completed.completedAt })],
    );
    expect(model.today.map((row) => row.targetId)).toEqual(["closed"]);
    expect(model.today[0].state).toBe("done");
    expect((model.today[0] as WorkItem & { planningStatus?: string }).planningStatus).toBe("done");
  });

  it("wraps long stakeholder content and shows human execution labels", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const longTitle = "Confirm an unusually long cross-organization delivery commitment without losing the meaningful end of the title";
    const planned = localItem({ id: "long", localRef: "LOCAL-LONG", title: longTitle, dueDate: "2026-07-31", plannedDate: "2026-07-31" });
    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={[planned]}
        workbench={workbench([homeItem({
          workItemId: "long",
          localRef: "LOCAL-LONG",
          title: longTitle,
          requester: { relation: "customer", name: "A requester with a very long organization-facing display name", organization: "Acme" },
          executionState: "awaiting_approval",
          attentionReason: "approval_required",
          ai: { autoRunId: null, invocationId: "inv-long", agentId: "agt", agentName: "Codex", status: "waiting_for_local_approval", updatedAt: "2026-07-31T03:00:00.000Z" },
          nextAction: { kind: "open_approval", label: "review_approval", targetId: "apr-long", section: "approvals" },
        })])}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        now={now}
      />,
    );
    expect(screen.getAllByText(/LOCAL-LONG/).some((node) => node.className.includes("overflow-wrap"))).toBe(true);
    expect(screen.getByTestId("active-ai-work").textContent).toContain("Awaiting approval");
    expect(screen.getByTestId("active-ai-work").textContent).not.toContain("waiting_for_local_approval");
  });

  it("renders one compact approval card per pending decision at the tab edge", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const approvals: PendingDecision[] = [
      { id: "approval-1", kind: "invocation_approval", title: "Install dependencies", section: "approvals" },
      { id: "approval-2", kind: "invocation_approval", title: "Push the release branch", section: "approvals" },
    ];
    const onOpenApproval = vi.fn();
    const { rerender } = render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        approvals={approvals}
        onOpenApproval={onOpenApproval}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        now={now}
      />,
    );

    expect(screen.getAllByTestId("ai-approval-card")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "AI approvals: Install dependencies" }));
    expect(onOpenApproval).toHaveBeenCalledWith(approvals[0]);

    rerender(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        approvals={[]}
        onOpenApproval={onOpenApproval}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        now={now}
      />,
    );
    expect(screen.queryByTestId("ai-approval-cards")).toBeNull();
  });

  it("separates yesterday outcomes from today's current focus without duplicating follow-up items", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const yesterday = new Date(2026, 6, 30, 12).toISOString();
    const states = emptyStates();
    const active = item("active", "in_progress", new Date(now).toISOString());
    states.in_progress = { count: 1, items: [active] };
    states.follow_up = { count: 1, items: [active] };
    states.done = { count: 1, items: [item("done", "done", yesterday)] };
    states.failed = { count: 1, items: [item("failed", "failed", yesterday)] };
    const board = { generatedAt: now, states };

    const model = buildDailyWorkBoardModel(board, report(3, 1), now);

    expect(model.yesterday.map((row) => row.id)).toEqual(["failed", "done"]);
    expect(model.today.map((row) => row.id)).toEqual(["active"]);
    expect(model.todayCompleted).toBe(3);
    expect(model.todayFailed).toBe(1);
  });

  it("renders the three-day hierarchy and opens real work items", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const states = emptyStates();
    const active = item("active", "in_progress", new Date(now).toISOString());
    states.in_progress = { count: 1, items: [active] };
    const onOpenItem = vi.fn();
    const onOpenTasks = vi.fn();

    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states }}
        report={report(2, 0)}
        onOpenItem={onOpenItem}
        onOpenTasks={onOpenTasks}
        now={now}
      />,
    );

    expect(screen.getAllByText("Yesterday")).toHaveLength(2);
    expect(screen.getAllByText("Today")).toHaveLength(2);
    expect(screen.getAllByText("Tomorrow")).toHaveLength(2);
    expect(screen.getByText("Task active")).toBeTruthy();
    expect(screen.getByText("No tasks are due tomorrow")).toBeTruthy();

    fireEvent.click(screen.getByText("Task active"));
    expect(onOpenItem).toHaveBeenCalledWith(active);
    fireEvent.click(screen.getByRole("button", { name: "View my tasks" }));
    expect(onOpenTasks).toHaveBeenCalled();
    expect(screen.getByTestId("my-work-status-cards")).toBeTruthy();
    expect(screen.getByTestId("ai-work-status-cards")).toBeTruthy();
    expect(screen.getByTestId("ai-execution-timeline")).toBeTruthy();
    expect(screen.getByTestId("ai-date-columns")).toBeTruthy();
    expect(screen.getAllByText("No automated work yet")).toHaveLength(4);
  });

  it("expands hidden work so every issue status remains inspectable", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const states = emptyStates();
    states.waiting = {
      count: 4,
      items: ["one", "two", "three", "four"].map((id) =>
        ({ ...item(id, "waiting", new Date(now).toISOString()), plannedDate: "2026-07-31" })),
    };

    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states }}
        report={report(0, 0)}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        now={now}
      />,
    );

    expect(screen.queryByText("Task three")).toBeNull();
    const expand = screen.getByRole("button", { name: "Show 2 more" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expand);

    expect(screen.getByText("Task three")).toBeTruthy();
    expect(screen.getByText("Task four")).toBeTruthy();
    const collapse = screen.getByRole("button", { name: "Show fewer" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(collapse);
    expect(screen.queryByText("Task three")).toBeNull();
  });

  it("uses expected completion dates for my tasks and deep-links to the local task", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const states = emptyStates();
    const today = localItem({ id: "today", localRef: "LOCAL-41", dueDate: "2026-07-31", plannedDate: null });
    const tomorrow = localItem({ id: "tomorrow", localRef: "LOCAL-23", dueDate: "2026-08-01", plannedDate: null });
    const onOpenItem = vi.fn();

    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states }}
        report={report(0, 0)}
        plannedItems={[today, tomorrow]}
        onOpenItem={onOpenItem}
        onOpenTasks={vi.fn()}
        now={now}
      />,
    );

    expect(screen.getByText("LOCAL-41 · Plan the next release")).toBeTruthy();
    expect(screen.getByText("LOCAL-23 · Plan the next release")).toBeTruthy();
    fireEvent.click(screen.getByText("LOCAL-23 · Plan the next release"));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({
      section: "task",
      targetId: "tomorrow",
    }));
  });

  it("groups each day by task status instead of mixing a flat list", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const states = emptyStates();
    states.pending_decision = {
      count: 1,
      items: [{ ...item("decision", "pending_decision", new Date(now).toISOString()), plannedDate: "2026-07-31" }],
    };
    states.in_progress = {
      count: 1,
      items: [item("running", "in_progress", new Date(now).toISOString())],
    };
    states.waiting = {
      count: 1,
      items: [{ ...item("waiting", "waiting", new Date(now).toISOString()), plannedDate: "2026-07-31" }],
    };

    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states }}
        report={report(0, 0)}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        now={now}
      />,
    );

    expect(screen.getByTestId("daily-state-group-pending_decision").textContent).toContain("Decision");
    expect(screen.getByTestId("daily-state-group-in_progress").textContent).toContain("In progress");
    expect(screen.getByTestId("daily-state-group-waiting").textContent).toContain("Waiting");
  });

  it("keeps unplanned runtime issues out of Today and explains why they are unscheduled", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const states = emptyStates();
    states.follow_up = {
      count: 1,
      items: [{
        ...item("failed", "follow_up", new Date(now).toISOString()),
        scheduleKey: "autorun:failed",
      }],
    };

    const model = buildDailyWorkBoardModel({ generatedAt: now, states }, report(0, 0), now);
    expect(model.today).toEqual([]);
    expect(model.unscheduled.map((row) => row.id)).toEqual(["failed"]);

    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states }}
        report={report(0, 0)}
        preview={{
          generatedAt: "2026-07-31T04:00:00.000Z",
          planRevision: "0123456789abcdef01234567",
          terminalId: "dev-local",
          horizon: { yesterday: "2026-07-30", today: "2026-07-31", tomorrow: "2026-08-01" },
          assumptions: { workdayMinutes: 480, utilization: 0.75, urgentReserve: 0.2, grossMinutes: 360, allocatableMinutes: 288 },
          days: [
            { date: "2026-07-31", capacityMinutes: 288, plannedMinutes: 0, availableMinutes: 288, items: [] },
            { date: "2026-08-01", capacityMinutes: 288, plannedMinutes: 0, availableMinutes: 288, items: [] },
          ],
          attention: [{ workItemId: "autorun:failed", reason: "auto_run_failed" }],
          unscheduled: [],
        }}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        now={now}
      />,
    );

    expect(screen.getByTestId("other-completion-column").textContent).toContain("Run failed; triage or retry first");
  });

  it("surfaces unscheduled AI work and completed work awaiting human review in both views", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const unscheduled = localItem({ id: "ai-unscheduled", localRef: "LOCAL-AU", title: "Schedule linked AI", dueDate: "2026-07-31", plannedDate: null });
    const review = localItem({ id: "ai-review", localRef: "LOCAL-AR", title: "Review completed AI", dueDate: "2026-07-31", plannedDate: "2026-07-31" });
    const ai = (id: string): NonNullable<HomeWorkbenchItem["ai"]> => ({
      autoRunId: `aur-${id}`,
      invocationId: `inv-${id}`,
      agentId: "agt-codex",
      agentName: "Codex",
      status: "ready",
      updatedAt: "2026-07-31T03:00:00.000Z",
    });

    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={[unscheduled, review]}
        workbench={workbench([
          homeItem({
            workItemId: unscheduled.id,
            localRef: unscheduled.localRef,
            title: unscheduled.title,
            dueDate: unscheduled.dueDate,
            plannedDate: null,
            executionState: "claimed",
            ai: ai(unscheduled.id),
          }),
          homeItem({
            workItemId: review.id,
            localRef: review.localRef,
            title: review.title,
            dueDate: review.dueDate,
            plannedDate: review.plannedDate,
            executionState: "completed",
            ai: ai(review.id),
          }),
        ])}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        now={now}
      />,
    );

    const myWork = screen.getByTestId("my-work-section");
    expect(within(myWork).getAllByText("Automation：Agent · Claimed").length).toBeGreaterThan(0);
    expect(within(myWork).getAllByText("Automation：Agent · Ready for review").length).toBeGreaterThan(0);
    const aiWork = screen.getByTestId("ai-work-section");
    expect(within(myWork).getByText("Automated execution has no execution date")).toBeTruthy();
    expect(within(aiWork).getByText("Automated execution has no execution date")).toBeTruthy();
    expect(within(myWork).getByText("Automated execution completed; awaiting human review")).toBeTruthy();
    expect(within(aiWork).getByText("Automated execution completed; awaiting human review")).toBeTruthy();
  });

  it("deduplicates urgent work into one action queue step per Issue and edits its execution date in place", async () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const late = localItem({ id: "late", localRef: "LOCAL-LATE", title: "Move the AI execution", dueDate: "2026-07-31", plannedDate: "2026-08-01" });
    const approval = localItem({ id: "approval", localRef: "LOCAL-APP", title: "Approve the release", dueDate: "2026-07-31", plannedDate: "2026-07-31" });
    const onOpenItem = vi.fn();
    const onUpdatePlannedDate = vi.fn().mockResolvedValue(undefined);

    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={[late, approval]}
        workbench={workbench([
          homeItem({ workItemId: late.id, localRef: late.localRef, title: late.title, dueDate: late.dueDate, plannedDate: late.plannedDate, ai: aiBinding(late.id) }),
          homeItem({
            workItemId: approval.id,
            localRef: approval.localRef,
            title: approval.title,
            dueDate: approval.dueDate,
            plannedDate: approval.plannedDate,
            attentionReason: "approval_required",
            executionState: "awaiting_approval",
            ai: aiBinding(approval.id, "waiting_for_local_approval"),
            nextAction: { kind: "open_approval", label: "open_approval", targetId: "apr-release", section: "approvals" },
          }),
        ])}
        onOpenItem={onOpenItem}
        onOpenTasks={vi.fn()}
        onUpdatePlannedDate={onUpdatePlannedDate}
        now={now}
      />,
    );

    expect(screen.queryByTestId("unified-action-queue")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review needs my action" }));
    const queue = screen.getByTestId("unified-action-queue");
    expect(within(queue).getAllByTestId(/^action-queue-/)).toHaveLength(2);
    const approvalRow = within(queue).getByTestId("action-queue-approval");
    const lateRow = within(queue).getByTestId("action-queue-late");
    expect(approvalRow.compareDocumentPosition(lateRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(queue).getByText("Automated execution is after expected completion")).toBeTruthy();

    fireEvent.click(within(queue).getByRole("button", { name: "Adjust execution date" }));
    const scheduleDialog = screen.getByRole("dialog", { name: "Schedule AI execution" });
    const dateInput = within(scheduleDialog).getByLabelText("Automated execution date") as HTMLInputElement;
    expect(dateInput.value).toBe("2026-08-01");
    fireEvent.change(dateInput, { target: { value: "2026-07-31" } });
    fireEvent.click(within(scheduleDialog).getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(onUpdatePlannedDate).toHaveBeenCalledWith(expect.objectContaining({ workItemId: "late" }), "2026-07-31"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Schedule AI execution" })).toBeNull());
    fireEvent.click(within(queue).getByRole("button", { name: "Approve" }));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ section: "task", targetId: "approval" }));
  });

  it("keeps the execution-date editor open when saving fails", async () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const late = localItem({ id: "late-error", localRef: "LOCAL-LATE", title: "Move the AI execution", dueDate: "2026-07-31", plannedDate: "2026-08-01" });
    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={[late]}
        workbench={workbench([homeItem({ workItemId: late.id, localRef: late.localRef, title: late.title, dueDate: late.dueDate, plannedDate: late.plannedDate, ai: aiBinding(late.id) })])}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        onUpdatePlannedDate={vi.fn().mockRejectedValue(new Error("revision conflict"))}
        now={now}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review needs my action" }));
    fireEvent.click(screen.getByRole("button", { name: "Adjust execution date" }));
    const scheduleDialog = screen.getByRole("dialog", { name: "Schedule AI execution" });
    fireEvent.click(within(scheduleDialog).getByRole("button", { name: "Save date" }));
    expect((await within(scheduleDialog).findByRole("alert")).textContent).toBe("Could not save the execution date. Try again.");
    expect(screen.getByRole("dialog", { name: "Schedule AI execution" })).toBeTruthy();
  });

  it("turns live work into a coordination brief and a bounded focus session", async () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const late = localItem({ id: "brief-late", localRef: "LOCAL-LATE", title: "Realign the AI date", dueDate: "2026-07-31", plannedDate: "2026-08-01" });
    const approval = localItem({ id: "brief-approval", localRef: "LOCAL-APP", title: "Approve the release", dueDate: "2026-07-31", plannedDate: "2026-07-31" });
    const rows = [
      homeItem({ workItemId: late.id, localRef: late.localRef, title: late.title, dueDate: late.dueDate, plannedDate: late.plannedDate, ai: aiBinding(late.id) }),
      homeItem({
        workItemId: approval.id,
        localRef: approval.localRef,
        title: approval.title,
        dueDate: approval.dueDate,
        plannedDate: approval.plannedDate,
        attentionReason: "approval_required",
        executionState: "awaiting_approval",
        ai: aiBinding(approval.id, "waiting_for_local_approval"),
        nextAction: { kind: "open_approval", label: "open_approval", targetId: "apr-brief", section: "approvals" },
      }),
    ];
    const onStartFocusSession = vi.fn();
    const onEndFocusSession = vi.fn();
    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={[late, approval]}
        workbench={workbench(rows)}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        onStartFocusSession={onStartFocusSession}
        onEndFocusSession={onEndFocusSession}
        now={now}
      />,
    );

    const brief = screen.getByTestId("daily-coordination-brief");
    expect(within(brief).getByText("Today: 2 due, 2 need your action, automated work in progress: 0.")).toBeTruthy();
    expect(within(brief).getByText("Date conflicts between your expectation and automated execution: 1.")).toBeTruthy();
    expect(within(brief).getByText("LOCAL-APP · Approve the release")).toBeTruthy();

    fireEvent.click(within(brief).getByRole("button", { name: "Start first action" }));
    expect(onStartFocusSession).toHaveBeenCalledTimes(1);
    let focus = screen.getByRole("dialog", { name: "Focus session" });
    expect(within(focus).getByText("Item 1 of 2")).toBeTruthy();
    expect(within(focus).getByText("Approve the release")).toBeTruthy();
    fireEvent.click(within(focus).getByRole("button", { name: "Next" }));
    focus = screen.getByRole("dialog", { name: "Focus session" });
    expect(within(focus).getByText("Item 2 of 2")).toBeTruthy();
    expect(within(focus).getByText("Realign the AI date")).toBeTruthy();
    fireEvent.click(within(focus).getByRole("button", { name: "End focus" }));
    expect(onEndFocusSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Focus session" })).toBeNull();
  });

  it("resumes an unresolved launched Issue instead of skipping it", async () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const first = homeItem({ workItemId: "focus-first", localRef: "LOCAL-1", title: "First decision", dueDate: "2026-07-31", plannedDate: "2026-07-31", attentionReason: "approval_required" });
    const second = homeItem({ workItemId: "focus-second", localRef: "LOCAL-2", title: "Second decision", dueDate: "2026-07-31", plannedDate: "2026-07-31", attentionReason: "overdue" });
    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={[]}
        workbench={workbench([first, second])}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        focusSessionActive
        focusPendingWorkItemId="focus-first"
        now={now}
      />,
    );

    const focus = await screen.findByRole("dialog", { name: "Focus session" });
    expect(within(focus).getByText("First decision")).toBeTruthy();
  });

  it("continues with the next Issue only after the previous action resolves", async () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const first = homeItem({ workItemId: "focus-first", localRef: "LOCAL-1", title: "First decision", dueDate: "2026-07-31", plannedDate: "2026-07-31", attentionReason: "approval_required" });
    const second = homeItem({ workItemId: "focus-second", localRef: "LOCAL-2", title: "Second decision", dueDate: "2026-07-31", plannedDate: "2026-07-31", attentionReason: "overdue" });
    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={[]}
        workbench={workbench([first, second])}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        focusSessionActive
        focusResolvedWorkItemId="focus-first"
        now={now}
      />,
    );

    const focus = await screen.findByRole("dialog", { name: "Focus session" });
    expect(within(focus).getByText("Second decision")).toBeTruthy();
  });

  it("returns to the same focus Issue when execution-date editing is cancelled", async () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const late = homeItem({ workItemId: "focus-late", localRef: "LOCAL-LATE", title: "Realign execution", dueDate: "2026-07-31", plannedDate: "2026-08-01", ai: aiBinding("focus-late") });
    const onFocusActionResolved = vi.fn();
    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={[]}
        workbench={workbench([late])}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        onUpdatePlannedDate={vi.fn()}
        focusSessionActive
        focusPendingWorkItemId="focus-late"
        onFocusActionResolved={onFocusActionResolved}
        now={now}
      />,
    );

    let focus = await screen.findByRole("dialog", { name: "Focus session" });
    fireEvent.click(within(focus).getByRole("button", { name: "Adjust execution date" }));
    const schedule = screen.getByRole("dialog", { name: "Schedule AI execution" });
    fireEvent.click(within(schedule).getByRole("button", { name: "Cancel" }));
    focus = await screen.findByRole("dialog", { name: "Focus session" });
    expect(within(focus).getByText("Realign execution")).toBeTruthy();
    expect(onFocusActionResolved).not.toHaveBeenCalled();
  });

  it("locates, reveals, and highlights the same Issue across both boards", async () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const rows = [
      localItem({ id: "first", localRef: "LOCAL-1", title: "First personal task", dueDate: "2026-07-31", plannedDate: "2026-07-31", requesterRelation: "child" }),
      localItem({ id: "second", localRef: "LOCAL-2", title: "Second personal task", dueDate: "2026-07-31", plannedDate: "2026-07-31" }),
      localItem({ id: "target", localRef: "LOCAL-T", title: "Cross-board target", dueDate: "2026-07-31", plannedDate: "2026-08-01" }),
    ];
    const homes = rows.map((row) => homeItem({
      workItemId: row.id,
      localRef: row.localRef,
      title: row.title,
      dueDate: row.dueDate,
      plannedDate: row.plannedDate,
      requester: { relation: row.requesterRelation, name: null, organization: null },
      ai: aiBinding(row.id),
    }));

    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={rows}
        workbench={workbench(homes)}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        now={now}
      />,
    );

    const myWork = screen.getByTestId("my-work-section");
    const aiWork = screen.getByTestId("ai-work-section");
    fireEvent.click(within(myWork).getByRole("button", { name: "1 Child learning" }));
    expect(within(myWork).queryByText("LOCAL-T · Cross-board target")).toBeNull();

    activateWorkTab("ai");
    const aiTarget = within(aiWork).getByText("Cross-board target").closest<HTMLElement>('[data-work-view="ai"]')!;
    fireEvent.click(within(aiTarget).getByRole("button", { name: "Locate in My tasks" }));
    await waitFor(() => {
      const myTarget = document.querySelector<HTMLElement>('[data-work-view="my"][data-work-item-id="target"]');
      expect(myTarget).toBeTruthy();
      expect(myTarget?.className).toContain("ring-primary/35");
      expect(document.activeElement).toBe(myTarget);
    });
    expect(within(myWork).getByRole("button", { name: "1 Child learning" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(myWork).getByText("Temporarily showing this Issue without changing your filter")).toBeTruthy();

    activateWorkTab("my");
    fireEvent.click(within(myWork).getByRole("button", { name: "Back to automated work" }));
    await waitFor(() => expect(within(myWork).queryByText("LOCAL-T · Cross-board target")).toBeNull());
    activateWorkTab("my");
    expect(within(myWork).getByRole("button", { name: "1 Child learning" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(within(myWork).getByRole("button", { name: "3 All people" }));
    fireEvent.click(within(screen.getByTestId("today-completion-column")).getByRole("button", { name: "Show 1 more" }));
    const myTarget = (await within(myWork).findByText("LOCAL-T · Cross-board target"))
      .closest<HTMLElement>('[data-work-view="my"]')!;
    activateWorkTab("ai");
    fireEvent.click(within(aiWork).getByRole("button", { name: /Running/ }));
    expect(within(aiWork).queryByText("Cross-board target")).toBeNull();
    activateWorkTab("my");
    fireEvent.click(within(myTarget).getByRole("button", { name: "Locate in automated work" }));
    await waitFor(() => {
      const focusedAiTarget = document.querySelector<HTMLElement>('[data-work-view="ai"][data-work-item-id="target"]');
      expect(focusedAiTarget?.className).toContain("ring-primary/35");
      expect(document.activeElement).toBe(focusedAiTarget);
    });
    expect(within(aiWork).getByRole("button", { name: /Running/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(aiWork).getByRole("button", { name: "Back to My tasks" }));
    await waitFor(() => expect(within(aiWork).queryByText("Cross-board target")).toBeNull());
  });

  it("keeps dated and undated cards expandable in the fourth columns after Tomorrow", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const plannedItems = [
      localItem({ id: "future-1", localRef: "LOCAL-F1", title: "First future follow-up", dueDate: "2026-08-03", plannedDate: "2026-08-04" }),
      localItem({ id: "future-2", localRef: "LOCAL-F2", title: "Second future follow-up", dueDate: "2026-08-04", plannedDate: "2026-08-05" }),
      localItem({ id: "undated", localRef: "LOCAL-U", title: "Unscheduled follow-up", dueDate: null, plannedDate: null }),
    ];
    const workbenchItems = plannedItems.map((plannedItem) => homeItem({
      workItemId: plannedItem.id,
      localRef: plannedItem.localRef,
      title: plannedItem.title,
      requester: { relation: "child", name: null, organization: null },
      dueDate: plannedItem.dueDate,
      plannedDate: plannedItem.plannedDate,
      ai: {
        autoRunId: null,
        invocationId: `inv-${plannedItem.id}`,
        agentId: "agt-codex",
        agentName: "Codex",
        status: "waiting_for_local_approval",
        updatedAt: "2026-07-31T03:00:00.000Z",
      },
    }));
    const onOpenItem = vi.fn();

    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={plannedItems}
        workbench={workbench(workbenchItems)}
        onOpenItem={onOpenItem}
        onOpenTasks={vi.fn()}
        now={now}
      />,
    );

    const myWork = screen.getByTestId("my-work-section");
    const aiWork = screen.getByTestId("ai-work-section");
    const myColumns = [
      screen.getByTestId("yesterday-completion-column"),
      screen.getByTestId("today-completion-column"),
      screen.getByTestId("tomorrow-completion-column"),
      screen.getByTestId("other-completion-column"),
    ];
    const aiColumns = [
      screen.getByTestId("yesterday-execution-column"),
      screen.getByTestId("today-execution-column"),
      screen.getByTestId("tomorrow-execution-column"),
      screen.getByTestId("other-execution-column"),
    ];
    for (const columns of [myColumns, aiColumns]) {
      for (let index = 1; index < columns.length; index += 1) {
        expect(columns[index - 1].compareDocumentPosition(columns[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    }
    expect(within(myWork).getByText("Expected completion · Yesterday / Today / Tomorrow / Other completion dates")).toBeTruthy();
    expect(screen.getAllByText("Swipe horizontally to view all 4 columns")).toHaveLength(2);

    const myTomorrow = within(myWork).getByRole("heading", { name: "Tomorrow" }).closest("section")!;
    const myOther = screen.getByTestId("other-completion-column");
    expect(myTomorrow.compareDocumentPosition(myOther) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(myOther.textContent).toContain("Expected completion：8/3");
    expect(myOther.textContent).not.toContain("LOCAL-U · Unscheduled follow-up");
    fireEvent.click(within(myOther).getByRole("button", { name: "Show 1 more" }));
    expect(myOther.textContent).toContain("LOCAL-U · Unscheduled follow-up");
    expect(myOther.textContent).toContain("Expected completion：Expected completion not set");
    fireEvent.click(within(myOther).getByRole("button", { name: /LOCAL-U · Unscheduled follow-up/ }));

    activateWorkTab("ai");
    const aiTomorrow = within(aiWork).getByRole("heading", { name: "Tomorrow" }).closest("section")!;
    const aiOther = screen.getByTestId("other-execution-column");
    expect(within(aiOther).getByRole("heading", { name: "Other execution dates / unscheduled" })).toBeTruthy();
    expect(aiTomorrow.compareDocumentPosition(aiOther) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(aiOther.textContent).toContain("Automated execution date：8/4");
    expect(aiOther.textContent).not.toContain("LOCAL-U");
    fireEvent.click(within(aiOther).getByRole("button", { name: "Show 1 more" }));
    expect(aiOther.textContent).toContain("LOCAL-U");
    expect(aiOther.textContent).toContain("Automated execution date：No execution date");
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ targetId: "undated", section: "task" }));
  });

  it("keeps a completed AI task visible in a collapsed Today execution column", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const plannedItems = ["a", "b", "completed"].map((id) => localItem({
      id, localRef: `LOCAL-${id.toUpperCase()}`, title: `Task ${id}`, dueDate: "2026-07-31", plannedDate: "2026-07-31",
      ...(id === "completed" ? { state: "closed" as const, status: "review" as const, updatedAt: "2026-07-31T08:00:00.000Z" } : {}),
    }));
    const workbenchItems = plannedItems.map((plannedItem) => homeItem({
      workItemId: plannedItem.id,
      localRef: plannedItem.localRef,
      title: plannedItem.title,
      plannedDate: "2026-07-31",
      executionState: plannedItem.id === "completed" ? "completed" : "unclaimed",
      planningStatus: plannedItem.id === "completed" ? "done" : "ready",
      waitingOn: "none",
      completedAt: plannedItem.id === "completed" ? plannedItem.updatedAt : null,
      ai: aiBinding(plannedItem.id, plannedItem.id === "completed" ? "done" : "queued"),
    }));
    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={plannedItems}
        workbench={workbench(workbenchItems)}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        now={now}
      />,
    );
    activateWorkTab("ai");
    expect(within(screen.getByTestId("today-execution-column")).getByText("LOCAL-COMPLETED")).toBeTruthy();
  });

  it("keeps the newest failed AI task visible and reveals every failure when filtered", () => {
    const now = new Date(2026, 7, 7, 12).getTime();
    const ids = ["old-1", "old-2", "old-3", "local-60"];
    const plannedItems = ids.map((id, index) => localItem({
      id,
      localRef: id === "local-60" ? "LOCAL-60" : `LOCAL-${index + 1}`,
      title: id === "local-60" ? "Propagate the current-terminal timezone" : `Older failed task ${index + 1}`,
      status: "blocked",
      dueDate: null,
      plannedDate: null,
    }));
    const workbenchItems = plannedItems.map((plannedItem, index) => homeItem({
      workItemId: plannedItem.id,
      localRef: plannedItem.localRef,
      title: plannedItem.title,
      planningStatus: "blocked",
      executionState: "failed",
      waitingOn: "none",
      attentionReason: "ai_failed",
      needsAttention: true,
      nextAction: { kind: "retry", label: "retry", targetId: `aur-${plannedItem.id}`, section: "autoRuns" },
      ai: {
        autoRunId: `aur-${plannedItem.id}`,
        invocationId: `inv-${plannedItem.id}`,
        agentId: "agt_codex_cli",
        agentName: "Codex CLI",
        status: "blocked",
        updatedAt: index === ids.length - 1 ? "2026-08-07T04:00:00.000Z" : `2026-08-0${index + 1}T04:00:00.000Z`,
      },
    }));

    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={plannedItems}
        workbench={workbench(workbenchItems)}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        now={now}
      />,
    );

    expect(within(screen.getByTestId("other-completion-column")).getByText(/LOCAL-60 ·/)).toBeTruthy();

    activateWorkTab("ai");
    const aiOther = screen.getByTestId("other-execution-column");
    expect(within(aiOther).getByText("LOCAL-60")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Automation failed$/ }));
    for (const plannedItem of plannedItems) {
      expect(within(aiOther).getByText(plannedItem.localRef)).toBeTruthy();
    }
  });

  it("shows every unassigned local issue outside personal capacity and lets the user claim one", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const unassigned = Array.from({ length: 8 }, (_, index) => localItem({
      id: `unassigned-${index + 1}`,
      localRef: `LOCAL-${index + 1}`,
      title: `Available issue ${index + 1}`,
      assigneeIds: [],
      status: index === 0 ? "blocked" : "backlog",
    }));
    const onClaimItem = vi.fn();
    const onOpenItem = vi.fn();

    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        unassignedItems={unassigned}
        onOpenItem={onOpenItem}
        onOpenTasks={vi.fn()}
        onClaimItem={onClaimItem}
        now={now}
      />,
    );

    expect(screen.getByTestId("unassigned-work").textContent).toContain("Unassigned8");
    expect(screen.queryByText("LOCAL-8 · Available issue 8")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.getByText("LOCAL-8 · Available issue 8")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Claim" })[0]);
    expect(onClaimItem).toHaveBeenCalledWith(unassigned[0]);
    fireEvent.click(screen.getByRole("button", { name: /LOCAL-1 · Available issue 1/ }));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ targetId: "unassigned-1", section: "task" }));
  });

  it("shows the current terminal capacity without implying another terminal can take the work", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        capacity={{
          generatedAt: "2026-07-31T04:00:00.000Z",
          terminal: { id: "dev-local", name: "This terminal", status: "online", unlinkState: "linked", bridgeAvailable: true },
          capacity: { maxConcurrency: 3, inFlight: 1, utilization: 0.33, atCapacity: false, availableSlots: 2, queueDepth: 4, worktreeLocks: 1 },
          work: { total: 0, executable: 0, attention: 0, backlog: 0, items: [] },
          assumptions: { pointMinutes: 60, defaultMinutes: 60, estimateRangeMinutes: { min: 15, max: 480 } },
        }}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        now={now}
      />,
    );

    activateWorkTab("ai");
    expect(screen.getByText("Available slots 2 / 3")).toBeTruthy();
    const capacityButton = screen.getByRole("button", { name: "Available slots 2 / 3" });
    expect(capacityButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("local-capacity-summary")).toBeNull();
    fireEvent.click(capacityButton);
    expect(capacityButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("local-capacity-summary").textContent).toContain("Queue 4");
    expect(screen.getByTestId("local-capacity-summary").textContent).toContain("Workspace locks 1");
    expect(screen.getByRole("status").textContent).toContain("Queue 4");
  });

  it("renders preview dates without mutating source items and applies only after confirmation", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const source = localItem({ id: "suggested", plannedDate: null });
    const onApplyPlan = vi.fn();
    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={[source]}
        preview={{
          generatedAt: "2026-07-31T04:00:00.000Z",
          planRevision: "0123456789abcdef01234567",
          terminalId: "dev-local",
          horizon: { yesterday: "2026-07-30", today: "2026-07-31", tomorrow: "2026-08-01" },
          assumptions: { workdayMinutes: 480, utilization: 0.75, urgentReserve: 0.2, grossMinutes: 360, allocatableMinutes: 288 },
          days: [
            { date: "2026-07-31", capacityMinutes: 288, plannedMinutes: 0, availableMinutes: 288, items: [] },
            { date: "2026-08-01", capacityMinutes: 288, plannedMinutes: 60, availableMinutes: 228, items: [{
              workItemId: "suggested", sourceKind: "work_item", sourceId: "suggested", localRef: "LOCAL-1", title: source.title, priority: "p1", status: "ready",
              estimatedMinutes: 60, estimateConfidence: "low", previousPlannedDate: null, pinned: false, expectedRevision: 1,
            }] },
          ],
          attention: [],
          unscheduled: [],
        }}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        onApplyPlan={onApplyPlan}
        now={now}
      />,
    );

    activateWorkTab("ai");
    expect(screen.getAllByText("LOCAL-1 · Plan the next release").length).toBeGreaterThan(0);
    expect(source.plannedDate).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apply suggested plan" }));
    expect(onApplyPlan).toHaveBeenCalledOnce();
  });

  it("rolls over unpinned work directly and asks before moving a manual pin", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const onRollover = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        rollover={{
          generatedAt: "2026-07-31T04:00:00.000Z",
          rolloverRevision: "0123456789abcdef01234567",
          terminalId: "dev-local",
          sourceDate: "2026-07-30",
          targetDate: "2026-07-31",
          moves: [{
            workItemId: "auto", localRef: "LOCAL-A", title: "Auto", status: "ready",
            sourceDate: "2026-07-30", targetDate: "2026-07-31", expectedRevision: 1,
            runningContextPreserved: false, previousPlanSource: "auto_plan", reason: "unfinished_from_previous_local_day",
          }],
          confirmationRequired: [{
            workItemId: "pinned", localRef: "LOCAL-P", title: "Pinned", status: "ready",
            sourceDate: "2026-07-30", targetDate: "2026-07-31", expectedRevision: 1,
            runningContextPreserved: false, previousPlanSource: "manual", reason: "unfinished_from_previous_local_day",
          }],
          unscheduled: [],
        }}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        onRollover={onRollover}
        now={now}
      />,
    );

    activateWorkTab("ai");
    fireEvent.click(screen.getByRole("button", { name: "Roll over 2" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(onRollover).toHaveBeenCalledWith(true);
    confirm.mockRestore();
  });

  it("prompts once per local day before carrying yesterday's unfinished work", async () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const promptKey = "myagenttool:rollover-prompt:2026-07-30";
    window.localStorage.removeItem(promptKey);
    const onRollover = vi.fn();
    const rollover = {
      generatedAt: "2026-07-31T04:00:00.000Z",
      rolloverRevision: "0123456789abcdef01234567",
      terminalId: "dev-local",
      sourceDate: "2026-07-30",
      targetDate: "2026-07-31",
      moves: [{
        workItemId: "auto-prompt", localRef: "LOCAL-AP", title: "Carry unfinished work", status: "ready" as const,
        sourceDate: "2026-07-30", targetDate: "2026-07-31", expectedRevision: 1,
        runningContextPreserved: false, previousPlanSource: "auto_plan", reason: "unfinished_from_previous_local_day",
      }],
      confirmationRequired: [],
      unscheduled: [],
    };
    const { unmount } = render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        rollover={rollover}
        autoRolloverPrompt
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        onRollover={onRollover}
        now={now}
      />,
    );

    expect(await screen.findByRole("dialog", { name: "Unfinished work from yesterday" })).toBeTruthy();
    expect(screen.getByText("Carry unfinished work")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Carry all to today" }));
    expect(onRollover).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Unfinished work from yesterday" })).toBeNull());
    expect(window.localStorage.getItem(promptKey)).toBe("dismissed");
    unmount();
    window.localStorage.removeItem(promptKey);
  });

  it("previews an urgent insertion and only applies it from the explicit P0 action", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const p0 = localItem({ id: "p0", localRef: "LOCAL-P0", title: "Restore production", priority: "p0", plannedDate: null });
    const displaced = localItem({ id: "p3", localRef: "LOCAL-P3", title: "Polish docs", priority: "p3", plannedDate: "2026-07-31" });
    const onApplyUrgent = vi.fn();
    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states: emptyStates() }}
        report={report(0, 0)}
        plannedItems={[displaced, p0]}
        urgent={{
          generatedAt: "2026-07-31T04:00:00.000Z",
          urgentRevision: "0123456789abcdef01234567",
          terminalId: "dev-local",
          date: "2026-07-31",
          capacity: { grossMinutes: 480, routineMinutes: 384, urgentReserveMinutes: 96, availableSlots: 1, inFlight: 0 },
          insertions: [{
            workItemId: "p0", localRef: "LOCAL-P0", title: "Restore production", dueDate: null,
            createdAt: p0.createdAt ?? null, expectedRevision: 1, targetDate: "2026-07-31", estimatedMinutes: 60,
            queueOrder: 0, activation: "immediate", requiresPinnedConfirmation: false, reason: "p0_idle_slot",
          }],
          displacements: [{
            workItemId: "p3", localRef: "LOCAL-P3", title: "Polish docs", priority: "p3", expectedRevision: 1,
            sourceDate: "2026-07-31", targetDate: "2026-08-01", estimatedMinutes: 60,
            manuallyPinned: false, forWorkItemId: "p0", reason: "displaced_by_p0",
          }],
          confirmationRequired: [],
          unscheduled: [],
        }}
        onOpenItem={vi.fn()}
        onOpenTasks={vi.fn()}
        onApplyUrgent={onApplyUrgent}
        now={now}
      />,
    );

    activateWorkTab("ai");
    expect(screen.getByText("1 P0 pending")).toBeTruthy();
    expect(screen.getByText("LOCAL-P0 · Restore production")).toBeTruthy();
    expect(screen.getByText("LOCAL-P3 · Polish docs")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Insert urgent work" }));
    expect(onApplyUrgent).toHaveBeenCalledWith(false);
  });
});
