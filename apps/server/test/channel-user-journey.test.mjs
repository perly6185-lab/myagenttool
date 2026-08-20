import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { createServerState } from "../src/runtime/state-factory.mjs";
import { createChannelConversationService } from "../src/services/channel-conversation.mjs";
import { createChannelDeliveryService } from "../src/services/channel-delivery.mjs";
import { createChannelService } from "../src/services/channels.mjs";

const NOW = "2026-08-14T00:00:00.000Z";
const OWNER = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

function makeJourneyHarness({ retryAutoRun = null, riskTask = false, routeChannelTask = null, dismissChannelTask = null } = {}) {
  const { state } = createServerState({ defaultProjectPath: tmpdir(), now: () => NOW });
  const events = [];
  const replies = [];
  const taskCalls = [];
  const answerCalls = [];
  const sent = [];
  let sequence = 0;
  const nextId = (prefix) => `${prefix}_${String(++sequence).padStart(4, "0")}`;
  const projectId = state.projects[0]?.id ?? "prj_local";
  const channelService = createChannelService({
    state,
    now: () => NOW,
    nextId,
    appendEvent: (event) => events.push(event),
    validateApprovalToken: () => ({ approved: true }),
  });
  const conversationService = createChannelConversationService({
    state,
    now: () => NOW,
    nextId,
    appendEvent: (event) => events.push(event),
    refuse: () => {},
    createChannelTaskIssue: async (args) => {
      taskCalls.push(args);
      const workItemId = `wi_${taskCalls.length}`;
      state.workItems.push({
        id: workItemId,
        projectId,
        outputAssets: [],
      });
      return {
        ok: true,
        number: taskCalls.length,
        localRef: `LOCAL-${taskCalls.length}`,
        workItemId,
        ...(riskTask ? {
          autoRoute: false,
          requiresChannelConfirmation: true,
          riskLevel: "external_communication",
          executionPreview: {
            schemaVersion: 1,
            action: "对外发送或发布",
            target: "客户",
            targetStatus: "inferred",
            impact: "可能向外部对象发送或发布内容",
            unknownFields: ["最终发送内容和附件"],
            inputs: [],
            digest: "preview-digest-1",
          },
          previewDigest: "preview-digest-1",
        } : {}),
      };
    },
    answerClarify: async (autoRunId, input) => {
      answerCalls.push({ autoRunId, input });
      return {
        resumed: true,
        autoRun: { id: autoRunId, status: "running", invocationId: "inv_resumed" },
        invocation: { id: "inv_resumed", options: { metadata: {} } },
      };
    },
    retryAutoRun,
    routeChannelTask,
    dismissChannelTask,
    replySender: (reply) => replies.push(reply),
    intakeQuietMs: 1,
  });
  const deliveryService = createChannelDeliveryService({
    state,
    now: () => NOW,
    nextId,
    appendEvent: (event) => events.push(event),
    sendMessage: async (message) => {
      sent.push(message);
      return { ok: true, msgid: `receipt_${sent.length}` };
    },
  });
  const registered = channelService.registerChannel({ provider: "wechat_ilink", name: "journey" }, OWNER);
  const channelId = registered.body.channel.id;
  const channel = state.channels.find((row) => row.id === channelId);
  channel.operationMode = "personal";
  channel.taskAutoRoute = true;
  channel.taskProjectId = projectId;
  channel.taskTerminalId = "dev_local";
  channelService.enableChannel({ channelId, approvalToken: "ok" }, OWNER);
  channelService.mapChannelIdentity({ channelId, externalUserId: "wx_journey", userId: OWNER.userId }, OWNER);

  let messageNumber = 0;
  function receive(content, attachmentAssets = []) {
    const imported = channelService.importChannelEvent({
      channelId,
      providerMessageId: `journey_${++messageNumber}`,
      externalUserId: "wx_journey",
      content,
      attachmentAssets,
    });
    const dispatched = imported.ok
      ? conversationService.dispatchImportedChannelEvent({ eventId: imported.eventId })
      : null;
    return { imported, dispatched };
  }

  return {
    state,
    replies,
    taskCalls,
    answerCalls,
    sent,
    channelId,
    conversationService,
    deliveryService,
    receive,
    projectId,
  };
}

