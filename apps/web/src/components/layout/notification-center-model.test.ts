import { describe, expect, it } from "vitest";
import { deriveNotificationCenterModel, unreadCompletionIds } from "@/components/layout/notification-center-model";
import type { ConsoleSnapshot } from "@/lib/console-state";

describe("notification center model (#1537)", () => {
  it("keeps approvals, failures, completions, and transport state separate", () => {
    const state = {
      device: { status: "online" },
      pendingDecisions: [{ id: "approval-1", title: "Approve installation" }],
      workBoard: {
        states: {
          pending_decision: { count: 1, items: [] },
          follow_up: { count: 0, items: [] },
          in_progress: { count: 0, items: [] },
          waiting: { count: 0, items: [] },
          failed: { count: 2, items: [{ id: "failed-1", title: "Failed run" }] },
          done: { count: 3, items: [{ id: "done-1", title: "Completed run" }] },
        },
      },
      invocations: [],
    } as unknown as ConsoleSnapshot;

    const model = deriveNotificationCenterModel(state, {
      isError: false,
      isLoading: false,
      liveUpdates: false,
    });

    expect(model.approvals.count).toBe(1);
    expect(model.failures.count).toBe(2);
    expect(model.completions.count).toBe(3);
    expect(model.offline).toBe(false);
    expect(model.fallback).toBe(true);
    expect(model.eventIds).toEqual([
      "approval:approval-1",
      "failure:failed-1",
      "completion:done-1",
    ]);
  });

  it("uses durable seen ids so refresh does not create false unread results", () => {
    const items = [
      { id: "done-1", title: "One", target: "work_item" as const },
      { id: "done-2", title: "Two", target: "work_item" as const },
    ];
    expect(unreadCompletionIds(items, new Set(["done-1", "done-2"]))).toEqual([]);
    expect(unreadCompletionIds(items, new Set(["done-1"]))).toEqual(["done-2"]);
  });

  it("surfaces disconnected execution independently from polling fallback", () => {
    const state = { device: { status: "offline" }, invocations: [] } as unknown as ConsoleSnapshot;
    const model = deriveNotificationCenterModel(state, {
      isError: false,
      isLoading: false,
      liveUpdates: true,
    });
    expect(model.offline).toBe(true);
    expect(model.fallback).toBe(false);
    expect(model.eventIds).toContain("execution:offline");
  });
});
