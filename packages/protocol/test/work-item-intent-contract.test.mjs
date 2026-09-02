import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeWorkItemIntentAccessMode,
  normalizeWorkItemIntentConflictCode,
  normalizeWorkItemIntentOperation,
  normalizeWorkItemIntentResolutionTargets,
  normalizeWorkItemIntentSource,
  normalizeWorkItemIntentStatus,
  workItemIntentContractSchemaVersion,
} from "../src/work-item-intent-contract.mjs";

test("work item intent contract v2 fails closed for unknown authority values", () => {
  assert.equal(workItemIntentContractSchemaVersion, 2);
  assert.equal(normalizeWorkItemIntentStatus("future_ready"), "needs_clarification");
  assert.equal(normalizeWorkItemIntentAccessMode("unrestricted"), "unknown");
  assert.equal(normalizeWorkItemIntentOperation("run_anything"), "unknown");
  assert.equal(normalizeWorkItemIntentSource("provider_guess"), "safe_default");
  assert.equal(normalizeWorkItemIntentConflictCode("provider_conflict"), "intent_contract_unknown");
  assert.deepEqual(normalizeWorkItemIntentResolutionTargets([
    "action.accessMode", "provider.patch", "action.accessMode",
  ]), ["action.accessMode"]);
});
