import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChannelsView } from "@/features/channels/channels-view";

const action = vi.hoisted(() => ({
  execute: vi.fn((fn: () => Promise<unknown>) => fn()),
  retry: vi.fn(),
  reroute: vi.fn(),
  takeover: vi.fn(),
  listInteractions: vi.fn(async () => ({
    interactions: [
      { id: "evt_1", direction: "inbound", type: "text", content: "你好，帮我查一下发布状态", attachments: [], status: "imported", createdAt: "2026-08-13T12:00:00.000Z", conversationId: "conv_1" },
      { id: "del_1", direction: "outbound", type: "file", content: "发布报告", attachments: [{ id: "asset_1", name: "release-report.pdf", family: "pdf", mimeType: "application/pdf", size: 1024, projectId: "prj_1", path: "release-report.pdf" }], status: "delivered", createdAt: "2026-08-13T12:01:00.000Z", conversationId: "conv_1" },
    ],
    nextCursor: null,
    count: 2,
  })),
}));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: () => ({ data: {
  channelIntentMetrics: { total: 4, lowConfidence: 0, ambiguous: 1, experience: { consultationAnswers: 3, consultationAnswerMissing: 1, consultationTimeouts: 1, consultationAutoRetries: 2, consultationAutoRetryRecovered: 1, consultationAutoRetryExhausted: 1, difficultSamples: 5, pendingReviewSamples: 2, resolvedCorrections: 3, replayReadySamples: 3, deduplicatedOccurrences: 4 } },
  channelOperations: [{ id: "chn_1", provider: "wechat_ilink", name: "Ops", status: "enabled", readiness: { account: true, session: true, worker: true }, ready: true, health: "attention", capabilityAllowlist: [], counts: { identities: 1, conversations: 1, events: 1, deliveries: 1, failedDeliveries: 0, unconfirmedDeliveries: 1, injectionFlagged: 0 }, deliveryHealth: { state: "outbound_delayed", unconfirmedCount: 1, delayedCount: 1, latestDeliveryId: "del_unconfirmed", latestAcceptedAt: "2026-08-13T12:01:00.000Z", retryAfter: "2026-08-13T12:11:00.000Z" }, lastInboundAt: "2026-08-13T12:00:00.000Z", lastOutboundAt: "2026-08-13T12:01:00.000Z", lastDeliveredAt: null, pipeline: { inbound: { imported: 1 }, outbound: { sent_unconfirmed: 1 } }, recentLinks: [{ eventId: "evt_link", conversationId: "conv_1", hosts: ["mp.weixin.qq.com"], status: "ready", detectedAt: "2026-08-13T12:00:10.000Z", completedAt: "2026-08-13T12:00:20.000Z", activeTaskCount: 1, acknowledgement: { deliveryId: "del_ack", status: "sent_unconfirmed", attempts: 1, updatedAt: "2026-08-13T12:00:11.000Z" }, finalReply: { deliveryId: "del_final", status: "sent_unconfirmed", attempts: 1, updatedAt: "2026-08-13T12:00:21.000Z" }, route: { target: "current_task_follow_up", status: "queued", reason: "confirmed_route_choice", activeTaskCount: 1, decidedAt: "2026-08-13T12:00:30.000Z" }, failureCode: null }] }],
  channelDeliveries: [], projects: [],
  channelConversations: [{
    id: "conv_1", channelId: "chn_1", externalUserId: "wx_alice", status: "active",
    sharedContentContext: {
      status: "analyzed", activeItemIds: ["sct_1"], retryUrls: ["https://mp.weixin.qq.com/s/failed"], lastFailedAt: "2026-08-14T12:00:00.000Z",
      nextTaskProposals: [
        { id: "proposal_knowledge_analysis", kind: "knowledge_analysis", label: "深度分析", outcome: "形成分析报告", state: "suggested", createsTask: false },
        { id: "proposal_content_article", kind: "content_article", label: "深度文章", outcome: "形成文章稿件", state: "suggested", createsTask: false },
      ],
      items: [{ id: "sct_1", status: "ready", provider: "wechat", title: "移动端知识助手", author: "示例作者", canonicalUrl: "https://mp.weixin.qq.com/s/example", publishedAt: "2026-08-14", archiveStatus: "saved", knowledgeItemId: "content_1" }],
    },
  }],
  channelTaskRequests: [
    { id: "ctr_1", channelId: "chn_1", projectId: "prj_1", issueNumber: 42, issueUrl: "https://example.test/42", title: "Repair failed release", status: "routed", stage: "run_failed", autoRunId: "run_1", runStatus: "failed", invocationId: "inv_1", invocationStatus: "failed", resultSummary: "Bridge disconnected", deliveryStatus: "failed_terminal", actions: { retry: true, reroute: true, takeover: true } },
    { id: "ctr_thread", channelId: "chn_1", projectId: "prj_1", issueNumber: 43, title: "整理文章", threadId: "thread_1", status: "routed", stage: "run_failed", runStatus: "failed", resultSummary: "读取资料失败", actions: { retry: true, reroute: false, takeover: false } },
  ],
  channelTaskThreads: [{ id: "thread_1", channelId: "chn_1", conversationId: "conv_1", sourceEventIds: [], messages: [], summary: "整理文章", status: "failed", workItemId: "work_1", nextAction: "重试任务" }],
  channelTaskRevisions: [],
} }) }));
vi.mock("@/data/use-console-actions", () => ({
  useAsyncAction: () => ({ execute: action.execute, pending: false, error: null }),
  api: { retryChannelTask: action.retry, rerouteChannelTask: action.reroute, takeoverChannelTask: action.takeover, listChannelInteractions: action.listInteractions },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ChannelsView task operations", () => {
  it("defaults to a simple view and reveals diagnostics only on demand", async () => {
    render(<ChannelsView />);
    expect(screen.getByTestId("channel-outbound-delay-fallback").textContent).toContain("微信回复可能延迟");
    expect(screen.getByTestId("channel-outbound-delay-fallback").textContent).toContain("收消息和任务执行仍然正常");
    expect(screen.getByRole("button", { name: "查看本地结果" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新连接微信" })).toBeTruthy();
    expect(screen.getByTestId("channel-shared-materials").textContent).toContain("最近分享的资料（2）");
    expect(screen.getByText("移动端知识助手")).toBeTruthy();
    expect(screen.getByText("已分析")).toBeTruthy();
    expect(screen.getByText("已收纳")).toBeTruthy();
    expect(screen.getByText("链接正文暂时无法读取")).toBeTruthy();
    expect(screen.getByText(/请在微信回复“重试”/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看我的资料" })).toBeTruthy();
    expect(screen.getByTestId("channel-next-task-proposals").textContent).toContain("以下只是建议，不会自动创建任务");
    expect(screen.getByTestId("channel-next-task-proposals").textContent).toContain("深度分析");
    expect(screen.getByTestId("channel-next-task-proposals").textContent).toContain("深度文章");
    expect(screen.queryByTestId("channel-diagnostics-summary")).toBeNull();
    expect(screen.getByTestId("channel-intent-metrics").textContent).toContain("咨询质量：有效回答 3");
    expect(screen.getByTestId("channel-intent-metrics").textContent).toContain("自动重试 2（恢复 1，耗尽 1）");
    expect(screen.getByTestId("channel-intent-metrics").textContent).toContain("真实表达评测：困难样本 5，待审核 2，用户已纠正 3，可回放 3，重复表达合并 4");
    expect(screen.queryByText("Issue #42")).toBeNull();
    expect(screen.getByTestId("channel-task-operations")).toBeTruthy();
    expect(screen.getByTestId("channel-task-next-step").textContent).toContain("重试任务");
    expect(screen.getByText("Retry")).toBeTruthy();
    expect(screen.queryByText("Reroute")).toBeNull();
    fireEvent.click(screen.getByText("高级信息"));
    expect(screen.getByTestId("channel-diagnostics-summary").textContent).toContain("最后入站");
    expect((screen.getByTestId("channel-task-device") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByTestId("channel-diagnostics-summary").textContent).toContain("入站 已接收 1");
    expect(screen.getByTestId("channel-link-diagnostics").textContent).toContain("mp.weixin.qq.com");
    expect(screen.getByTestId("channel-link-diagnostics").textContent).toContain("即时回执：微信已接受，未确认送达");
    expect(screen.getByTestId("channel-link-diagnostics").textContent).toContain("未自动修改任务");
    expect(screen.getByTestId("channel-link-diagnostics").textContent).toContain("已明确安排到当前任务之后");
    expect(screen.getByText("run failed")).toBeTruthy();
    expect(screen.getByText("Issue #42")).toBeTruthy();
    expect(screen.getByText("inv_1")).toBeTruthy();
    expect(screen.getByText("Bridge disconnected")).toBeTruthy();
    fireEvent.click(screen.getAllByText("Retry")[0]);
    fireEvent.click(screen.getByText("Reroute"));
    fireEvent.click(screen.getByText("Take over"));
    expect(action.retry).toHaveBeenCalledWith("ctr_1");
    expect(action.reroute).toHaveBeenCalledWith("ctr_1");
    expect(action.takeover).toHaveBeenCalledWith("ctr_1");
  });

  it("opens the interaction timeline and shows inbound and outbound records", async () => {
    render(<ChannelsView />);
    fireEvent.click(screen.getByText("View interaction records"));

    expect(await screen.findByTestId("channel-interactions")).toBeTruthy();
    expect(await screen.findByText("你好，帮我查一下发布状态")).toBeTruthy();
    expect(await screen.findByText("发布报告")).toBeTruthy();
    expect(await screen.findByText(/release-report\.pdf/)).toBeTruthy();
    expect(action.listInteractions).toHaveBeenCalledWith("chn_1", expect.objectContaining({ limit: 50, cursor: null }));
  });
});
