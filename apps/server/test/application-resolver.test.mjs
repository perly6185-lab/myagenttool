import test from "node:test";
import assert from "node:assert/strict";
import { resolveLocalApplicationCapability } from "../src/services/application-resolver.mjs";

const capability = (overrides = {}) => ({
  name: "app.app_officecli.wrapper.apply",
  displayName: "Edit Office document",
  provider: { type: "application", id: "app_officecli" },
  terminalId: "terminal-1",
  invokable: true,
  requiresApproval: true,
  riskLevel: "medium",
  metadata: { readiness: { state: "ready", reason: "runtime_available" }, assetVerbs: ["edit"] },
  ...overrides,
});

test("resolves an asset verb only to a ready capability on the immutable terminal", () => {
  const result = resolveLocalApplicationCapability({
    assetVerb: "edit",
    terminalId: "terminal-1",
    capabilities: [
      capability({ terminalId: "terminal-2", requiresApproval: false }),
      capability(),
    ],
  });
  assert.equal(result.state, "waiting_approval");
  assert.equal(result.capability.applicationId, "app_officecli");
  assert.equal(result.terminalId, "terminal-1");
  assert.deepEqual(result.explanation.requested, { kind: "asset_verb", value: "edit" });
});

test("explains missing setup, approval, and local capacity without rerouting", () => {
  const setup = resolveLocalApplicationCapability({
    intent: "inspect", terminalId: "terminal-1",
    capabilities: [capability({ name: "app.app_pdf.inspect", requiresApproval: false, metadata: { readiness: { state: "needs_setup", reason: "binary_unavailable" }, intents: ["inspect"] } })],
  });
  assert.equal(setup.state, "waiting_capability");
  assert.equal(setup.reason, "binary_unavailable");

  const capacity = resolveLocalApplicationCapability({
    assetVerb: "edit", terminalId: "terminal-1", resourceClass: "large",
    capabilities: [capability()],
  });
  assert.equal(capacity.state, "waiting_capacity");
  assert.equal(capacity.capability.name, "app.app_officecli.wrapper.apply");
});

test("rejects unknown intent and never treats caller text as a capability id or command", () => {
  const injected = resolveLocalApplicationCapability({
    intent: "run app.app_officecli.wrapper.apply; rm -rf /",
    terminalId: "terminal-1",
    capabilities: [capability({ requiresApproval: false })],
  });
  assert.equal(injected.state, "refusal");
  assert.equal(injected.capability, null);
});

test("does not fall back to another terminal or disabled/non-application candidates", () => {
  const result = resolveLocalApplicationCapability({
    assetVerb: "edit", terminalId: "terminal-1",
    capabilities: [
      capability({ terminalId: "terminal-2" }),
      capability({ provider: { type: "tool", id: "tool-edit" } }),
      capability({ invokable: false }),
    ],
  });
  assert.equal(result.state, "waiting_capability");
  assert.equal(result.reason, "no_local_application_capability");
});
