import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIlinkRuntime } from "../src/gateway/ilink-runtime.mjs";

test("iLink runtime persists QR login without exposing the bot token", async () => {
  const state = {
    channels: [{ id: "chn_1", provider: "wechat_ilink", ownerTeamId: "team_local", status: "registered" }],
    ilinkAccounts: [],
  };
  const secrets = new Map();
  const credentialStore = {
    save: (id, value) => secrets.set(id, value),
    load: (id) => secrets.get(id) ?? null,
    remove: (id) => secrets.delete(id),
  };
  let id = 0;
  let statusCalls = 0;
  const runtime = createIlinkRuntime({
    state,
    stateStorePath: "/tmp/unused-ilink-state.json",
    now: () => "2026-08-13T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++id}`,
    credentialStore,
    persistStateSoon: () => {},
    clientFactory: () => ({
      getQrCode: async () => ({ ret: 0, qrcode: "qr-1", qrcode_img_content: "https://example.test/qr" }),
      getQrCodeStatus: async () => {
        statusCalls += 1;
        return { ret: 0, status: "confirmed", bot_token: "secret", baseurl: "https://example.test", ilink_bot_id: "bot-1" };
      },
      sendMessage: async () => ({ clientId: "msg-1" }),
    }),
    importChannelEvent: async () => ({ ok: true }),
    mapChannelIdentity: () => ({ ok: true }),
    enableChannel: () => ({ ok: true, body: { channel: state.channels[0] } }),
    disableChannel: () => ({ ok: true, body: { channel: state.channels[0] } }),
  });

  const started = await runtime.beginLogin({ channelId: "chn_1", actor: { userId: "usr_local", teamId: "team_local" } });
  assert.equal(started.body.status, "waiting_scan");
  const confirmed = await runtime.pollLogin({ channelId: "chn_1" });
  assert.equal(statusCalls, 1);
  assert.equal(confirmed.body.status, "authenticated");
  assert.equal(runtime.readiness(state.channels[0]).session, true);
  assert.doesNotMatch(JSON.stringify(state), /secret/);
  assert.equal(secrets.values().next().value.botToken, "secret");
  const sent = await runtime.sendApplicationMessage({ channelId: "chn_1", toUser: "wx-user", content: "hello", replyContext: { contextToken: "ctx" } });
  assert.deepEqual(sent, { ok: true, msgid: "msg-1" });
});

