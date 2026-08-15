import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { createServerState } from "../src/runtime/state-factory.mjs";
import { createChannelConversationService } from "../src/services/channel-conversation.mjs";
import { createChannelDeliveryService } from "../src/services/channel-delivery.mjs";
import { createChannelService } from "../src/services/channels.mjs";

const NOW = "2026-08-14T00:00:00.000Z";
const OWNER = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

function makeJourneyHarness() {
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
      return { ok: true, number: taskCalls.length, localRef: `LOCAL-${taskCalls.length}`, workItemId };
    },
    answerClarify: async (autoRunId, input) => {
      answerCalls.push({ autoRunId, input });
      return {
        resumed: true,
        autoRun: { id: autoRunId, status: "running", invocationId: "inv_resumed" },
        invocation: { id: "inv_resumed", options: { metadata: {} } },
      };
    },
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
