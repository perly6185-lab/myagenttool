import assert from "node:assert/strict";
import test from "node:test";

import { resolveActor } from "../src/runtime/auth.mjs";
import { identityPolicyFromEnv, publicIdentityOptions } from "../src/runtime/identity-policy.mjs";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  authorizeIdentityChallenge,
  consumeIdentityChallenge,
  cancelIdentityChallenge,
  createIdentityChallenge,
  createServerSession,
  expireIdentityChallenge,
  hashIdentitySecret,
  revokeAllUserSessions,
  validSessionCsrf,
} from "../src/services/identity-security.mjs";

const user = { id: "usr_a", teamId: "team_a", role: "admin", sessionEpoch: 2 };

test("I3: auth-required deployments fail closed unless local mode is explicit", () => {
  const closed = identityPolicyFromEnv({ MYAGENT_REQUIRE_AUTH: "1" });
  assert.equal(closed.localMode, false);
  assert.equal(closed.legacyBearerIssue, false);

  const local = identityPolicyFromEnv({ MYAGENT_REQUIRE_AUTH: "1", MYAGENT_LOCAL_MODE: "1" });
  assert.equal(local.localMode, true);
});

test("I3: an unauthenticated request has no local owner authority when auth is required", () => {
  const previous = process.env.MYAGENT_REQUIRE_AUTH;
  process.env.MYAGENT_REQUIRE_AUTH = "1";
  try {
    const actor = resolveActor({ users: [user], tokens: [], identitySessions: [] }, { headers: {} });
    assert.equal(actor.authenticated, false);
    assert.equal(actor.role, "anonymous");
    assert.equal(actor.userId, null);
    assert.equal(actor.teamId, null);
  } finally {
    if (previous === undefined) delete process.env.MYAGENT_REQUIRE_AUTH;
    else process.env.MYAGENT_REQUIRE_AUTH = previous;
  }
});

test("I1: public capability discovery exposes only configured, registered adapters", () => {
  const policy = identityPolicyFromEnv({
    MYAGENT_REQUIRE_AUTH: "1",
    MYAGENT_IDENTITY_PROVIDERS: "wecom,feishu,unknown",
  });
  assert.deepEqual(publicIdentityOptions(policy, ["feishu", "dingtalk"]), {
    protocolVersion: 1,
    localMode: false,
    passwordMode: true,
    providers: [{
      provider: "feishu",
      label: "飞书",
      authorization: "redirect",
    }],
  });
});

