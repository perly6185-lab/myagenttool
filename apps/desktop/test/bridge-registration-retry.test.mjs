import assert from "node:assert/strict";
import test from "node:test";
import { isExpiredBridgeCredentialError, registerBridgeWithRecovery, registerBridgeWithRetry } from "../src/bridge-registration-retry.mjs";

test("registration retries a transient loopback reset and then succeeds", async () => {
  let calls = 0;
  const delays = [];
  const result = await registerBridgeWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed", { cause: new Error("read ECONNRESET") });
    return { bridgeToken: "not-logged" };
  }, { delay: async (ms) => delays.push(ms) });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);
  assert.equal(result.bridgeToken, "not-logged");
});

test("registration does not retry a credential refusal", async () => {
  let calls = 0;
  await assert.rejects(
    registerBridgeWithRetry(async () => {
      calls += 1;
      throw new Error("POST /api/bridge/register failed: invalid_bridge_credentials");
    }, { delay: async () => {} }),
    /invalid_bridge_credentials/,
  );
  assert.equal(calls, 1);
});

test("expired credentials are recovered once through relink and a fresh registration", async () => {
  let calls = 0;
  let recovered = 0;
  let reset = 0;
  const result = await registerBridgeWithRecovery(async () => {
    calls += 1;
    if (calls === 1) throw new Error("POST /api/bridge/register failed: {\"error\":\"bridge_credentials_expired\"}");
    return { bridgeToken: "fresh-token" };
  }, {
    recoverExpiredCredential: async () => { recovered += 1; },
    resetCredential: () => { reset += 1; },
  });
  assert.equal(calls, 2);
  assert.equal(recovered, 1);
  assert.equal(reset, 1);
  assert.equal(result.bridgeToken, "fresh-token");
});

test("intentional credential refusals are not auto-repaired", async () => {
  let recovered = 0;
  await assert.rejects(
    registerBridgeWithRecovery(async () => {
      throw new Error("POST /api/bridge/register failed: device_credentials_revoked");
    }, {
      recoverExpiredCredential: async () => { recovered += 1; },
    }),
    /device_credentials_revoked/,
  );
  assert.equal(recovered, 0);
  assert.equal(isExpiredBridgeCredentialError(new Error("bridge_credentials_expired")), true);
  assert.equal(isExpiredBridgeCredentialError(new Error("device_credentials_revoked")), false);
});

test("registration stops after the bounded transient retry budget", async () => {
  let calls = 0;
  await assert.rejects(
    registerBridgeWithRetry(async () => {
      calls += 1;
      throw new TypeError("fetch failed", { cause: new Error("read ECONNRESET") });
    }, { attempts: 3, delay: async () => {} }),
    /fetch failed/,
  );
  assert.equal(calls, 3);
});
