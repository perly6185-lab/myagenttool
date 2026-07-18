import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { computeMsgSignature, encryptWecomMessage } from "../../src/gateway/wecom-crypto.mjs";
import { createWecomGateway } from "../../src/gateway/wecom-gateway.mjs";
import { createServerState } from "../../src/runtime/state-factory.mjs";
import { createChannelConversationService } from "../../src/services/channel-conversation.mjs";
import { createChannelDeliveryService } from "../../src/services/channel-delivery.mjs";
import { createChannelService } from "../../src/services/channels.mjs";

const NOW_MS = 1_800_000_000_000;
const NOW = new Date(NOW_MS).toISOString();
const TOKEN = "acceptance-token";
const AES_KEY = randomBytes(32).toString("base64").slice(0, 43);
const CORP_ID = "ww_acceptance_corp";
const owner = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

test("WeCom signed message reaches governed Invocation and delivers its final result exactly once", async () => {
  const { state } = createServerState({ defaultProjectPath: tmpdir(), now: () => NOW });
  const events = [];
  const sent = [];
  let counter = 0;
  const nextId = (prefix) => `${prefix}_${++counter}`;
  const channels = createChannelService({ state, now: () => NOW, nextId, appendEvent: (event) => events.push(event), validateApprovalToken: () => ({ approved: true }) });
  let invocation;
  const conversations = createChannelConversationService({
    state, now: () => NOW, nextId, appendEvent: (event) => events.push(event), refuse: () => {},
    createCapabilityInvocation: (name) => {
      invocation = { id: nextId("inv"), status: "succeeded", input: { task: name }, options: { metadata: { capability: name } }, result: { summary: "Repository is clean and ready." }, createdAt: NOW, updatedAt: NOW };
      state.invocations.push(invocation);
      return { status: 202, body: { invocation } };
    },
  });
  const delivery = createChannelDeliveryService({ state, now: () => NOW, nextId, appendEvent: (event) => events.push(event), sendMessage: async (message) => { sent.push(message); return { ok: true, msgid: `receipt_${sent.length}` }; } });

  const registered = channels.registerChannel({ provider: "wecom", name: "acceptance" }, owner);
  const channelId = registered.body.channel.id;
  channels.enableChannel({ channelId, approvalToken: "ok" }, owner);
  channels.setChannelAllowlist({ channelId, capabilities: ["git.status"], approvalToken: "ok" }, owner);
  channels.mapChannelIdentity({ channelId, externalUserId: "wx_acceptance", userId: "usr_local" }, owner);

  const receive = async (payload) => {
    const imported = channels.importChannelEvent(payload);
    if (imported.ok && !imported.duplicate) {
      const dispatched = await conversations.dispatchImportedChannelEvent({ eventId: imported.eventId });
      if (dispatched.reply) delivery.enqueueChannelDelivery({ channelId, conversationId: imported.conversationId, invocationId: dispatched.invocationId, content: dispatched.reply });
    }
    return imported;
  };
  const gateway = createWecomGateway({ token: TOKEN, encodingAesKey: AES_KEY, receiveId: CORP_ID, channelId, importChannelEvent: receive, now: () => NOW_MS });
  const inner = `<xml><ToUserName><![CDATA[${CORP_ID}]]></ToUserName><FromUserName><![CDATA[wx_acceptance]]></FromUserName><CreateTime>1800000000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[/run git.status]]></Content><MsgId>acceptance_1</MsgId></xml>`;
  const encrypted = encryptWecomMessage({ encodingAesKey: AES_KEY, message: inner, receiveId: CORP_ID });
  const timestamp = String(NOW_MS / 1000);
  const nonce = "acceptance-nonce";
  const signature = computeMsgSignature(TOKEN, timestamp, nonce, encrypted);
  const body = `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`;
  const req = { method: "POST", url: `/wecom/callback?msg_signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`, async *[Symbol.asyncIterator]() { yield body; } };

  const first = fakeRes();
  await gateway.handleRequest(req, first);
  assert.equal(first.statusCode, 200);
  assert.equal(state.invocations.length, 1);
  assert.equal(invocation.options.metadata.channel.channelId, channelId);
  await delivery.sweepChannelDeliveries();
  delivery.notifyInvocationCompleted(invocation);
  await delivery.sweepChannelDeliveries();
  assert.equal(state.channelDeliveries.filter((item) => item.status === "delivered").length, 2);
  assert.ok(sent.some((item) => item.content.includes("Repository is clean and ready.")));

  const replay = fakeRes();
  await gateway.handleRequest(req, replay);
  assert.equal(replay.statusCode, 400);
  assert.equal(state.invocations.length, 1, "a replay never creates a second effective execution");
});

function fakeRes() {
  return { statusCode: null, body: "", writeHead(status) { this.statusCode = status; }, end(chunk) { this.body += chunk ?? ""; } };
}
