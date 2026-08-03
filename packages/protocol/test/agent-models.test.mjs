import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agentAdapterSupportsModel,
  defaultModelForAgentAdapter,
  modelIdsForAgentAdapter,
  normalizeAgentModel,
} from "../src/agent-models.mjs";

test("model catalog follows the selected coding-agent runtime", () => {
  assert.deepEqual(modelIdsForAgentAdapter({ type: "cli", command: "codex" }).slice(0, 1), ["gpt-5.6-sol"]);
  assert.deepEqual(modelIdsForAgentAdapter({ type: "cli", command: "claude.cmd" }), ["sonnet", "opus"]);
  assert.deepEqual(modelIdsForAgentAdapter({ type: "http", baseUrl: "https://example.test" }), []);
});

test("a registered catalog overrides fallback models and constrains its default", () => {
  const adapter = { type: "cli", command: "codex", models: ["custom/a", "custom/a", "bad value"], defaultModel: "custom/a" };
  assert.deepEqual(modelIdsForAgentAdapter(adapter), ["custom/a"]);
  assert.equal(defaultModelForAgentAdapter(adapter), "custom/a");
  assert.equal(defaultModelForAgentAdapter({ ...adapter, defaultModel: "other" }), null);
  assert.equal(normalizeAgentModel("model --help"), null);
  assert.equal(normalizeAgentModel("claude-sonnet-4-5@20250929"), "claude-sonnet-4-5@20250929");
  assert.equal(agentAdapterSupportsModel(adapter, "custom/a"), true);
  assert.equal(agentAdapterSupportsModel(adapter, "other"), false);
});
