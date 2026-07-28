import assert from "node:assert/strict";
import test from "node:test";

import { verifyPassword } from "../src/runtime/auth.mjs";
import { createServerSession } from "../src/services/identity-security.mjs";
import {
  RECOVERY_GRANT_TTL_MS,
  canIssuePasswordRecovery,
  completePasswordRecovery,
  createPasswordRecoveryGrant,
  passwordLoginStatus,
  passwordRecoveryStatus,
  recordPasswordLoginFailure,
  tenantAwareLoginKey,
  validateNewPassword,
} from "../src/services/password-recovery.mjs";

function fixture() {
  const owner = {
    id: "usr_owner",
    teamId: "team_a",
    role: "owner",
    authenticated: true,
  };
  const target = {
    id: "usr_target",
    teamId: "team_a",
    role: "operator",
    sessionEpoch: 0,
    passwordHash: null,
  };
  return {
    owner,
    target,
    state: {
      users: [target],
      identitySessions: [],
      identityAuditEvents: [],
      identityLoginAttempts: [],
      identityRecoveryAttempts: [],
      identityRecoveryGrants: [],
      identitySecurityAlerts: [],
    },
  };
}

test("password policy follows the single-factor length baseline without composition rules", () => {
  assert.deepEqual(validateNewPassword("short"), {
    ok: false,
    error: "password_too_short",
    minLength: 15,
  });
  assert.equal(validateNewPassword("this is a long passphrase").ok, true);
  assert.equal(validateNewPassword("123456789012345").error, "password_blocklisted");
  assert.equal(validateNewPassword("team_a secure passphrase", {
    teamId: "team_a",
  }).error, "password_blocklisted");
});

test("login throttles are tenant-aware, progressively delayed, and alert at abuse threshold", () => {
  const { state } = fixture();
  const now = new Date("2026-07-27T00:00:00.000Z");
  assert.notEqual(
    tenantAwareLoginKey("team_a", "usr_target"),
    tenantAwareLoginKey("team_b", "usr_target"),
  );

  recordPasswordLoginFailure(state, { teamId: "team_a", userId: "usr_target" }, now);
  recordPasswordLoginFailure(state, { teamId: "team_a", userId: "usr_target" }, now);
  const throttled = recordPasswordLoginFailure(
    state,
    { teamId: "team_a", userId: "usr_target" },
    now,
  );
  assert.equal(throttled.allowed, false);
  assert.equal(throttled.retryAfterSeconds, 1);
  assert.equal(
    passwordLoginStatus(state, { teamId: "team_b", userId: "usr_target" }, now).allowed,
    true,
  );
  assert.equal(JSON.stringify(state.identityLoginAttempts).includes("usr_target"), false);

  recordPasswordLoginFailure(state, { teamId: "team_a", userId: "usr_target" }, now);
  recordPasswordLoginFailure(state, { teamId: "team_a", userId: "usr_target" }, now);
  assert.equal(state.identitySecurityAlerts.length, 1);
  assert.equal(state.identitySecurityAlerts[0].failureCount, 5);
});

test("recovery grants enforce role boundaries and never persist the raw grant", () => {
  const { state, owner, target } = fixture();
  assert.equal(canIssuePasswordRecovery(owner, target), true);
  assert.equal(canIssuePasswordRecovery(
    { ...owner, role: "admin" },
    { ...target, role: "admin" },
  ), false);
  assert.equal(canIssuePasswordRecovery(
    { ...owner, teamId: "team_local", userId: "usr_local" },
    { ...target, teamId: "team_local" },
  ), false);

  const issued = createPasswordRecoveryGrant(
    state,
    { issuer: owner, target },
    new Date("2026-07-27T00:00:00.000Z"),
  );
  assert.equal(issued.ok, true);
  assert.match(issued.recoveryToken, /^rgr_/);
  assert.equal(JSON.stringify(state).includes(issued.recoveryToken), false);
  assert.equal(state.identityRecoveryGrants[0].purpose, "password_reset");
  assert.equal(
    Date.parse(state.identityRecoveryGrants[0].expiresAt)
      - Date.parse(state.identityRecoveryGrants[0].createdAt),
    RECOVERY_GRANT_TTL_MS,
  );
});

test("recovery rotates the password, revokes every session, and is single use", () => {
  const { state, owner, target } = fixture();
  createServerSession(state, target, new Date("2026-07-27T00:00:00.000Z"));
  createServerSession(state, target, new Date("2026-07-27T00:01:00.000Z"));
  const issued = createPasswordRecoveryGrant(
    state,
    { issuer: owner, target },
    new Date("2026-07-27T00:02:00.000Z"),
  );
  const completed = completePasswordRecovery(state, {
    teamId: target.teamId,
    userId: target.id,
    recoveryToken: issued.recoveryToken,
    newPassword: "a strong recovery passphrase",
  }, new Date("2026-07-27T00:03:00.000Z"));
  assert.deepEqual(completed, { ok: true, revokedSessions: 2 });
  assert.equal(verifyPassword("a strong recovery passphrase", target.passwordHash), true);
  assert.equal(state.identitySessions.every((session) => session.revokedAt), true);
  assert.equal(target.sessionEpoch, 1);
  assert.equal(state.identityRecoveryGrants[0].consumedAt, "2026-07-27T00:03:00.000Z");

  const replay = completePasswordRecovery(state, {
    teamId: target.teamId,
    userId: target.id,
    recoveryToken: issued.recoveryToken,
    newPassword: "another strong recovery passphrase",
  }, new Date("2026-07-27T00:04:00.000Z"));
  assert.deepEqual(replay, { ok: false, error: "recovery_failed" });
});

test("expired recovery grants fail without changing credentials", () => {
  const { state, owner, target } = fixture();
  const issuedAt = new Date("2026-07-27T00:00:00.000Z");
  const issued = createPasswordRecoveryGrant(state, { issuer: owner, target }, issuedAt);
  const result = completePasswordRecovery(state, {
    teamId: target.teamId,
    userId: target.id,
    recoveryToken: issued.recoveryToken,
    newPassword: "a strong recovery passphrase",
  }, new Date(issuedAt.getTime() + RECOVERY_GRANT_TTL_MS));
  assert.deepEqual(result, { ok: false, error: "recovery_failed" });
  assert.equal(target.passwordHash, null);
});

test("recovery token failures have an independent tenant-aware throttle", () => {
  const { state, target } = fixture();
  const now = new Date("2026-07-27T00:00:00.000Z");
  const input = {
    teamId: target.teamId,
    userId: target.id,
    recoveryToken: "rgr_invalid",
    newPassword: "a strong recovery passphrase",
  };
  completePasswordRecovery(state, input, now);
  completePasswordRecovery(state, input, now);
  completePasswordRecovery(state, input, now);
  const status = passwordRecoveryStatus(
    state,
    { teamId: target.teamId, userId: target.id },
    now,
  );
  assert.equal(status.allowed, false);
  assert.equal(status.retryAfterSeconds, 1);
  assert.equal(state.identityLoginAttempts.length, 0);
  assert.equal(
    passwordRecoveryStatus(state, { teamId: "team_b", userId: target.id }, now).allowed,
    true,
  );
});