async function createConfirmedTask(harness, content) {
  harness.receive(content);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const confirmed = await harness.receive("确认").dispatched;
  return { confirmed, thread: harness.state.channelTaskThreads.at(-1) };
}

test("iLink ordinary-user journey stays understandable from intake through delivery", async () => {
  const harness = makeJourneyHarness();
  const inboundImage = {
    id: "asset_inbound_image",
    projectId: harness.projectId,
    terminalId: "dev_local",
    path: "inbox/feedback.png",
    family: "image",
    hash: "sha256:feedback",
    version: "v1",
    readiness: { state: "ready" },
  };

  const first = harness.receive("请整理本周客户反馈", [inboundImage]);
  assert.match(first.dispatched.reply, /已收到/);
  harness.receive("重点看重复问题和高优先级");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(harness.replies.some((reply) => /回复“确认”开始/.test(reply.content)));

  const confirmed = await harness.receive("确认").dispatched;
  const firstThread = harness.state.channelTaskThreads[0];
  assert.equal(confirmed.status, "dispatched");
  assert.equal(firstThread.status, "queued");
  assert.equal(harness.taskCalls[0].inputAssets[0].id, inboundImage.id);
  assert.doesNotMatch(confirmed.reply, /T-|LOCAL-|Trace:/);

  harness.receive("另外，请检查部署日志");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const secondConfirmed = await harness.receive("确认").dispatched;
  assert.match(secondConfirmed.reply, /前面还有 1 个任务/);
  assert.doesNotMatch(secondConfirmed.reply, /T-|LOCAL-|Trace:/);

  harness.state.autoRuns.push({
    id: "run_first",
    status: "needs_input",
    invocationId: "inv_first",
    report: "请补充目标环境",
  });
  const waiting = harness.conversationService.syncTaskThreadFromInvocation({
    id: "inv_first",
    status: "succeeded",
    result: { summary: "请补充目标环境" },
    options: { metadata: { channel: {
      channelId: harness.channelId,
      conversationId: firstThread.conversationId,
      threadId: firstThread.id,
      autoRunId: "run_first",
    } } },
  });
  assert.equal(waiting.status, "waiting_user");
  const selected = harness.receive("继续第一个任务").dispatched;
  assert.match(selected.reply, /已切换到 这个任务/);
  assert.equal(harness.state.channelConversations[0].activeTaskThreadId, firstThread.id);
  const answered = await harness.receive("目标环境是生产环境").dispatched;
  assert.match(answered.reply, /继续执行/);
  assert.equal(harness.answerCalls[0].input.answers, "目标环境是生产环境");

  harness.state.autoRuns[0].status = "succeeded";
  harness.state.workItems[0].outputAssets.push({
    id: "asset_outbound_report",
    projectId: harness.projectId,
    path: "deliveries/feedback-report.pdf",
    family: "pdf",
    size: 42,
  });
  const completedInvocation = {
    id: "inv_completed",
    status: "succeeded",
    result: { summary: "已完成整理" },
    options: { metadata: { channel: {
      channelId: harness.channelId,
      conversationId: firstThread.conversationId,
      threadId: firstThread.id,
      workItemId: firstThread.workItemId,
      traceId: "trace_internal_only",
    } } },
  };
  const synced = harness.conversationService.syncTaskThreadFromInvocation(completedInvocation);
  assert.equal(synced.status, "succeeded");
  const queued = harness.deliveryService.notifyInvocationCompleted(completedInvocation);
  assert.equal(queued.ok, true);
  await harness.deliveryService.sweepChannelDeliveries();
  assert.equal(harness.sent.length, 1);
  assert.match(harness.sent[0].content, /任务已完成/);
  assert.match(harness.sent[0].content, /已完成整理/);
  assert.doesNotMatch(harness.sent[0].content, /T-|LOCAL-|trace_internal_only|Trace:/);
  assert.equal(harness.sent[0].mediaAssets[0].path, "deliveries/feedback-report.pdf");
});

