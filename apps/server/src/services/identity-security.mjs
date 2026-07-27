import crypto from "node:crypto";

export const SESSION_COOKIE = "myagenttool_session";
export const CSRF_COOKIE = "myagenttool_csrf";
export const CHALLENGE_BINDING_COOKIE = "myagenttool_identity_binding";

export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;

function opaque(prefix, bytes = 32) {
  return `${prefix}_${crypto.randomBytes(bytes).toString("base64url")}`;
}

export function hashIdentitySecret(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

export function parseCookies(req) {
  const result = {};
  for (const pair of String(req?.headers?.cookie ?? "").split(";")) {
    const index = pair.indexOf("=");
    if (index < 1) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!name || Object.hasOwn(result, name)) continue;
    try {
      result[name] = decodeURIComponent(value);
    } catch {
      result[name] = value;
    }
  }
  return result;
}

function cookie(name, value, { httpOnly = false, secure = false, maxAge = null } = {}) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    ...(httpOnly ? ["HttpOnly"] : []),
    ...(secure ? ["Secure"] : []),
    ...(Number.isFinite(maxAge) ? [`Max-Age=${Math.max(0, Math.floor(maxAge))}`] : []),
  ];
  return attributes.join("; ");
}

export function setIdentityCookies(res, { sessionSecret, csrfSecret, bindingSecret } = {}, options = {}) {
  const values = [];
  if (sessionSecret) {
    values.push(cookie(SESSION_COOKIE, sessionSecret, {
      httpOnly: true,
      secure: options.secure,
      maxAge: SESSION_ABSOLUTE_MS / 1000,
    }));
  }
  if (csrfSecret) {
    values.push(cookie(CSRF_COOKIE, csrfSecret, {
      secure: options.secure,
      maxAge: SESSION_ABSOLUTE_MS / 1000,
    }));
  }
  if (bindingSecret) {
    values.push(cookie(CHALLENGE_BINDING_COOKIE, bindingSecret, {
      httpOnly: true,
      secure: options.secure,
      maxAge: CHALLENGE_TTL_MS / 1000,
    }));
  }
  if (values.length) res.setHeader("Set-Cookie", values);
}

export function clearIdentityCookies(res, { secure = false } = {}) {
  res.setHeader("Set-Cookie", [
    cookie(SESSION_COOKIE, "", { httpOnly: true, secure, maxAge: 0 }),
    cookie(CSRF_COOKIE, "", { secure, maxAge: 0 }),
    cookie(CHALLENGE_BINDING_COOKIE, "", { httpOnly: true, secure, maxAge: 0 }),
  ]);
}

export function createServerSession(state, user, now = new Date(), { mode = "password" } = {}) {
  state.identitySessions ??= [];
  const sessionSecret = opaque("sid");
  const csrfSecret = opaque("csrf", 24);
  const createdMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const record = {
    id: opaque("ids", 18),
    tokenHash: hashIdentitySecret(sessionSecret),
    csrfHash: hashIdentitySecret(csrfSecret),
    userId: user.id,
    teamId: user.teamId,
    mode,
    sessionEpoch: Number(user.sessionEpoch ?? 0),
    createdAt: new Date(createdMs).toISOString(),
    lastSeenAt: new Date(createdMs).toISOString(),
    idleExpiresAt: new Date(createdMs + SESSION_IDLE_MS).toISOString(),
    absoluteExpiresAt: new Date(createdMs + SESSION_ABSOLUTE_MS).toISOString(),
    revokedAt: null,
  };
  state.identitySessions.unshift(record);
  state.identitySessions = state.identitySessions.slice(0, 200);
  auditIdentity(state, {
    id: opaque("ida", 12),
    type: "identity.session.created",
    sessionId: record.id,
    userId: record.userId,
    teamId: record.teamId,
    outcome: "created",
    at: record.createdAt,
  });
  return { record, sessionSecret, csrfSecret };
}

