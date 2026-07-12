import crypto from "node:crypto";

import { listDevices, primaryDevice } from "./device.mjs";

const TOKEN_BYTES = 32;
// A bridge credential expires after this much inactivity. An active bridge polls
// continuously so it never idles out; a LEAKED-but-unused bearer stops working
// once the TTL elapses, bounding its lifetime without a manual revoke. Uses the
// existing lastSeenAt (updated every request), so there is no extra state churn.
const DEFAULT_CREDENTIAL_IDLE_TTL_MS = Number(process.env.MYAGENTTOOL_BRIDGE_CREDENTIAL_IDLE_TTL_MS) || 12 * 60 * 60 * 1000;

export function createBridgeCredentialRuntime({ state, now, persistStateSoon, appendEvent = null, credentialIdleTtlMs = DEFAULT_CREDENTIAL_IDLE_TTL_MS }) {
  function credentialIsIdleExpired(credential, atMs = Date.parse(now())) {
    const lastSeenMs = Date.parse(credential?.lastSeenAt ?? credential?.issuedAt ?? "");
    return Number.isFinite(lastSeenMs) && Number.isFinite(atMs) && atMs - lastSeenMs > credentialIdleTtlMs;
  }

  function issueBridgeCredential({ deviceId = null, rotate = false } = {}) {
    const device = (deviceId ? findDeviceById(deviceId) : primaryDevice(state)) ?? null;
    if (!device) {
      return { credential: null, token: null, issued: false };
    }
    const existing = credentialOf(device);
    // Reuse a live credential; re-issue if rotating OR the existing one idled
    // out, so a reconnecting bridge naturally recovers a fresh token.
    if (existing && !rotate && !credentialIsIdleExpired(existing)) {
      return { credential: publicCredential(existing), token: null, issued: false };
    }
    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const issuedAt = now();
    const credential = {
      id: `brg_cred_${device.id}`,
      deviceId: device.id,
      tokenHash: hashBridgeToken(token),
      tokenPrefix: token.slice(0, 8),
      issuedAt,
      lastSeenAt: issuedAt,
      revokedAt: null,
    };
    device.bridgeCredential = credential;
    device.credentialRevokedAt = null;
    persistStateSoon();
    return { credential: publicCredential(credential), token, issued: true };
  }

  /**
   * The bearer token IS the device identity: each device holds its own
   * credential, so the only machine a token can name is the one whose hash it
   * matches. Every device is compared (each comparison constant-time) — the
   * size of the fleet is not a secret, and short-circuiting on a prefix would
   * leak which device a guessed token was closest to.
   */
  function deviceForToken(token) {
    if (!token) return null;
    return listDevices(state).find((device) => {
      const tokenHash = credentialOf(device)?.tokenHash;
      return tokenHash && verifyBridgeToken(token, tokenHash);
    }) ?? null;
  }

  /**
   * Authenticate a bridge request and return the DEVICE that made it — not just
   * the credential. Callers must route and gate on this device rather than on
   * `state.device` (the primary alias), or every ownership check collapses into
   * comparing the primary device to itself.
   *
   * Revocation is checked *after* the token resolves a device: in a fleet there
   * is no "the" device to check first, and an unauthenticated caller has no
   * business learning whether some machine was unlinked. A revoked device keeps
   * its token hash (unlink only stamps `revokedAt`), so its own bridge still
   * resolves here and still gets the 403 it did before.
   */
  function requireBridgeCredential({ req, res, sendJson }) {
    if (!listDevices(state).some((device) => credentialOf(device)?.tokenHash)) {
      sendJson(res, 401, { error: "bridge_credentials_required" });
      return null;
    }
    const device = deviceForToken(bearer(req));
    if (!device) {
      sendJson(res, 401, { error: "invalid_bridge_credentials" });
      return null;
    }
    const credential = credentialOf(device);
    if (device.unlinkState !== "linked" || device.credentialRevokedAt || credential.revokedAt) {
      sendJson(res, 403, { error: "device_credentials_revoked" });
      return null;
    }
    // Idle expiry: a valid token unused past the TTL is rejected (re-register to
    // recover). Checked before refreshing lastSeenAt so the staleness is real.
    if (credentialIsIdleExpired(credential)) {
      sendJson(res, 401, { error: "bridge_credentials_expired" });
      return null;
    }
    credential.lastSeenAt = now();
    device.lastSeenAt = credential.lastSeenAt;
    // Liveness restore is symmetric with the staleness sweep that flips a device
    // offline (BRIDGE_LIVENESS_AND_REFUSAL.md): any authenticated bridge request
    // proves that bridge is back, immediately.
    //
    // It restores THE DEVICE THE TOKEN NAMED, not the primary alias. On a fleet
    // those differ, and restoring `state.device` here would mark the wrong
    // machine online — one that may still be unreachable — every time any other
    // device polled.
    if (device.status !== "online") {
      device.status = "online";
      device.livenessLostAt = null;
      device.updatedAt = credential.lastSeenAt;
      persistStateSoon();
      appendEvent?.({
        invocationId: null,
        type: "bridge_liveness_restored",
        level: "info",
        message: "Desktop Bridge is reachable again; device back online.",
        data: { deviceId: device.id },
      });
    }
    return device;
  }

  function findDeviceById(deviceId) {
    return listDevices(state).find((device) => device?.id === deviceId) ?? null;
  }

  function credentialOf(device) {
    return device?.bridgeCredential && typeof device.bridgeCredential === "object"
      ? device.bridgeCredential
      : null;
  }

  return {
    deviceForToken,
    issueBridgeCredential,
    requireBridgeCredential,
  };
}

export function hashBridgeToken(token) {
  return crypto.createHash("sha256").update(String(token ?? ""), "utf8").digest("hex");
}

function verifyBridgeToken(token, expectedHash) {
  const expected = Buffer.from(String(expectedHash ?? ""), "hex");
  const actual = Buffer.from(hashBridgeToken(token), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function bearer(req) {
  const header = req?.headers?.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(String(header));
  return match ? match[1].trim() : null;
}

function publicCredential(credential) {
  if (!credential) return null;
  return {
    id: credential.id,
    deviceId: credential.deviceId,
    tokenPrefix: credential.tokenPrefix,
    issuedAt: credential.issuedAt,
    lastSeenAt: credential.lastSeenAt,
    revokedAt: credential.revokedAt ?? null,
  };
}

export function publicDeviceView(device) {
  if (!device || typeof device !== "object") return device;
  const { bridgeCredential, ...rest } = device;
  return {
    ...rest,
    bridgeCredential: publicCredential(bridgeCredential),
  };
}
