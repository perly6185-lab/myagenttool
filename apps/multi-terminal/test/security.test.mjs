import test from "node:test";
import assert from "node:assert/strict";
import { bearerAuthorized, requireSecureDeployment, signWebhook, verifyWebhookSignature } from "../src/security.mjs";

test("remote binding requires explicit TLS proxy contract", () => {
  assert.equal(requireSecureDeployment({ MULTI_TERMINAL_HOST: "127.0.0.1" }), "127.0.0.1");
  assert.throws(() => requireSecureDeployment({ MULTI_TERMINAL_HOST: "0.0.0.0" }), /TLS reverse proxy/);
  assert.equal(requireSecureDeployment({ MULTI_TERMINAL_HOST: "0.0.0.0", MULTI_TERMINAL_TRUST_PROXY: "true", MULTI_TERMINAL_TLS_TERMINATED: "true" }), "0.0.0.0");
});

test("admin bearer comparison and signed webhook reject replay windows", () => {
  const secret = "a".repeat(24);
  assert.equal(bearerAuthorized(`Bearer ${secret}`, secret), true);
  assert.equal(bearerAuthorized("Bearer wrong", secret), false);
  const timestamp = "1000000000";
  const body = "{\"status\":\"breached\"}";
  const signature = signWebhook(secret, timestamp, body);
  assert.equal(verifyWebhookSignature({ secret, timestamp, body, signature, now: 1_000_000_000_000 }), true);
  assert.equal(verifyWebhookSignature({ secret, timestamp, body, signature, now: 1_400_000_000_000 }), false);
});
