import assert from "node:assert/strict";
import { test } from "node:test";

import {
  configuredLoopbackToken,
  hostAllowed,
  loopbackTokenValid,
} from "../src/runtime/loopback-guard.mjs";

const TOKEN = "a".repeat(64);

test("hostAllowed: loopback names pass in every common form, rebind hosts fail", () => {
  for (const host of ["127.0.0.1", "127.0.0.1:5001", "localhost", "localhost:5001", "[::1]", "[::1]:5001"]) {
    assert.equal(hostAllowed(host, {}), true, `${host} is loopback`);
  }
  for (const host of [
    "evil.example", // classic rebind: DNS says 127.0.0.1, Host says attacker
    "evil.example:5001",
    "127.0.0.1.evil.example", // lookalike suffix
    "192.168.1.20:5001", // LAN address without an allowlist entry
    "", // fails closed
    null,
    "bad host header", // unparsable
  ]) {
    assert.equal(hostAllowed(host, {}), false, `${host} must be rejected`);
  }
});

test("hostAllowed: MYAGENT_ALLOWED_HOSTS extends the allowlist by hostname, case-insensitively", () => {
  const env = { MYAGENT_ALLOWED_HOSTS: "workstation.lan, Console.Example" };
  assert.equal(hostAllowed("workstation.lan:5001", env), true);
  assert.equal(hostAllowed("console.example", env), true);
  assert.equal(hostAllowed("other.lan", env), false);
});

test("configuredLoopbackToken: short or missing values disable the gate rather than weaken it", () => {
  assert.equal(configuredLoopbackToken({}), null);
  assert.equal(configuredLoopbackToken({ MYAGENT_LOOPBACK_TOKEN: "short" }), null);
  assert.equal(configuredLoopbackToken({ MYAGENT_LOOPBACK_TOKEN: `  ${TOKEN}  ` }), TOKEN);
});

test("loopbackTokenValid: exact match only, wrong/absent/prefix values fail", () => {
  const req = (value) => ({ headers: value == null ? {} : { "x-loopback-token": value } });
  assert.equal(loopbackTokenValid(req(TOKEN), TOKEN), true);
  assert.equal(loopbackTokenValid(req(null), TOKEN), false);
  assert.equal(loopbackTokenValid(req(""), TOKEN), false);
  assert.equal(loopbackTokenValid(req(TOKEN.slice(0, 63)), TOKEN), false);
  assert.equal(loopbackTokenValid(req(`${TOKEN}x`), TOKEN), false);
  assert.equal(loopbackTokenValid(req("b".repeat(64)), TOKEN), false);
  assert.equal(loopbackTokenValid(req(TOKEN), null), false, "no configured token → nothing validates");
});
