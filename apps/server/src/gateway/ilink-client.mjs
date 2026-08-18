import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

export const ILINK_API_BASE = "https://ilinkai.weixin.qq.com";
export const ILINK_CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";
// Keep these wire identifiers aligned with Tencent's current
// @tencent-weixin/openclaw-weixin client. The application name is carried in
// bot_agent for observability; iLink-App-Id is the protocol app identifier.
export const ILINK_APP_ID = "bot";
export const ILINK_PROTOCOL_VERSION = "2.4.6";
export const ILINK_CHANNEL_VERSION = ILINK_PROTOCOL_VERSION;
export const ILINK_BOT_AGENT = "MyAgentTool/0.2.0";
export const MAX_ILINK_MEDIA_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MEDIA_TRANSFER_TIMEOUT_MS = 30_000;

export class IlinkApiError extends Error {
  constructor(message, { code = "ilink_api_error", status = 0, retryable = false, authExpired = false } = {}) {
    super(message);
    this.name = "IlinkApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.authExpired = authExpired;
  }
}

function normalizeBaseUrl(value) {
  return String(value || ILINK_API_BASE).replace(/\/+$/, "");
}

function randomWechatUin() {
  return Buffer.from(String(randomBytes(4).readUInt32BE(0)), "utf8").toString("base64");
}

function numericClientVersion(version) {
  const parts = String(version ?? "0.0.0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  return ((parts[0] & 0xff) << 16) | ((parts[1] & 0xff) << 8) | (parts[2] & 0xff);
}

export const ILINK_APP_CLIENT_VERSION = numericClientVersion(ILINK_PROTOCOL_VERSION);

function baseHeaders({ token = null, appId = ILINK_APP_ID, clientVersion = ILINK_APP_CLIENT_VERSION } = {}) {
  const headers = {
    "content-type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    "iLink-App-Id": appId,
    "iLink-App-ClientVersion": String(clientVersion),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readJson(response, label) {
  const raw = await response.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    throw new IlinkApiError(`${label}: invalid JSON response`, {
      code: "invalid_json",
      status: response.status,
      retryable: response.status >= 500,
    });
  }
  if (!response.ok) {
    const authExpired = response.status === 401 || response.status === 403;
    throw new IlinkApiError(`${label}: HTTP ${response.status}`, {
      code: authExpired ? "auth_expired" : `http_${response.status}`,
      status: response.status,
      retryable: response.status >= 500 || response.status === 429,
      authExpired,
    });
  }
  return body;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs = MEDIA_TRANSFER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function assertRet(body, label, { allowMissingRet = false } = {}) {
  const rawRet = body?.ret;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new IlinkApiError(`${label}: malformed response`, {
      code: "invalid_response",
      retryable: true,
    });
  }
  if (rawRet === undefined && allowMissingRet) return body;
  const ret = Number(rawRet);
  if (rawRet === undefined || !Number.isFinite(ret)) {
    throw new IlinkApiError(`${label}: malformed response`, {
      code: "invalid_response",
      retryable: true,
    });
  }
  if (ret === 0) return body;
  const authExpired = ret === -14 || ret === 14;
  throw new IlinkApiError(`${label}: ret=${ret}${body?.errmsg ? ` ${body.errmsg}` : ""}`, {
    code: authExpired ? "auth_expired" : `ret_${ret}`,
    retryable: !authExpired,
    authExpired,
  });
}

function mediaKeyFromValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^[0-9a-f]{32}$/i.test(raw)) return Buffer.from(raw, "hex");
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 16) return decoded;
    const decodedText = decoded.toString("utf8").trim();
    if (/^[0-9a-f]{32}$/i.test(decodedText)) return Buffer.from(decodedText, "hex");
  } catch {
    // Fall through to the missing/invalid-key path.
  }
  return null;
}

function decryptMedia(bytes, key) {
  if (!key) return bytes;
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(bytes), decipher.final()]);
}

function mediaDownloadUrl(media) {
  const direct = String(media?.full_url ?? media?.url ?? "").trim();
  if (direct) {
    const parsed = new URL(direct);
    if (parsed.protocol !== "https:" || parsed.hostname !== "novac2c.cdn.weixin.qq.com") {
      throw new IlinkApiError("media URL host is not allowlisted", { code: "media_url_refused" });
    }
    return parsed.toString();
  }
  const encryptedParam = String(media?.encrypt_query_param ?? "").trim();
  if (!encryptedParam) throw new IlinkApiError("media download URL is missing", { code: "media_url_missing" });
  return `${ILINK_CDN_BASE}/download?encrypted_query_param=${encodeURIComponent(encryptedParam)}`;
}

