import crypto from "node:crypto";

const TOKEN_BYTES = 32;

export function createBridgeCredentialRuntime({ state, now, persistStateSoon }) {
  function issueBridgeCredential({ rotate = false } = {}) {
    const existing = currentCredential();
    if (existing && !rotate) {
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
    credential.lastSeenAt = now();
    state.device.lastSeenAt = credential.lastSeenAt;
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
