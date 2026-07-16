/*
 * Microsoft Teams / Bot Framework inbound authentication (T1, #1135). node:crypto
 * only — no JWT library. Teams authenticates each callback with a Bearer JWT
 * (RS256) that must be validated against the Bot Framework JWKS:
 *
 *   - decode header/payload (base64url)
 *   - select the JWKS key by the header `kid`
 *   - import the JWK via crypto.createPublicKey({format:"jwk"}) and verify the
 *     RSA-SHA256 signature over `${headerB64}.${payloadB64}`
 *   - check claims: iss ∈ allowed issuers, aud === bot app id, exp/nbf window
 *
 * The JWKS is fetched + cached by the gateway (injected here, so tests use a
 * locally-generated keypair). The Activity body is plaintext JSON.
 */

import { createPublicKey, verify as cryptoVerify } from "node:crypto";

const DEFAULT_ISSUERS = [
  "https://api.botframework.com",
  "https://api.botframework.us",
];
const CLOCK_SKEW_SECONDS = 300;

function b64urlToBuffer(part) {
  return Buffer.from(String(part ?? ""), "base64url");
}

function decodeJwt(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(b64urlToBuffer(headerB64).toString("utf8"));
    payload = JSON.parse(b64urlToBuffer(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  return {
    header,
    payload,
    signingInput: `${headerB64}.${payloadB64}`,
    signature: b64urlToBuffer(signatureB64),
  };
}

/**
 * Verify a Bot Framework JWT. Returns `{ ok: true, payload }` or
 * `{ ok: false, reason }`. `jwksKeys` is the array of JWK objects from the
 * provider's JWKS document.
 */
export function verifyTeamsJwt({ token, appId, jwksKeys = [], now = () => Date.now(), issuers = DEFAULT_ISSUERS }) {
  const decoded = decodeJwt(token);
  if (!decoded) return { ok: false, reason: "malformed_token" };
  const { header, payload, signingInput, signature } = decoded;

  if (header.alg !== "RS256") return { ok: false, reason: "unexpected_alg" };
  const jwk = (jwksKeys ?? []).find((key) => key.kid === header.kid);
  if (!jwk) return { ok: false, reason: "unknown_kid" };

  let keyObject;
  try {
    keyObject = createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    return { ok: false, reason: "bad_jwk" };
  }
  let signatureOk = false;
  try {
    signatureOk = cryptoVerify("RSA-SHA256", Buffer.from(signingInput, "utf8"), keyObject, signature);
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return { ok: false, reason: "bad_signature" };

  // Claims. iss/aud pin the token to the Bot Framework and THIS bot; exp/nbf
  // bound its lifetime (with a small clock-skew allowance).
  if (!issuers.includes(String(payload.iss ?? ""))) return { ok: false, reason: "bad_issuer" };
  if (String(payload.aud ?? "") !== String(appId ?? "")) return { ok: false, reason: "bad_audience" };
  const nowSec = Math.floor(now() / 1000);
  if (Number.isFinite(payload.exp) && nowSec > payload.exp + CLOCK_SKEW_SECONDS) return { ok: false, reason: "expired" };
  if (Number.isFinite(payload.nbf) && nowSec < payload.nbf - CLOCK_SKEW_SECONDS) return { ok: false, reason: "not_yet_valid" };

  return { ok: true, payload };
}

/**
 * Parse a Bot Framework Activity into a normalized, discriminated shape. Total:
 * never throws; a non-message activity returns `{ kind: "unknown" }`. The
 * reply context (serviceUrl + conversation id) is carried through so delivery
 * can reply where the message came from (#1135).
 */
export function parseTeamsActivity(jsonString) {
  let doc;
  try {
    doc = JSON.parse(String(jsonString ?? ""));
  } catch {
    return { kind: "unknown" };
  }
  if (doc?.type !== "message") return { kind: "unknown" };
  const externalUserId = String(doc?.from?.id ?? "");
  const conversationId = String(doc?.conversation?.id ?? "");
  const serviceUrl = String(doc?.serviceUrl ?? "");
  const activityId = String(doc?.id ?? "");
  if (!externalUserId || !conversationId || !activityId) return { kind: "unknown" };
  return {
    kind: "message",
    activityId,
    externalUserId,
    conversationId,
    serviceUrl,
    content: String(doc?.text ?? "").trim(),
    createTime: String(doc?.timestamp ?? ""),
  };
}
