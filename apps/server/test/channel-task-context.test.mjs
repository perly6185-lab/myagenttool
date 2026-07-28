import test from "node:test";
import assert from "node:assert/strict";
import {
  createChannelTaskContext,
  extendChannelTaskContext,
  normalizeChannelAttachmentAssets,
} from "../src/services/channel-task-context.mjs";

const channel = { id: "channel-1" };
const conversation = { id: "conversation-1", channelId: "channel-1" };
const identity = { id: "identity-1", userId: "user-1" };
const asset = {
  id: "asset-1", path: "inbox/source.xlsx", family: "excel",
  hash: "sha256:x", version: "v1", terminalId: "terminal-1", projectId: "project-1",
  readiness: { state: "ready" },
};
const event = {
  id: "event-1", channelId: "channel-1", conversationId: "conversation-1",
  providerMessageId: "provider-message-1", attachmentAssets: [asset],
};

test("binds Channel identity, message, terminal, project, attachments, task, invocation, delivery, and trace", () => {
  const initial = createChannelTaskContext({
    channel, conversation, event, identity, terminalId: "terminal-1", projectId: "project-1",
  });
  const completed = extendChannelTaskContext(initial, {
    workItemId: "task-1", invocationId: "invocation-1", deliveryId: "delivery-1", traceId: "trace-1",
  });
  assert.equal(completed.principalId, "user-1");
  assert.equal(completed.terminalId, "terminal-1");
  assert.equal(completed.attachmentAssets[0].id, "asset-1");
  assert.equal(completed.workItemId, "task-1");
  assert.deepEqual(completed.invocationIds, ["invocation-1"]);
  assert.deepEqual(completed.deliveryIds, ["delivery-1"]);
  assert.equal(completed.traceId, "trace-1");
});

test("attachments must already be governed assets on the bound project and terminal", () => {
  assert.throws(() => normalizeChannelAttachmentAssets([{ name: "raw.xlsx", url: "https://provider/file" }], {
    terminalId: "terminal-1", projectId: "project-1",
  }), /channel_attachment_not_ingested/);
  assert.throws(() => normalizeChannelAttachmentAssets([{ ...asset, terminalId: "terminal-2" }], {
    terminalId: "terminal-1", projectId: "project-1",
  }), /channel_attachment_scope_mismatch/);
  assert.throws(() => normalizeChannelAttachmentAssets([{ ...asset, readiness: { state: "waiting_capability" } }], {
    terminalId: "terminal-1", projectId: "project-1",
  }), /channel_attachment_not_ready/);
});

test("context refuses identity drift and missing explicit task binding", () => {
  assert.throws(() => createChannelTaskContext({
    channel, conversation: { ...conversation, channelId: "other" }, event, identity,
    terminalId: "terminal-1", projectId: "project-1",
  }), /channel_context_mismatch/);
  assert.throws(() => createChannelTaskContext({ channel, conversation, event, identity }), /channel_task_binding_required/);
});
