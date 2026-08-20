import test from "node:test";
import assert from "node:assert/strict";
import { createChannelNotificationService, parseChannelNotificationPolicyRequest } from "../src/services/channel-notifications.mjs";

function harness({ now = "2026-08-19T12:00:00.000Z" } = {}) {
  const state = {
    channels: [{ id: "chn_1", ownerTeamId: "team_local" }],
    channelConversations: [{ id: "conv_1", channelId: "chn_1" }],
    channelTaskThreads: [{ id: "thread_1", channelId: "chn_1", conversationId: "conv_1", summary: "整理报价", createdAt: now, lastProgressNotificationAt: null }],
    channelNotificationPolicies: [],
    channelNotificationBatches: [],
    channelNotificationLog: [],
  };
  let clock = now;
  let sequence = 0;
  const deliveries = [];
  const service = createChannelNotificationService({
    state,
    now: () => clock,
    nextId: (prefix) => `${prefix}_${++sequence}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    store: null,
    enqueueChannelDelivery: (row) => {
      deliveries.push(row);
      return { ok: true, deliveryId: `del_${deliveries.length}` };
    },
  });
  return { state, service, deliveries, setNow: (value) => { clock = value; } };
}

test("自然语言提醒设置返回结构化策略，不创建任务", () => {
  assert.deepEqual(parseChannelNotificationPolicyRequest("有进展就告诉我")?.patch.mode, "progress");
  assert.equal(parseChannelNotificationPolicyRequest("每半小时提醒我")?.patch.progressIntervalMinutes, 30);
  assert.equal(parseChannelNotificationPolicyRequest("只告诉我完成和失败")?.patch.events.progress, false);
  assert.equal(parseChannelNotificationPolicyRequest("停止这个任务的提醒")?.patch.mode, "off");
  assert.equal(parseChannelNotificationPolicyRequest("晚上十点后不要提醒")?.patch.quietHours.start, "22:00");
  assert.equal(parseChannelNotificationPolicyRequest("按北京时间晚上十点后不要提醒")?.patch.quietHours.timezone, "Asia/Shanghai");
});

test("单任务重要节点不重复长标题，进展仍遵守间隔", () => {
  const { service, deliveries, state, setNow } = harness();
  assert.equal(service.notifyTaskEvent({ channelId: "chn_1", conversationId: "conv_1", threadId: "thread_1", event: "started", content: "任务已开始执行" }).ok, true);
  assert.equal(deliveries[0].content, "任务已开始执行");
  assert.equal(service.setPolicy({ channelId: "chn_1", conversationId: "conv_1", patch: { mode: "progress", progressStartAfterMinutes: 0, progressIntervalMinutes: 10 } }).ok, true);
  setNow("2026-08-19T12:01:00.000Z");
  assert.equal(service.notifyTaskEvent({ channelId: "chn_1", conversationId: "conv_1", threadId: "thread_1", event: "progress", content: "已读取文件" }).suppressed, undefined);
  setNow("2026-08-19T12:02:00.000Z");
  assert.equal(service.notifyTaskEvent({ channelId: "chn_1", conversationId: "conv_1", threadId: "thread_1", event: "progress", content: "继续处理" }).reason, "progress_throttled");
});

test("并行任务的重要节点保留短标题用于区分", () => {
  const { service, deliveries, state } = harness();
  state.channelTaskThreads[0].status = "running";
  state.channelTaskThreads.push({ id: "thread_2", channelId: "chn_1", conversationId: "conv_1", summary: "跟踪发货", status: "running", createdAt: "2026-08-19T11:00:00.000Z" });
  service.notifyTaskEvent({ channelId: "chn_1", conversationId: "conv_1", threadId: "thread_1", event: "started", content: "任务已开始执行" });
  assert.match(deliveries[0].content, /^【整理报价】/);
});

test("首次使用默认开启限频长任务进展，显式重要节点模式仍可关闭普通进展", () => {
  const { service, deliveries, setNow } = harness();
  const progress = service.notifyTaskEvent({ channelId: "chn_1", conversationId: "conv_1", threadId: "thread_1", event: "progress", content: "已读取一半文件" });
  assert.equal(progress.suppressed, true);
  assert.equal(progress.reason, "progress_start_delay");
  assert.equal(deliveries.length, 0);
  setNow("2026-08-19T12:06:00.000Z");
  assert.equal(service.notifyTaskEvent({ channelId: "chn_1", conversationId: "conv_1", threadId: "thread_1", event: "progress", content: "仍在安全读取文件" }).ok, true);
  assert.equal(deliveries.length, 1);
  assert.equal(service.setPolicy({ channelId: "chn_1", conversationId: "conv_1", patch: { mode: "important" } }).ok, true);
  assert.equal(service.notifyTaskEvent({ channelId: "chn_1", conversationId: "conv_1", threadId: "thread_1", event: "progress", content: "继续读取" }).reason, "important_only");
  assert.equal(service.notifyTaskEvent({ channelId: "chn_1", conversationId: "conv_1", threadId: "thread_1", event: "succeeded", content: "任务已完成" }).ok, true);
  assert.equal(deliveries.length, 2);
});

test("汇总模式持久化批次，sweep 后只生成一条出站消息", () => {
  const { service, deliveries, state, setNow } = harness();
  service.setPolicy({ channelId: "chn_1", conversationId: "conv_1", patch: { mode: "digest", digestWindowSeconds: 30, progressStartAfterMinutes: 0 } });
  service.notifyTaskEvent({ channelId: "chn_1", conversationId: "conv_1", threadId: "thread_1", event: "progress", content: "读取报价" });
  assert.equal(deliveries.length, 0);
  assert.equal(state.channelNotificationBatches.length, 1);
  setNow("2026-08-19T12:01:00.000Z");
  assert.equal(service.sweep().processed, 1);
  assert.equal(deliveries.length, 1);
  assert.match(deliveries[0].content, /进展汇总/);
});

test("同一会话有多个执行中任务时，普通进展自动合并", () => {
  const { service, deliveries, state, setNow } = harness();
  state.channelTaskThreads.push({ id: "thread_2", channelId: "chn_1", conversationId: "conv_1", summary: "跟踪发货", createdAt: "2026-08-19T11:00:00.000Z", lastProgressNotificationAt: null, status: "running" });
  state.channelTaskThreads[0].status = "running";
  service.setPolicy({ channelId: "chn_1", conversationId: "conv_1", patch: { mode: "progress", progressStartAfterMinutes: 0 } });
  service.notifyTaskEvent({ channelId: "chn_1", conversationId: "conv_1", threadId: "thread_1", event: "progress", content: "已读取报价" });
  assert.equal(state.channelTaskThreads[0].lastProgressNotificationAt, "2026-08-19T12:00:00.000Z");
  setNow("2026-08-19T12:01:00.000Z");
  service.sweep();
  assert.equal(deliveries.length, 1);
  assert.match(deliveries[0].content, /进展汇总/);
});

test("免打扰消息会等到窗口结束后补发", () => {
  const { service, deliveries, state, setNow } = harness({ now: "2026-08-19T23:00:00.000Z" });
  service.setPolicy({ channelId: "chn_1", conversationId: "conv_1", patch: { quietHours: { enabled: true, start: "22:00", end: "08:00", timezone: "UTC" } } });
  const result = service.notifyTaskEvent({ channelId: "chn_1", conversationId: "conv_1", threadId: "thread_1", event: "succeeded", content: "任务已完成" });
  assert.equal(result.batched, true);
  assert.equal(deliveries.length, 0);
  assert.equal(state.channelNotificationBatches.length, 1);
  setNow("2026-08-20T08:01:00.000Z");
  assert.equal(service.sweep().processed, 1);
  assert.equal(deliveries.length, 1);
});
