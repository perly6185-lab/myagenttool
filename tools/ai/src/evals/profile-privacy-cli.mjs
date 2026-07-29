#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PROFILE_ACCEPTANCE_THRESHOLDS,
  evaluateProfileAcceptance,
  formatProfileAcceptanceReport,
  loadProfileAcceptanceSet,
  loadProfilePredictions,
} from "./profile-privacy.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "../../../..");
const args = process.argv.slice(2);
const setArg = option("--set") ?? "tools/ai/evals/profile-privacy/cases";
const predictionsArg = option("--predictions") ?? "tools/ai/evals/profile-privacy/baseline-predictions.json";
const thresholds = {
  ...DEFAULT_PROFILE_ACCEPTANCE_THRESHOLDS,
  minRecall: numericOption("--min-recall", DEFAULT_PROFILE_ACCEPTANCE_THRESHOLDS.minRecall),
  minPrecision: numericOption("--min-precision", DEFAULT_PROFILE_ACCEPTANCE_THRESHOLDS.minPrecision),
};

try {
  const cases = loadProfileAcceptanceSet(resolve(repoRoot, setArg));
  const predictions = loadProfilePredictions(resolve(repoRoot, predictionsArg));
  const summary = evaluateProfileAcceptance({ cases, predictions, thresholds });
  const output = args.includes("--json")
    ? `${JSON.stringify(summary, null, 2)}\n`
    : formatProfileAcceptanceReport(summary, {
      setDir: setArg,
      predictionsPath: predictionsArg,
    });
  process.stdout.write(output);
  if (!summary.passed) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`Profile acceptance eval failed: ${error.message}\n`);
  process.exitCode = 1;
}

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function numericOption(name, fallback) {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number.`);
  return value;
}
