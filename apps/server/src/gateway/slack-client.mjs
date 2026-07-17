/*
 * Slack outbound message client (SL2, #1128; ADR 0012 rule 4 + ADR 0013). The
 * SIMPLEST provider client: a STATIC bot token (`xoxb-…`) — no access_token
 * exchange, no refresh. The token lives in CLOSURE/MEMORY only; callers receive
 * the message `ts` or an error code, never the token.
 *
 * Sends via chat.postMessage; the `channel` field accepts a user id (opens/uses
 * the DM), so replies go to the sender. Transport injected for tests.
 */

const SLACK_API_BASE = "https://slack.com/api";

async function fetchJson(url, { method = "POST", headers, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json; charset=utf-8", ...(headers ?? {}) },
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

// Slack error strings that mean "back off and retry later".
const RATE_ERRORS = new Set(["ratelimited", "rate_limited"]);

export function createSlackClient({ botToken, httpJson = fetchJson, baseUrl = SLACK_API_BASE }) {
  if (!botToken) {
    throw new Error("slack_client_misconfigured");
  }

  /**
   * Send one text message to a Slack conversation (a user id → DM). Normalized:
   *   { ok: true, msgid }              // ts of the posted message
   *   { ok: false, retryable, errcode }
   * No token exchange — the static bot token authenticates every call.
   */
  async function sendApplicationMessage({ toUser, content }) {
    const { status, json } = await httpJson(`${baseUrl}/chat.postMessage`, {
      method: "POST",
      headers: { authorization: `Bearer ${botToken}` },
      body: { channel: String(toUser ?? ""), text: String(content ?? "").slice(0, 4000) },
    });
    if (json?.ok === true) {
      return { ok: true, msgid: String(json?.ts ?? "") };
    }
    // HTTP 429 or an explicit ratelimited error → retryable; every other Slack
    // error (channel_not_found, not_in_channel, invalid_auth, …) is terminal.
    const error = String(json?.error ?? (status === 429 ? "ratelimited" : `http_${status}`));
    const retryable = status === 429 || RATE_ERRORS.has(error) || (!json?.error && status >= 500);
    return { ok: false, retryable, errcode: error };
  }

  return { sendApplicationMessage };
}
