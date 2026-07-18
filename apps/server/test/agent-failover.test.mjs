/*
 * Same-device agent failover selector (#1268, slice 3b): pick a healthy alternate
 * of the SAME adapter type on the SAME device, skipping disabled/unhealthy/tried.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { FAILOVER_INFRA_CODES, MAX_FAILOVERS, selectFailoverAgent } from "../src/services/invocations/agent-failover.mjs";

const cli = (id, deviceId, over = {}) => ({
  id,
  adapter: { type: "cli" },
  location: { type: "local_device", deviceId },
  status: "available",
  lifecycle: { state: "enabled" },
  health: { status: "healthy" },
  ...over,
});

test("constants: infra codes and a bounded cap", () => {
  assert.deepEqual(FAILOVER_INFRA_CODES, ["dispatch_timeout", "orphaned", "stuck"]);
  assert.ok(MAX_FAILOVERS >= 1 && Number.isInteger(MAX_FAILOVERS));
});

test("picks a healthy same-device, same-type alternate; excludes the failed agent", () => {
  const failed = cli("agt_a", "dev_1");
  const agents = [failed, cli("agt_b", "dev_1")];
  assert.equal(selectFailoverAgent(agents, failed, ["agt_a"]).id, "agt_b");
});

test("skips wrong device, wrong adapter type, disabled, unhealthy, and already-tried", () => {
  const failed = cli("agt_a", "dev_1");
  const agents = [
    failed,
    cli("agt_otherdev", "dev_2"), // wrong device
    cli("agt_mcp", "dev_1", { adapter: { type: "mcp" } }), // wrong adapter type
    cli("agt_disabled", "dev_1", { status: "disabled" }), // disabled
    cli("agt_unhealthy", "dev_1", { health: { status: "unhealthy" } }), // unhealthy
    cli("agt_tried", "dev_1"), // excluded (already failed over from)
    cli("agt_good", "dev_1"), // the one valid alternate
  ];
  assert.equal(selectFailoverAgent(agents, failed, ["agt_a", "agt_tried"]).id, "agt_good");
});

test("returns null when no alternate qualifies", () => {
  const failed = cli("agt_a", "dev_1");
  assert.equal(selectFailoverAgent([failed, cli("agt_b", "dev_1", { status: "disabled" })], failed, ["agt_a"]), null);
});

test("returns null for a non-local (platform/remote) failed agent — no same-device pool", () => {
  const failed = { id: "agt_platform", adapter: { type: "platform" }, location: { type: "platform" } };
  const agents = [failed, cli("agt_b", "dev_1")];
  assert.equal(selectFailoverAgent(agents, failed, ["agt_platform"]), null);
});

test("null failed agent → null (never throws)", () => {
  assert.equal(selectFailoverAgent([cli("agt_b", "dev_1")], null, []), null);
});
