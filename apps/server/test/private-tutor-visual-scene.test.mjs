import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrivateTutorVisualScene,
  privateTutorVisualTemplateCatalog,
  validatePrivateTutorVisualScene,
} from "../src/services/private-tutor-visual-scene.mjs";

test("the versioned catalog contains the six deterministic visual templates", () => {
  assert.deepEqual(privateTutorVisualTemplateCatalog().map((item) => item.id), [
    "number_line",
    "fraction_strip",
    "equation_balance",
    "bar_model",
    "coordinate_plane",
    "comparison",
  ]);
  assert.equal(privateTutorVisualTemplateCatalog().every((item) => item.revision === 1), true);
});

test("balance narration, formula, and visual state share one ordered timeline", () => {
  const scene = buildPrivateTutorVisualScene({
    knowledgeId: "balance",
    activityKind: "independent_check",
    teachingMethod: "visual_model",
    questionRevisionId: "tutor-bal-transfer-001-v1",
  });
  assert.equal(scene.schemaVersion, 1);
  assert.equal(scene.template, "equation_balance");
  assert.equal(scene.revisionId, "balance-tutor-bal-transfer-001-v1-independent_check-visual_model-v1");
  assert.deepEqual(scene.parameters.states.map((item) => [item.left, item.right]), [
    ["3x + 2", "17"],
    ["3x", "15"],
    ["x", "5"],
  ]);
  assert.deepEqual(scene.steps.map((step) => step.startMs), [0, 2_400, 4_800]);
  assert.equal(scene.steps[1].narration, scene.parameters.states[1].narration);
  assert.equal(scene.interaction.choices.some((choice) => "correct" in choice), false);
  assert.deepEqual(validatePrivateTutorVisualScene(scene), { ok: true, errors: [] });
  scene.parameters.equation.solution = 6;
  assert.equal(validatePrivateTutorVisualScene(scene).errors.includes("math_parameters"), true);
});

test("mathematically inconsistent scene parameters fail closed", () => {
  const scene = buildPrivateTutorVisualScene({ knowledgeId: "integer", activityKind: "recall", questionRevisionId: "tutor-int-recall-001-v1" });
  scene.parameters.result = 9;
  const validation = validatePrivateTutorVisualScene(scene);
  assert.equal(validation.ok, false);
  assert.equal(validation.errors.includes("math_parameters"), true);
});

test("bar models validate the whole-part relation", () => {
  const scene = buildPrivateTutorVisualScene({ knowledgeId: "word-problem", activityKind: "guided_practice", questionRevisionId: "tutor-word-guided-001-v1" });
  assert.equal(scene.parameters.unitValue * scene.parameters.equalParts + scene.parameters.extra, scene.parameters.total);
  assert.equal(validatePrivateTutorVisualScene(scene).ok, true);
});
