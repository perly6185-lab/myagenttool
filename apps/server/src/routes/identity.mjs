import crypto from "node:crypto";

import { isEnterpriseIdentityProvider } from "@myagenttool/protocol/identity";
import { hashPassword, verifyPassword } from "../runtime/auth.mjs";
import { publicIdentityOptions } from "../runtime/identity-policy.mjs";
import {
  CHALLENGE_BINDING_COOKIE,
  cancelIdentityChallenge,
  clearIdentityCookies,
  createServerSession,
  expireIdentityChallenge,
  hashIdentitySecret,
  newChallengeBinding,
  parseCookies,
  publicChallenge,
  revokeAllUserSessions,
  revokeServerSession,
  setIdentityCookies,
} from "../services/identity-security.mjs";
import {
  clearPasswordLoginFailures,
  completePasswordRecovery,
  createPasswordRecoveryGrant,
  listIdentitySecurityAlerts,
  passwordLoginStatus,
  recordPasswordLoginFailure,
} from "../services/password-recovery.mjs";

// Unknown accounts still take the same scrypt verification path as known
// accounts. The random dummy credential exists only in process memory.
const DUMMY_PASSWORD_HASH = hashPassword(crypto.randomBytes(32).toString("base64url"));

function boundedIdentifier(value, maxLength = 128) {
  const text = String(value ?? "").trim();
  if (Array.from(text).length <= maxLength) return text;
  return `invalid_${hashIdentitySecret(text)}`;
}