export function resolveServerSession(state, req, now = new Date()) {
  const secret = parseCookies(req)[SESSION_COOKIE];
  if (!secret) return null;
  const tokenHash = hashIdentitySecret(secret);
  const record = (state.identitySessions ?? []).find((item) => item.tokenHash === tokenHash);
  if (!record || record.revokedAt) return null;
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (Date.parse(record.idleExpiresAt) <= nowMs || Date.parse(record.absoluteExpiresAt) <= nowMs) return null;
  const user = (state.users ?? []).find((item) => item.id === record.userId);
  if (!user || user.teamId !== record.teamId || Number(user.sessionEpoch ?? 0) !== record.sessionEpoch) return null;
  const touched = nowMs - Date.parse(record.lastSeenAt) >= 60_000;
  if (touched) {
    record.lastSeenAt = new Date(nowMs).toISOString();
    record.idleExpiresAt = new Date(Math.min(
      nowMs + SESSION_IDLE_MS,
      Date.parse(record.absoluteExpiresAt),
    )).toISOString();
  }
  return { record, user, touched };
}

export function revokeServerSession(state, sessionId, now = new Date()) {
  const record = (state.identitySessions ?? []).find((item) => item.id === sessionId);
  if (!record || record.revokedAt) return false;
  record.revokedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  auditIdentity(state, {
    id: opaque("ida", 12),
    type: "identity.session.revoked",
    sessionId: record.id,
    userId: record.userId,
    teamId: record.teamId,
    outcome: "current_device",
    at: record.revokedAt,
  });
  return true;
}

export function revokeAllUserSessions(state, userId, now = new Date()) {
  const user = (state.users ?? []).find((item) => item.id === userId);
  if (!user) return 0;
  user.sessionEpoch = Number(user.sessionEpoch ?? 0) + 1;
  const revokedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  let revoked = 0;
  for (const session of state.identitySessions ?? []) {
    if (session.userId !== userId || session.revokedAt) continue;
    session.revokedAt = revokedAt;
    revoked += 1;
  }
  auditIdentity(state, {
    id: opaque("ida", 12),
    type: "identity.session.revoked",
    userId,
    outcome: "all_devices",
    revokedCount: revoked,
    at: revokedAt,
  });
  return revoked;
}

