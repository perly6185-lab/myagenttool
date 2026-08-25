import { describe, expect, it } from "vitest";
import { buildMyTaskTimeline } from "@/features/dashboard/my-task-timeline";

describe("buildMyTaskTimeline", () => {
  it("merges a channel task into its linked local task and keeps the history readable", () => {
    const rows = buildMyTaskTimeline({
      workItems: [{ id: "work-1", title: "整理客户资料", status: "done", lastProgressAt: "2026-08-21T10:00:00Z" } as never],
      channelTaskThreads: [{
        id: "thread-1", channelId: "channel-1", conversationId: "conversation-1", sourceEventIds: [], messages: [],
        summary: "整理客户资料", status: "succeeded", workItemId: "work-1", createdAt: "2026-08-21T09:00:00Z",
        updatedAt: "2026-08-21T11:00:00Z", resultSummary: "已整理完成。", statusHistory: [
          { status: "queued", at: "2026-08-21T09:01:00Z" },
          { status: "succeeded", at: "2026-08-21T11:00:00Z" },
        ],
      }],
      channelTaskRevisions: [],
      channelDeliveries: [],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "channel:thread-1", workItemId: "work-1", status: "succeeded" });
    expect(rows[0].events.map((event) => event.kind)).toContain("result");
    expect(rows[0].events.map((event) => event.kind)).toContain("status");
  });

  it("includes unlinked local and channel tasks in one newest-first feed", () => {
    const rows = buildMyTaskTimeline({
      workItems: [{ id: "work-1", title: "本地任务", status: "in_progress", updatedAt: "2026-08-21T09:00:00Z" } as never],
      channelTaskThreads: [{ id: "thread-1", channelId: "channel-1", conversationId: "conversation-1", sourceEventIds: [], messages: [], summary: "微信任务", status: "running", createdAt: "2026-08-21T10:00:00Z" }],
      limit: 8,
    });

    expect(rows.map((row) => row.title)).toEqual(["微信任务", "本地任务"]);
  });
});
