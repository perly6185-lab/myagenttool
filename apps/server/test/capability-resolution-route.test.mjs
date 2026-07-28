import test from "node:test";
import assert from "node:assert/strict";
import { handleCapabilityRoutes } from "../src/routes/capabilities.mjs";

test("capability resolution route accepts structured intent and returns the explainable result", async () => {
  let response;
  const expected = { state: "ready", reason: "local_capability_selected", terminalId: "terminal-1" };
  const handled = await handleCapabilityRoutes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://localhost/api/capability-resolutions"),
    sendJson: (_res, status, body) => { response = { status, body }; },
    readJson: async () => ({ intent: "inspect", terminalId: "terminal-1" }),
    state: {},
    actor: { userId: "user-1" },
    listCapabilities: () => [],
    getCapability: () => null,
    createCapabilityInvocation: () => null,
    resolveCapability: (input) => {
      assert.deepEqual(input, { intent: "inspect", terminalId: "terminal-1" });
      return expected;
    },
  });
  assert.equal(handled, true);
  assert.deepEqual(response, { status: 200, body: { resolution: expected } });
});

test("capability resolution route refuses non-object input", async () => {
  let response;
  await handleCapabilityRoutes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://localhost/api/capability-resolutions"),
    sendJson: (_res, status, body) => { response = { status, body }; },
    readJson: async () => "edit everything",
    resolveCapability: () => { throw new Error("must not resolve unstructured input"); },
  });
  assert.deepEqual(response, { status: 400, body: { error: "invalid_capability_resolution" } });
});