test("iLink ordinary-user journey keeps image, voice, and file inputs in one task", async () => {
  const harness = makeJourneyHarness();
  const assets = [
    { id: "asset_image", projectId: harness.projectId, terminalId: "dev_local", path: "inbox/photo.png", family: "image", hash: "sha256:image", version: "v1", readiness: { state: "ready" } },
    { id: "asset_voice", projectId: harness.projectId, terminalId: "dev_local", path: "inbox/note.mp3", family: "audio", hash: "sha256:voice", version: "v1", readiness: { state: "ready" } },
    { id: "asset_file", projectId: harness.projectId, terminalId: "dev_local", path: "inbox/data.csv", family: "file", hash: "sha256:file", version: "v1", readiness: { state: "ready" } },
  ];
  const received = harness.receive("请处理这些附件", assets);
  assert.equal(received.dispatched.status, "dispatched");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const confirmed = await harness.receive("确认").dispatched;
  assert.equal(confirmed.status, "dispatched");
  assert.deepEqual(harness.taskCalls[0].inputAssets.map((asset) => asset.id), ["asset_image", "asset_voice", "asset_file"]);
  assert.equal(harness.state.channelTaskThreads[0].messages.length, 1);
});

test("iLink high-risk task pauses before execution and resumes from the same channel confirmation", async () => {
  const routeCalls = [];
  const harness = makeJourneyHarness({
    riskTask: true,
    routeChannelTask: async (requestId) => {
      routeCalls.push(requestId);
      const request = harness.state.channelTaskRequests.find((candidate) => candidate.id === requestId);
      request.status = "routed";
      return { status: 200, body: { ok: true, workItemId: request.workItemId } };
    },
  });

  harness.receive("请把报价单发给客户");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const created = await harness.receive("确认").dispatched;
  const thread = harness.state.channelTaskThreads[0];

  assert.equal(created.status, "dispatched");
  assert.equal(thread.status, "waiting_approval");
  assert.equal(thread.waitingFor, "channel_confirmation");
  assert.match(created.reply, /确认无误回复“确认”/);
  assert.match(created.reply, /对象：客户/);
  assert.equal(thread.riskPreviewDigest, "preview-digest-1");
  assert.equal(harness.state.channelTaskRequests[0].status, "pending");

  harness.state.channelTaskRequests[0].previewDigest = "changed-after-preview";
  const stale = await harness.receive("确认执行").dispatched;
  assert.equal(stale.status, "refused");
  assert.match(stale.reply, /预览已经变化/);
  assert.equal(thread.status, "waiting_approval");
  harness.state.channelTaskRequests[0].previewDigest = "preview-digest-1";
  const resumed = await harness.receive("确认执行").dispatched;
  assert.equal(resumed.status, "dispatched");
  assert.equal(thread.status, "queued");
  assert.equal(thread.waitingFor, null);
  assert.equal(routeCalls.length, 1);
  assert.match(resumed.reply, /任务已收录|即将开始/);

  const duplicate = await harness.receive("确认执行").dispatched;
  assert.equal(duplicate.status, "dispatched");
  assert.match(duplicate.reply, /已经在执行队列|进度/);
  assert.equal(routeCalls.length, 1);
});

test("iLink high-risk task cancellation clears the pending route", async () => {
  const dismissCalls = [];
  const harness = makeJourneyHarness({
    riskTask: true,
    dismissChannelTask: async (requestId) => {
      dismissCalls.push(requestId);
      const request = harness.state.channelTaskRequests.find((candidate) => candidate.id === requestId);
      request.status = "dismissed";
      return { status: 200, body: { ok: true } };
    },
  });

  harness.receive("请把报价单发给客户");
  await new Promise((resolve) => setTimeout(resolve, 10));
  await harness.receive("确认").dispatched;
  assert.equal(harness.state.channelTaskThreads[0].waitingFor, "channel_confirmation");
  const cancelled = await harness.receive("取消").dispatched;

  assert.equal(cancelled.status, "dispatched");
  assert.equal(dismissCalls.length, 1);
  assert.equal(harness.state.channelTaskThreads[0].status, "cancelled");
  assert.equal(harness.state.channelTaskRequests[0].status, "dismissed");
  assert.match(cancelled.reply, /已取消/);
});