async function readBoundedResponseBody(response, maxBytes, signal = null) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new IlinkApiError("media exceeds size limit", { code: "media_too_large" });
  }
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (signal?.aborted) throw new IlinkApiError("media download timed out", { code: "media_download_timeout", retryable: true });
    if (bytes.length > maxBytes) throw new IlinkApiError("media exceeds size limit", { code: "media_too_large" });
    return bytes;
  }
  const reader = response.body.getReader();
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", onAbort, { once: true });
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new IlinkApiError("media exceeds size limit", { code: "media_too_large" });
      }
      chunks.push(Buffer.from(value));
    }
    if (signal?.aborted) throw new IlinkApiError("media download timed out", { code: "media_download_timeout", retryable: true });
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (signal?.aborted) throw new IlinkApiError("media download timed out", { code: "media_download_timeout", retryable: true });
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export function createIlinkClient({
  baseUrl = ILINK_API_BASE,
  token = null,
  appId = ILINK_APP_ID,
  clientVersion = ILINK_APP_CLIENT_VERSION,
  fetchImpl = globalThis.fetch,
  mediaTimeoutMs = MEDIA_TRANSFER_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("ilink_fetch_unavailable");
  const root = normalizeBaseUrl(baseUrl);

  async function request(path, { method = "POST", body, timeoutMs = DEFAULT_TIMEOUT_MS, signal, auth = true } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetchImpl(`${root}/${path.replace(/^\//, "")}`, {
        method,
        headers: baseHeaders({ token: auth ? token : null, appId, clientVersion }),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      return await readJson(response, path);
    } catch (error) {
      if (error instanceof IlinkApiError) throw error;
      if (error?.name === "AbortError") {
        if (signal?.aborted) throw error;
        throw new IlinkApiError(`${path}: request timed out`, { code: "timeout", retryable: true });
      }
      throw new IlinkApiError(`${path}: network error`, { code: "network_error", retryable: true });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async function getQrCode({ botType = 3, localTokenList = [] } = {}) {
    const body = await request(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`, {
      // Tencent's current client uses POST with the local token list. The
      // list lets iLink return binded_redirect for a bot already bound to this
      // local installation instead of creating a duplicate session.
      method: "POST",
      body: { local_token_list: Array.isArray(localTokenList) ? localTokenList.filter(Boolean).slice(-10) : [] },
      timeoutMs: 30_000,
      auth: false,
    });
    return assertRet(body, "get_bot_qrcode");
  }

  async function getQrCodeStatus(qrcode, { verifyCode = null } = {}) {
    const endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}${verifyCode ? `&verify_code=${encodeURIComponent(verifyCode)}` : ""}`;
    const body = await request(endpoint, {
      method: "GET",
      timeoutMs: 35_000,
      auth: false,
    });
    return body;
  }

  async function getUpdates({ cursor = "", signal, timeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS } = {}) {
    try {
      const body = assertRet(await request("ilink/bot/getupdates", {
        body: { get_updates_buf: cursor || "", base_info: { channel_version: ILINK_CHANNEL_VERSION, bot_agent: ILINK_BOT_AGENT } },
        timeoutMs,
        signal,
      }), "getupdates", { allowMissingRet: true });
      if (body.msgs !== undefined && !Array.isArray(body.msgs)) {
        throw new IlinkApiError("getupdates: msgs must be an array", { code: "invalid_response", retryable: true });
      }
      if (body.get_updates_buf !== undefined && typeof body.get_updates_buf !== "string") {
        throw new IlinkApiError("getupdates: cursor must be a string", { code: "invalid_response", retryable: true });
      }
      if (body.longpolling_timeout_ms !== undefined && (!Number.isFinite(Number(body.longpolling_timeout_ms)) || Number(body.longpolling_timeout_ms) < 0)) {
        throw new IlinkApiError("getupdates: long-poll timeout is invalid", { code: "invalid_response", retryable: true });
      }
      return body;
    } catch (error) {
      // A client-side timeout is the normal end of an empty long-poll. Preserve
      // the cursor and let the worker immediately open the next poll.
      if (error?.code === "timeout" && !signal?.aborted) return { ret: 0, msgs: [], get_updates_buf: cursor || "" };
      throw error;
    }
  }

  async function sendMessage({ toUser, content, contextToken, fromUserId = undefined, mediaItems = [], clientId = null } = {}) {
    const now = Date.now();
    const msg = {
      // Callers that own a durable delivery row pass its id here so a retry
      // reuses the same provider idempotency key. Standalone callers retain a
      // fresh id for each message.
      client_id: String(clientId ?? "").trim() || randomUUID(),
      message_id: now,
      from_user_id: fromUserId,
      to_user_id: String(toUser ?? ""),
      message_type: 2,
      message_state: 2,
      context_token: contextToken || undefined,
      item_list: [
        ...(String(content ?? "") ? [{
          type: 1,
          create_time_ms: now,
          update_time_ms: now,
          is_completed: true,
          text_item: { text: String(content) },
        }] : []),
        ...mediaItems,
      ],
    };
    const body = await request("ilink/bot/sendmessage", {
      body: { msg, base_info: { channel_version: ILINK_CHANNEL_VERSION, bot_agent: ILINK_BOT_AGENT } },
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    return { ...assertRet(body, "sendmessage", { allowMissingRet: true }), clientId: msg.client_id };
  }

  async function getUploadUrl({ toUser, mediaType, rawSize, rawFileMd5, fileSize, aesKeyHex, fileKey } = {}) {
    const body = await request("ilink/bot/getuploadurl", {
      body: {
        filekey: String(fileKey ?? rawFileMd5 ?? ""),
        media_type: Number(mediaType),
        to_user_id: String(toUser ?? ""),
        rawsize: Number(rawSize),
        rawfilemd5: String(rawFileMd5 ?? ""),
        filesize: Number(fileSize),
        no_need_thumb: true,
        aeskey: String(aesKeyHex ?? ""),
        base_info: { channel_version: ILINK_CHANNEL_VERSION, bot_agent: ILINK_BOT_AGENT },
      },
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    const result = assertRet(body, "getuploadurl", { allowMissingRet: true });
    if (!result.upload_param && !result.upload_full_url) {
      throw new IlinkApiError("getuploadurl: upload URL is missing", { code: "media_upload_param_missing", retryable: true });
    }
    return result;
  }

  async function uploadMedia({ toUser, mediaType, bytes, filename = "attachment" } = {}) {
    const plaintext = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
    if (!plaintext.length || plaintext.length > MAX_ILINK_MEDIA_BYTES) {
      throw new IlinkApiError("outbound media size is invalid", { code: "media_too_large" });
    }
    const aesKey = randomBytes(16);
    const aesKeyHex = aesKey.toString("hex");
    const cipher = createCipheriv("aes-128-ecb", aesKey, null);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const rawFileMd5 = createHash("md5").update(plaintext).digest("hex");
    const upload = await getUploadUrl({
      toUser,
      mediaType,
      rawSize: plaintext.length,
      rawFileMd5,
      fileSize: encrypted.length,
      aesKeyHex,
      fileKey: rawFileMd5,
    });
    const uploadParam = String(upload?.upload_param ?? "").trim();
    const fullUploadUrl = String(upload?.upload_full_url ?? "").trim();
    if (!uploadParam && !fullUploadUrl) throw new IlinkApiError("iLink upload parameter missing", { code: "media_upload_param_missing" });
    const fileKey = String(upload?.filekey ?? rawFileMd5).trim() || rawFileMd5;
    let uploadUrl = fullUploadUrl;
    if (!uploadUrl) uploadUrl = `${ILINK_CDN_BASE}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(fileKey)}`;
    else {
      const parsed = new URL(uploadUrl);
      if (parsed.protocol !== "https:" || parsed.hostname !== "novac2c.cdn.weixin.qq.com") {
        throw new IlinkApiError("media upload URL host is not allowlisted", { code: "media_url_refused" });
      }
    }
    let response;
    try {
      response = await fetchWithTimeout(fetchImpl, uploadUrl, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: encrypted,
      }, mediaTimeoutMs);
    } catch (error) {
      throw new IlinkApiError(
        error?.name === "AbortError" ? "media upload timed out" : "media upload network error",
        { code: error?.name === "AbortError" ? "media_upload_timeout" : "media_upload_network_error", retryable: true },
      );
    }
    if (!response.ok) {
      throw new IlinkApiError(`media upload HTTP ${response.status}`, {
        code: `media_upload_http_${response.status}`,
        status: response.status,
        retryable: response.status >= 500 || response.status === 429,
      });
    }
    const encryptedParam = String(response.headers?.get?.("x-encrypted-param") ?? uploadParam).trim();
    return {
      filename: String(filename),
      rawSize: plaintext.length,
      encryptedSize: encrypted.length,
      md5: rawFileMd5,
      media: {
        encrypt_query_param: encryptedParam,
        aes_key: aesKey.toString("base64"),
        encrypt_type: 1,
      },
    };
  }

  async function downloadMedia({ media, aesKey = null, maxBytes = MAX_ILINK_MEDIA_BYTES } = {}) {
    const url = mediaDownloadUrl(media);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), mediaTimeoutMs);
    let response;
    try {
      response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: controller.signal });
    } catch (error) {
      clearTimeout(timer);
      throw new IlinkApiError(
        error?.name === "AbortError" ? "media download timed out" : "media download network error",
        { code: error?.name === "AbortError" ? "media_download_timeout" : "media_network_error", retryable: true },
      );
    }
    if (!response.ok || response.status >= 300 && response.status < 400) {
      clearTimeout(timer);
      throw new IlinkApiError(`media download HTTP ${response.status}`, {
        code: `media_http_${response.status}`,
        status: response.status,
        retryable: response.status >= 500 || response.status === 429,
      });
    }
    let encrypted;
    try {
      encrypted = await readBoundedResponseBody(response, maxBytes, controller.signal);
    } finally {
      clearTimeout(timer);
    }
    try {
      const key = mediaKeyFromValue(aesKey) ?? mediaKeyFromValue(media?.aes_key);
      const bytes = decryptMedia(encrypted, key);
      if (bytes.length > maxBytes) throw new IlinkApiError("decrypted media exceeds size limit", { code: "media_too_large" });
      return {
        bytes,
        contentType: String(response.headers?.get?.("content-type") ?? "").split(";")[0].trim() || null,
        url,
      };
    } catch (error) {
      if (error instanceof IlinkApiError) throw error;
      throw new IlinkApiError("media decrypt failed", { code: "media_decrypt_failed" });
    }
  }

  async function notifyStart() {
    return assertRet(await request("ilink/bot/msg/notifystart", {
      body: { base_info: { channel_version: ILINK_CHANNEL_VERSION, bot_agent: ILINK_BOT_AGENT } },
      timeoutMs: 10_000,
    }), "notifystart", { allowMissingRet: true });
  }

  async function notifyStop() {
    return assertRet(await request("ilink/bot/msg/notifystop", {
      body: { base_info: { channel_version: ILINK_CHANNEL_VERSION, bot_agent: ILINK_BOT_AGENT } },
      timeoutMs: 10_000,
    }), "notifystop", { allowMissingRet: true });
  }

  return { getQrCode, getQrCodeStatus, getUpdates, sendMessage, getUploadUrl, uploadMedia, downloadMedia, notifyStart, notifyStop };
}

export function textFromIlinkMessage(message) {
  return (message?.item_list ?? [])
    .filter((item) => Number(item?.type) === 1)
    .map((item) => String(item?.text_item?.text ?? ""))
    .join("\n")
    .trim();
}

export function messageIdFromIlinkMessage(message) {
  return String(message?.message_id ?? message?.client_id ?? "").trim();
}

function extensionForMimeType(contentType) {
  return ({
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/amr": ".amr",
    "audio/silk": ".silk",
    "application/pdf": ".pdf",
  })[String(contentType ?? "").toLowerCase()] ?? ".bin";
}

/** Normalize the media-bearing item types in an inbound iLink message. */
export function ilinkMediaCandidates(message) {
  const messageId = messageIdFromIlinkMessage(message) || "message";
  const candidates = [];
  for (const item of message?.item_list ?? []) {
    const type = Number(item?.type);
    const config = type === 2
      ? { kind: "image", payload: item.image_item, fallbackName: `image-${messageId}` }
      : type === 3
        ? { kind: "voice", payload: item.voice_item, fallbackName: `voice-${messageId}` }
        : type === 4
          ? { kind: "file", payload: item.file_item, fallbackName: `file-${messageId}` }
          : null;
    if (!config?.payload) continue;
    const payload = config.payload;
    const media = payload.media ?? (payload.url ? { url: payload.url } : null);
    if (!media && !(config.kind === "voice" && String(payload.text ?? "").trim())) continue;
    const providedName = config.kind === "file" ? String(payload.file_name ?? "").trim() : "";
    candidates.push({
      kind: config.kind,
      media,
      aesKey: payload.aeskey ?? null,
      filename: providedName || config.fallbackName,
      voiceText: config.kind === "voice" ? String(payload.text ?? "").trim() : "",
      encodeType: config.kind === "voice" ? Number(payload.encode_type ?? 0) : null,
      contentTypeHint: config.kind === "image" ? "image/*" : config.kind === "voice" ? "audio/*" : null,
    });
  }
  return candidates;
}

export { extensionForMimeType };
