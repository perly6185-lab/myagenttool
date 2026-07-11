import crypto from "node:crypto";

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

  function issueBridgeCredential({ rotate = false } = {}) {
    const existing = currentCredential();
    // Reuse a live credential; re-issue if rotating OR the existing one idled
    // out, so a reconnecting bridge naturally recovers a fresh token.
    if (existing && !rotate && !credentialIsIdleExpired(existing)) {
      return { credential: publicCredential(existing), token: null, issued: false };
    }
    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const issuedAt = now();
    const credential = {
      id: "brg_cred_local_001",
      deviceId: state.device.id,
      tokenHash: hashBridgeToken(token),
      tokenPrefix: token.slice(0, 8),
      issuedAt,
      lastSeenAt: issuedAt,
      revokedAt: null,
    };
    state.device.bridgeCredential = credential;
    state.device.credentialRevokedAt = null;
    persistStateSoon();
    return { credential: publicCredential(credential), token, issued: true };
  }

  function requireBridgeCredential({ req, res, sendJson }) {
    const credential = currentCredential();
    if (state.device.unlinkState !== "linked" || state.device.credentialRevokedAt || credential?.revokedAt) {
      sendJson(res, 403, { error: "device_credentials_revoked" });
      return null;
    }
    if (!credential?.tokenHash) {
      sendJson(res, 401, { error: "bridge_credentials_required" });
      return null;
    }
    const token = bearer(req);
    if (!token || !verifyBridgeToken(token, credential.tokenHash)) {
      sendJson(res, 401, { error: "invalid_bridge_credentials" });
      return null;
    }
    // Idle expiry: a valid token unused past the TTL is rejected (re-register to
    // recover). Checked before refreshing lastSeenAt so the staleness is real.
    if (credentialIsIdleExpired(credential)) {
      sendJson(res, 401, { error: "bridge_credentials_expired" });
      return null;
    }
    credential.lastSeenAt = now();
    state.device.lastSeenAt = credential.lastSeenAt;
    // Liveness restore is symmetric with the staleness sweep that flips the
    // device offline (BRIDGE_LIVENESS_AND_REFUSAL.md): any authenticated bridge
    // request proves the bridge is back, immediately.
    if (state.device.status !== "online") {
      state.device.status = "online";
      state.device.livenessLostAt = null;
      state.device.updatedAt = credential.lastSeenAt;
      persistStateSoon();
      appendEvent?.({
        invocationId: null,
        type: "bridge_liveness_restored",
        level: "info",
        message: "Desktop Bridge is reachable again; device back online.",
        data: { deviceId: state.device.id },
      });
    }
    return credential;
  }

  function currentCredential() {
    return state.device?.bridgeCredential && typeof state.device.bridgeCredential === "object"
      ? state.device.bridgeCredential
      : null;
  }

  return {
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