export function validSessionCsrf(req, session) {
  const supplied = String(req?.headers?.["x-csrf-token"] ?? "");
  if (!supplied || !session?.csrfHash) return false;
  const actual = Buffer.from(hashIdentitySecret(supplied), "hex");
  const expected = Buffer.from(session.csrfHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function auditIdentity(state, event) {
  state.identityAuditEvents ??= [];
  state.identityAuditEvents.unshift(event);
  state.identityAuditEvents = state.identityAuditEvents.slice(0, 500);
}

export function createIdentityChallenge(
  state,
  { provider, bindingSecret, authorizationUri, deviceContext = null },
  now = new Date(),
) {
  state.identityChallenges ??= [];
  const createdMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const id = opaque("idc", 18);
  const record = {
    id,
    provider,
    state: "pending",
    bindingHash: hashIdentitySecret(bindingSecret),
    deviceHash: deviceContext ? hashIdentitySecret(deviceContext) : null,
    authorizationUriHash: hashIdentitySecret(authorizationUri),
    createdAt: new Date(createdMs).toISOString(),
    expiresAt: new Date(createdMs + CHALLENGE_TTL_MS).toISOString(),
    authorizedAt: null,
    consumedAt: null,
    failureCode: null,
  };
  state.identityChallenges.unshift(record);
  state.identityChallenges = state.identityChallenges.slice(0, 500);
  auditIdentity(state, {
    id: opaque("ida", 12),
    type: "identity.challenge.created",
    challengeId: id,
    provider,
    outcome: "pending",
    at: record.createdAt,
  });
  return {
    challenge: publicChallenge(record),
    authorizationUri,
  };
}

export function authorizeIdentityChallenge(
  state,
  { challengeId, bindingSecret, providerSubject },
  now = new Date(),
) {
  const record = (state.identityChallenges ?? []).find((item) => item.id === challengeId);
  const nowDate = now instanceof Date ? now : new Date(now);
  if (!record) return { ok: false, error: "challenge_not_found" };
  if (record.state !== "pending") return { ok: false, error: "challenge_not_pending" };
  if (Date.parse(record.expiresAt) <= nowDate.getTime()) {
    record.state = "expired";
    auditIdentity(state, {
      id: opaque("ida", 12),
      type: "identity.challenge.expired",
      challengeId,
      provider: record.provider,
      outcome: "expired",
      at: nowDate.toISOString(),
    });
    return { ok: false, error: "challenge_expired" };
  }
  if (record.bindingHash !== hashIdentitySecret(bindingSecret)) {
    auditIdentity(state, {
      id: opaque("ida", 12),
      type: "identity.provider.rejected",
      challengeId,
      provider: record.provider,
      outcome: "binding_mismatch",
      at: nowDate.toISOString(),
    });
    return { ok: false, error: "challenge_binding_mismatch" };
  }
  record.state = "authorized";
  record.providerSubjectHash = hashIdentitySecret(providerSubject);
  record.authorizedAt = nowDate.toISOString();
  return { ok: true, challenge: publicChallenge(record) };
}

export function consumeIdentityChallenge(state, { challengeId, bindingSecret }, now = new Date()) {
  const record = (state.identityChallenges ?? []).find((item) => item.id === challengeId);
  const nowDate = now instanceof Date ? now : new Date(now);
  if (!record) return { ok: false, error: "challenge_not_found" };
  if (record.bindingHash !== hashIdentitySecret(bindingSecret)) {
    return { ok: false, error: "challenge_binding_mismatch" };
  }
  // The state transition is the compare-and-set boundary: only authorized can
  // become consumed, so a replay can never mint a second session.
  if (record.state !== "authorized") {
    if (record.state === "consumed") {
      auditIdentity(state, {
        id: opaque("ida", 12),
        type: "identity.challenge.replayed",
        challengeId,
        provider: record.provider,
        outcome: "rejected",
        at: nowDate.toISOString(),
      });
      return { ok: false, error: "challenge_replayed" };
    }
    return { ok: false, error: "challenge_not_authorized" };
  }
  if (Date.parse(record.expiresAt) <= nowDate.getTime()) {
    record.state = "expired";
    return { ok: false, error: "challenge_expired" };
  }
  record.state = "consumed";
  record.consumedAt = nowDate.toISOString();
  auditIdentity(state, {
    id: opaque("ida", 12),
    type: "identity.challenge.consumed",
    challengeId,
    provider: record.provider,
    outcome: "consumed",
    at: nowDate.toISOString(),
  });
  return { ok: true, challenge: publicChallenge(record) };
}

export function expireIdentityChallenge(state, challengeId, now = new Date()) {
  const record = (state.identityChallenges ?? []).find((item) => item.id === challengeId);
  const nowDate = now instanceof Date ? now : new Date(now);
  if (!record || !["pending", "authorized"].includes(record.state)) return false;
  if (Date.parse(record.expiresAt) > nowDate.getTime()) return false;
  record.state = "expired";
  auditIdentity(state, {
    id: opaque("ida", 12),
    type: "identity.challenge.expired",
    challengeId,
    provider: record.provider,
    outcome: "expired",
    at: nowDate.toISOString(),
  });
  return true;
}

export function cancelIdentityChallenge(state, { challengeId, bindingSecret }, now = new Date()) {
  const record = (state.identityChallenges ?? []).find((item) => item.id === challengeId);
  if (!record || record.bindingHash !== hashIdentitySecret(bindingSecret)) {
    return { ok: false, error: "challenge_not_found" };
  }
  if (!["pending", "authorized"].includes(record.state)) {
    return { ok: false, error: "challenge_terminal" };
  }
  const nowDate = now instanceof Date ? now : new Date(now);
  record.state = "cancelled";
  auditIdentity(state, {
    id: opaque("ida", 12),
    type: "identity.challenge.cancelled",
    challengeId,
    provider: record.provider,
    outcome: "cancelled",
    at: nowDate.toISOString(),
  });
  return { ok: true, challenge: publicChallenge(record) };
}

export function rejectIdentityChallenge(state, { challengeId, reasonCode = "provider_rejected" }, now = new Date()) {
  const record = (state.identityChallenges ?? []).find((item) => item.id === challengeId);
  if (!record || !["pending", "authorized"].includes(record.state)) {
    return { ok: false, error: "challenge_terminal" };
  }
  const nowDate = now instanceof Date ? now : new Date(now);
  record.state = "rejected";
  record.failureCode = String(reasonCode).slice(0, 80);
  auditIdentity(state, {
    id: opaque("ida", 12),
    type: "identity.provider.rejected",
    challengeId,
    provider: record.provider,
    outcome: "rejected",
    reasonCode: record.failureCode,
    at: nowDate.toISOString(),
  });
  return { ok: true, challenge: publicChallenge(record) };
}

export function publicChallenge(record) {
  return {
    id: record.id,
    provider: record.provider,
    state: record.state,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

export function newChallengeBinding() {
  return opaque("idb");
}