test("iLink high-risk preview is invalidated when the user changes the request", async () => {
  const dismissCalls = [];
  const harness = makeJourneyHarness({
    riskTask: true,
    dismissChannelTask: async (requestId) => {
      dismissCalls.push(requestId);
      const request = harness.state.channelTaskRequests.find((candidate) => candidate.id === requestId);
      request.status = "dismissed";
      return { status: 200, body: { ok: true } };
    },
  });

  harness.receive("请把报价单发给客户");
  await new Promise((resolve) => setTimeout(resolve, 10));
  await harness.receive("确认").dispatched;
  const revised = await harness.receive("补充一下，收件人改为供应商").dispatched;
  const thread = harness.state.channelTaskThreads[0];

  assert.equal(revised.status, "dispatched");
  assert.equal(thread.status, "awaiting_confirmation");
  assert.equal(thread.taskRevision, 1);
  assert.equal(harness.state.channelTaskRequests[0].status, "dismissed");
  assert.equal(dismissCalls.length, 1);
  assert.match(revised.reply, /预览已失效/);

  await harness.receive("确认").dispatched;
  assert.equal(harness.taskCalls.length, 2);
  assert.equal(thread.status, "waiting_approval");
  assert.equal(thread.riskPreviewDigest, "preview-digest-1");
  assert.equal(harness.state.channelTaskRequests.filter((request) => request.status === "pending").length, 1);
});

test("iLink multi-task results stay correlated when tasks complete out of order", async () => {
  const harness = makeJourneyHarness();
  const first = await createConfirmedTask(harness, "请写第一篇公众号文章");
  const second = await createConfirmedTask(harness, "另外 写第二篇公众号文章");
  assert.equal(first.thread.status, "queued");
  assert.equal(second.thread.status, "queued");

  const secondInvocation = {
    id: "inv_second_done",
    status: "succeeded",
    result: { summary: "第二批反馈已完成" },
    options: { metadata: { channel: {
      channelId: harness.channelId,
      conversationId: second.thread.conversationId,
      threadId: second.thread.id,
      workItemId: second.thread.workItemId,
    } } },
  };
  const secondSync = harness.conversationService.syncTaskThreadFromInvocation(secondInvocation);
  assert.equal(secondSync.status, "succeeded");
  assert.equal(first.thread.status, "queued");
  assert.equal(harness.deliveryService.notifyInvocationCompleted(secondInvocation).ok, true);
  await harness.deliveryService.sweepChannelDeliveries();
  assert.equal(harness.sent.length, 1);
  assert.match(harness.sent[0].content, /第二批反馈已完成/);
  assert.equal(harness.state.channelDeliveries.at(-1).taskContext.threadId, second.thread.id);

  const firstInvocation = {
    id: "inv_first_done",
    status: "succeeded",
    result: { summary: "第一批反馈已完成" },
    options: { metadata: { channel: {
      channelId: harness.channelId,
      conversationId: first.thread.conversationId,
      threadId: first.thread.id,
      workItemId: first.thread.workItemId,
    } } },
  };
  const firstSync = harness.conversationService.syncTaskThreadFromInvocation(firstInvocation);
  assert.equal(firstSync.status, "succeeded");
  assert.equal(harness.deliveryService.notifyInvocationCompleted(firstInvocation).ok, true);
  await harness.deliveryService.sweepChannelDeliveries();
  assert.equal(harness.sent.length, 2);
  assert.match(harness.sent[1].content, /第一批反馈已完成/);
  assert.equal(harness.state.channelDeliveries.at(-1).taskContext.threadId, first.thread.id);
  assert.notEqual(harness.state.channelDeliveries[0].taskContext.threadId, harness.state.channelDeliveries[1].taskContext.threadId);
});

