// L4 held-out evaluation harness.
//
// Purpose: replace L4's structural "does an adapter contract slot exist" check
// with a measured pass rate on a local held-out set of real issues. See
// docs/engineering/L4_HELDOUT_EVAL.md and docs/engineering/MATURITY_CALIBRATION.md.
//
// This module is pure/testable: no process.exit, no argv parsing. The command
// wrapper in ../index.mjs handles CLI concerns and evidence output.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// A resolver turns one held-out case into a resolution attempt. The mock
// resolver stands in for current coding capability so the harness stays
// hermetic; real capability plugs in via a command resolver (see index.mjs).
//   resolver(caseObj) -> { changedFiles: string[], notes?: string }

export function validateHeldoutCase(raw, source) {
  const where = source ? ` (${source})` : "";
  if (!raw || typeof raw !== "object") throw new Error(`Held-out case must be a JSON object${where}.`);
  if (!isNonEmptyString(raw.id)) throw new Error(`Held-out case needs a string id${where}.`);
  if (!isNonEmptyString(raw.title)) throw new Error(`Held-out case ${raw.id} needs a title${where}.`);
  if (!isNonEmptyString(raw.spec)) throw new Error(`Held-out case ${raw.id} needs a spec${where}.`);
  const oracle = raw.oracle ?? {};
  const expectedFiles = stringArray(oracle.expectedFiles);
  const forbiddenFiles = stringArray(oracle.forbiddenFiles);
  if (expectedFiles.length === 0) {
    throw new Error(`Held-out case ${raw.id} oracle needs at least one expectedFiles entry${where}.`);
  }
  return {
    id: raw.id,
    issue: isNonEmptyString(raw.issue) ? raw.issue : String(raw.id),
    title: raw.title,
    spec: raw.spec,
    risk: isNonEmptyString(raw.risk) ? raw.risk : "unknown",
    // Optional git ref the resolver should base its worktree on. Real cases
    // mined from history pin this to the parent of the original fix commit so
    // the change does not already exist in the tree being evaluated.
    base: isNonEmptyString(raw.base) ? raw.base : "",
    oracle: { expectedFiles, forbiddenFiles },
    mock: { changedFiles: stringArray(raw.mock?.changedFiles), note: isNonEmptyString(raw.mock?.note) ? raw.mock.note : "" },
  };
}

export function loadHeldoutSet(dir) {
  if (!existsSync(dir)) throw new Error(`Held-out set directory not found: ${dir}`);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) throw new Error(`Held-out set has no *.json cases: ${dir}`);
  const cases = [];
  const seen = new Set();
  for (const name of files) {
    const full = resolve(dir, name);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(full, "utf8"));
    } catch (error) {
      throw new Error(`Held-out case ${name} is not valid JSON: ${error.message}`);
    }
    const validated = validateHeldoutCase(parsed, name);
    if (seen.has(validated.id)) throw new Error(`Duplicate held-out case id: ${validated.id} (${name})`);
    seen.add(validated.id);
    cases.push(validated);
  }
  return cases;
}

// Oracle: a case is resolved when the resolver touched every expected file and
// touched nothing under a forbidden prefix (scope discipline), and touched at
// least one file at all. Deterministic, no glob dependency.
export function judgeCase(caseObj, resolution) {
  const changed = stringArray(resolution?.changedFiles);
  const { expectedFiles, forbiddenFiles } = caseObj.oracle;
  const missing = expectedFiles.filter((file) => !changed.includes(file));
  const violated = changed.filter((file) => forbiddenFiles.some((prefix) => underPrefix(file, prefix)));
  const resolved = changed.length > 0 && missing.length === 0 && violated.length === 0;
  let reason;
  if (resolved) reason = "All expected files changed with no scope violations.";
  else if (changed.length === 0) reason = "Resolver produced no file changes.";
  else if (missing.length > 0) reason = `Missing expected files: ${missing.join(", ")}.`;
  else reason = `Touched forbidden files: ${violated.join(", ")}.`;
  return { id: caseObj.id, resolved, reason, changedFiles: changed, missing, violated };
}

export async function evaluateHeldoutSet({ cases, resolver }) {
  if (typeof resolver !== "function") throw new Error("evaluateHeldoutSet requires a resolver function.");
  const results = [];
  for (const caseObj of cases) {
    let resolution;
    try {
      resolution = await resolver(caseObj);
    } catch (error) {
      results.push({ id: caseObj.id, resolved: false, reason: `Resolver threw: ${error.message}`, changedFiles: [], missing: caseObj.oracle.expectedFiles, violated: [] });
      continue;
    }
    results.push({ ...judgeCase(caseObj, resolution), notes: resolution?.notes ?? "" });
  }
  const total = results.length;
  const resolved = results.filter((r) => r.resolved).length;
  const passRate = total === 0 ? 0 : resolved / total;
  return { total, resolved, passRate, results };
}

export function mockResolver(caseObj) {
  return { changedFiles: caseObj.mock.changedFiles, notes: caseObj.mock.note || "mock resolver" };
}

export function formatHeldoutReport(summary, { setDir, resolverName } = {}) {
  const pct = (summary.passRate * 100).toFixed(1);
  const lines = [
    "# L4 Held-out Evaluation",
    "",
    `Pass rate: ${pct}% (${summary.resolved}/${summary.total})`,
    resolverName ? `Resolver: ${resolverName}` : null,
    setDir ? `Set: ${setDir}` : null,
    "",
    "| Case | Resolved | Reason |",
    "| --- | --- | --- |",
    ...summary.results.map((r) => `| ${r.id} | ${r.resolved ? "yes" : "no"} | ${escapeCell(r.reason)} |`),
    "",
  ].filter((line) => line !== null);
  return `${lines.join("\n")}\n`;
}

function underPrefix(file, prefix) {
  if (file === prefix) return true;
  const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return file.startsWith(normalized);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value) {
  return Array.isArray(value) ? value.map(String).filter((item) => item.length > 0) : [];
}

function escapeCell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}
