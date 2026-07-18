/*
 * Microsoft Teams / Bot Framework outbound client (T2, #1135; ADR 0012 rule 4 +
 * ADR 0013). Holds appId/appPassword + a cached Azure AD access_token IN
 * CLOSURE/MEMORY only — never persisted; callers receive an activity id or an
 * error code, never token material.
 *
 * Reply address is the inbound `replyContext` ({serviceUrl, conversationId}),
 * not a user id — Teams replies go to the originating conversation:
 *   POST {serviceUrl}/v3/conversations/{conversationId}/activities
 * authenticated by an Azure AD client-credentials token. Transport is injected.
 */

const AAD_TOKEN_URL = "https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token";
const BOTFRAMEWORK_SCOPE = "https://api.botframework.com/.default";
const TOKEN_SAFETY_MS = 60 * 1000;

async function fetchJson(url, { method = "GET", headers, body, form } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: form ? new URLSearchParams(form).toString() : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const status = response.status;
  let json = {};
  try {
    json = await response.json();
  } catch {
    json = {};
  }
  return { status, json };
}

export function createTeamsClient({
  appId,
  appPassword,
  httpJson = fetchJson,
  now = () => Date.now(),
  tokenUrl = AAD_TOKEN_URL,
}) {
  if (!appId || !appPassword) {
    throw new Error("teams_client_misconfigured");
  }

  let cachedToken = null; // { token, expiresAtMs } — memory only
  let inflightRefresh = null;

  async function refreshToken() {
    const { json } = await httpJson(tokenUrl, {
      method: "POST",
      form: { grant_type: "client_credentials", client_id: appId, client_secret: appPassword, scope: BOTFRAMEWORK_SCOPE },
    });
    const token = String(json?.access_token ?? "");
    if (!token) {
      throw Object.assign(new Error("teams_token_fetch_failed"), { errcode: json?.error ?? "no_token" });
    }
    cachedToken = { token, expiresAtMs: now() + Math.max(0, Number(json?.expires_in ?? 3600) * 1000 - TOKEN_SAFETY_MS) };
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
   * Send one text message to the originating Teams conversation. `replyContext`
   * = {serviceUrl, conversationId} captured at inbound. Normalized outcome:
   *   { ok: true, msgid }              // the posted activity id
   *   { ok: false, retryable, errcode }
   * An unauthorized token refreshes and retries ONCE.
   */
  async function sendApplicationMessage({ content, replyContext }, { _retried = false } = {}) {
    const serviceUrl = String(replyContext?.serviceUrl ?? "").replace(/\/+$/, "");
    const conversationId = String(replyContext?.conversationId ?? "");
    if (!serviceUrl || !conversationId) {
      return { ok: false, retryable: false, errcode: "missing_reply_context" };
    }
    const token = await getAccessToken({ forceRefresh: _retried });
    const { status, json } = await httpJson(
      `${serviceUrl}/v3/conversations/${encodeURIComponent(conversationId)}/activities`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: { type: "message", text: String(content ?? "").slice(0, 4000) },
      },
    );
    if (status >= 200 && status < 300) {
      return { ok: true, msgid: String(json?.id ?? "") };
    }
    if (status === 401 && !_retried) {
      return sendApplicationMessage({ content, replyContext }, { _retried: true });
    }
    // 429 / 5xx are transient; other 4xx are terminal.
    const retryable = status === 429 || status >= 500;
    return { ok: false, retryable, errcode: String(json?.error?.code ?? json?.error ?? status) };
  }

  return { getAccessToken, sendApplicationMessage };
}
