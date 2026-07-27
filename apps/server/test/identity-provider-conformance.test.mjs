import assert from "node:assert/strict";
import test from "node:test";

import { enterpriseIdentityProviders } from "@myagenttool/protocol/identity";
import { createIdentityProviderCore } from "../src/services/identity-provider-core.mjs";
import { hashIdentitySecret } from "../src/services/identity-security.mjs";
import { createIdentityProviderSandbox } from "../src/testing/identity-provider-sandbox.mjs";

const START_MS = Date.parse("2026-07-27T00:00:00.000Z");

function profileFor(provider) {
  return {
    provider,
    issuer: `https://issuer.${provider}.sandbox.example`,
    redirectUri: `https://console.sandbox.example/api/identity/callback/${provider}`,
    authorizationOrigins: [`https://auth.${provider}.sandbox.example`],
    pkce: "S256",
    nonceRequired: true,
    tenantClaimRequired: true,
  };
}

function fixture(provider, {
  exchangeDelayMs = 0,
  exchangeTimeoutMs = 100,
  adapterTransform = (adapter) => adapter,
} = {}) {
  let clockMs = START_MS;
  const now = () => new Date(clockMs).toISOString();
  const profile = profileFor(provider);
  const sandbox = createIdentityProviderSandbox({
    provider,
    issuer: profile.issuer,
    authorizationEndpoint: `${profile.authorizationOrigins[0]}/authorize`,
    now,
    exchangeDelayMs,
  });
  const adapter = adapterTransform(sandbox);
  const state = {
    identityChallenges: [],
    identityProviderCodeUses: [],
    identityAuditEvents: [],
  };
  const enabled = new Map([[provider, true]]);
  const core = createIdentityProviderCore({
    state,
    profiles: { [provider]: profile },
    adapters: { [provider]: adapter },
    now,
    exchangeTimeoutMs,
    isProviderEnabled: (candidate) => enabled.get(candidate) !== false,
  });
  const bindingSecret = "idb_synthetic_browser_binding";
  return {
    state,
    core,
    sandbox,
    profile,
    bindingSecret,
    advance(ms) {
      clockMs += ms;
    },
    setEnabled(value) {
      enabled.set(provider, value);
    },
  };
}

async function begin(flow) {
  const started = await flow.core.beginAuthorization({
    provider: flow.profile.provider,
    bindingSecret: flow.bindingSecret,
    deviceContext: "synthetic-browser",
  });
  assert.equal(started.ok, true);
  const authorizationUri = new URL(started.authorizationUri);
  return {
    ...started,
    authorizationUri,
    callbackState: authorizationUri.searchParams.get("state"),
    nonce: authorizationUri.searchParams.get("nonce"),
  };
}