test("iLink failed task can be retried and its retry result is delivered once", async () => {
  const retryCalls = [];
  const harness = makeJourneyHarness({
    retryAutoRun: async (autoRunId) => {
      retryCalls.push(autoRunId);
      return {
        autoRun: { id: autoRunId, status: "running", invocationId: "inv_retry" },
        invocation: { id: "inv_retry", options: { metadata: {} } },
      };
    },
  });
  const task = await createConfirmedTask(harness, "请检查失败的部署");
  harness.state.autoRuns.push({ id: "run_failed", status: "failed", invocationId: "inv_failed", error: "部署失败" });
  const failedInvocation = {
    id: "inv_failed",
    status: "failed",
    result: { summary: "部署失败" },
    options: { metadata: { channel: {
      channelId: harness.channelId,
      conversationId: task.thread.conversationId,
      threadId: task.thread.id,
      workItemId: task.thread.workItemId,
      autoRunId: "run_failed",
    } } },
  };
  assert.equal(harness.conversationService.syncTaskThreadFromInvocation(failedInvocation).status, "failed");
  assert.equal(harness.deliveryService.notifyInvocationCompleted(failedInvocation).ok, true);
  await harness.deliveryService.sweepChannelDeliveries();
  assert.match(harness.sent[0].content, /失败/);
  assert.match(harness.sent[0].content, /重试/);

  const retried = await harness.receive("重试").dispatched;
  assert.match(retried.reply, /正在重试这个任务/);
  assert.deepEqual(retryCalls, ["run_failed"]);
  assert.equal(task.thread.status, "running");
  assert.equal(task.thread.invocationId, "inv_retry");
  assert.equal(task.thread.lastProgressNotificationKey, `${task.thread.id}:inv_retry:running`);
  assert.equal(harness.state.channelIntentMetrics.experience.retryStartDuplicatesSuppressed, 1);

  harness.state.autoRuns[0].status = "succeeded";
  const retryInvocation = {
    id: "inv_retry",
    status: "succeeded",
    result: { summary: "部署重试成功" },
    options: { metadata: { channel: {
      channelId: harness.channelId,
      conversationId: task.thread.conversationId,
      threadId: task.thread.id,
      workItemId: task.thread.workItemId,
      autoRunId: "run_failed",
    } } },
  };
  assert.equal(harness.conversationService.syncTaskThreadFromInvocation(retryInvocation).status, "succeeded");
  assert.equal(harness.deliveryService.notifyInvocationCompleted(retryInvocation).ok, true);
  await harness.deliveryService.sweepChannelDeliveries();
  assert.equal(harness.sent.length, 2);
  assert.match(harness.sent[1].content, /部署重试成功/);
  assert.equal(new Set(harness.state.channelDeliveries.map((delivery) => delivery.taskContext.threadId)).size, 1);
});

test("iLink restart recovery reconciles completed work and requeues unfinished tasks together", async () => {
  const harness = makeJourneyHarness();
  const first = await createConfirmedTask(harness, "请恢复第一项任务");
  const second = await createConfirmedTask(harness, "另外 第二项任务");
  const third = await createConfirmedTask(harness, "另外 第三项任务");
  first.thread.status = "running";
  second.thread.status = "running";
  third.thread.status = "queued";
  first.thread.invocationId = "inv_restart_done";
  harness.state.invocations.push({
    id: "inv_restart_done",
    status: "succeeded",
    result: { summary: "第一项已在重启前完成" },
    options: { metadata: { channel: {
      channelId: harness.channelId,
      conversationId: first.thread.conversationId,
      threadId: first.thread.id,
      workItemId: first.thread.workItemId,
    } } },
  });

  const recovery = harness.conversationService.recoverTaskThreads();
  assert.equal(recovery.reconciled, 1);
  assert.equal(recovery.requeued, 1);
  assert.equal(first.thread.status, "succeeded");
  assert.equal(second.thread.status, "queued");
  assert.equal(third.thread.status, "queued");
  assert.equal(second.thread.queuePosition, 1);
  assert.equal(third.thread.queuePosition, 2);
  assert.equal(second.thread.queueAheadCount, 0);
  assert.equal(third.thread.queueAheadCount, 1);
});
