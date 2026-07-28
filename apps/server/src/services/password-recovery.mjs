import crypto from "node:crypto";

import { hashPassword } from "../runtime/auth.mjs";
import {
  auditIdentity,
  hashIdentitySecret,
  revokeAllUserSessions,
} from "./identity-security.mjs";

export const RECOVERY_GRANT_TTL_MS = 15 * 60 * 1000;
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const TEMPORARY_LOCK_MS = 15 * 60 * 1000;
const LOGIN_ALERT_THRESHOLD = 5;
const LOGIN_DISABLE_THRESHOLD = 20;
const RECOVERY_DISABLE_THRESHOLD = 10;
const MAX_LOGIN_RECORDS = 1_000;
const MAX_RECOVERY_GRANTS = 500;
const MAX_SECURITY_ALERTS = 500;

const COMMON_PASSWORDS = new Set([
  "123456789012345",
  "passwordpassword",
  "qwertyuiopasdfg",
  "letmeinletmein",
  "adminadminadmin",
]);

function opaque(prefix, bytes = 32) {
  return `${prefix}_${crypto.randomBytes(bytes).toString("base64url")}`;
}

function instant(now) {
  return now instanceof Date ? now : new Date(now);
}

function normalizedIdentifier(value) {
  return String(value ?? "").trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

export function tenantAwareLoginKey(teamId, userId) {
  return hashIdentitySecret(
    `${normalizedIdentifier(teamId)}\u0000${normalizedIdentifier(userId)}`,
  );
}

function passwordDelayMs(failureCount) {
  if (failureCount < 3) return 0;
  return Math.min(30_000, 1_000 * (2 ** (failureCount - 3)));
}

function pruneLoginAttempts(state, nowDate) {
  state.identityLoginAttempts ??= [];
  const cutoff = nowDate.getTime() - LOGIN_WINDOW_MS;
  state.identityLoginAttempts = state.identityLoginAttempts
    .filter((record) =>
      (record.disabled && Date.parse(record.lockedUntil) > nowDate.getTime())
      || Date.parse(record.lastFailedAt) > cutoff)
    .slice(0, MAX_LOGIN_RECORDS);
}

function loginAttemptRecord(state, teamId, userId) {
  const keyHash = tenantAwareLoginKey(teamId, userId);
  return {
    keyHash,
    record: (state.identityLoginAttempts ?? []).find((item) => item.keyHash === keyHash) ?? null,
  };
}

/**
 * Checks the account-scoped throttle before doing an expensive password check.
 * The durable key is a hash of tenant + identifier, so identical identifiers in
 * different tenants never share a failure budget.
 */
export function passwordLoginStatus(state, { teamId, userId }, now = new Date()) {
  const nowDate = instant(now);
  pruneLoginAttempts(state, nowDate);
  const { record } = loginAttemptRecord(state, teamId, userId);
  if (!record) return { allowed: true, retryAfterSeconds: 0, disabled: false };
  if (record.disabled) {
    const retryMs = Math.max(0, Date.parse(record.lockedUntil) - nowDate.getTime());
    return {
      allowed: retryMs === 0,
      retryAfterSeconds: retryMs ? Math.max(1, Math.ceil(retryMs / 1_000)) : 0,
      disabled: retryMs > 0,
    };
  }
  const retryMs = Math.max(0, Date.parse(record.nextAllowedAt) - nowDate.getTime());
  return {
    allowed: retryMs === 0,
    retryAfterSeconds: retryMs ? Math.max(1, Math.ceil(retryMs / 1_000)) : 0,
    disabled: false,
  };
}

function upsertSecurityAlert(
  state,
  {
    type = "password_login_throttled",
    teamId,
    userId,
    identifier = userId,
    failureCount,
  },
  nowDate,
) {
  state.identitySecurityAlerts ??= [];
  const identifierHash = hashIdentitySecret(normalizedIdentifier(identifier));
  const existing = state.identitySecurityAlerts.find((alert) =>
    alert.type === type
    && alert.teamId === teamId
    && alert.identifierHash === identifierHash
    && alert.status === "open");
  if (existing) {
    existing.count += 1;
    existing.failureCount = failureCount;
    existing.updatedAt = nowDate.toISOString();
  } else {
    state.identitySecurityAlerts.unshift({
      id: opaque("isa", 18),
      type,
      severity: failureCount >= (
        type === "recovery_token_rejected"
          ? RECOVERY_DISABLE_THRESHOLD
          : LOGIN_DISABLE_THRESHOLD
      ) ? "high" : "warning",
      status: "open",
      teamId,
      userId,
      identifierHash,
      count: 1,
      failureCount,
      createdAt: nowDate.toISOString(),
      updatedAt: nowDate.toISOString(),
    });
  }
  state.identitySecurityAlerts = state.identitySecurityAlerts.slice(0, MAX_SECURITY_ALERTS);
}

export function recordPasswordLoginFailure(
  state,
  { teamId, userId, userExists = true },
  now = new Date(),
) {
  const nowDate = instant(now);
  pruneLoginAttempts(state, nowDate);
  const { keyHash, record: existing } = loginAttemptRecord(state, teamId, userId);
  const record = existing ?? {
    id: `ila_${keyHash}`,
    keyHash,
    failureCount: 0,
    firstFailedAt: nowDate.toISOString(),
    lastFailedAt: nowDate.toISOString(),
    nextAllowedAt: nowDate.toISOString(),
    disabled: false,
    lockedUntil: null,
  };
  record.failureCount += 1;
  record.lastFailedAt = nowDate.toISOString();
  record.disabled = record.failureCount >= LOGIN_DISABLE_THRESHOLD;
  record.lockedUntil = record.disabled
    ? new Date(nowDate.getTime() + TEMPORARY_LOCK_MS).toISOString()
    : null;
  record.nextAllowedAt = new Date(
    nowDate.getTime() + passwordDelayMs(record.failureCount),
  ).toISOString();
  if (!existing) state.identityLoginAttempts.unshift(record);

  if (record.failureCount >= LOGIN_ALERT_THRESHOLD) {
    upsertSecurityAlert(
      state,
      {
        type: "password_login_throttled",
        teamId,
        userId: userExists ? userId : null,
        identifier: userId,
        failureCount: record.failureCount,
      },
      nowDate,
    );
  }
  auditIdentity(state, {
    id: opaque("ida", 12),
    type: "identity.password.rejected",
    teamId,
    userIdHash: hashIdentitySecret(normalizedIdentifier(userId)),
    outcome: record.disabled ? "temporarily_locked" : "invalid_credentials",
    failureCount: record.failureCount,
    at: nowDate.toISOString(),
  });
  return passwordLoginStatus(state, { teamId, userId }, nowDate);
}

function recoveryAttemptRecord(state, teamId, userId) {
  const keyHash = tenantAwareLoginKey(teamId, userId);
  return {
    keyHash,
    record: (state.identityRecoveryAttempts ?? []).find((item) => item.keyHash === keyHash) ?? null,
  };
}

function pruneRecoveryAttempts(state, nowDate) {
  state.identityRecoveryAttempts ??= [];
  const cutoff = nowDate.getTime() - LOGIN_WINDOW_MS;
  state.identityRecoveryAttempts = state.identityRecoveryAttempts
    .filter((record) =>
      (record.disabled && Date.parse(record.lockedUntil) > nowDate.getTime())
      || Date.parse(record.lastFailedAt) > cutoff)
    .slice(0, MAX_LOGIN_RECORDS);
}

export function passwordRecoveryStatus(state, { teamId, userId }, now = new Date()) {
  const nowDate = instant(now);
  pruneRecoveryAttempts(state, nowDate);
  const { record } = recoveryAttemptRecord(state, teamId, userId);
  if (!record) return { allowed: true, retryAfterSeconds: 0, disabled: false };
  if (record.disabled) {
    const retryMs = Math.max(0, Date.parse(record.lockedUntil) - nowDate.getTime());
    return {
      allowed: retryMs === 0,
      retryAfterSeconds: retryMs ? Math.max(1, Math.ceil(retryMs / 1_000)) : 0,
      disabled: retryMs > 0,
    };
  }
  const retryMs = Math.max(0, Date.parse(record.nextAllowedAt) - nowDate.getTime());
  return {
    allowed: retryMs === 0,
    retryAfterSeconds: retryMs ? Math.max(1, Math.ceil(retryMs / 1_000)) : 0,
    disabled: false,
  };
}

export function recordPasswordRecoveryFailure(
  state,
  { teamId, userId, userExists = true },
  now = new Date(),
) {
  const nowDate = instant(now);
  pruneRecoveryAttempts(state, nowDate);
  const { keyHash, record: existing } = recoveryAttemptRecord(state, teamId, userId);
  const record = existing ?? {
    id: `ira_${keyHash}`,
    keyHash,
    failureCount: 0,
    firstFailedAt: nowDate.toISOString(),
    lastFailedAt: nowDate.toISOString(),
    nextAllowedAt: nowDate.toISOString(),
    disabled: false,
    lockedUntil: null,
  };
  record.failureCount += 1;
  record.lastFailedAt = nowDate.toISOString();
  record.disabled = record.failureCount >= RECOVERY_DISABLE_THRESHOLD;
  record.lockedUntil = record.disabled
    ? new Date(nowDate.getTime() + TEMPORARY_LOCK_MS).toISOString()
    : null;
  record.nextAllowedAt = new Date(
    nowDate.getTime() + passwordDelayMs(record.failureCount),
  ).toISOString();
  if (!existing) state.identityRecoveryAttempts.unshift(record);
  if (record.failureCount >= LOGIN_ALERT_THRESHOLD) {
    upsertSecurityAlert(
      state,
      {
        type: "recovery_token_rejected",
        teamId,
        userId: userExists ? userId : null,
        identifier: userId,
        failureCount: record.failureCount,
      },
      nowDate,
    );
  }
  return passwordRecoveryStatus(state, { teamId, userId }, nowDate);
}

export function clearPasswordRecoveryFailures(state, { teamId, userId }, now = new Date()) {
  const keyHash = tenantAwareLoginKey(teamId, userId);
  state.identityRecoveryAttempts = (state.identityRecoveryAttempts ?? [])
    .filter((item) => item.keyHash !== keyHash);
  const nowIso = instant(now).toISOString();
  for (const alert of state.identitySecurityAlerts ?? []) {
    if (
      alert.type === "recovery_token_rejected"
      && alert.teamId === teamId
      && alert.userId === userId
      && alert.status === "open"
    ) {
      alert.status = "recovered";
      alert.updatedAt = nowIso;
    }
  }
}

export function clearPasswordLoginFailures(state, { teamId, userId }, now = new Date()) {
  const keyHash = tenantAwareLoginKey(teamId, userId);
  state.identityLoginAttempts = (state.identityLoginAttempts ?? [])
    .filter((item) => item.keyHash !== keyHash);
  const nowIso = instant(now).toISOString();
  for (const alert of state.identitySecurityAlerts ?? []) {
    if (
      alert.type === "password_login_throttled"
      && alert.teamId === teamId
      && alert.userId === userId
      && alert.status === "open"
    ) {
      alert.status = "recovered";
      alert.updatedAt = nowIso;
    }
  }
}

export function validateNewPassword(password, { teamId = "", userId = "" } = {}) {
  const value = String(password ?? "");
  const length = Array.from(value).length;
  if (length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: "password_too_short", minLength: PASSWORD_MIN_LENGTH };
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return { ok: false, error: "password_too_long", maxLength: PASSWORD_MAX_LENGTH };
  }
  const normalized = normalizedIdentifier(value).replace(/\s+/g, "");
  const contextValues = [teamId, userId]
    .map(normalizedIdentifier)
    .filter((item) => item.length >= 4);
  if (
    COMMON_PASSWORDS.has(normalized)
    || contextValues.some((item) => normalized.includes(item))
  ) {
    return { ok: false, error: "password_blocklisted" };
  }
  return { ok: true };
}

