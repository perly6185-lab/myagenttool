/*
 * Regression tests for the code-review hardening pass (#1126). Each test pins a
 * specific finding's fix.
 */

import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { extractXmlFields } from "../src/gateway/wecom-crypto.mjs";
import { readCappedBody } from "../src/gateway/read-body.mjs";
import { createDingtalkClient } from "../src/gateway/dingtalk-client.mjs";
import { createWecomClient } from "../src/gateway/wecom-client.mjs";
import { createFeishuClient } from "../src/gateway/feishu-client.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createChannelService } from "../src/services/channels.mjs";
import { createChannelConversationService } from "../src/services/channel-conversation.mjs";
import { createChannelDeliveryService } from "../src/services/channel-delivery.mjs";

const NOW = "2026-07-16T00:00:00.000Z";
const owner = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

function dispatchHarness() {
  const { state } = createServerState({ defaultProjectPath: tmpdir(), now: () => NOW });
  state.teams.push({ id: "team_b", name: "B", createdAt: NOW });
  state.users.push({ id: "usr_b", name: "B", teamId: "team_b", createdAt: NOW });
  const refusals = [];
  const capCalls = [];
  let counter = 0;
  const nextId = (p) => `${p}_${String(++counter).padStart(4, "0")}`;
  const channels = createChannelService({
    state, now: () => NOW, nextId, appendEvent: () => {}, validateApprovalToken: () => ({ approved: true }),
    refuse: (r) => refusals.push(r),
  });
  const conv = createChannelConversationService({
    state, now: () => NOW, nextId, appendEvent: () => {}, refuse: (r) => refusals.push(r),
    createCapabilityInvocation: (name, input, actor) => {
      capCalls.push({ name, actor });
      const inv = { id: nextId("inv"), status: "queued", options: { metadata: {} } };
      state.invocations.push(inv);
      return { status: 202, body: { invocation: inv } };
    },
    cancelInvocation: () => ({ status: 200, body: {} }),
  });
  const { body } = channels.registerChannel({ provider: "wecom", name: "ops" }, owner);
  const channelId = body.channel.id;
  channels.enableChannel({ channelId, approvalToken: "ok" }, owner);
  channels.setChannelAllowlist({ channelId, capabilities: ["git.status"], approvalToken: "ok" }, owner);
  channels.mapChannelIdentity({ channelId, externalUserId: "wx_a", userId: "usr_local" }, owner);
  let seq = 0;
  function receive(content) {
    const imported = channels.importChannelEvent({ channelId, providerMessageId: `m_${++seq}`, externalUserId: "wx_a", content });
    return conv.dispatchImportedChannelEvent({ eventId: imported.eventId });
  }
  return { state, refusals, capCalls, channelId, receive };
}

test("H1: dispatch fails closed when the mapped user was deleted", () => {
  const h = dispatchHarness();
  // Delete the mapped user out from under the (still-present) identity row.
  h.state.users = h.state.users.filter((u) => u.id !== "usr_local");
  const r = h.receive("/run git.status");
  assert.equal(r.status, "refused");
  assert.equal(h.capCalls.length, 0, "no capability dispatched as a fallback owner actor");
  assert.equal(h.refusals.at(-1).code, "action_not_permitted");
});

test("H1: dispatch fails closed when the mapped user moved to another team", () => {
  const h = dispatchHarness();
  const u = h.state.users.find((x) => x.id === "usr_local");
  u.teamId = "team_b"; // drift: user no longer in the channel's team
  const r = h.receive("/run git.status");
  assert.equal(r.status, "refused");
  assert.equal(h.capCalls.length, 0);
  assert.equal(h.refusals.at(-1).code, "action_not_permitted");
});

test("H1: a valid same-team mapping still dispatches", () => {
  const h = dispatchHarness();
  const r = h.receive("/run git.status");
  assert.equal(r.ok, true);
  assert.equal(h.capCalls.length, 1);
});

test("H2: DingTalk transient 5xx (no machine code) is retryable, not terminal", async () => {
  const client = createDingtalkClient({
    appKey: "k", appSecret: "s", robotCode: "r",
    now: () => 1_800_000_000_000,
    httpJson: async (url) => {
      if (url.includes("accessToken")) return { status: 200, json: { accessToken: "t", expireIn: 7200 } };
      return { status: 503, json: {} }; // maintenance / LB blip, HTML body → json {}
    },
  });
  const res = await client.sendApplicationMessage({ toUser: "u", content: "x" });
  assert.equal(res.ok, false);
  assert.equal(res.retryable, true, "a 5xx with no code must retry, not drop the delivery");
  assert.equal(res.errcode, "503");
});