for (const provider of enterpriseIdentityProviders) {
  test(`${provider} sandbox passes the shared provider conformance contract`, async (t) => {
    await t.test("binds state, S256 PKCE, nonce, redirect URI, and hash-only durable state", async () => {
      const flow = fixture(provider);
      const started = await begin(flow);
      assert.equal(started.authorizationUri.origin, flow.profile.authorizationOrigins[0]);
      assert.equal(started.authorizationUri.searchParams.get("code_challenge_method"), "S256");
      assert.match(started.authorizationUri.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
      assert.equal(started.authorizationUri.searchParams.get("redirect_uri"), flow.profile.redirectUri);
      assert.equal(started.authorizationUri.searchParams.has("code_verifier"), false);
      assert.equal(started.authorizationUri.searchParams.has("client_secret"), false);
      assert.equal(started.authorizationUri.searchParams.has("access_token"), false);

      const durable = JSON.stringify(flow.state);
      assert.equal(durable.includes(started.callbackState), false);
      assert.equal(durable.includes(started.nonce), false);
      assert.equal(
        flow.state.identityChallenges[0].callbackStateHash,
        hashIdentitySecret(started.callbackState),
      );
    });

    await t.test("accepts normalized tenant claims and consumes state/code once", async () => {
      const flow = fixture(provider);
      const started = await begin(flow);
      const callback = flow.sandbox.issueCallback({ state: started.callbackState });
      const accepted = await flow.core.consumeCallback({
        ...callback,
        bindingSecret: flow.bindingSecret,
      });
      assert.equal(accepted.ok, true);
      assert.equal(accepted.challenge.state, "authorized");
      assert.deepEqual(accepted.externalIdentity.tenantClaims, ["tenant_synthetic_001"]);
      assert.equal(Object.hasOwn(accepted, "accessToken"), false);
      assert.equal(Object.hasOwn(accepted, "refreshToken"), false);
      assert.equal(flow.state.identityProviderCodeUses[0].outcome, "accepted");

      const durable = JSON.stringify(flow.state);
      assert.equal(durable.includes(callback.code), false);
      assert.equal(durable.includes("sandbox_access_token"), false);
      assert.equal(durable.includes("sandbox_refresh_token"), false);

      const replay = await flow.core.consumeCallback({
        ...callback,
        bindingSecret: flow.bindingSecret,
      });
      assert.deepEqual(replay, { ok: false, error: "provider_callback_rejected" });

      const second = await begin(flow);
      const secondCallback = flow.sandbox.issueCallback({ state: second.callbackState });
      const crossTransactionReplay = await flow.core.consumeCallback({
        ...secondCallback,
        code: callback.code,
        bindingSecret: flow.bindingSecret,
      });
      assert.deepEqual(crossTransactionReplay, {
        ok: false,
        error: "provider_callback_rejected",
      });
      assert.equal(flow.state.identityChallenges[0].state, "rejected");
    });

    await t.test("rejects state, browser binding, callback issuer, and redirect mismatch", async () => {
      {
        const flow = fixture(provider);
        const started = await begin(flow);
        const callback = flow.sandbox.issueCallback({ state: started.callbackState });
        const result = await flow.core.consumeCallback({
          ...callback,
          state: "ist_wrong_state",
          bindingSecret: flow.bindingSecret,
        });
        assert.deepEqual(result, { ok: false, error: "provider_callback_rejected" });
      }
      for (const patch of [
        { bindingSecret: "idb_wrong" },
        { issuer: "https://issuer.attacker.sandbox.example" },
        { redirectUri: "https://attacker.sandbox.example/callback" },
      ]) {
        const flow = fixture(provider);
        const started = await begin(flow);
        const callback = flow.sandbox.issueCallback({ state: started.callbackState });
        const result = await flow.core.consumeCallback({
          ...callback,
          bindingSecret: flow.bindingSecret,
          ...patch,
        });
        assert.deepEqual(result, { ok: false, error: "provider_callback_rejected" });
        assert.equal(flow.state.identityChallenges[0].state, "rejected");
      }
    });

    await t.test("requires exact token issuer, nonce, and verified tenant claims", async () => {
      const cases = [
        { tokenIssuer: "https://issuer.attacker.sandbox.example" },
        { identityIssuer: "https://issuer.attacker.sandbox.example" },
        { nonce: "idn_wrong_nonce" },
        { tenantClaims: [] },
      ];
      for (const callbackOptions of cases) {
        const flow = fixture(provider);
        const started = await begin(flow);
        const callback = flow.sandbox.issueCallback({
          state: started.callbackState,
          ...callbackOptions,
        });
        const result = await flow.core.consumeCallback({
          ...callback,
          bindingSecret: flow.bindingSecret,
        });
        assert.deepEqual(result, { ok: false, error: "provider_callback_rejected" });
        assert.equal(flow.state.identityProviderCodeUses[0].outcome, "claims_rejected");
      }
    });

    await t.test("enforces PKCE at exchange and rejects expiry/timeout", async () => {
      {
        const flow = fixture(provider);
        const started = await begin(flow);
        const callback = flow.sandbox.issueCallback({ state: started.callbackState });
        await assert.rejects(() => flow.sandbox.exchangeCode({
          code: callback.code,
          codeVerifier: "wrong-verifier-with-at-least-forty-three-characters",
          redirectUri: flow.profile.redirectUri,
        }));
        const accepted = await flow.core.consumeCallback({
          ...callback,
          bindingSecret: flow.bindingSecret,
        });
        assert.equal(accepted.ok, true);
      }
      {
        const flow = fixture(provider);
        const started = await begin(flow);
        const callback = flow.sandbox.issueCallback({ state: started.callbackState });
        flow.advance(120_001);
        const expired = await flow.core.consumeCallback({
          ...callback,
          bindingSecret: flow.bindingSecret,
        });
        assert.deepEqual(expired, { ok: false, error: "provider_callback_rejected" });
        assert.equal(flow.state.identityChallenges[0].state, "expired");
      }
      {
        const flow = fixture(provider, { exchangeDelayMs: 30, exchangeTimeoutMs: 5 });
        const started = await begin(flow);
        const callback = flow.sandbox.issueCallback({ state: started.callbackState });
        const timedOut = await flow.core.consumeCallback({
          ...callback,
          bindingSecret: flow.bindingSecret,
        });
        assert.deepEqual(timedOut, { ok: false, error: "provider_callback_rejected" });
        assert.equal(flow.state.identityProviderCodeUses[0].outcome, "exchange_rejected");
      }
    });

    await t.test("sanitizes adapter failures without persisting provider payloads", async () => {
      const secretText = "client_secret=production-looking-value access_token=leak";
      const flow = fixture(provider, {
        adapterTransform: (sandbox) => ({
          ...sandbox,
          async exchangeCode() {
            throw new Error(secretText);
          },
        }),
      });
      const started = await begin(flow);
      const callback = flow.sandbox.issueCallback({ state: started.callbackState });
      const result = await flow.core.consumeCallback({
        ...callback,
        bindingSecret: flow.bindingSecret,
      });
      assert.deepEqual(result, { ok: false, error: "provider_callback_rejected" });
      assert.equal(JSON.stringify(flow.state).includes(secretText), false);
      assert.equal(JSON.stringify(flow.state).includes("production-looking-value"), false);
    });

    await t.test("rejects an authorization URI outside the configured origin or carrying secrets", async () => {
      const flow = fixture(provider, {
        adapterTransform: (sandbox) => ({
          ...sandbox,
          async beginAuthorization(context) {
            const started = await sandbox.beginAuthorization(context);
            const unsafe = new URL(started.authorizationUri);
            unsafe.hostname = "attacker.sandbox.example";
            unsafe.searchParams.set("client_secret", "must-not-survive");
            return { ...started, authorizationUri: unsafe.toString() };
          },
        }),
      });
      const result = await flow.core.beginAuthorization({
        provider,
        bindingSecret: flow.bindingSecret,
      });
      assert.deepEqual(result, { ok: false, error: "identity_provider_unavailable" });
      assert.equal(flow.state.identityChallenges.length, 0);
      assert.equal(JSON.stringify(flow.state).includes("must-not-survive"), false);
    });
  });
}

test("provider kill switches disable one adapter without enabling or disabling another", () => {
  const state = { identityChallenges: [], identityProviderCodeUses: [], identityAuditEvents: [] };
  const enabled = new Map(enterpriseIdentityProviders.map((provider) => [provider, true]));
  const profiles = {};
  const adapters = {};
  for (const provider of enterpriseIdentityProviders) {
    const profile = profileFor(provider);
    profiles[provider] = profile;
    adapters[provider] = createIdentityProviderSandbox({
      provider,
      issuer: profile.issuer,
      authorizationEndpoint: `${profile.authorizationOrigins[0]}/authorize`,
    });
  }
  const core = createIdentityProviderCore({
    state,
    profiles,
    adapters,
    isProviderEnabled: (provider) => enabled.get(provider) !== false,
  });
  assert.deepEqual(core.availableProviders(), ["wecom", "feishu", "dingtalk"]);
  enabled.set("feishu", false);
  assert.deepEqual(core.availableProviders(), ["wecom", "dingtalk"]);
  enabled.set("feishu", true);
  enabled.set("wecom", false);
  assert.deepEqual(core.availableProviders(), ["feishu", "dingtalk"]);
});

test("disabling a provider also fails closed for its in-flight callback", async () => {
  const flow = fixture("feishu");
  const started = await begin(flow);
  const callback = flow.sandbox.issueCallback({ state: started.callbackState });
  flow.setEnabled(false);
  const result = await flow.core.consumeCallback({
    ...callback,
    bindingSecret: flow.bindingSecret,
  });
  assert.deepEqual(result, { ok: false, error: "provider_callback_rejected" });
  assert.equal(flow.state.identityChallenges[0].state, "rejected");
});

test("environment policy has independent provider kill switches", async () => {
  const { identityPolicyFromEnv } = await import("../src/runtime/identity-policy.mjs");
  const policy = identityPolicyFromEnv({
    MYAGENT_IDENTITY_PROVIDERS: "wecom,feishu,dingtalk",
    MYAGENT_IDENTITY_WECOM_ENABLED: "0",
    MYAGENT_IDENTITY_FEISHU_ENABLED: "1",
    MYAGENT_IDENTITY_DINGTALK_ENABLED: "0",
  });
  assert.deepEqual(policy.configuredProviders, ["feishu"]);
});

test("provider profiles reject ambiguous issuer URLs", async () => {
  const provider = "feishu";
  const profile = {
    ...profileFor(provider),
    issuer: "https://issuer.feishu.sandbox.example?tenant=ambiguous",
  };
  const state = {
    identityChallenges: [],
    identityProviderCodeUses: [],
    identityAuditEvents: [],
  };
  const sandbox = createIdentityProviderSandbox({
    provider,
    issuer: profile.issuer,
    authorizationEndpoint: `${profile.authorizationOrigins[0]}/authorize`,
  });
  const core = createIdentityProviderCore({
    state,
    profiles: { [provider]: profile },
    adapters: { [provider]: sandbox },
  });
  assert.deepEqual(core.availableProviders(), []);
  assert.deepEqual(await core.beginAuthorization({
    provider,
    bindingSecret: "idb_synthetic_browser_binding",
  }), {
    ok: false,
    error: "identity_provider_unavailable",
  });
});