export function canIssuePasswordRecovery(actor, target) {
  if (!actor?.authenticated || !target) return false;
  if (!["owner", "admin"].includes(actor.role)) return false;
  if (actor.teamId !== target.teamId || target.teamId === "team_local") return false;
  if (actor.userId === target.id) return false;
  if (actor.role === "admin") return ["operator", "viewer"].includes(target.role);
  return target.role !== "owner";
}

export function createPasswordRecoveryGrant(
  state,
  { issuer, target, purpose = "password_reset" },
  now = new Date(),
) {
  if (purpose !== "password_reset") return { ok: false, error: "invalid_recovery_purpose" };
  if (!canIssuePasswordRecovery(issuer, target)) return { ok: false, error: "recovery_forbidden" };

  const nowDate = instant(now);
  const recoveryToken = opaque("rgr");
  state.identityRecoveryGrants ??= [];
  for (const grant of state.identityRecoveryGrants) {
    if (
      grant.teamId === target.teamId
      && grant.userId === target.id
      && grant.purpose === purpose
      && !grant.consumedAt
      && !grant.revokedAt
    ) {
      grant.revokedAt = nowDate.toISOString();
    }
  }
  const grant = {
    id: opaque("irg", 18),
    tokenHash: hashIdentitySecret(recoveryToken),
    purpose,
    teamId: target.teamId,
    userId: target.id,
    issuedBy: issuer.userId,
    createdAt: nowDate.toISOString(),
    expiresAt: new Date(nowDate.getTime() + RECOVERY_GRANT_TTL_MS).toISOString(),
    consumedAt: null,
    revokedAt: null,
  };
  state.identityRecoveryGrants.unshift(grant);
  state.identityRecoveryGrants = state.identityRecoveryGrants.slice(0, MAX_RECOVERY_GRANTS);
  auditIdentity(state, {
    id: opaque("ida", 12),
    type: "identity.recovery.requested",
    grantId: grant.id,
    teamId: grant.teamId,
    userId: grant.userId,
    issuedBy: grant.issuedBy,
    purpose,
    outcome: "created",
    at: grant.createdAt,
  });
  clearPasswordRecoveryFailures(state, { teamId: target.teamId, userId: target.id }, nowDate);
  return {
    ok: true,
    recoveryToken,
    grant: {
      id: grant.id,
      purpose: grant.purpose,
      teamId: grant.teamId,
      userId: grant.userId,
      createdAt: grant.createdAt,
      expiresAt: grant.expiresAt,
    },
  };
}

