/*
 * DingTalk (钉钉) outbound message client (D2, #1119; ADR 0012 rule 4 + ADR 0013).
 * Lives on the gateway side of the credential boundary: it holds appKey/appSecret
 * and the cached access_token in CLOSURE/MEMORY only — nothing here is ever
 * persisted, and callers receive provider ids/codes, never token material.
 *
 * Sends a 1:1 robot message via the new-API robot batchSend. Transport is
 * injected (`httpJson`) so tests exercise every code branch with a fake.
 */

const DINGTALK_API_BASE = "https://api.dingtalk.com";
const TOKEN_SAFETY_MS = 60 * 1000;

async function fetchJson(url, { method = "GET", headers, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(headers ?? {}) },
    body: body ? JSON.stringify(body) : undefined,
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

// DingTalk new-API errors that mean "refresh the access token and retry once".
const TOKEN_CODE_MARKERS = ["accesstoken", "access_token", "token", "unauthorized", "authentication"];
// Codes/markers that mean "back off and retry later".
const RATE_MARKERS = ["limit", "flowcontrol", "frequency", "toomany"];

function classify(code) {
  const lower = String(code ?? "").toLowerCase();
  if (TOKEN_CODE_MARKERS.some((m) => lower.includes(m))) return "token";
  if (RATE_MARKERS.some((m) => lower.includes(m))) return "rate";
  return "terminal";
}

export function createDingtalkClient({
  appKey,
  appSecret,
  robotCode,
  httpJson = fetchJson,
  now = () => Date.now(),
  baseUrl = DINGTALK_API_BASE,
}) {
  if (!appKey || !appSecret || !robotCode) {
    throw new Error("dingtalk_client_misconfigured");
  }

  let cachedToken = null; // { token, expiresAtMs } — memory only, never persisted
  let inflightRefresh = null;

  async function refreshToken() {
    const { json } = await httpJson(`${baseUrl}/v1.0/oauth2/accessToken`, {
      method: "POST",
      body: { appKey, appSecret },
    });
    const token = String(json?.accessToken ?? "");
    if (!token) {
      throw Object.assign(new Error("dingtalk_token_fetch_failed"), { errcode: json?.code ?? "no_token" });
    }
    cachedToken = { token, expiresAtMs: now() + Math.max(0, Number(json?.expireIn ?? 7200) * 1000 - TOKEN_SAFETY_MS) };
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
   * Send one text message to a DingTalk user (by userid). Normalized outcome:
   *   { ok: true, msgid }
   *   { ok: false, retryable, errcode }
   * An invalid/expired token refreshes and retries ONCE internally.
   */
  async function sendApplicationMessage({ toUser, content }, { _retried = false } = {}) {
    const token = await getAccessToken({ forceRefresh: _retried });
    const { status, json } = await httpJson(`${baseUrl}/v1.0/robot/oToMessages/batchSend`, {
      method: "POST",
      headers: { "x-acs-dingtalk-access-token": token },
      body: {
        robotCode,
        userIds: [String(toUser ?? "")],
        msgKey: "sampleText",
        msgParam: JSON.stringify({ content: String(content ?? "").slice(0, 4000) }),
      },
    });
    if (status >= 200 && status < 300 && !json?.code) {
      return { ok: true, msgid: String(json?.processQueryKey ?? "") };
    }
    const kind = classify(json?.code);
    if (kind === "token" && !_retried) {
      return sendApplicationMessage({ toUser, content }, { _retried: true });
    }
    // A non-2xx status with NO machine code (5xx/HTML maintenance page, LB blip)
    // is a TRANSIENT failure, not terminal (code-review H2). Without this, a
    // routine provider outage would drop the delivery on the first attempt —
    // WeCom/Feishu already recover because their `.json()` throw is caught as
    // retryable; DingTalk must match.
    const transient = !json?.code && (status < 200 || status >= 300);
    return { ok: false, retryable: kind === "token" || kind === "rate" || transient, errcode: String(json?.code ?? status) };
  }

  return { getAccessToken, sendApplicationMessage };
}
