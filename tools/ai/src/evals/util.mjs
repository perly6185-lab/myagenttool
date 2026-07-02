// Shared helpers for the eval modules (heldout.mjs, subcap.mjs).
//
// Extracted from three review-flagged duplications (#245): the string helpers
// and the case-set loader skeleton were byte-identical copies, and the copies
// embed load-bearing policy (what counts as a valid case file, how markdown
// cells are sanitized) that must not drift between the two evals.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function stringArray(value) {
  return Array.isArray(value) ? value.map(String).filter((item) => item.length > 0) : [];
}

export function escapeCell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// One loader for every case set: *.json files, sorted, validated, de-duped by
// id. `label` names the set kind in error messages ("Held-out",
// "Sub-capability"); `validate(raw, filename)` returns the normalized case.
export function loadCaseSet(dir, { validate, label }) {
  if (!existsSync(dir)) throw new Error(`${label} set directory not found: ${dir}`);
  const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`${label} set has no *.json cases: ${dir}`);
  const cases = [];
  const seen = new Set();
  for (const name of files) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(resolve(dir, name), "utf8"));
    } catch (error) {
      throw new Error(`${label} case ${name} is not valid JSON: ${error.message}`);
    }
    const validated = validate(parsed, name);
    if (seen.has(validated.id)) throw new Error(`Duplicate ${label.toLowerCase()} case id: ${validated.id} (${name})`);
    seen.add(validated.id);
    cases.push(validated);
  }
  return cases;
}
