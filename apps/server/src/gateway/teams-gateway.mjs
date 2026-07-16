/*
 * Microsoft Teams / Bot Framework callback gateway (T1, #1135; ADR 0012 rule 1 +
 * ADR 0013). A separate public listener serving only the messaging endpoint — an
 * /api/* probe gets the same bodyless 404. Verified, normalized Activities
 * forward into the SHARED importChannelEvent (with a replyContext so delivery
 * can reply to the originating conversation's serviceUrl).
 *
 * Teams specifics: POST-only, `Authorization: Bearer <JWT>` (RS256, validated
 * against the Bot Framework JWKS — fetched + cached here), plaintext JSON
 * Activity. Secrets never touch this file (validation is public-key only).
 */

import http from "node:http";

import { readCappedBody } from "./read-body.mjs";
import { parseTeamsActivity, verifyTeamsJwt } from "./teams-crypto.mjs";

const MAX_BODY_BYTES = 256 * 1024; // Activities can carry attachments metadata
const MAX_SEEN = 10_000;
const OPENID_METADATA_URL = "https://login.botframework.com/v1/.well-known/openidconfiguration";
const JWKS_TTL_MS = 24 * 60 * 60 * 1000; // Bot Framework keys rotate slowly

async function defaultFetchJwks() {
  const meta = await fetch(OPENID_METADATA_URL).then((r) => r.json());
  const jwks = await fetch(meta.jwks_uri).then((r) => r.json());
  return jwks.keys ?? [];
}

export function createTeamsGateway({
  appId,
  channelId,
  importChannelEvent,
  callbackPath = "/teams/callback",
  fetchJwks = defaultFetchJwks,
  now = () => Date.now(),
}) {
  if (!appId || !channelId || !importChannelEvent) {
    throw new Error("teams_gateway_misconfigured");
  }

  let jwksCache = { keys: null, fetchedAtMs: 0 };
  let jwksInflight = null;

  async function getJwksKeys() {
    if (jwksCache.keys && now() - jwksCache.fetchedAtMs < JWKS_TTL_MS) {
      return jwksCache.keys;
    }
    if (!jwksInflight) {
      jwksInflight = Promise.resolve(fetchJwks())
        .then((keys) => {
          jwksCache = { keys: keys ?? [], fetchedAtMs: now() };
          return jwksCache.keys;
        })
        .finally(() => {
          jwksInflight = null;
        });
    }
    return jwksInflight;
  }

  const seen = new Map();
  function replayChecked(activityId) {
    const nowMs = now();
    for (const [key, expiresAt] of seen) {
      if (expiresAt <= nowMs) seen.delete(key);
    }
    while (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value);
    if (seen.has(activityId)) return false;
    seen.set(activityId, nowMs + JWKS_TTL_MS);
    return true;
  }

  function send(res, status, body, headers) {
    res.writeHead(status, headers);
    res.end(body ?? "");
  }

  function bearer(req) {
    const header = String(req.headers?.authorization ?? "");
    return header.startsWith("Bearer ") ? header.slice(7) : null;
  }

  async function handleRequest(req, res) {
    const url = new URL(req.url ?? "/", "http://gateway.invalid");
    if (url.pathname !== callbackPath) {
      send(res, 404);
      return;
    }
    if (req.method !== "POST") {
      send(res, 405);
      return;
    }
    const token = bearer(req);
    if (!token) {
      send(res, 401);
      return;
    }

    const { raw, overflow } = await readCappedBody(req, MAX_BODY_BYTES);
    if (overflow) {
      send(res, 413);
      return;
    }

    let keys;
    try {
      keys = await getJwksKeys();
    } catch {
      // Can't validate without keys — refuse rather than trust.
      send(res, 503);
      return;
    }
    const verdict = verifyTeamsJwt({ token, appId, jwksKeys: keys, now });
    if (!verdict.ok) {
      send(res, 401);
      return;
    }

    const parsed = parseTeamsActivity(raw);
    if (parsed.kind !== "message") {
      send(res, 200, "");
      return;
    }
    if (parsed.activityId && !replayChecked(parsed.activityId)) {
      send(res, 200, ""); // a retry — ack, do not re-import
      return;
    }

    try {
      await importChannelEvent({
        channelId,
        providerMessageId: parsed.activityId,
        externalUserId: parsed.externalUserId,
        msgType: "text",
        content: parsed.content,
        providerCreateTime: parsed.createTime,
        agentId: null,
        // The reply address for this conversation (#1135).
        replyContext: { serviceUrl: parsed.serviceUrl, conversationId: parsed.conversationId },
      });
    } catch {
      // Import must never take the public socket down; Teams just retries.
    }
    send(res, 200, "");
  }

  function createServer() {
    return http.createServer((req, res) => {
      handleRequest(req, res).catch(() => {
        try {
          res.writeHead(500);
          res.end();
        } catch {
          // socket already gone
        }
      });
    });
  }

  return { handleRequest, createServer, getJwksKeys };
}

/** Gateway config from env. Presence-only readiness for this lives in channels.mjs. */
export function teamsGatewayConfigFromEnv(env = process.env) {
  const port = Number(env.TEAMS_GATEWAY_PORT);
  return {
    port: Number.isFinite(port) && port > 0 ? port : null,
    host: String(env.TEAMS_GATEWAY_HOST ?? "0.0.0.0"),
    appId: String(env.TEAMS_APP_ID ?? "").trim() || null,
    channelId: String(env.TEAMS_CHANNEL_ID ?? "").trim() || null,
  };
}
