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
    expect(model.channelDeliveries.count).toBe(0);
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

  it("counts due stakeholder follow-ups once and includes their stable reminder event", () => {
    const state = {
      device: { status: "online" },
      pendingDecisions: [],
      workBoard: {
        states: {
          pending_decision: { count: 0, items: [] },
          follow_up: { count: 1, items: [{ id: "followup:wfr_1", kind: "work_item_follow_up_reminder", title: "Update customer", section: "task", targetId: "lwi_1" }] },
          in_progress: { count: 0, items: [] },
          waiting: { count: 0, items: [] },
          failed: { count: 0, items: [] },
          done: { count: 0, items: [] },
        },
      },
      invocations: [],
    } as unknown as ConsoleSnapshot;
    const model = deriveNotificationCenterModel(state, {
      isError: false,
      isLoading: false,
      liveUpdates: true,
    });
    expect(model.followUps).toEqual({
      count: 1,
      items: [{ id: "followup:wfr_1", title: "Update customer", target: "work_item" }],
    });
    expect(model.eventIds).toContain("followup:wfr_1");
  });

  it("surfaces a delayed iLink result globally and links directly to its local result", () => {
    const state = {
      device: { status: "online" },
      pendingDecisions: [],
      invocations: [],
      channelOperations: [{
        id: "chn_1", provider: "wechat_ilink", name: "我的微信",
        deliveryHealth: { state: "outbound_delayed", latestDeliveryId: "del_1", delayedCount: 1, unconfirmedCount: 1 },
      }],
      channelDeliveries: [{
        id: "del_1", channelId: "chn_1", conversationId: "conv_1", status: "sent_unconfirmed", attempts: 1,
        taskContext: { threadId: "thread_1", workItemId: "work_1", deliveryKind: "result" },
      }],
      channelTaskThreads: [{
        id: "thread_1", channelId: "chn_1", conversationId: "conv_1", summary: "整理公众号文章",
        status: "succeeded", workItemId: "work_1", lastDeliveryId: "del_1",
      }],
    } as unknown as ConsoleSnapshot;

    const model = deriveNotificationCenterModel(state, {
      isError: false,
      isLoading: false,
      liveUpdates: true,
    });

    expect(model.channelDeliveries).toEqual({
      count: 1,
      items: [{ id: "work_1", title: "整理公众号文章 · 微信可能尚未显示", target: "work_item" }],
    });
    expect(model.eventIds).toContain("channel-delivery:del_1:unconfirmed");
  });

  it("surfaces stale business records as actionable work-item notifications", () => {
    const state = { device: { status: "online" }, pendingDecisions: [], invocations: [] } as unknown as ConsoleSnapshot;
    const model = deriveNotificationCenterModel(state, {
      isError: false,
      isLoading: false,
      liveUpdates: true,
      recordBindingAttentionItems: [{
        id: "record_binding_stale:lwi_1",
        workItemId: "lwi_1",
        title: "Prepare account review",
      }],
    });
    expect(model.businessRecords).toEqual({
      count: 1,
      items: [{ id: "lwi_1", title: "Prepare account review", target: "work_item" }],
    });
    expect(model.eventIds).toContain("business-record:record_binding_stale:lwi_1");
  });
});
