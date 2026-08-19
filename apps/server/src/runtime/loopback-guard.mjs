/*
 * Loopback trust boundary (#1616). The single-device control plane listens on
 * 127.0.0.1 and spawns local agents; "reachable on loopback" must not mean
 * "authorized". Two independent checks:
 *
 * 1. Host allowlist — always on. A browser lured to an attacker hostname that
 *    DNS-rebinds to 127.0.0.1 sends that hostname in the Host header; the CORS
 *    layer's same-hostname rule would then reflect it. Rejecting non-loopback
 *    Hosts up front closes rebinding for every route, cached or not.
 *
 * 2. Launch token — on when MYAGENT_LOOPBACK_TOKEN is set (the Electron shell
 *    mints a fresh one per launch and hands it only to the processes it
 *    spawns). Every /api request must present it, or an authenticated cookie
 *    session that was itself established through it. Other local processes —
 *    the "any local process can drive the control plane" exposure — get 401.
 *
 * Not handled here: bridge device credentials (runtime/bridge-auth.mjs) and
 * user sessions (runtime/auth.mjs) — this is the outer perimeter, not actor
 * resolution.
 */
import { timingSafeEqual } from "node:crypto";

export const LOOPBACK_TOKEN_HEADER = "x-loopback-token";

// Hostname forms of the loopback interface as URL.hostname renders them.
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The launch token, if one is configured and plausibly strong. A short value
 *  is treated as absent rather than silently weakening the gate. */
export function configuredLoopbackToken(env = process.env) {
  const token = String(env.MYAGENT_LOOPBACK_TOKEN ?? "").trim();
  return token.length >= 32 ? token : null;
}

/**
 * Whether the request's Host header names an allowed hostname. Loopback names
 * always pass; anything else must be listed in MYAGENT_ALLOWED_HOSTS
 * (comma-separated hostnames, no ports). A missing or unparsable Host fails
 * closed — every legitimate HTTP/1.1 client sends one.
 */
export function hostAllowed(hostHeader, env = process.env) {
  const raw = String(hostHeader ?? "").trim();
  if (!raw) return false;
  let hostname;
  try {
    hostname = new URL(`http://${raw}`).hostname;
  } catch {
    return false;
  }
  if (LOOPBACK_HOSTNAMES.has(hostname)) return true;
  const extra = String(env.MYAGENT_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(hostname.toLowerCase());
}

/** Constant-time comparison of the request's launch-token header. */
export function loopbackTokenValid(req, token) {
  if (!token) return false;
  const supplied = String(req?.headers?.[LOOPBACK_TOKEN_HEADER] ?? "");
  const expected = Buffer.from(token);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
