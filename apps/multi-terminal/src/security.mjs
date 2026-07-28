import { createHmac, timingSafeEqual } from "node:crypto";

export function requireSecureDeployment(env = process.env) {
  const host = env.MULTI_TERMINAL_HOST ?? "127.0.0.1";
  const proxy = env.MULTI_TERMINAL_TRUST_PROXY === "true";
  const tls = env.MULTI_TERMINAL_TLS_TERMINATED === "true";
  if (!["127.0.0.1", "::1", "localhost"].includes(host) && (!proxy || !tls)) {
    throw new Error("non-loopback binding requires an authenticated TLS reverse proxy");
  }
  return host;
}

export function bearerAuthorized(header, expected, { minimumLength = 24 } = {}) {
  const supplied = String(header ?? "").replace(/^Bearer\s+/i, "");
  const secret = String(expected ?? "");
  if (secret.length < minimumLength || supplied.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
}

export function signWebhook(secret, timestamp, body) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifyWebhookSignature({ secret, timestamp, body, signature, now = Date.now(), toleranceMs = 300_000 }) {
  if (!secret || !/^\d{10,13}$/.test(String(timestamp))) return false;
  const time = Number(timestamp) < 10_000_000_000 ? Number(timestamp) * 1000 : Number(timestamp);
  if (Math.abs(now - time) > toleranceMs) return false;
  const expected = signWebhook(secret, timestamp, body);
  return typeof signature === "string" && signature.length === expected.length
    && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
