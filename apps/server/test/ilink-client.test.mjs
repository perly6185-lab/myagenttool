import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import test from "node:test";
import { createIlinkClient, ilinkMediaCandidates, messageIdFromIlinkMessage, textFromIlinkMessage } from "../src/gateway/ilink-client.mjs";

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

test("iLink client uses QR GET, authenticated long-poll, and sendmessage envelopes", async () => {
  const calls = [];
  const client = createIlinkClient({
    token: "bot-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("get_bot_qrcode")) return response({ ret: 0, qrcode: "qr-1", qrcode_img_content: "https://liteapp.weixin.qq.com/q/qr-1" });
      if (url.includes("getupdates")) return response({ ret: 0, msgs: [], get_updates_buf: "cursor-2" });
      return response({ ret: 0 });
    },
  });

  const qr = await client.getQrCode();
  const updates = await client.getUpdates({ cursor: "cursor-1", timeoutMs: 100 });
  const sent = await client.sendMessage({ toUser: "wx-user", content: "hello", contextToken: "ctx-1", clientId: "cdl_1" });

  assert.equal(qr.qrcode, "qr-1");
  assert.equal(updates.get_updates_buf, "cursor-2");
  assert.equal(sent.clientId, "cdl_1");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].options.headers.Authorization, "Bearer bot-secret");
  const updateBody = JSON.parse(calls[1].options.body);
  assert.equal(updateBody.get_updates_buf, "cursor-1");
  const sendBody = JSON.parse(calls[2].options.body);
  assert.deepEqual(sendBody.base_info, { channel_version: "1.0.0", bot_agent: "MyAgentTool/1.0.0" });
  assert.equal(sendBody.msg.to_user_id, "wx-user");
  assert.equal(sendBody.msg.context_token, "ctx-1");
  assert.equal(sendBody.msg.client_id, "cdl_1");
  assert.equal(sendBody.msg.item_list[0].text_item.text, "hello");
  assert.equal(sendBody.msg.message_type, 2);
});

test("iLink client rejects an HTTP-success response without a protocol ret code", async () => {
  const client = createIlinkClient({
    fetchImpl: async () => response({}),
  });
  await assert.rejects(
    () => client.sendMessage({ toUser: "wx-user", content: "hello" }),
    (error) => error.code === "invalid_response" && error.retryable === true,
  );
});

test("iLink media transfers abort on timeout and remain retryable", async () => {
  const client = createIlinkClient({
    mediaTimeoutMs: 5,
    fetchImpl: async (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  });
  await assert.rejects(
    () => client.downloadMedia({ media: { encrypt_query_param: "slow" } }),
    (error) => error.code === "media_download_timeout" && error.retryable === true,
  );
});

test("iLink client encrypts, uploads, and sends outbound media using the CDN contract", async () => {
  const calls = [];
  const client = createIlinkClient({
    token: "bot-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("getuploadurl")) return response({ ret: 0, upload_param: "upload-param", upload_full_url: "https://novac2c.cdn.weixin.qq.com/c2c/upload?presigned=1" });
      if (url.includes("/c2c/upload")) return {
        ok: true,
        status: 200,
        headers: { get: (name) => name === "x-encrypted-param" ? "uploaded-param" : null },
      };
      return response({ ret: 0 });
    },
  });

  const uploaded = await client.uploadMedia({ toUser: "wx-user", mediaType: 3, bytes: Buffer.from("file-bytes"), filename: "report.txt" });
  assert.equal(uploaded.rawSize, 10);
  assert.equal(Buffer.from(uploaded.media.aes_key, "base64").length, 16);
  const uploadCall = calls.find((call) => call.url.includes("/c2c/upload"));
  assert.equal(uploadCall.options.method, "PUT");
  assert.deepEqual(JSON.parse(calls.find((call) => call.url.includes("getuploadurl")).options.body), {
    filekey: uploaded.md5,
    media_type: 3,
    to_user_id: "wx-user",
    rawsize: 10,
    rawfilemd5: uploaded.md5,
    filesize: uploaded.encryptedSize,
    no_need_thumb: true,
    aeskey: Buffer.from(uploaded.media.aes_key, "base64").toString("hex"),
    base_info: { channel_version: "1.0.0", bot_agent: "MyAgentTool/1.0.0" },
  });

  await client.sendMessage({
    toUser: "wx-user",
    content: "附件如下",
    mediaItems: [{ type: 4, file_item: { media: uploaded.media, file_name: uploaded.filename, len: String(uploaded.rawSize), md5: uploaded.md5 } }],
  });
  const sendCall = calls.at(-1);
  const sendBody = JSON.parse(sendCall.options.body);
  assert.equal(sendBody.msg.message_type, 2);
  assert.equal(sendBody.msg.item_list[1].file_item.file_name, "report.txt");
  assert.equal(sendBody.msg.item_list[1].file_item.media.encrypt_query_param, "uploaded-param");
});

test("iLink message normalization only extracts text items", () => {
  const message = {
    message_id: 42,
    item_list: [{ type: 2, image_item: {} }, { type: 1, text_item: { text: "hello" } }, { type: 1, text_item: { text: "world" } }],
  };
  assert.equal(textFromIlinkMessage(message), "hello\nworld");
  assert.equal(messageIdFromIlinkMessage(message), "42");
});

test("iLink media normalization and download decrypt AES-128-ECB media", async () => {
  const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const cipher = createCipheriv("aes-128-ecb", key, null);
  const encrypted = Buffer.concat([cipher.update(Buffer.from("image-bytes")), cipher.final()]);
  const media = ilinkMediaCandidates({
    message_id: 43,
    item_list: [
      { type: 2, image_item: { aeskey: key.toString("hex"), media: { encrypt_query_param: "encrypted-param" } } },
      { type: 3, voice_item: { text: "语音转写", encode_type: 6, media: { encrypt_query_param: "voice-param" } } },
      { type: 4, file_item: { file_name: "report.pdf", media: { encrypt_query_param: "file-param" } } },
    ],
  });
  assert.deepEqual(media.map((candidate) => candidate.kind), ["image", "voice", "file"]);
  assert.equal(media[1].voiceText, "语音转写");
  assert.equal(media[2].filename, "report.pdf");
  assert.equal(ilinkMediaCandidates({ item_list: [{ type: 3, voice_item: { text: "只有转写，没有媒体" } }] })[0].voiceText, "只有转写，没有媒体");

  const client = createIlinkClient({
    fetchImpl: async (url) => {
      assert.match(url, /encrypted_query_param=encrypted-param/);
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name === "content-type" ? "image/jpeg" : null },
        body: new Response(encrypted).body,
      };
    },
  });
  const downloaded = await client.downloadMedia({ media: media[0].media, aesKey: media[0].aesKey });
  assert.equal(downloaded.contentType, "image/jpeg");
  assert.deepEqual(downloaded.bytes, Buffer.from("image-bytes"));
});