test("iLink QR status polling is single-flight per channel", async () => {
  const state = {
    channels: [{ id: "chn_poll", provider: "wechat_ilink", ownerTeamId: "team_local", status: "registered" }],
    ilinkAccounts: [],
  };
  const credentials = { save: () => {}, load: () => null, remove: () => {} };
  let releaseStatus;
  let statusCalls = 0;
  const statusPending = new Promise((resolve) => { releaseStatus = resolve; });
  const runtime = createIlinkRuntime({
    state,
    stateStorePath: "/tmp/unused-ilink-poll-state.json",
    now: () => "2026-08-13T00:00:00.000Z",
    nextId: (prefix) => prefix + "_poll",
    credentialStore: credentials,
    clientFactory: () => ({
      getQrCode: async () => ({ ret: 0, qrcode: "qr-poll", qrcode_img_content: "qr" }),
      getQrCodeStatus: async () => {
        statusCalls += 1;
        return statusPending;
      },
    }),
    persistStateSoon: () => {},
  });
  await runtime.beginLogin({ channelId: "chn_poll" });
  const first = runtime.pollLogin({ channelId: "chn_poll" });
  const second = runtime.pollLogin({ channelId: "chn_poll" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(statusCalls, 1);
  releaseStatus({ ret: 0, status: "expired" });
  const results = await Promise.all([first, second]);
  assert.equal(results[0].body.status, "expired");
  assert.equal(results[1].body.status, "expired");
});

test("iLink runtime downloads inbound media and passes governed attachment candidates downstream", async () => {
  const state = {
    channels: [{ id: "chn_media", provider: "wechat_ilink", ownerTeamId: "team_local", status: "enabled" }],
    ilinkAccounts: [{
      id: "ila_media", channelId: "chn_media", ownerTeamId: "team_local", ownerUserId: "usr_local",
      status: "connected", cursor: "", botId: "bot-1",
    }],
  };
  const credentials = { load: () => ({ botToken: "secret", baseUrl: "https://example.test" }), save: () => {}, remove: () => {} };
  let runtime;
  let imported;
  let firstPoll = true;
  const runtimeClient = {
    notifyStart: async () => {},
    notifyStop: async () => {},
    getUpdates: async () => {
      if (!firstPoll) return { ret: 0, msgs: [], get_updates_buf: "cursor-2" };
      firstPoll = false;
      runtime.stop();
      return {
        ret: 0,
        get_updates_buf: "cursor-1",
        msgs: [{
          message_id: 99,
          from_user_id: "wx-user",
          message_type: 1,
          context_token: "ctx-media",
          item_list: [{ type: 2, image_item: { media: { encrypt_query_param: "media-param" } } }],
        }],
      };
    },
    downloadMedia: async () => ({ bytes: Buffer.from("png-bytes"), contentType: "image/png" }),
  };
  runtime = createIlinkRuntime({
    state,
    stateStorePath: "/tmp/unused-ilink-media-state.json",
    now: () => "2026-08-13T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_1`,
    credentialStore: credentials,
    clientFactory: () => runtimeClient,
    persistStateSoon: () => {},
    appendEvent: () => {},
    importChannelEvent: async (payload) => { imported = payload; return { ok: true }; },
    mapChannelIdentity: () => ({ ok: true }),
    enableChannel: () => ({ ok: true, body: { channel: state.channels[0] } }),
    disableChannel: () => ({ ok: true, body: { channel: state.channels[0] } }),
  });
  runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(imported.msgType, "image");
  assert.equal(imported.replyContext.contextToken, "ctx-media");
  assert.equal(imported.attachmentCandidates[0].filename, "image-99.png");
  runtime.stop();
});

test("iLink runtime records media failure so the composed channel path can refuse unsafe task creation", async () => {
  const state = {
    channels: [{ id: "chn_media_fail", provider: "wechat_ilink", ownerTeamId: "team_local", status: "enabled" }],
    ilinkAccounts: [{ id: "ila_media_fail", channelId: "chn_media_fail", ownerTeamId: "team_local", status: "connected", cursor: "", botId: "bot-1" }],
  };
  let imported;
  let runtime;
  let firstPoll = true;
  const client = {
    notifyStart: async () => {},
    notifyStop: async () => {},
    getUpdates: async () => {
      if (!firstPoll) return { ret: 0, msgs: [], get_updates_buf: "cursor-2" };
      firstPoll = false;
      runtime.stop();
      return {
        ret: 0,
        get_updates_buf: "cursor-1",
        msgs: [{
          message_id: 100,
          from_user_id: "wx-user",
          message_type: 1,
          item_list: [{ type: 2, image_item: { media: { encrypt_query_param: "missing-media" } } }],
        }],
      };
    },
    downloadMedia: async () => { throw Object.assign(new Error("cdn_timeout"), { code: "cdn_timeout" }); },
  };
  runtime = createIlinkRuntime({
    state,
    stateStorePath: "/tmp/unused-ilink-media-failure-state.json",
    now: () => "2026-08-13T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_1`,
    credentialStore: { load: () => ({ botToken: "secret", baseUrl: "https://example.test" }), save: () => {}, remove: () => {} },
    clientFactory: () => client,
    persistStateSoon: () => {},
    appendEvent: () => {},
    importChannelEvent: async (payload) => { imported = payload; return { ok: true }; },
  });
  runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(imported.mediaFailure.failed[0].code, "cdn_timeout");
  assert.equal(imported.mediaFailure.total, 1);
  assert.equal(imported.attachmentCandidates.length, 0);
  runtime.stop();
});

test("iLink runtime does not restart a worker with a credential that requires reauthentication", () => {
  const state = {
    channels: [{ id: "chn_reauth", provider: "wechat_ilink", ownerTeamId: "team_local", status: "enabled" }],
    ilinkAccounts: [{ id: "ila_reauth", channelId: "chn_reauth", ownerTeamId: "team_local", status: "reauth_required", cursor: "", botId: "bot-1" }],
  };
  let polls = 0;
  const runtime = createIlinkRuntime({
    state,
    stateStorePath: "/tmp/unused-ilink-reauth-state.json",
    now: () => "2026-08-13T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_1`,
    credentialStore: { load: () => ({ botToken: "expired", baseUrl: "https://example.test" }), save: () => {}, remove: () => {} },
    clientFactory: () => ({ getUpdates: async () => { polls += 1; return { ret: 0, msgs: [] }; } }),
    persistStateSoon: () => {},
  });
  runtime.start();
  assert.equal(polls, 0);
  assert.equal(runtime.readiness(state.channels[0]).worker, false);
  runtime.stop();
});

test("iLink worker recovers from a transient poll failure and clears the visible error", async () => {
  const account = { id: "ila_retry", channelId: "chn_retry", ownerTeamId: "team_local", status: "connected", cursor: "", botId: "bot-1" };
  const state = {
    channels: [{ id: "chn_retry", provider: "wechat_ilink", ownerTeamId: "team_local", status: "enabled" }],
    ilinkAccounts: [account],
  };
  let polls = 0;
  let runtime;
  const client = {
    notifyStart: async () => {},
    notifyStop: async () => {},
    getUpdates: async () => {
      polls += 1;
      if (polls === 1) throw Object.assign(new Error("temporary network"), { code: "network_error", retryable: true });
      runtime.stop();
      return { ret: 0, msgs: [], get_updates_buf: "cursor-ok" };
    },
  };
  runtime = createIlinkRuntime({
    state,
    stateStorePath: "/tmp/unused-ilink-retry-state.json",
    now: () => "2026-08-13T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_1`,
    credentialStore: { load: () => ({ botToken: "secret", baseUrl: "https://example.test" }), save: () => {}, remove: () => {} },
    clientFactory: () => client,
    persistStateSoon: () => {},
  });
  runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 2_200));
  assert.equal(polls, 2);
  assert.equal(account.status, "connected");
  assert.equal(account.lastError, null);
  assert.equal(account.workerFailureCount, 0);
  assert.equal(account.cursor, "cursor-ok");
  runtime.stop();
});

