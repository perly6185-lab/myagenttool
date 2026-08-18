import { createHash, randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { createIlinkClient, extensionForMimeType, IlinkApiError, ILINK_API_BASE, ilinkMediaCandidates, messageIdFromIlinkMessage, textFromIlinkMessage } from "./ilink-client.mjs";
import { createIlinkCredentialStore } from "../services/ilink-credential-store.mjs";
import { classifyAsset, resolveConfinedAssetPath } from "../services/asset-capabilities.mjs";

const PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_OUTBOUND_MEDIA_ASSETS = 5;
const MAX_OUTBOUND_MEDIA_BYTES = 25 * 1024 * 1024;

function mediaFilename(candidate, contentType, bytes = null) {
  const raw = String(candidate?.filename ?? "attachment").replace(/[\\/\0]/g, "_").slice(0, 120);
  if (extname(raw)) return raw;
  if (candidate?.kind === "voice") {
    const extension = ({ 5: ".amr", 6: ".silk", 7: ".mp3", 8: ".ogg" })[Number(candidate.encodeType)] ?? extensionForMimeType(contentType);
    return `${raw}${extension}`;
  }
  if (candidate?.kind === "image" && extensionForMimeType(contentType) === ".bin") {
    if (bytes?.subarray(0, 8)?.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return `${raw}.png`;
    if (bytes?.[0] === 0xff && bytes?.[1] === 0xd8) return `${raw}.jpg`;
    if (["GIF87a", "GIF89a"].includes(bytes?.subarray(0, 6)?.toString("ascii"))) return `${raw}.gif`;
    if (bytes?.subarray(0, 4)?.toString("ascii") === "RIFF" && bytes?.subarray(8, 12)?.toString("ascii") === "WEBP") return `${raw}.webp`;
    return `${raw}.jpg`;
  }
  return `${raw}${extensionForMimeType(contentType)}`;
}

function mediaLabel(candidate, filename) {
  const label = candidate?.kind === "image" ? "图片" : candidate?.kind === "voice" ? "语音" : "文件";
  return `[${label}附件：${filename}]`;
}

function sleep(ms, signal = null) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

function accountFor(state, channelId) {
  return (state.ilinkAccounts ?? []).find((row) => row.channelId === channelId) ?? null;
}

function pairCode() {
  return randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
}

function ilinkRedirectBaseUrl(value) {
  try {
    const raw = String(value ?? "").trim();
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (parsed.protocol !== "https:" || !/(^|\.)weixin\.qq\.com$/i.test(parsed.hostname)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function ilinkProviderBaseUrl(value) {
  try {
    const raw = String(value ?? ILINK_API_BASE).trim();
    const parsed = new URL(raw || ILINK_API_BASE);
    if (parsed.protocol !== "https:" || !/(^|\.)weixin\.qq\.com$/i.test(parsed.hostname)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function publicAccount(account) {
  if (!account) return null;
  return {
    channelId: account.channelId,
    status: account.status,
    botId: account.botId ?? null,
    lastPollAt: account.lastPollAt ?? null,
    lastMessageAt: account.lastMessageAt ?? null,
    lastError: account.lastError ?? null,
    pairingStatus: account.pairingStatus ?? (account.status === "pairing_expired" ? "expired" : account.status === "pairing" ? "pending" : null),
    workerFailureCount: Number(account.workerFailureCount ?? 0),
    nextRetryAt: account.nextRetryAt ?? null,
    connectedAt: account.connectedAt ?? null,
    updatedAt: account.updatedAt ?? null,
    pairingExpiresAt: account.pairingExpiresAt ?? null,
  };
}

export function createIlinkRuntime({
  state,
  stateStorePath,
  now,
  nextId,
  persistStateSoon = () => {},
  appendEvent = () => {},
  importChannelEvent,
  mapChannelIdentity,
  enableChannel,
  disableChannel,
  credentialStore = null,
  clientFactory = createIlinkClient,
}) {
  const credentials = credentialStore ?? createIlinkCredentialStore({ stateStorePath });
  state.ilinkAccounts ??= [];
  const loginSessions = new Map();
  const loginPolls = new Map();
  const workers = new Map();
  let stopped = false;

  function channelFor(channelId) {
    return (state.channels ?? []).find((row) => row.id === String(channelId ?? "")) ?? null;
  }

  function channelAccessible(channel, actor) {
    return Boolean(channel) && (!actor?.teamId || (channel.ownerTeamId ?? "team_local") === actor.teamId);
  }

  function ensureAccount(channel, actor = null) {
    let account = accountFor(state, channel.id);
    if (!account) {
      account = {
        id: nextId("ila"),
        channelId: channel.id,
        ownerTeamId: channel.ownerTeamId,
        ownerUserId: actor?.userId ?? "usr_local",
        status: "disconnected",
        botId: null,
        cursor: "",
        lastPollAt: null,
        lastMessageAt: null,
        lastError: null,
        workerFailureCount: 0,
        nextRetryAt: null,
        connectedAt: null,
        updatedAt: now(),
        pairingExpiresAt: null,
        pairingStatus: null,
        pendingPairCode: null,
        pendingPairUserId: null,
      };
      state.ilinkAccounts.push(account);
    }
    if (actor?.userId) account.ownerUserId = actor.userId;
    if (actor?.teamId) account.ownerTeamId = actor.teamId;
    account.updatedAt = now();
    return account;
  }

  function setAccount(account, patch) {
    Object.assign(account, patch, { updatedAt: now() });
    persistStateSoon();
  }

  function requireReauth(account, code = "auth_expired") {
    if (!account) return;
    setAccount(account, { status: "reauth_required", lastError: code });
    // Do not let an expired credential keep a worker alive until the next
    // process restart. A fresh login is the only supported recovery path.
    stopWorker(account.id);
  }

  function readiness(channel) {
    const account = accountFor(state, channel?.id);
    const credential = account ? credentials.load(account.id) : null;
    const workerRunning = Boolean(workers.has(account?.id));
    const workerHealthy = Boolean(workerRunning && account && account.status !== "error" && account.status !== "reauth_required" && account.status !== "stopped" && !account.lastError);
    return {
      account: Boolean(account),
      session: Boolean(credential?.botToken),
      worker: workerHealthy,
      workerRunning,
      workerHealthy,
    };
  }

  function restorePreviousLogin(account, session, errorCode = null) {
    if (!session?.previousCredential) return false;
    const channel = channelFor(account.channelId);
    setAccount(account, {
      status: session.previousStatus ?? "authenticated",
      lastError: errorCode,
    });
    if (session.previousWorker && channel?.status === "enabled") startWorker(account);
    return true;
  }

  function expirePairingIfNeeded(account) {
    if (!account?.pendingPairCode || !account.pairingExpiresAt) return false;
    if (Date.parse(account.pairingExpiresAt) > Date.now()) return false;
    setAccount(account, {
      status: credentials.load(account.id)?.botToken ? "connected" : "disconnected",
      pendingPairCode: null,
      pendingPairUserId: null,
      pairingExpiresAt: null,
      pairingStatus: "expired",
      lastError: null,
    });
    return true;
  }

  function loginDisplayStatus(status) {
    const normalized = String(status ?? "wait").toLowerCase();
    if (normalized === "wait") return "waiting_scan";
    if (["scaned", "scaned_but_redirect"].includes(normalized)) return "scanned";
    if (normalized === "need_verifycode") return "verification_required";
    if (["confirmed", "already_connected", "binded_redirect"].includes(normalized)) return "authenticated";
    return normalized;
  }

  async function beginLogin({ channelId, actor = null } = {}) {
    const channel = channelFor(channelId);
    if (!channelAccessible(channel, actor)) return { ok: false, status: 404, body: { error: "channel_not_found" } };
    if (channel.provider !== "wechat_ilink") return { ok: false, status: 400, body: { error: "not_ilink_channel" } };
    const account = ensureAccount(channel, actor);
    const previousCredential = credentials.load(account.id);
    const pending = {
      previousCredential,
      previousStatus: account.status,
      previousWorker: workers.has(account.id),
    };
    // Keep both the old credential and worker until the replacement QR session
    // is confirmed. A user may abandon the scan, and the existing channel must
    // continue receiving messages during that time.
    const client = clientFactory();
    let qr;
    try {
      const localTokenList = typeof credentials.listBotTokens === "function"
        ? credentials.listBotTokens(10)
        : previousCredential?.botToken ? [previousCredential.botToken] : [];
      qr = await client.getQrCode({ localTokenList });
    } catch (error) {
      const code = error?.code ?? "qr_request_failed";
      if (!restorePreviousLogin(account, pending, code)) setAccount(account, { status: "error", lastError: code });
      return { ok: false, status: 502, body: { error: "ilink_qr_unavailable", detail: error?.code ?? "network_error" } };
    }
    if (!qr?.qrcode) {
      if (!restorePreviousLogin(account, pending, "qr_missing")) setAccount(account, { status: "error", lastError: "qr_missing" });
      return { ok: false, status: 502, body: { error: "ilink_qr_missing" } };
    }
    loginSessions.set(channel.id, {
      ...pending,
      qrcode: String(qr.qrcode),
      imageUrl: String(qr.qrcode_img_content ?? ""),
      createdAt: now(),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      status: "wait",
      pollBaseUrl: ILINK_API_BASE,
      verifyCode: null,
    });
    setAccount(account, { status: previousCredential ? "reconnecting" : "waiting_scan", lastError: null });
    return pollLogin({ channelId, actor, initial: true });
  }

  async function pollLogin({ channelId, actor = null, initial = false, verifyCode = undefined } = {}) {
    const normalizedChannelId = String(channelId ?? "");
    const channel = channelFor(normalizedChannelId);
    if (!channelAccessible(channel, actor) || channel.provider !== "wechat_ilink") return { ok: false, status: 404, body: { error: "channel_not_found" } };
    const session = loginSessions.get(normalizedChannelId);
    if (session && verifyCode !== undefined) session.verifyCode = String(verifyCode ?? "").trim() || null;
    const existing = loginPolls.get(normalizedChannelId);
    if (existing) return existing;
    const request = pollLoginInternal({ channelId: normalizedChannelId, actor, initial });
    loginPolls.set(normalizedChannelId, request);
    try {
      return await request;
    } finally {
      if (loginPolls.get(normalizedChannelId) === request) loginPolls.delete(normalizedChannelId);
    }
  }

  async function pollLoginInternal({ channelId, actor = null, initial = false } = {}) {
    const channel = channelFor(channelId);
    const session = loginSessions.get(String(channelId));
    if (!channelAccessible(channel, actor) || channel.provider !== "wechat_ilink") return { ok: false, status: 404, body: { error: "channel_not_found" } };
    if (!session) {
      const account = accountFor(state, channel.id);
      expirePairingIfNeeded(account);
      return { ok: true, status: 200, body: { status: account?.status ?? "disconnected", account: publicAccount(account) } };
    }
    const account = accountFor(state, channel.id);
    if (!initial && session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) {
      session.status = "expired";
      loginSessions.delete(channel.id);
      if (!restorePreviousLogin(account, session, "ilink_qr_expired")) {
        setAccount(account, { status: "expired", lastError: "ilink_qr_expired" });
      }
      return { ok: true, status: 200, body: { status: "expired", qr: null, account: publicAccount(account) } };
    }
    try {
      const statusBody = initial
        ? { status: "wait" }
        : await clientFactory({ baseUrl: session.pollBaseUrl ?? ILINK_API_BASE }).getQrCodeStatus(session.qrcode, { verifyCode: session.verifyCode });
      const status = String(statusBody?.status ?? "wait").toLowerCase();
      session.status = status;
      if (status === "binded_redirect") {
        loginSessions.delete(channel.id);
        if (session.previousCredential) {
          restorePreviousLogin(account, session, null);
          setAccount(account, { status: "authenticated", lastError: null });
          return { ok: true, status: 200, body: { status: "authenticated", account: publicAccount(account) } };
        }
        setAccount(account, { status: "reauth_required", lastError: "ilink_already_bound" });
        return { ok: false, status: 409, body: { error: "ilink_already_bound" } };
      } else if (status === "confirmed" || status === "already_connected") {
        const botToken = String(statusBody?.bot_token ?? statusBody?.botToken ?? "").trim();
        const baseUrl = ilinkProviderBaseUrl(statusBody?.baseurl ?? statusBody?.base_url ?? ILINK_API_BASE);
        if (!baseUrl) {
          loginSessions.delete(channel.id);
          if (!restorePreviousLogin(account, session, "ilink_baseurl_invalid")) {
            setAccount(account, { status: "error", lastError: "ilink_baseurl_invalid" });
          }
          return { ok: false, status: 502, body: { error: "ilink_baseurl_invalid" } };
        }
        if (!botToken) {
          loginSessions.delete(channel.id);
          if (!restorePreviousLogin(account, session, "ilink_login_missing_token")) {
            setAccount(account, { status: "reauth_required", lastError: "ilink_login_missing_token" });
          }
          return { ok: false, status: 502, body: { error: "ilink_login_missing_token" } };
        }
        if (botToken) {
          // Switch workers only after the provider has confirmed the new
          // credential. If persistence fails, the old worker/credential can
          // still be restored by the common error path.
          if (session.previousCredential) stopWorker(account.id);
          credentials.save(account.id, {
            botToken,
            baseUrl,
            botId: String(statusBody?.ilink_bot_id ?? statusBody?.bot_id ?? "").trim() || null,
          });
          setAccount(account, {
            status: "authenticated",
            botId: String(statusBody?.ilink_bot_id ?? statusBody?.bot_id ?? "").trim() || account.botId || null,
            connectedAt: account.connectedAt ?? now(),
            lastError: null,
          });
        } else {
          // A redirect without a token cannot resume this local session. Keep
          // the account recoverable instead of deleting the session and
          // leaving the UI in an endless waiting_scan state.
          setAccount(account, { status: "reauth_required", lastError: "ilink_login_redirect_required" });
        }
        loginSessions.delete(channel.id);
      } else if (status === "scaned" || status === "scaned_but_redirect") {
        if (status === "scaned_but_redirect") {
          const redirectedBaseUrl = ilinkRedirectBaseUrl(statusBody?.redirect_host);
          if (!redirectedBaseUrl) {
            loginSessions.delete(channel.id);
            if (!restorePreviousLogin(account, session, "ilink_redirect_invalid")) setAccount(account, { status: "error", lastError: "ilink_redirect_invalid" });
            return { ok: false, status: 502, body: { error: "ilink_redirect_invalid" } };
          }
          session.pollBaseUrl = redirectedBaseUrl;
        }
        setAccount(account, { status: "scanned" });
      } else if (status === "need_verifycode") {
        setAccount(account, { status: "verification_required", lastError: "ilink_verify_code_required" });
      } else if (status === "verify_code_blocked") {
        loginSessions.delete(channel.id);
        if (!restorePreviousLogin(account, session, "ilink_verify_code_blocked")) setAccount(account, { status: "error", lastError: "ilink_verify_code_blocked" });
        return { ok: false, status: 409, body: { error: "ilink_verify_code_blocked" } };
      } else if (["expired", "timeout", "refused"].includes(status)) {
        // Keep the terminal QR state visible so the console can offer a fresh
        // login attempt. Reporting waiting_scan here left the UI polling a dead
        // session with no QR and no recovery action.
        if (!restorePreviousLogin(account, session, "ilink_qr_expired")) {
          setAccount(account, { status: "expired", lastError: "ilink_qr_expired" });
        }
        loginSessions.delete(channel.id);
      }
      persistStateSoon();
      return {
        ok: true,
        status: 200,
        body: {
          status: loginDisplayStatus(session.status),
          qr: session.status === "wait" || session.status === "scaned" ? { imageUrl: session.imageUrl, expiresAt: session.expiresAt } : null,
          account: publicAccount(account),
        },
      };
    } catch (error) {
      if (error?.name === "AbortError") return { ok: true, status: 200, body: { status: "waiting_scan", account: publicAccount(account) } };
      const code = error?.code ?? "qr_status_failed";
      // The previous session is already healthy again. Do not leave a stale
      // QR poll alive to compete with the restored worker or confuse the UI.
      loginSessions.delete(channel.id);
      if (!restorePreviousLogin(account, session, code)) setAccount(account, { status: "error", lastError: code });
      return { ok: false, status: 502, body: { error: "ilink_qr_status_failed", detail: code } };
    }
  }

  async function activate({ channelId, approvalToken, actor = null } = {}) {
    const channel = channelFor(channelId);
    const account = channel ? accountFor(state, channel.id) : null;
    if (!channelAccessible(channel, actor) || channel.provider !== "wechat_ilink") return { ok: false, status: 404, body: { error: "channel_not_found" } };
    if (!account || !credentials.load(account.id)?.botToken) return { ok: false, status: 409, body: { error: "ilink_login_required" } };
    const enabled = enableChannel({ channelId: channel.id, approvalToken }, actor);
    if (!enabled?.ok) return enabled;
    const code = pairCode();
    setAccount(account, {
      status: "pairing",
      pendingPairCode: code,
      pendingPairUserId: actor?.userId ?? account.ownerUserId ?? "usr_local",
      pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS).toISOString(),
      pairingStatus: "pending",
      lastError: null,
    });
    startWorker(account);
    return { ok: true, status: 200, body: { channel: enabled.body?.channel, pairCode: code, pairingExpiresAt: account.pairingExpiresAt, account: publicAccount(account) } };
  }

  function stopWorker(accountId) {
    const worker = workers.get(accountId);
    if (!worker) return;
    worker.abortController.abort();
    workers.delete(accountId);
  }

  function workerFor(account) {
    const credential = credentials.load(account.id);
    if (!credential?.botToken) return null;
    return clientFactory({ baseUrl: credential.baseUrl, token: credential.botToken });
  }

  async function downloadMediaCandidates(client, message, channelId) {
    const candidates = ilinkMediaCandidates(message);
    const attachmentCandidates = [];
    const descriptions = [];
    const failed = [];
    const voiceTexts = [];
    for (const candidate of candidates) {
      if (candidate.voiceText) voiceTexts.push(candidate.voiceText);
      if (!candidate.media) continue;
      try {
        if (typeof client.downloadMedia !== "function") throw Object.assign(new Error("media_download_unavailable"), { code: "media_download_unavailable" });
        const downloaded = await client.downloadMedia({ media: candidate.media, aesKey: candidate.aesKey });
        const filename = mediaFilename(candidate, downloaded.contentType, downloaded.bytes);
        attachmentCandidates.push({
          bytes: downloaded.bytes,
          filename,
          contentType: downloaded.contentType,
        });
        descriptions.push(mediaLabel(candidate, filename));
      } catch (error) {
        const filename = mediaFilename(candidate, null);
        descriptions.push(`${mediaLabel(candidate, filename)}下载失败`);
        failed.push({ kind: candidate.kind, filename, code: error?.code ?? "media_import_failed" });
        appendEvent({
          invocationId: null,
          type: "ilink_media_import_failed",
          level: "warn",
          message: `iLink ${candidate.kind} media import failed.`,
          data: { channelId: channelId ?? null, kind: candidate.kind, code: error?.code ?? "media_import_failed" },
        });
      }
    }
    return { attachmentCandidates, descriptions, failed, voiceTexts };
  }

  async function processMessage(account, client, message) {
    const channel = channelFor(account.channelId);
    const senderId = String(message?.from_user_id ?? "").trim();
    const messageId = messageIdFromIlinkMessage(message);
    const text = textFromIlinkMessage(message).slice(0, MAX_MESSAGE_CHARS);
    const mediaTypes = ilinkMediaCandidates(message);
    if (!channel || !senderId || !messageId) return;
    if (Number(message?.message_type) === 2 || (!text && !mediaTypes.length)) return;
    // P1 intentionally supports private chats only; group messages must not
    // accidentally create tasks or consume the pairing code.
    if (message?.group_id) return;
    // Avoid downloading and storing the same media again when iLink replays a
    // message after a cursor retry. The import service remains the authoritative
    // exactly-once boundary; replay the durable event so a crash between import,
    // dispatch, and enqueue cannot silently lose the user's reply.
    if ((state.channelEvents ?? []).some((row) => row.channelId === channel.id && row.providerMessageId === messageId)) {
      const replayed = await importChannelEvent({
        channelId: channel.id,
        providerMessageId: messageId,
        externalUserId: senderId,
        msgType: mediaTypes.length === 1 ? mediaTypes[0].kind : mediaTypes.length > 1 ? "mixed" : "text",
        content: text,
        providerCreateTime: message?.create_time_ms ? new Date(Number(message.create_time_ms)).toISOString() : null,
        replyContext: { contextToken: String(message?.context_token ?? "") },
        attachmentCandidates: [],
      });
      if (!replayed?.ok) {
        throw Object.assign(new Error(replayed?.reason ?? "channel_event_recovery_failed"), {
          code: replayed?.reason ?? "channel_event_recovery_failed",
        });
      }
      setAccount(account, { lastMessageAt: now(), lastError: null });
      return;
    }
    const media = mediaTypes.length
      ? await downloadMediaCandidates(client, message, channel.id)
      : { attachmentCandidates: [], descriptions: [], failed: [], voiceTexts: [] };
    const content = [text, ...media.voiceTexts.filter((value) => !text.includes(value)), ...media.descriptions]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_MESSAGE_CHARS);
    if (!content) return;
    const activePair = account.pendingPairCode && Date.parse(account.pairingExpiresAt ?? "") > Date.now();
    const expected = `绑定 ${account.pendingPairCode}`;
    if (activePair && content.trim() === expected) {
      const mapped = mapChannelIdentity(
        { channelId: channel.id, externalUserId: senderId, userId: account.pendingPairUserId ?? account.ownerUserId },
        { userId: account.pendingPairUserId ?? account.ownerUserId, teamId: account.ownerTeamId, role: "owner" },
      );
      if (!(mapped?.ok || mapped?.body?.error === "identity_already_mapped")) {
        throw Object.assign(new Error("identity_mapping_failed"), { code: "identity_mapping_failed" });
      }
      // Keep this id stable across a cursor replay. If the provider accepted
      // the first reply but the process died before the account update, the
      // replay must not create a second visible confirmation message.
      await client.sendMessage({
        toUser: senderId,
        content: "绑定成功。现在直接发送问题、文字、图片、语音或文件即可；回复“帮助”可查看使用方式。",
        contextToken: message.context_token,
        fromUserId: account.botId,
        clientId: `ilink-bind-${channel.id}-${messageId}`,
      });
      setAccount(account, { status: "connected", pairingStatus: "bound", pendingPairCode: null, pendingPairUserId: null, pairingExpiresAt: null, lastMessageAt: now(), lastError: null });
      appendEvent({ invocationId: null, type: "ilink_account_bound", level: "info", message: `iLink account bound to channel ${channel.id}.`, data: { channelId: channel.id } });
      return;
    }
    const imported = await importChannelEvent({
      channelId: channel.id,
      providerMessageId: messageId,
      externalUserId: senderId,
      msgType: mediaTypes.length === 1 ? mediaTypes[0].kind : mediaTypes.length > 1 ? "mixed" : "text",
      content,
      providerCreateTime: message?.create_time_ms ? new Date(Number(message.create_time_ms)).toISOString() : null,
      replyContext: { contextToken: String(message?.context_token ?? "") },
      attachmentCandidates: media.attachmentCandidates,
      mediaFailure: media.failed.length
        ? { failed: media.failed, total: mediaTypes.filter((candidate) => candidate.media).length }
        : null,
    });
    if (!imported?.ok) {
      throw Object.assign(new Error(imported?.reason ?? "channel_event_import_failed"), { code: imported?.reason ?? "channel_event_import_failed" });
    }
    setAccount(account, { lastMessageAt: now(), lastError: null });
  }

  async function runWorker(account, worker) {
    const client = workerFor(account);
    if (!client) return;
    try { await client.notifyStart(); } catch { /* status is still useful when notify is unavailable */ }
    let failures = 0;
    while (!worker.abortController.signal.aborted && !stopped) {
      const channel = channelFor(account.channelId);
      if (!channel || channel.status !== "enabled") break;
      expirePairingIfNeeded(account);
      try {
        const response = await client.getUpdates({ cursor: account.cursor ?? "", signal: worker.abortController.signal });
        let processingFailed = false;
        for (const message of response?.msgs ?? []) {
          try {
            await processMessage(account, client, message);
          } catch (error) {
            processingFailed = true;
            // One malformed provider message must not block the cursor or every
            // later user message. The failure is durable evidence without
            // persisting raw payloads or credentials.
            appendEvent({
              invocationId: null,
              type: "ilink_message_processing_failed",
              level: "error",
              message: `iLink message processing failed (${error?.code ?? "message_processing_failed"}).`,
              data: { channelId: account.channelId, code: error?.code ?? "message_processing_failed" },
            });
            break;
          }
        }
        if (processingFailed) {
          // Do not acknowledge the provider cursor until every message in the
          // batch has reached a durable boundary. The next poll will replay the
          // batch; normal imports are idempotent and binding replies use a
          // stable client id, so this is at-least-once without message loss.
          setAccount(account, { status: "connected", lastPollAt: now(), lastError: "message_processing_failed", workerFailureCount: 0, nextRetryAt: new Date(Date.now() + 1_000).toISOString() });
          await sleep(1_000, worker.abortController.signal);
          continue;
        }
        if (response?.get_updates_buf !== undefined) account.cursor = String(response.get_updates_buf ?? "");
        setAccount(account, { status: "connected", lastPollAt: now(), lastError: null, workerFailureCount: 0, nextRetryAt: null });
        failures = 0;
      } catch (error) {
        if (worker.abortController.signal.aborted) break;
        failures += 1;
        if (error instanceof IlinkApiError && error.authExpired) {
          requireReauth(account, error.code);
          break;
        }
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5));
        setAccount(account, {
          status: "error",
          lastError: error?.code ?? "worker_error",
          workerFailureCount: failures,
          nextRetryAt: new Date(Date.now() + delay).toISOString(),
        });
        await sleep(delay, worker.abortController.signal);
      }
    }
    try { await client.notifyStop(); } catch { /* best effort */ }
    if (!worker.abortController.signal.aborted && account.status === "connected") setAccount(account, { status: "stopped" });
  }

  function startWorker(account) {
    if (stopped || workers.has(account.id) || account.status === "reauth_required") return;
    const abortController = new AbortController();
    const worker = { abortController };
    workers.set(account.id, worker);
    void runWorker(account, worker).finally(() => {
      if (workers.get(account.id) === worker) workers.delete(account.id);
      persistStateSoon();
    });
  }

  function syncWorkers() {
    for (const account of state.ilinkAccounts ?? []) {
      const channel = channelFor(account.channelId);
      if (channel?.provider !== "wechat_ilink") continue;
      if (channel.status === "enabled" && account.status !== "reauth_required" && credentials.load(account.id)?.botToken && !workers.has(account.id)) {
        if (account.status === "pairing_expired") setAccount(account, { status: "connected", pairingStatus: "expired", lastError: null });
        startWorker(account);
      }
      if (channel.status !== "enabled") stopWorker(account.id);
    }
  }

  function onChannelStateChanged(channelId) {
    const account = accountFor(state, channelId);
    if (!account) return;
    const channel = channelFor(channelId);
    if (channel?.status === "enabled") startWorker(account);
    else stopWorker(account.id);
  }

  async function sendApplicationMessage({ channelId, toUser, content, replyContext = null, mediaAssets = [], deliveryId = null } = {}) {
    const channel = channelFor(channelId);
    const account = accountFor(state, channelId);
    const credential = account ? credentials.load(account.id) : null;
    if (!channel || channel.provider !== "wechat_ilink") {
      return { ok: false, retryable: false, errcode: "ilink_channel_not_found" };
    }
    if (channel.status === "disabled") {
      return { ok: false, retryable: true, errcode: "ilink_channel_disabled" };
    }
    if (!account || !credential?.botToken) return { ok: false, retryable: false, errcode: "ilink_not_connected" };
    try {
      const client = clientFactory({ baseUrl: credential.baseUrl, token: credential.botToken });
      const mediaItems = [];
      let totalBytes = 0;
      for (const asset of mediaAssets.slice(0, MAX_OUTBOUND_MEDIA_ASSETS)) {
        const project = (state.projects ?? []).find((row) => row.id === asset?.projectId);
        if (!project?.path || !asset?.projectId || !asset?.path) {
          throw Object.assign(new Error("outbound_media_scope_refused"), { code: "outbound_media_scope_refused" });
        }
        const confined = resolveConfinedAssetPath(project.path, asset.path);
        const stat = statSync(confined.target);
        if (!stat.isFile()) throw Object.assign(new Error("outbound_media_not_file"), { code: "outbound_media_not_file" });
        if (Number.isFinite(Number(asset.size)) && Number(asset.size) !== stat.size) {
          throw Object.assign(new Error("outbound_media_asset_changed"), { code: "outbound_media_asset_changed" });
        }
        totalBytes += stat.size;
        if (stat.size <= 0 || totalBytes > MAX_OUTBOUND_MEDIA_BYTES) {
          throw Object.assign(new Error("outbound_media_too_large"), { code: "outbound_media_too_large" });
        }
        const bytes = readFileSync(confined.target);
        if (asset.hash) {
          const actualHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
          if (actualHash !== String(asset.hash)) {
            throw Object.assign(new Error("outbound_media_asset_changed"), { code: "outbound_media_asset_changed" });
          }
        }
        const classification = classifyAsset(confined.relativePath);
        const mediaType = classification.family === "image" ? 1 : classification.family === "audio" ? 4 : 3;
        const uploaded = await client.uploadMedia({ toUser, mediaType, bytes, filename: confined.relativePath.split("/").at(-1) });
        mediaItems.push(classification.family === "image"
          ? { type: 2, create_time_ms: Date.now(), update_time_ms: Date.now(), is_completed: true, image_item: { media: uploaded.media, mid_size: uploaded.encryptedSize, hd_size: uploaded.encryptedSize } }
          : classification.family === "audio"
            ? { type: 3, create_time_ms: Date.now(), update_time_ms: Date.now(), is_completed: true, voice_item: { media: uploaded.media, encode_type: extname(confined.relativePath).toLowerCase() === ".silk" ? 6 : extname(confined.relativePath).toLowerCase() === ".amr" ? 5 : 7 } }
            : { type: 4, create_time_ms: Date.now(), update_time_ms: Date.now(), is_completed: true, file_item: { media: uploaded.media, file_name: confined.relativePath.split("/").at(-1), len: String(uploaded.rawSize), md5: uploaded.md5 } });
      }
      const result = await client.sendMessage({
        toUser,
        content,
        contextToken: replyContext?.contextToken,
        fromUserId: account.botId ?? credential.botId ?? undefined,
        mediaItems,
        clientId: deliveryId,
      });
      setAccount(account, { lastError: null });
      return { ok: true, msgid: result?.clientId ?? String(Date.now()) };
    } catch (error) {
      if (error?.authExpired) requireReauth(account, error.code);
      return { ok: false, retryable: Boolean(error?.retryable), errcode: error?.code ?? "ilink_send_failed" };
    }
  }

  async function disconnect({ channelId, actor = null } = {}) {
    const channel = channelFor(channelId);
    const account = channel ? accountFor(state, channel.id) : null;
    if (!channelAccessible(channel, actor) || channel.provider !== "wechat_ilink" || !account) return { ok: false, status: 404, body: { error: "channel_not_found" } };
    stopWorker(account.id);
    const disabled = disableChannel({ channelId: channel.id }, actor);
    credentials.remove(account.id);
    setAccount(account, { status: "disconnected", botId: null, cursor: "", pendingPairCode: null, pendingPairUserId: null, pairingExpiresAt: null, pairingStatus: null, lastError: null });
    loginSessions.delete(channel.id);
    return disabled?.ok ? { ok: true, status: 200, body: { channel: disabled.body?.channel, account: publicAccount(account) } } : disabled;
  }

  function start() {
    stopped = false;
    syncWorkers();
  }

  function stop() {
    stopped = true;
    for (const accountId of workers.keys()) stopWorker(accountId);
  }

  return { beginLogin, pollLogin, activate, disconnect, sendApplicationMessage, readiness, start, stop, syncWorkers, onChannelStateChanged, publicAccount: (channelId) => publicAccount(accountFor(state, channelId)) };
}