export function completePasswordRecovery(
  state,
  { teamId, userId, purpose = "password_reset", recoveryToken, newPassword },
  now = new Date(),
) {
  const password = validateNewPassword(newPassword, { teamId, userId });
  if (!password.ok) return password;

  const nowDate = instant(now);
  const attemptStatus = passwordRecoveryStatus(state, { teamId, userId }, nowDate);
  if (!attemptStatus.allowed) {
    return {
      ok: false,
      error: "recovery_failed",
      throttled: true,
      retryAfterSeconds: attemptStatus.retryAfterSeconds,
    };
  }
  const tokenHash = hashIdentitySecret(recoveryToken);
  const grant = (state.identityRecoveryGrants ?? []).find((item) =>
    item.tokenHash === tokenHash
    && item.teamId === teamId
    && item.userId === userId
    && item.purpose === purpose);
  const target = (state.users ?? []).find((item) =>
    item.id === userId && item.teamId === teamId);
  if (
    !grant
    || !target
    || teamId === "team_local"
    || grant.consumedAt
    || grant.revokedAt
    || Date.parse(grant.expiresAt) <= nowDate.getTime()
  ) {
    recordPasswordRecoveryFailure(state, {
      teamId,
      userId,
      userExists: Boolean(target),
    }, nowDate);
    auditIdentity(state, {
      id: opaque("ida", 12),
      type: "identity.recovery.rejected",
      teamId: String(teamId ?? ""),
      userIdHash: hashIdentitySecret(normalizedIdentifier(userId)),
      purpose,
      outcome: "invalid_or_expired",
      at: nowDate.toISOString(),
    });
    return { ok: false, error: "recovery_failed" };
  }

  // This synchronous state transition is the single-use compare-and-set
  // boundary. Credential rotation and session invalidation complete before the
  // successful response is returned.
  grant.consumedAt = nowDate.toISOString();
  target.passwordHash = hashPassword(newPassword);
  target.credentialUpdatedAt = nowDate.toISOString();
  const revokedSessions = revokeAllUserSessions(state, target.id, nowDate);
  clearPasswordLoginFailures(state, { teamId, userId }, nowDate);
  clearPasswordRecoveryFailures(state, { teamId, userId }, nowDate);
  auditIdentity(state, {
    id: opaque("ida", 12),
    type: "identity.recovery.completed",
    grantId: grant.id,
    teamId,
    userId,
    purpose,
    revokedSessions,
    outcome: "completed",
    at: nowDate.toISOString(),
  });
  return { ok: true, revokedSessions };
}

export function listIdentitySecurityAlerts(state, actor) {
  if (!actor?.authenticated || !["owner", "admin"].includes(actor.role)) return null;
  return (state.identitySecurityAlerts ?? [])
    .filter((alert) => alert.teamId === actor.teamId)
    .map(({ identifierHash: _identifierHash, ...alert }) => ({ ...alert }));
}
