import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { LocalWorkItemTable } from "./local-work-item-table";
import { PlanningInsights } from "./planning-insights";
import type { LocalWorkItem } from "./task-view-types";

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
});

afterEach(cleanup);

function workItem(overrides: Partial<LocalWorkItem> = {}): LocalWorkItem {
  return {
    id: "item-1",
    localRef: "LOCAL-1",
    projectId: "project-1",
    title: "Plan release",
    body: "",
    type: "task",
    status: "ready",
    priority: "p1",
    state: "open",
    labels: [],
    assigneeIds: [],
    followUpSchemaVersion: 1,
    requesterRelation: "self",
    requesterName: null,
    requesterOrganization: null,
    requesterUserId: null,
    intakeChannel: "manual",
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
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("planning task components", () => {
  it("aggregates planning metrics without counting completed work as active load", () => {
    const items = [
      workItem({
        id: "ready",
        status: "ready",
        priority: "p0",
        dueDate: "2026-08-01",
        milestone: "M1",
        estimatePoints: 5,
        assigneeIds: ["alice"],
        blockedBy: [{ id: "dep", localRef: "LOCAL-D", title: "Dependency", status: "ready", state: "open", resolved: false }],
      }),
      workItem({ id: "done", status: "done", milestone: "M1", estimatePoints: 3, assigneeIds: ["alice", "charlie"] }),
      workItem({ id: "blocked", status: "blocked", milestone: "M2", estimatePoints: 2, assigneeIds: ["alice", "bob"] }),
    ];

    render(
      <PlanningInsights
        items={items}
        today="2026-08-10"
        capacityPoints={10}
        startDate="2026-08-01"
        targetDate="2026-08-20"
        daysRemaining={10}
        projectOverdue={false}
      />,
    );

    expect(screen.getByText("7 / 10 points")).toBeTruthy();
    expect(screen.getByText("1/2 · 50% · 8 pts")).toBeTruthy();
    expect(screen.getByText("2 · 7 pts")).toBeTruthy();
    expect(screen.getByText("1 · 2 pts")).toBeTruthy();
    expect(screen.getByText("0 · 0 pts")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.textContent === "1Overdue")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.textContent === "2Blocked")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.textContent === "2Unscheduled")).toBeTruthy();
  });

  it("uses indexed project names and opens the selected work item", () => {
    const onOpen = vi.fn();
    render(
      <LocalWorkItemTable
        items={[workItem({ dueDate: "2020-01-01", labels: ["release"] })]}
        projects={[{ id: "project-1", name: "Console" }]}
        emptyTitle="Nothing here"
        emptyHint="Create a task"
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText("Console")).toBeTruthy();
    expect(screen.getByText("release")).toBeTruthy();
    expect(screen.getByText("Overdue 2020-01-01")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Plan release" }));
    expect(onOpen).toHaveBeenCalledWith("item-1");
  });

  it("projects unified execution state into an ordinary-user task list", () => {
    render(
      <LocalWorkItemTable
        simple
        items={[workItem({
          title: "Import a WeChat article",
          labels: ["source:wechat", "content:article"],
          priority: "p0",
          executionState: "running",
          lastProgressSummary: "Downloading article content",
        })]}
        projects={[{ id: "project-1", name: "Console" }]}
        emptyTitle="Nothing here"
        emptyHint="Create a task"
        onOpen={() => {}}
      />,
    );

    expect(screen.getByText("AI working")).toBeTruthy();
    expect(screen.getByText("Downloading article content")).toBeTruthy();
    expect(screen.getByRole("button", { name: "View progress" })).toBeTruthy();
    expect(screen.queryByText("LOCAL-1")).toBeNull();
    expect(screen.queryByText("source:wechat")).toBeNull();
    expect(screen.queryByText("P0")).toBeNull();
  });
});