function safeUser(user) {
  if (!user) return null;
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

function legacyBearer(state, user, now) {
  const token = `tok_${crypto.randomBytes(24).toString("base64url")}`;
  const record = {
    id: `tok_${crypto.randomBytes(12).toString("base64url")}`,
    token,
    userId: user.id,
    teamId: user.teamId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    revokedAt: null,
  };
  state.tokens ??= [];
  state.tokens.unshift(record);
  state.tokens = state.tokens.slice(0, 20);
  return token;
}

export async function handleIdentityRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
  actor,
  now,
  persistStateSoon,
  policy,
  providerCore = null,
}) {
  const availableProviders = providerCore?.availableProviders?.() ?? [];

  if (req.method === "GET" && url.pathname === "/api/identity/options") {
    sendJson(res, 200, publicIdentityOptions(policy, availableProviders));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    if (!actor?.authenticated) {
      sendJson(res, 401, { error: "unauthenticated" });
      return true;
    }
    const user = (state.users ?? []).find((item) => item.id === actor.userId);
    const session = (state.identitySessions ?? []).find((item) => item.id === actor.sessionId);
    sendJson(res, 200, {
      user: {
        ...safeUser(user),
        privateTutorChildMode: actor.privateTutorLearnerId ? {
          learnerId: actor.privateTutorLearnerId,
          enteredAt: actor.privateTutorChildModeEnteredAt,
        } : null,
      },
      expiresAt: actor.sessionExpiresAt ?? null,
      session: session ? {
        id: session.id,
        mode: session.mode ?? "password",
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        idleExpiresAt: session.idleExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        currentDevice: true,
      } : null,
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/session") {
    const body = await readJson(req).catch(() => ({}));
    const requestedMode = body?.mode ? String(body.mode) : null;
    const legacyRequest = !requestedMode && policy.legacyLocalLogin;
    const mode = requestedMode ?? (legacyRequest && body?.userId ? "password" : legacyRequest ? "local" : null);

    if (!mode) {
      sendJson(res, 400, { error: "identity_mode_required", message: "Choose local or password sign-in explicitly." });
      return true;
    }

    let user = null;
    if (mode === "local") {
      if (!policy.localMode) {
        sendJson(res, 403, { error: "local_mode_disabled" });
        return true;
      }
      user = (state.users ?? []).find((item) => item.id === "usr_local") ?? null;
    } else if (mode === "password") {
      if (!policy.passwordMode) {
        sendJson(res, 403, { error: "password_mode_disabled" });
        return true;
      }
      const requestedUserId = boundedIdentifier(body?.userId);
      const requestedTeamId = boundedIdentifier(body?.teamId);
      const lookupTeamId = requestedTeamId || (policy.legacyLocalLogin
        ? (state.users ?? []).find((item) => item.id === requestedUserId)?.teamId
        : "");
      const nowDate = new Date(now());
      if (!policy.legacyLocalLogin) {
        const status = passwordLoginStatus(
          state,
          { teamId: lookupTeamId, userId: requestedUserId },
          nowDate,
        );
        if (!status.allowed) {
          if (status.retryAfterSeconds) res.setHeader("Retry-After", String(status.retryAfterSeconds));
          sendJson(res, 429, { error: "invalid_credentials" });
          return true;
        }
      }
      user = (state.users ?? []).find((item) =>
        item.id === requestedUserId && item.teamId === lookupTeamId) ?? null;
      const suppliedPassword = String(body?.password ?? "");
      const boundedPassword = Array.from(suppliedPassword).length <= 128
        ? suppliedPassword
        : "oversized-password-input";
      const storedHash = typeof user?.passwordHash === "string"
        && /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/i.test(user.passwordHash)
        ? user.passwordHash
        : DUMMY_PASSWORD_HASH;
      const passwordMatches = verifyPassword(boundedPassword, storedHash);
      const credentialAccepted = Boolean(
        user && (
          (policy.legacyLocalLogin && !user.passwordHash)
          || (user.passwordHash && passwordMatches)
        ),
      );
      if (!credentialAccepted) {
        if (!policy.legacyLocalLogin) {
          recordPasswordLoginFailure(
            state,
            {
              teamId: lookupTeamId,
              userId: requestedUserId,
              userExists: Boolean(user),
            },
            nowDate,
          );
          persistStateSoon();
        }
        sendJson(res, 401, { error: "invalid_credentials" });
        return true;
      }
      if (!policy.legacyLocalLogin) {
        clearPasswordLoginFailures(
          state,
          { teamId: lookupTeamId, userId: requestedUserId },
          nowDate,
        );
      }
    } else {
      sendJson(res, 400, { error: "unsupported_identity_mode" });
      return true;
    }

    if (!user) {
      sendJson(res, 503, { error: "identity_unavailable" });
      return true;
    }

    const nowDate = new Date(now());
    const session = createServerSession(state, user, nowDate, { mode });
    setIdentityCookies(res, session, { secure: policy.secureCookies });
    const token = policy.legacyBearerIssue ? legacyBearer(state, user, nowDate) : undefined;
    persistStateSoon();
    sendJson(res, 200, {
      ...(token ? { token } : {}),
      expiresAt: session.record.absoluteExpiresAt,
      user: safeUser(user),
    });
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/api/session") {
    if (actor?.sessionId) revokeServerSession(state, actor.sessionId, new Date(now()));
    const bearer = String(req.headers?.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (bearer) state.tokens = (state.tokens ?? []).filter((item) => item.token !== bearer);
    clearIdentityCookies(res, { secure: policy.secureCookies });
    persistStateSoon();
    sendJson(res, 204, null);
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/api/sessions") {
    if (!actor?.authenticated || !actor.userId) {
      sendJson(res, 401, { error: "unauthenticated" });
      return true;
    }
    revokeAllUserSessions(state, actor.userId, new Date(now()));
    clearIdentityCookies(res, { secure: policy.secureCookies });
    persistStateSoon();
    sendJson(res, 204, null);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/identity/recovery-grants") {
    const body = await readJson(req).catch(() => ({}));
    const target = (state.users ?? []).find((item) =>
      item.id === boundedIdentifier(body?.userId)
      && item.teamId === actor?.teamId) ?? null;
    const result = createPasswordRecoveryGrant(state, {
      issuer: actor,
      target,
      purpose: String(body?.purpose ?? "password_reset"),
    }, new Date(now()));
    if (!result.ok) {
      sendJson(res, 403, { error: "recovery_forbidden" });
      return true;
    }
    persistStateSoon();
    sendJson(res, 201, result);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/identity/recovery/complete") {
    const body = await readJson(req).catch(() => ({}));
    const result = completePasswordRecovery(state, {
      teamId: boundedIdentifier(body?.teamId),
      userId: boundedIdentifier(body?.userId),
      purpose: String(body?.purpose ?? "password_reset"),
      recoveryToken: boundedIdentifier(body?.recoveryToken, 256),
      newPassword: String(body?.newPassword ?? ""),
    }, new Date(now()));
    persistStateSoon();
    if (!result.ok) {
      const passwordPolicyError = String(result.error).startsWith("password_");
      if (result.retryAfterSeconds) {
        res.setHeader("Retry-After", String(result.retryAfterSeconds));
      }
      const status = passwordPolicyError ? 400 : result.throttled ? 429 : 401;
      sendJson(res, status, result.throttled
        ? { ok: false, error: "recovery_failed" }
        : result);
      return true;
    }
    sendJson(res, 200, { completed: true, revokedSessions: result.revokedSessions });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/identity/security-alerts") {
    const alerts = listIdentitySecurityAlerts(state, actor);
    if (!alerts) {
      sendJson(res, 403, { error: "forbidden" });
      return true;
    }
    sendJson(res, 200, { alerts });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/identity/challenges") {
    const body = await readJson(req).catch(() => ({}));
    const provider = String(body?.provider ?? "");
    if (
      !isEnterpriseIdentityProvider(provider)
      || !availableProviders.includes(provider)
      || typeof providerCore?.beginAuthorization !== "function"
    ) {
      sendJson(res, 404, { error: "identity_provider_unavailable" });
      return true;
    }
    const bindingSecret = newChallengeBinding();
    const result = await providerCore.beginAuthorization({
      provider,
      bindingSecret,
      deviceContext: req.headers?.["user-agent"] ?? null,
    });
    if (!result?.ok) {
      sendJson(res, 404, { error: "identity_provider_unavailable" });
      return true;
    }
    setIdentityCookies(res, { bindingSecret }, { secure: policy.secureCookies });
    persistStateSoon();
    const { ok: _ok, ...publicResult } = result;
    sendJson(res, 201, publicResult);
    return true;
  }

  const challengeMatch = /^\/api\/identity\/challenges\/(idc_[A-Za-z0-9_-]+)$/.exec(url.pathname);
  if (challengeMatch && ["GET", "DELETE"].includes(req.method)) {
    const record = (state.identityChallenges ?? []).find((item) => item.id === challengeMatch[1]);
    const binding = parseCookies(req)[CHALLENGE_BINDING_COOKIE];
    if (!record || !binding || record.bindingHash !== hashIdentitySecret(binding)) {
      sendJson(res, 404, { error: "identity_challenge_not_found" });
      return true;
    }
    if (expireIdentityChallenge(state, record.id, new Date(now()))) {
      persistStateSoon();
    }
    if (req.method === "DELETE") {
      const cancelled = cancelIdentityChallenge(state, {
        challengeId: record.id,
        bindingSecret: binding,
      }, new Date(now()));
      if (cancelled.ok) persistStateSoon();
    }
    sendJson(res, 200, { challenge: publicChallenge(record) });
    return true;
  }

  return false;
}
