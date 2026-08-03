import assert from "node:assert/strict";
import test from "node:test";
import {
  ENTRY_BUNDLE_LIMITS,
  INITIAL_JS_HARD_LIMIT_BYTES,
  INITIAL_JS_WARNING_BYTES,
  calculateInitialJsSize,
  evaluateInitialJsBudget,
  githubActionsWarning,
  githubStepSummary,
  initialJsFailureMessage,
  initialJsWarningMessage,
} from "../src/web-bundle-budget.mjs";

const thresholdFixtures = [
  { name: "below warning", size: 779_999, level: "ok", warns: false, fails: false },
  { name: "exact warning threshold", size: 780_000, level: "warning", warns: true, fails: false },
  { name: "exact hard limit", size: 800_000, level: "warning", warns: true, fails: false },
  { name: "above hard limit", size: 800_001, level: "failure", warns: false, fails: true },
];

for (const fixture of thresholdFixtures) {
  test(`initial JS budget: ${fixture.name}`, () => {
    const result = evaluateInitialJsBudget(fixture.size);
    assert.equal(result.level, fixture.level);
    assert.equal(Boolean(initialJsWarningMessage(result)), fixture.warns);
    assert.equal(Boolean(initialJsFailureMessage(result)), fixture.fails);
  });
}

test("warning reports current size, hard-limit headroom, and lazy-boundary guidance", () => {
  const warning = initialJsWarningMessage(evaluateInitialJsBudget(INITIAL_JS_WARNING_BYTES));
  assert.match(warning, /780\.0 kB/);
  assert.match(warning, /20\.0 kB/);
  assert.match(warning, /800\.0 kB hard limit/);
  assert.match(warning, /lazy import\(\) boundaries/);
  assert.match(githubActionsWarning(warning), /^::warning title=Web bundle budget::/);
  assert.match(githubStepSummary(warning), /## Web bundle budget warning/);
});

test("route-only chunks stay outside the initial JS calculation", async () => {
  const manifest = {
    "index.html": { file: "index.js", imports: ["vendor.js"] },
    "vendor.js": { file: "vendor.js" },
    "route-only.js": { file: "heavy-route.js" },
  };
  const sizes = new Map([["index.js", 500_000], ["vendor.js", 275_300], ["heavy-route.js", 900_000]]);
  assert.equal(await calculateInitialJsSize(manifest, async (entry) => sizes.get(entry.file)), 775_300);
});

test("existing per-entry hard budgets and the 800 kB initial hard limit remain unchanged", () => {
  assert.deepEqual(ENTRY_BUNDLE_LIMITS, {
    "index.html": 525_000,
    "src/features/tasks/task-view.tsx": 140_000,
    "src/features/auto-runs/auto-runs-view.tsx": 110_000,
  });
  assert.equal(INITIAL_JS_HARD_LIMIT_BYTES, 800_000);
});
