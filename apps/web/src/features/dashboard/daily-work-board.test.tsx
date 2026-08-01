import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDailyWorkBoardModel,
  DailyWorkBoard,
} from "@/features/dashboard/daily-work-board";
import type { WorkBoard, WorkItem, WorkReport, WorkState } from "@/lib/console-state";
import type { LocalWorkItem } from "@/features/tasks/task-view-types";
import { i18n } from "@/lib/i18n";

beforeEach(async () => { await i18n.changeLanguage("en-US"); });
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

describe("DailyWorkBoard", () => {
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
    const onOpenActive = vi.fn();
    const onOpenCompleted = vi.fn();

    render(
      <DailyWorkBoard
        board={{ generatedAt: now, states }}
        report={report(2, 0)}
        onOpenItem={onOpenItem}
        onOpenTasks={onOpenTasks}
        onOpenActive={onOpenActive}
        onOpenCompleted={onOpenCompleted}
        now={now}
      />,
    );

    expect(screen.getByText("Yesterday")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Tomorrow")).toBeTruthy();
    expect(screen.getByText("Task active")).toBeTruthy();
    expect(screen.getByText("Nothing planned for tomorrow")).toBeTruthy();

    fireEvent.click(screen.getByText("Task active"));
    expect(onOpenItem).toHaveBeenCalledWith(active);
    fireEvent.click(screen.getByRole("button", { name: "Plan tomorrow" }));
    expect(onOpenTasks).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "1 In progress" }));
    expect(onOpenActive).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "2 Completed" }));
    expect(onOpenCompleted).toHaveBeenCalled();
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

  it("uses personal planned dates for today and tomorrow and deep-links to the local task", () => {
    const now = new Date(2026, 6, 31, 12).getTime();
    const states = emptyStates();
    const today = localItem({ id: "today", localRef: "LOCAL-41", plannedDate: "2026-07-31" });
    const tomorrow = localItem({ id: "tomorrow", localRef: "LOCAL-23", plannedDate: "2026-08-01" });
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

    expect(screen.getByTestId("unscheduled-work").textContent).toContain("Run failed; triage or retry first");
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

    expect(screen.getByText("Available slots 2 / 3")).toBeTruthy();
    expect(screen.getByTestId("local-capacity-summary").textContent).toContain("Queue 4");
    expect(screen.getByTestId("local-capacity-summary").textContent).toContain("Workspace locks 1");
    const capacityButton = screen.getByRole("button", { name: "Available slots 2 / 3" });
    expect(capacityButton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(capacityButton);
    expect(capacityButton.getAttribute("aria-expanded")).toBe("true");
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

    expect(screen.getByText("LOCAL-1 · Plan the next release")).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: "Roll over 2" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(onRollover).toHaveBeenCalledWith(true);
    confirm.mockRestore();
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

    expect(screen.getByText("1 P0 pending")).toBeTruthy();
    expect(screen.getByText("LOCAL-P0 · Restore production")).toBeTruthy();
    expect(screen.getByText("LOCAL-P3 · Polish docs")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Insert urgent work" }));
    expect(onApplyUrgent).toHaveBeenCalledWith(false);
  });
});
