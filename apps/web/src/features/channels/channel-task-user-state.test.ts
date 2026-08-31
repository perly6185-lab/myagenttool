import { describe, expect, it } from "vitest";
import type { ChannelTaskThread } from "@/lib/console-state";
import { channelTaskUserState } from "./channel-task-user-state";

function thread(overrides: Partial<ChannelTaskThread> = {}): ChannelTaskThread {
  return {
    id: "thread_1",
    channelId: "channel_1",
    conversationId: "conversation_1",
    sourceEventIds: [],
    messages: [],
    summary: "整理文章",
    status: "queued",
    ...overrides,
  };
}

describe("channelTaskUserState", () => {
  it("prioritizes an undelivered result over the completed task state", () => {
    const result = channelTaskUserState({
      thread: thread({ status: "succeeded", resultSummary: "已生成结果" }),
      delivery: { id: "delivery_1", channelId: "channel_1", conversationId: "conversation_1", status: "failed_terminal", attempts: 3 },
    });

    expect(result.label).toBe("结果未送达");
    expect(result.action).toBe("retry_delivery");
  });

  it("does not call an iLink provider acceptance a confirmed delivery", () => {
    const result = channelTaskUserState({
      thread: thread({ status: "succeeded", resultSummary: "已生成结果" }),
      delivery: { id: "delivery_1", channelId: "channel_1", conversationId: "conversation_1", status: "sent_unconfirmed", attempts: 1 },
    });

    expect(result.label).toBe("微信未确认送达");
    expect(result.nextStep).toContain("没有确认客户端已经显示");
    expect(result.actionLabel).toBe("再次发送结果");
  });

  it("suppresses duplicate resend during the provider-acceptance cooldown", () => {
    const result = channelTaskUserState({
      thread: thread({ status: "succeeded", resultSummary: "已生成结果", workItemId: "work_1" }),
      delivery: {
        id: "delivery_1", channelId: "channel_1", conversationId: "conversation_1",
        status: "sent_unconfirmed", attempts: 1, nextManualRetryAt: "2026-08-25T08:10:00.000Z",
      },
      now: Date.parse("2026-08-25T08:05:00.000Z"),
    });

    expect(result.nextStep).toContain("避免之后收到重复消息");
    expect(result.action).toBe("view_task");
    expect(result.actionLabel).toBe("查看本地结果");
  });

  it("keeps a running task visible when only a progress notification is unconfirmed", () => {
    const result = channelTaskUserState({
      thread: thread({ status: "running" }),
      delivery: {
        id: "delivery_progress",
        channelId: "channel_1",
        conversationId: "conversation_1",
        status: "sent_unconfirmed",
        attempts: 1,
        taskContext: { threadId: "thread_1", deliveryKind: "status_notification" },
      },
    });

    expect(result.label).toBe("执行中");
    expect(result.action).not.toBe("retry_delivery");
  });

  it("turns a failed task with a retry action into a clear next step", () => {
    const result = channelTaskUserState({
      thread: thread({ status: "failed" }),
      task: { id: "task_1", channelId: "channel_1", projectId: "project_1", issueNumber: 1, title: "整理文章", status: "routed", stage: "run_failed", actions: { retry: true, reroute: false, takeover: false } },
    });

    expect(result.label).toBe("执行失败");
    expect(result.actionLabel).toBe("重试任务");
  });

  it("keeps confirmation guidance in the channel instead of exposing internal controls", () => {
    const result = channelTaskUserState({ thread: thread({ status: "awaiting_confirmation" }) });

    expect(result.nextStep).toContain("微信回复“确认”");
    expect(result.action).toBe("reply_in_channel");
  });

  it("makes a pending correction distinct from a first-run confirmation", () => {
    const result = channelTaskUserState({
      thread: thread({ status: "awaiting_confirmation", revisionId: "revision_1" }),
      revision: { id: "revision_1", channelId: "channel_1", conversationId: "conversation_1", threadId: "thread_1", revision: 2, type: "output_style_correction", status: "awaiting_confirmation", feedback: "格式不对，请保持原样" },
    });

    expect(result.label).toBe("等待确认修改");
    expect(result.nextStep).toContain("格式不对，请保持原样");
  });

  it("sends an expired WeChat login to the site-login view", () => {
    const result = channelTaskUserState({ thread: thread({ status: "needs_attention", attentionReason: "wechat_login_required" }) });
    expect(result.label).toBe("需要登录公众号");
    expect(result.action).toBe("open_sessions");
  });

  it("requires draft-box reconciliation instead of presenting a blind retry", () => {
    const result = channelTaskUserState({ thread: thread({ status: "needs_attention", attentionReason: "wechat_draft_outcome_unknown" }) });
    expect(result.label).toBe("等待核对草稿");
    expect(result.nextStep).toContain("确认没有草稿后");
    expect(result.action).toBeNull();
  });

  it("explains that upstream work is still preparing without asking for duplicate input", () => {
    const result = channelTaskUserState({
      thread: thread({ status: "waiting_upstream", dependencyTaskTitles: ["文章创作"] }),
    });
    expect(result.label).toBe("等待前置结果");
    expect(result.nextStep).toContain("文章创作");
    expect(result.nextStep).toContain("不需要重复发送");
  });

  it("keeps an upstream failure local and tells the user what must recover", () => {
    const result = channelTaskUserState({
      thread: thread({
        status: "needs_attention",
        waitingFor: "upstream_unavailable",
        attentionReason: "upstream_failed",
        upstreamBlockers: [{ sourceWorkItemId: "work_image", title: "图片创作", cause: "failed" }],
      }),
    });
    expect(result.label).toBe("等待上游恢复");
    expect(result.nextStep).toContain("图片创作");
    expect(result.nextStep).toContain("其他独立任务不受影响");
    expect(result.action).toBeNull();
  });

  it("surfaces a failed result check instead of calling a completed task successful", () => {
    const result = channelTaskUserState({
      thread: thread({ status: "succeeded", workItemId: "work_1" }),
      task: {
        id: "task_1", channelId: "channel_1", projectId: "project_1", issueNumber: 1,
        title: "生成文章", status: "done", stage: "run_succeeded",
        resultVerification: { status: "failed", summary: "文章需要至少 3 个章节" },
        actions: { retry: false, reroute: false, takeover: false },
      },
    });
    expect(result.label).toBe("结果需要检查");
    expect(result.nextStep).toContain("文章需要至少 3 个章节");
    expect(result.actionLabel).toBe("查看检查结果");
  });

  it("uses the shared task journey instead of promoting a generated result to completed", () => {
    const result = channelTaskUserState({
      thread: thread({ status: "succeeded", workItemId: "work_1" }),
      task: {
        id: "task_1", channelId: "channel_1", projectId: "project_1", issueNumber: 1,
        title: "生成文章", status: "done", stage: "run_succeeded",
        actions: { retry: false, reroute: false, takeover: false },
        journey: {
          schemaVersion: 1, origin: "channel", stage: "ready_to_complete", status: "ready",
          waitingFor: "result_review", requiresUserAction: true, reasonCodes: [],
          nextAction: { kind: "review_result", target: "task", required: true },
          result: { available: true, verificationStatus: "passed", verified: true, deliveryStatus: "delivered", delivered: true },
        },
      },
    });
    expect(result.label).toBe("结果待确认");
    expect(result.nextStep).toContain("确认后才会计为真正完成");
    expect(result.actionLabel).toBe("查看并确认");
  });

  it("turns a failed journey check into a direct governed AI repair action", () => {
    const result = channelTaskUserState({
      thread: thread({ status: "needs_attention", workItemId: "work_1" }),
      task: {
        id: "task_1", channelId: "channel_1", projectId: "project_1", issueNumber: 1,
        title: "生成文章", status: "routed", stage: "run_blocked",
        resultVerification: { status: "failed", summary: "文章缺少结论章节" },
        actions: { retry: false, fixWithAi: true, rerunVerification: true, reroute: false, takeover: false },
        journey: {
          schemaVersion: 1, origin: "channel", stage: "verification_failed", status: "attention",
          waitingFor: "user_decision", requiresUserAction: true, reasonCodes: ["result_verification_failed"],
          nextAction: { kind: "create_repair_task", target: "task", required: true },
          result: { available: true, verificationStatus: "failed", verified: false, deliveryStatus: null, delivered: false },
        },
      },
    });

    expect(result.label).toBe("结果需要处理");
    expect(result.nextStep).toContain("原结果和记录会保留");
    expect(result.action).toBe("fix_with_ai");
    expect(result.actionLabel).toBe("让 AI 按检查返工");
  });

  it("shows genuine completion only when the shared journey is closed", () => {
    const result = channelTaskUserState({
      thread: thread({ status: "succeeded", workItemId: "work_1" }),
      task: {
        id: "task_1", channelId: "channel_1", projectId: "project_1", issueNumber: 1,
        title: "生成文章", status: "done", stage: "run_succeeded",
        actions: { retry: false, reroute: false, takeover: false },
        journey: {
          schemaVersion: 1, origin: "channel", stage: "completed", status: "completed",
          waitingFor: null, requiresUserAction: false, reasonCodes: [],
          nextAction: { kind: "none", target: "task", required: false },
          result: { available: true, verificationStatus: "passed", verified: true, deliveryStatus: "delivered", delivered: true },
        },
      },
    });
    expect(result.label).toBe("已真正完成");
    expect(result.nextStep).toContain("已经闭环");
  });
});