test("I2: opaque server session stores hashes, resolves cookies, and enforces CSRF", () => {
  const state = { users: [user], tokens: [], identitySessions: [] };
  const issued = createServerSession(state, user, new Date("2026-07-27T00:00:00.000Z"));
  const serialized = JSON.stringify(state.identitySessions[0]);
  assert.equal(serialized.includes(issued.sessionSecret), false);
  assert.equal(serialized.includes(issued.csrfSecret), false);
  assert.equal(state.identitySessions[0].tokenHash, hashIdentitySecret(issued.sessionSecret));
  assert.equal(JSON.stringify(state.identityAuditEvents).includes(issued.sessionSecret), false);
  assert.equal(state.identityAuditEvents[0].type, "identity.session.created");

  const req = {
    headers: {
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(issued.sessionSecret)}; ${CSRF_COOKIE}=${encodeURIComponent(issued.csrfSecret)}`,
      "x-csrf-token": issued.csrfSecret,
    },
  };
  const actor = resolveActor(state, req, { now: () => "2026-07-27T00:05:00.000Z" });
  assert.equal(actor.authenticated, true);
  assert.equal(actor.authMethod, "cookie");
  assert.equal(actor.teamId, "team_a");
  assert.equal(validSessionCsrf(req, actor), true);
  assert.equal(validSessionCsrf({ headers: { "x-csrf-token": "wrong" } }, actor), false);
});

test("I2: session idle expiry and user epoch changes revoke authority", () => {
  const state = { users: [{ ...user }], tokens: [], identitySessions: [] };
  const issued = createServerSession(state, state.users[0], new Date("2026-07-27T00:00:00.000Z"));
  const req = { headers: { cookie: `${SESSION_COOKIE}=${issued.sessionSecret}` } };
  assert.equal(
    resolveActor(state, req, { now: () => "2026-07-27T00:31:00.000Z" }).authenticated,
    false,
  );

  const fresh = createServerSession(state, state.users[0], new Date("2026-07-27T01:00:00.000Z"));
  state.users[0].sessionEpoch += 1;
  assert.equal(
    resolveActor(state, { headers: { cookie: `${SESSION_COOKIE}=${fresh.sessionSecret}` } }, {
      now: () => "2026-07-27T01:01:00.000Z",
    }).authenticated,
    false,
  );
});

test("I2: all-device revocation increments the epoch and revokes every live session", () => {
  const state = { users: [{ ...user }], identitySessions: [] };
  createServerSession(state, state.users[0], new Date("2026-07-27T00:00:00.000Z"));
  createServerSession(state, state.users[0], new Date("2026-07-27T00:01:00.000Z"));
  assert.equal(revokeAllUserSessions(state, user.id, new Date("2026-07-27T00:02:00.000Z")), 2);
  assert.equal(state.users[0].sessionEpoch, 3);
  assert.equal(state.identitySessions.every((session) => session.revokedAt), true);
  assert.equal(state.identityAuditEvents[0].type, "identity.session.revoked");
});

test("I4: challenge is browser-bound, expiring, single-use, and audit-redacted", () => {
  const state = { identityChallenges: [], identityAuditEvents: [] };
  const secret = "binding-secret-that-must-not-persist";
  const uri = "https://identity.example.test/authorize?code=secret-code";
  const issued = createIdentityChallenge(state, {
    provider: "wecom",
    bindingSecret: secret,
    authorizationUri: uri,
    deviceContext: "test-browser",
  }, new Date("2026-07-27T00:00:00.000Z"));

  assert.equal(issued.authorizationUri, uri);
  const durable = JSON.stringify(state);
  assert.equal(durable.includes(secret), false);
  assert.equal(durable.includes(uri), false);
  assert.equal(
    authorizeIdentityChallenge(state, {
      challengeId: issued.challenge.id,
      bindingSecret: "other-browser",
      providerSubject: "external-user",
    }, new Date("2026-07-27T00:00:30.000Z")).error,
    "challenge_binding_mismatch",
  );

  assert.equal(authorizeIdentityChallenge(state, {
    challengeId: issued.challenge.id,
    bindingSecret: secret,
    providerSubject: "external-user",
  }, new Date("2026-07-27T00:00:40.000Z")).ok, true);
  assert.equal(consumeIdentityChallenge(state, {
    challengeId: issued.challenge.id,
    bindingSecret: secret,
  }, new Date("2026-07-27T00:00:50.000Z")).ok, true);
  assert.equal(consumeIdentityChallenge(state, {
    challengeId: issued.challenge.id,
    bindingSecret: secret,
  }, new Date("2026-07-27T00:00:51.000Z")).error, "challenge_replayed");
  assert.equal(JSON.stringify(state.identityAuditEvents).includes("external-user"), false);
  assert.equal(state.identityAuditEvents.some((event) => event.type === "identity.challenge.replayed"), true);
});

test("I4: expired and cancelled challenges are terminal and audited", () => {
  const state = { identityChallenges: [], identityAuditEvents: [] };
  const expired = createIdentityChallenge(state, {
    provider: "feishu",
    bindingSecret: "binding-a",
    authorizationUri: "https://identity.example.test/a",
  }, new Date("2026-07-27T00:00:00.000Z"));
  assert.equal(expireIdentityChallenge(
    state,
    expired.challenge.id,
    new Date("2026-07-27T00:02:01.000Z"),
  ), true);
  assert.equal(state.identityChallenges[0].state, "expired");

  const cancelled = createIdentityChallenge(state, {
    provider: "dingtalk",
    bindingSecret: "binding-b",
    authorizationUri: "https://identity.example.test/b",
  }, new Date("2026-07-27T01:00:00.000Z"));
  assert.equal(cancelIdentityChallenge(state, {
    challengeId: cancelled.challenge.id,
    bindingSecret: "binding-b",
  }, new Date("2026-07-27T01:00:20.000Z")).ok, true);
  assert.equal(authorizeIdentityChallenge(state, {
    challengeId: cancelled.challenge.id,
    bindingSecret: "binding-b",
    providerSubject: "subject",
  }, new Date("2026-07-27T01:00:30.000Z")).error, "challenge_not_pending");
  assert.equal(state.identityAuditEvents.some((event) => event.type === "identity.challenge.expired"), true);
  assert.equal(state.identityAuditEvents.some((event) => event.type === "identity.challenge.cancelled"), true);
});
