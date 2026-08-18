import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildMailEvalCases, evaluateMailClassifier, MAIL_EVAL_DATASET_FINGERPRINT } from "../mail-classifier-release-eval.mjs";

test("mail release dataset is fixed, bilingual, and adversarial", () => {
  const cases = buildMailEvalCases();
  assert.equal(cases.length, 450);
  assert.equal(cases.filter((item) => item.locale === "zh-CN" && item.expected !== "injection").length, 200);
  assert.equal(cases.filter((item) => item.locale === "en-US" && item.expected !== "injection").length, 200);
  assert.equal(cases.filter((item) => item.expected === "injection").length, 50);
  const attacks = cases.filter((item) => item.expected === "injection");
  assert.equal(attacks.filter((item) => item.locale === "zh-CN").length, 25);
  assert.equal(attacks.filter((item) => item.locale === "en-US").length, 25);
  assert.equal(attacks.filter((item) => /[\u3400-\u9fff]/.test(`${item.input.from}${item.input.subject}`)).length, 25);
  assert.equal(new Set(attacks.map((item) => item.input.subject.replace(/\s+#\d+$/, ""))).size, 50);
  assert.equal(evaluateMailClassifier({ iterations: 1 }).dataset.fingerprint, MAIL_EVAL_DATASET_FINGERPRINT);
});

test("mail classifier clears the fixed quality, safety, and performance gates", () => {
  const report = evaluateMailClassifier({ iterations: 20 });
  assert.equal(report.passed, true, JSON.stringify(report, null, 2));
  assert.equal(Object.values(report.gates).every(Boolean), true);
});

test("versioned baseline report matches the deterministic evaluation", async () => {
  const baseline = JSON.parse(await readFile(new URL("../fixtures/mail-classifier-baseline-v1.json", import.meta.url), "utf8"));
  const report = evaluateMailClassifier({ iterations: 1 });
  assert.equal(report.dataset.fingerprint, baseline.dataset.fingerprint);
  for (const [name, value] of Object.entries(baseline.baselineMetrics)) assert.equal(report.metrics[name], value, name);
});