test("M1: attemptDelivery will not re-send a row that is not queued/retrying (CAS)", async () => {
  const clockMs = 1_800_000_000_000;
  const { state } = createServerState({ defaultProjectPath: tmpdir(), now: () => new Date(clockMs).toISOString() });
  let sent = 0;
  const svc = createChannelDeliveryService({
    state, now: () => new Date(clockMs).toISOString(), nextId: (p) => `${p}_1`, appendEvent: () => {},
    resolveSender: () => async () => { sent += 1; return { ok: true, msgid: "m" }; },
  });
  // A row already delivered by a prior (overlapping) sweep pass.
  const delivered = { id: "chdl_1", channelId: "chn_x", conversationId: "chcv_x", status: "delivered", attempts: 1, toUser: "u", content: "x" };
  state.channelDeliveries.push(delivered);
  const out = await svc.attemptDelivery(delivered);
  assert.equal(out.skipped, true);
  assert.equal(sent, 0, "a non-queued row is never sent again");
  assert.equal(delivered.attempts, 1, "attempts not double-counted");
});

test("M2: extractXmlFields is correct for CDATA containing a closing tag, and stays fast on pathological input", () => {
  // CDATA content that itself contains `</Encrypt>` must be extracted whole
  // (CDATA end is `]]>`, not the close tag).
  const xml = "<Encrypt><![CDATA[abc</Encrypt>def]]></Encrypt>";
  assert.equal(extractXmlFields(xml, ["Encrypt"]).Encrypt, "abc</Encrypt>def");

  // Entity-decoded non-CDATA path still works.
  assert.equal(extractXmlFields("<A>x &amp; y</A>", ["A"]).A, "x & y");

  // Pathological: thousands of unclosed <Encrypt> tags. The old lazy-alternation
  // regex was ~O(n²); indexOf scanning is linear — this returns promptly.
  const hostile = "<Encrypt>".repeat(8000);
  const started = process.hrtime.bigint();
  const out = extractXmlFields(hostile, ["Encrypt"]);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(out.Encrypt, undefined, "no complete field → not extracted");
  assert.ok(elapsedMs < 50, `extraction should be linear/fast, took ${elapsedMs}ms`);
});

test("M3: readCappedBody decodes multibyte split across chunks and caps by BYTES", async () => {
  // A 3-byte UTF-8 char (中 = e4 b8 ad) split across two TCP chunks.
  const zhong = Buffer.from("中", "utf8");
  const reqSplit = { async *[Symbol.asyncIterator]() { yield zhong.subarray(0, 1); yield zhong.subarray(1); } };
  const { raw, overflow } = await readCappedBody(reqSplit, 1024);
  assert.equal(overflow, false);
  assert.equal(raw, "中", "a multibyte char split across chunks decodes correctly");

  // Byte cap: 3 two-byte-ish chars over a 4-byte cap overflow even though the
  // char length is small.
  const reqBig = { async *[Symbol.asyncIterator]() { yield Buffer.from("中中中", "utf8"); } }; // 9 bytes
  assert.equal((await readCappedBody(reqBig, 4)).overflow, true);
});

test("LOW: WeCom and Feishu clients refuse to cache an empty access token", async () => {
  const wecom = createWecomClient({
    corpId: "c", corpSecret: "s", agentId: "1", now: () => 0,
    httpJson: async () => ({ errcode: 0, access_token: "" }), // success code, no token
  });
  await assert.rejects(() => wecom.getAccessToken(), /wecom_token_fetch_failed/);

  const feishu = createFeishuClient({
    appId: "a", appSecret: "s", now: () => 0,
    httpJson: async () => ({ code: 0, tenant_access_token: "" }),
  });
  await assert.rejects(() => feishu.getAccessToken(), /feishu_token_fetch_failed/);
});

// The /approve TTL fail-closed + approve-not-applied fixes are exercised in
// channel-approval.test.mjs (which owns the full grant harness).
