import assert from "node:assert/strict";
import test from "node:test";

import {
  enterpriseIdentityProviders,
  identityChallengeStates,
  identityEntryModes,
  isEnterpriseIdentityProvider,
  isIdentityChallengeState,
  normalizeExternalIdentity,
} from "@myagenttool/protocol/identity";

test("identity protocol uses closed provider, mode, and challenge vocabularies", () => {
  assert.deepEqual(enterpriseIdentityProviders, ["wecom", "feishu", "dingtalk"]);
  assert.deepEqual(identityEntryModes, ["local", "password", "enterprise"]);
  assert.deepEqual(identityChallengeStates, [
    "pending",
    "authorized",
    "consumed",
    "expired",
    "rejected",
    "cancelled",
    "failed",
  ]);
});

test("provider output normalizes identity facts but cannot assign local authority", () => {
  const normalized = normalizeExternalIdentity({
    provider: "feishu",
    issuer: "https://accounts.example.test",
    subjectExternalId: "ou_external",
    tenantClaims: ["tenant_a", "tenant_a"],
    authenticatedAt: "2026-07-27T00:00:00Z",
    userId: "usr_owner",
    teamId: "team_admin",
    role: "owner",
  });
  assert.deepEqual(normalized, {
    provider: "feishu",
    issuer: "https://accounts.example.test",
    subjectExternalId: "ou_external",
    tenantClaims: ["tenant_a"],
    authenticatedAt: "2026-07-27T00:00:00.000Z",
  });
  assert.equal(normalizeExternalIdentity({ provider: "unknown" }), null);
});

test("identity protocol rejects provider and state expansion by string", () => {
  assert.equal(isEnterpriseIdentityProvider("wecom"), true);
  assert.equal(isEnterpriseIdentityProvider("wechat"), false);
  assert.equal(isIdentityChallengeState("consumed"), true);
  assert.equal(isIdentityChallengeState("complete"), false);
});

test("external identity normalization fails closed on oversized provider claims", () => {
  const base = {
    provider: "feishu",
    issuer: "https://issuer.example.test",
    subjectExternalId: "subject_fixture",
    tenantClaims: ["tenant_fixture"],
    authenticatedAt: "2026-07-27T00:00:00Z",
  };
  assert.equal(normalizeExternalIdentity({
    ...base,
    subjectExternalId: "x".repeat(257),
  }), null);
  assert.equal(normalizeExternalIdentity({
    ...base,
    tenantClaims: Array.from({ length: 33 }, (_, index) => `tenant_${index}`),
  }), null);
  assert.equal(normalizeExternalIdentity({
    ...base,
    tenantClaims: ["x".repeat(257)],
  }), null);
});
