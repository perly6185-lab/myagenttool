import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkItemIntentContract } from "../src/services/work-item-intent-contract.mjs";
import {
  evaluateWorkItemIntentFields,
  WORK_ITEM_INTENT_FIELD_ACCURACY_SET_V1,
} from "../src/services/work-item-intent-evaluation.mjs";

test("field-level intent benchmark scores goal, action, materials, output, and delivery independently", () => {
  const evaluation = evaluateWorkItemIntentFields();

  assert.equal(evaluation.datasetValid, true);
  assert.equal(evaluation.datasetId, "work-item-intent-field-accuracy");
  assert.equal(evaluation.datasetVersion, 1);
  assert.equal(evaluation.datasetDigest, "058b5aedf8f4bb5a3a7c614f0b32ef70df8f328de3cb4a53a349dfb0c725d29a");
  assert.equal(evaluation.total, 12);
  assert.equal(evaluation.passed, 12);
  assert.deepEqual(evaluation.metrics.fieldAccuracy, {
    goal: 1,
    action: 1,
    materials: 1,
    output: 1,
    delivery: 1,
  });
  assert.equal(evaluation.metrics.exactCaseAccuracy, 1);
  assert.equal(evaluation.metrics.macroFieldAccuracy, 1);
  assert.equal(evaluation.metrics.unsafeActionExpansionRate, 0);
  assert.deepEqual(evaluation.gateFailures, []);
  assert.equal(evaluation.releaseReady, true);
  assert.ok(evaluation.coverage.channelCases >= 6);
  assert.ok(evaluation.coverage.desktopCases >= 5);
  assert.ok(evaluation.coverage.materialCases >= 3);
});

test("field-level intent benchmark pinpoints one goal regression without hiding the other fields", () => {
  const evaluation = evaluateWorkItemIntentFields({
    buildContract(item) {
      const contract = buildWorkItemIntentContract(item);
      return item.id === "eval_desktop_read" ? { ...contract, goal: "检查整个系统" } : contract;
    },
  });

  assert.equal(evaluation.passed, 11);
  assert.equal(evaluation.metrics.fieldAccuracy.goal, 11 / 12);
  assert.equal(evaluation.metrics.fieldAccuracy.action, 1);
  assert.deepEqual(evaluation.failed[0].failedFields, ["goal"]);
  assert.deepEqual(evaluation.failed[0].fields.goal.mismatchPaths, ["value"]);
  assert.ok(evaluation.gateFailures.includes("goal_accuracy_below_threshold"));
  assert.equal(evaluation.releaseReady, false);
});

test("field-level intent benchmark treats lost material identity as a materials-only regression", () => {
  const evaluation = evaluateWorkItemIntentFields({
    buildContract(item) {
      const contract = buildWorkItemIntentContract(item);
      if (item.id !== "eval_materials") return contract;
      return {
        ...contract,
        materials: {
          ...contract.materials,
          inputs: contract.materials.inputs.map((material) => material.id === "asset_quote"
            ? { ...material, fingerprint: "sha256:wrong-version" }
            : material),
        },
      };
    },
  });

  const failure = evaluation.failed.find((result) => result.id === "mixed-material-identities-and-versions");
  assert.deepEqual(failure.failedFields, ["materials"]);
  assert.deepEqual(failure.fields.materials.mismatchPaths, ["inputs[2].fingerprint"]);
  assert.ok(evaluation.gateFailures.includes("materials_accuracy_below_threshold"));
});

test("field-level intent benchmark fails closed on an unsafe action expansion", () => {
  const evaluation = evaluateWorkItemIntentFields({
    buildContract(item) {
      const contract = buildWorkItemIntentContract(item);
      return item.id === "eval_desktop_read"
        ? { ...contract, action: { accessMode: "write", operation: "mutate_files", forbiddenActions: [] } }
        : contract;
    },
  });

  const failure = evaluation.failed.find((result) => result.id === "desktop-explicit-read-only-files");
  assert.equal(failure.unsafeActionExpansion, true);
  assert.ok(evaluation.metrics.unsafeActionExpansionRate > 0);
  assert.ok(evaluation.gateFailures.includes("unsafe_action_expansion_rate_above_threshold"));
  assert.equal(evaluation.releaseReady, false);
});

test("field-level intent benchmark rejects a shrunken or malformed dataset", () => {
  const dataset = structuredClone(WORK_ITEM_INTENT_FIELD_ACCURACY_SET_V1);
  dataset.cases = [dataset.cases[0]];
  delete dataset.cases[0].expected.delivery;

  const evaluation = evaluateWorkItemIntentFields({ dataset });

  assert.equal(evaluation.datasetValid, false);
  assert.equal(evaluation.releaseReady, false);
  assert.equal(evaluation.datasetDigest, null);
  assert.ok(evaluation.datasetErrors.includes("case_desktop-explicit-read-only-files_delivery_expected_required"));
  assert.deepEqual(evaluation.gateFailures, ["dataset_invalid"]);
});
