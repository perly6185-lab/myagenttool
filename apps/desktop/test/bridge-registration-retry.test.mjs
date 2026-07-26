import assert from "node:assert/strict";
import test from "node:test";
import { registerBridgeWithRetry } from "../src/bridge-registration-retry.mjs";

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
