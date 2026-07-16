/*
 * Feishu (Lark) outbound message client (F3, #1110; ADR 0012 rule 4 + ADR 0013).
 * Lives on the gateway side of the credential boundary: it holds app_id/
 * app_secret and the cached tenant_access_token in CLOSURE/MEMORY only — nothing
 * here is ever persisted, and callers receive provider message ids and codes,
 * never token material.
 *
 * Transport is injected (`httpJson`) so tests exercise every code branch with a
 * fake; the default uses global fetch. The base URL is configurable so the same
 * client serves Feishu (feishu.cn) and Lark (larksuite.com).
 */

const FEISHU_BASE = "https://open.feishu.cn";
const TOKEN_SAFETY_MS = 60 * 1000;

async function fetchJson(url, { method = "GET", headers, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(headers ?? {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json();
}

// Feishu codes that mean "refresh the tenant_access_token and retry once".
const TOKEN_CODES = new Set([99991663, 99991661, 99991664]);
// Codes that mean "back off and retry later" (frequency / flow control).
const RETRYABLE_CODES = new Set([99991400, 230020, 230098]);

export function createFeishuClient({
  appId,
  appSecret,
  httpJson = fetchJson,
  now = () => Date.now(),
  baseUrl = FEISHU_BASE,
}) {
  if (!appId || !appSecret) {
    throw new Error("feishu_client_misconfigured");
  }

  let cachedToken = null; // { token, expiresAtMs } — memory only, never persisted
  let inflightRefresh = null;

  async function refreshToken() {
    const result = await httpJson(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      body: { app_id: appId, app_secret: appSecret },
    });
    if (Number(result?.code ?? -1) !== 0) {
      throw Object.assign(new Error("feishu_token_fetch_failed"), { errcode: Number(result?.code ?? -1) });
    }
    // Guard against caching an empty token (code-review LOW).
    const token = String(result.tenant_access_token ?? "");
    if (!token) {
      throw Object.assign(new Error("feishu_token_fetch_failed"), { errcode: "empty_token" });
    }
    cachedToken = {
      token,
      expiresAtMs: now() + Math.max(0, Number(result.expire ?? 7200) * 1000 - TOKEN_SAFETY_MS),
    };
    return cachedToken.token;
  }

  async function getAccessToken({ forceRefresh = false } = {}) {
    if (!forceRefresh && cachedToken && cachedToken.expiresAtMs > now()) {
      return cachedToken.token;
    }
    if (!inflightRefresh) {
      inflightRefresh = refreshToken().finally(() => {
        inflightRefresh = null;
      });
    }
    return inflightRefresh;
  }

  /**
   * Send one text message to a Feishu user (by open_id). Normalized outcome:
   *   { ok: true, msgid }
   *   { ok: false, retryable, errcode }
   * An invalid/expired token refreshes and retries ONCE internally.
   */
  async function sendApplicationMessage({ toUser, content }, { _retried = false } = {}) {
    const token = await getAccessToken({ forceRefresh: _retried });
    const result = await httpJson(`${baseUrl}/open-apis/im/v1/messages?receive_id_type=open_id`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: {
        receive_id: String(toUser ?? ""),
        msg_type: "text",
        content: JSON.stringify({ text: String(content ?? "").slice(0, 4000) }),
      },
    });
    const code = Number(result?.code ?? 0);
    if (code === 0) {
      return { ok: true, msgid: String(result?.data?.message_id ?? "") };
    }
    if (TOKEN_CODES.has(code) && !_retried) {
      return sendApplicationMessage({ toUser, content }, { _retried: true });
    }
    return { ok: false, retryable: RETRYABLE_CODES.has(code) || TOKEN_CODES.has(code), errcode: code };
  }

  return { getAccessToken, sendApplicationMessage };
}