test("iLink runtime resolves confined output assets and sends encrypted media with the reply", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "myagenttool-ilink-outbound-"));
  const bytes = Buffer.from("png-output");
  await writeFile(join(projectPath, "result.png"), bytes);
  const state = {
    projects: [{ id: "prj_media", path: projectPath }],
    channels: [{ id: "chn_out", provider: "wechat_ilink", ownerTeamId: "team_local", status: "enabled" }],
    ilinkAccounts: [{ id: "ila_out", channelId: "chn_out", status: "connected", botId: "bot-1" }],
  };
  const sent = [];
  const uploaded = [];
  const credentials = { load: () => ({ botToken: "secret", baseUrl: "https://example.test" }), save: () => {}, remove: () => {} };
  const runtime = createIlinkRuntime({
    state,
    stateStorePath: "/tmp/unused-ilink-outbound-state.json",
    now: () => "2026-08-13T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_1`,
    credentialStore: credentials,
    clientFactory: () => ({
      uploadMedia: async (args) => { uploaded.push(args); return { media: { encrypt_query_param: "uploaded" }, encryptedSize: 16, rawSize: bytes.length, md5: createHash("md5").update(bytes).digest("hex") }; },
      sendMessage: async (args) => { sent.push(args); return { clientId: "msg-out" }; },
    }),
    persistStateSoon: () => {},
    appendEvent: () => {},
    importChannelEvent: async () => ({ ok: true }),
    mapChannelIdentity: () => ({ ok: true }),
    enableChannel: () => ({ ok: true, body: { channel: state.channels[0] } }),
    disableChannel: () => ({ ok: true, body: { channel: state.channels[0] } }),
  });

  const result = await runtime.sendApplicationMessage({
    channelId: "chn_out",
    toUser: "wx-user",
    content: "已生成文件",
    deliveryId: "cdl_1",
    mediaAssets: [{ projectId: "prj_media", path: "result.png", size: bytes.length, hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}` }],
  });
  assert.deepEqual(result, { ok: true, msgid: "msg-out" });
  assert.equal(uploaded[0].mediaType, 1);
  assert.deepEqual(uploaded[0].bytes, bytes);
  assert.equal(sent[0].mediaItems[0].type, 2);
  assert.equal(sent[0].mediaItems[0].image_item.media.encrypt_query_param, "uploaded");
  assert.equal(sent[0].clientId, "cdl_1");
});
