/*
 * WeCom application-message client (S5, #1090/ADR 0012 rule 4). Lives on the
 * gateway side of the credential boundary: it holds CorpSecret and the cached
 * access token in CLOSURE/MEMORY only — nothing here is ever persisted, and
 * callers receive provider msgids and errcodes, never token material.
 *
 * Transport is injected (`httpJson`) so tests exercise every errcode branch
 * with a fake; the default uses global fetch against the WeCom API.
 */

const WECOM_API_BASE = "https://qyapi.weixin.qq.com/cgi-bin";
// Refresh slightly early so a token never expires mid-send.
const TOKEN_SAFETY_MS = 60 * 1000;

// WeCom's text `content` limit is 2048 BYTES, not characters — a Chinese char is
// 3 UTF-8 bytes, so a char-based slice of 2048 sends up to ~6KB and WeCom rejects
// the whole message. Truncate on a code-point boundary within the byte budget.
function truncateUtf8(value, maxBytes) {
  const s = String(value ?? "");
  if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;
  let bytes = 0;
  let out = "";
  for (const ch of s) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > maxBytes) break;
    bytes += b;
    out += ch;
  }
  return out;
}

async function fetchJson(url, { method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    // A hung provider must not stall the serialized delivery sweep indefinitely.
    signal: AbortSignal.timeout(10_000),
  });
  return response.json();
}

/** errcodes that mean "refresh the access token and retry once". */
const TOKEN_ERRCODES = new Set([40014, 41001, 42001]);
/** errcodes that mean "back off and retry later" (rate limit / flow control). */
const RETRYABLE_ERRCODES = new Set([45009, 45033, -1]);

export function createWecomClient({
  corpId,
  corpSecret,
  agentId,
  httpJson = fetchJson,
  now = () => Date.now(),
  apiBase = WECOM_API_BASE,
}) {
  if (!corpId || !corpSecret || !agentId) {
    throw new Error("wecom_client_misconfigured");
  }

  let cachedToken = null; // { token, expiresAtMs } — memory only, never persisted
  let inflightRefresh = null;

  async function refreshToken() {
    const result = await httpJson(
      `${apiBase}/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`,
    );
    if (result?.errcode && result.errcode !== 0) {
      throw Object.assign(new Error("wecom_token_fetch_failed"), { errcode: result.errcode });
    }
    // Guard against caching an empty token (code-review LOW): a success-coded but
    // token-less response would otherwise be cached for the full window and every
    // send would go out with "".
    const token = String(result.access_token ?? "");
    if (!token) {
      throw Object.assign(new Error("wecom_token_fetch_failed"), { errcode: "empty_token" });
    }
    cachedToken = {
      token,
      expiresAtMs: now() + Math.max(0, Number(result.expires_in ?? 7200) * 1000 - TOKEN_SAFETY_MS),
    };
    return cachedToken.token;
  }

  async function getAccessToken({ forceRefresh = false } = {}) {
    if (!forceRefresh && cachedToken && cachedToken.expiresAtMs > now()) {
      return cachedToken.token;
    }
    // Single-flight: concurrent sends share one refresh instead of stampeding.
    if (!inflightRefresh) {
      inflightRefresh = refreshToken().finally(() => {
        inflightRefresh = null;
      });
    }
    return inflightRefresh;
  }

  /**
   * Send one application text message. Returns a normalized outcome the
   * delivery service can act on without knowing WeCom's errcode zoo:
   *   { ok: true, msgid }
   *   { ok: false, retryable, errcode }
   * Expired/invalid token refreshes and retries ONCE internally.
   */
  async function sendApplicationMessage({ toUser, content }, { _retried = false } = {}) {
    const token = await getAccessToken({ forceRefresh: _retried });
    const result = await httpJson(`${apiBase}/message/send?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      body: {
        touser: String(toUser ?? ""),
        msgtype: "text",
        agentid: Number(agentId),
        text: { content: truncateUtf8(content, 2048) },
        enable_duplicate_check: 1,
        duplicate_check_interval: 600,
      },
    });
    const errcode = Number(result?.errcode ?? 0);
    if (errcode === 0) {
      return { ok: true, msgid: String(result?.msgid ?? "") };
    }
    if (TOKEN_ERRCODES.has(errcode) && !_retried) {
      return sendApplicationMessage({ toUser, content }, { _retried: true });
    }
    return { ok: false, retryable: RETRYABLE_ERRCODES.has(errcode) || TOKEN_ERRCODES.has(errcode), errcode };
  }

  return { getAccessToken, sendApplicationMessage };
}
