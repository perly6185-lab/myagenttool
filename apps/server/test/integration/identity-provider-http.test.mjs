process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENT_LOCAL_MODE = "0";
process.env.MYAGENT_IDENTITY_PROVIDERS = "feishu";
process.env.MYAGENT_IDENTITY_FEISHU_ENABLED = "1";
process.env.MYAGENT_LEGACY_BEARER_AUTH = "0";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createIdentityProviderCore } from "../../src/services/identity-provider-core.mjs";
import { createIdentityProviderSandbox } from "../../src/testing/identity-provider-sandbox.mjs";

let server;
let base;
let state;
let providerEnabled = true;

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");
  const now = () => new Date().toISOString();
  const created = createServerState({ defaultProjectPath: "/tmp", now });
  state = created.state;
  const profile = {
    provider: "feishu",
    issuer: "https://issuer.feishu.sandbox.example",
    redirectUri: "https://console.sandbox.example/api/identity/callback/feishu",
    authorizationOrigins: ["https://auth.feishu.sandbox.example"],
    pkce: "S256",
    nonceRequired: true,
    tenantClaimRequired: true,
  };
  const sandbox = createIdentityProviderSandbox({
    provider: "feishu",
    issuer: profile.issuer,
    authorizationEndpoint: `${profile.authorizationOrigins[0]}/authorize`,
    now,
  });
  const identityProviderCore = createIdentityProviderCore({
    state,
    profiles: { feishu: profile },
    adapters: { feishu: sandbox },
    now,
    isProviderEnabled: () => providerEnabled,
  });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "identity-provider-http-test",
    protocolVersion: "0.0.0",
    state,
    defaultProject: created.defaultProject,
    defaultProjectPath: "/tmp",
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused-provider-http.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "identity-provider-http-test",
    protocolVersion: "0.0.0",
    ...httpDependencies,
    identityProviderCore,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test("HTTP capability discovery and challenge start use only the conformance core", async () => {
  const options = await fetch(`${base}/api/identity/options`);
  assert.equal(options.status, 200);
  assert.deepEqual((await options.json()).providers, [{
    provider: "feishu",
    label: "飞书",
    authorization: "redirect",
  }]);

  const started = await fetch(`${base}/api/identity/challenges`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "synthetic-browser" },
    body: JSON.stringify({ provider: "feishu" }),
  });
  assert.equal(started.status, 201);
  const body = await started.json();
  const authorizationUri = new URL(body.authorizationUri);
  const callbackState = authorizationUri.searchParams.get("state");
  const nonce = authorizationUri.searchParams.get("nonce");
  assert.equal(authorizationUri.searchParams.get("code_challenge_method"), "S256");
  assert.match(started.headers.get("set-cookie") ?? "", /myagenttool_identity_binding=.*HttpOnly/i);
  assert.equal(JSON.stringify(state).includes(callbackState), false);
  assert.equal(JSON.stringify(state).includes(nonce), false);
});

test("an independent kill switch removes discovery and blocks new challenges", async () => {
  providerEnabled = false;
  const options = await fetch(`${base}/api/identity/options`);
  assert.deepEqual((await options.json()).providers, []);
  const blocked = await fetch(`${base}/api/identity/challenges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "feishu" }),
  });
  assert.equal(blocked.status, 404);
  assert.deepEqual(await blocked.json(), { error: "identity_provider_unavailable" });
});
