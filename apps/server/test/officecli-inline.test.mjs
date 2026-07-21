/*
 * Inline markdown <-> runs (L1.5). The parser must never throw (unmatched markers
 * degrade to literals), and the round-trip must be stable in normalized form.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseInline, runsToInlineMd, normalizeRuns } from "../src/services/officecli-inline.mjs";

const R = (text, bold = false, italic = false) => ({ text, bold, italic });

test("plain text -> one plain run", () => {
  assert.deepEqual(parseInline("hello world"), [R("hello world")]);
});

test("bold / italic / both", () => {
  assert.deepEqual(parseInline("**b**"), [R("b", true, false)]);
  assert.deepEqual(parseInline("*i*"), [R("i", false, true)]);
  assert.deepEqual(parseInline("***x***"), [R("x", true, true)]);
});

test("mixed spans merge adjacent plains", () => {
  assert.deepEqual(parseInline("a **b** c *d* e"), [
    R("a "), R("b", true), R(" c "), R("d", false, true), R(" e"),
  ]);
});

test("unmatched markers are literal, never throw", () => {
  assert.deepEqual(parseInline("2 * 3 = 6"), [R("2 * 3 = 6")]);
  assert.deepEqual(parseInline("**oops"), [R("**oops")]);
  assert.deepEqual(parseInline("a ** b"), [R("a ** b")]);
});

test("escaped stars are literal", () => {
  assert.deepEqual(parseInline("a \\* b"), [R("a * b")]);
  assert.deepEqual(parseInline("\\*\\*notbold\\*\\*"), [R("**notbold**")]);
});

test("runsToInlineMd emits markers + escapes literals", () => {
  assert.equal(runsToInlineMd([R("a "), R("b", true), R(" and "), R("c", false, true)]), "a **b** and *c*");
  assert.equal(runsToInlineMd([R("***", false, false)]), "\\*\\*\\*");
  assert.equal(runsToInlineMd([R("x", true, true)]), "***x***");
});

// KNOWN v1 limitation: two emphasis spans directly adjacent (no plain text
// between) serialize to ambiguous markdown (**b***i* reads as ***). This only
// bites a paragraph the user actively re-edits; an untouched paragraph is never
// rebuilt (change detection compares the md string), so the doc is never
// corrupted. Prose (emphasis on whole words, separated by spaces) is unaffected.
test("adjacent emphasis with no gap is the documented ambiguous case", () => {
  const md = runsToInlineMd([R("b", true), R("i", false, true)]);
  assert.equal(md, "**b***i*"); // ambiguous by construction — not round-trip stable
});

test("normalizeRuns merges same-format neighbours and drops empties", () => {
  assert.deepEqual(normalizeRuns([R("a"), R(""), R("b"), R("c", true)]), [R("ab"), R("c", true)]);
});

test("round-trip is stable in normalized form", () => {
  const cases = [
    [R("plain")],
    [R("a "), R("bold", true), R(" and "), R("it", false, true)],
    [R("both", true, true), R(" then plain")],
    [R("star * inside")],
    [R("lead", true), R("trail", true)], // merges to one
  ];
  for (const runs of cases) {
    const md = runsToInlineMd(runs);
    assert.deepEqual(parseInline(md), normalizeRuns(runs), `round-trip failed for ${md}`);
  }
});

test("literal star survives a full round-trip", () => {
  const runs = [R("use 2 * 3 here"), R("bold", true)];
  assert.deepEqual(parseInline(runsToInlineMd(runs)), normalizeRuns(runs));
});
