import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  REQUIRED_VISUAL_QA_SCENARIOS,
  SCRIPTED_VIOLATION_CODES,
  VISUAL_QA_VIEWPORTS,
  detectVisualQaViolations,
  expectedVisualQaScreenshotCount,
  scriptedVisualQaViolationFixture,
  validateVisualQaScenarioCatalog,
} from "../visual-qa-contract.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

test("Visual QA contract requires the foundational product states", () => {
  const catalog = validateVisualQaScenarioCatalog([
    ...REQUIRED_VISUAL_QA_SCENARIOS,
    "home-workbench",
  ]);
  assert.deepEqual(catalog.required, [...REQUIRED_VISUAL_QA_SCENARIOS]);
  assert.equal(catalog.available.length, REQUIRED_VISUAL_QA_SCENARIOS.length + 1);
});

test("Visual QA contract rejects missing and duplicate scenarios", () => {
  assert.throws(
    () => validateVisualQaScenarioCatalog(["empty", "empty"]),
    /duplicate scenarios: empty.*missing required scenarios/,
  );
});

test("screenshot count follows selected scenarios and supplemental board captures", () => {
  assert.equal(
    expectedVisualQaScreenshotCount({
      scenarioNames: ["empty", "ready", "home-workbench"],
      viewportCount: VISUAL_QA_VIEWPORTS.length,
    }),
    10,
  );
  assert.equal(
    expectedVisualQaScreenshotCount({ scenarioNames: ["running"], viewportCount: 2 }),
    2,
  );
});

test("scripted bad layout trips every governed Visual QA guard", () => {
  const codes = detectVisualQaViolations(scriptedVisualQaViolationFixture()).map((finding) => finding.code);
  assert.deepEqual(codes, [...SCRIPTED_VIOLATION_CODES]);
});

test("healthy layout has no contract violations", () => {
  assert.deepEqual(detectVisualQaViolations({
    viewportWidth: 390,
    documentWidth: 390,
    bodyWidth: 390,
    textLength: 800,
    requiresPrimaryControls: true,
    visiblePrimaryControlCount: 3,
    enforceTechnicalHierarchy: true,
    resultTextLength: 300,
    rawTechnicalTextLength: 40,
    columnOwnershipViolations: 0,
  }), []);
});

test("Visual QA documentation delegates counts to the generated manifest", () => {
  const documentation = readFileSync(resolve(repoRoot, "docs/engineering/VISUAL_QA.md"), "utf8");
  assert.match(documentation, /generated report is the source of truth/i);
  assert.doesNotMatch(documentation, /captures\s+\d+\s+screenshots/i);
  for (const scenario of REQUIRED_VISUAL_QA_SCENARIOS) {
    assert.match(documentation, new RegExp(`\\b${scenario}\\b`, "i"));
  }
});
