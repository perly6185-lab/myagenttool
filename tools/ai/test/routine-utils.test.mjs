/*
 * Unit tests for the loop-engine's input-sanitization + id primitives
 * (tools/ai/src/loop/routine-utils.mjs). These sanitize untrusted routine ids
 * and path segments and derive stable ids used across the loop worker/registry,
 * so their guards and determinism are worth pinning.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  booleanOr,
  nonNegativeIntegerOr,
  positiveIntegerOr,
  safeId,
  safePathSegment,
  shortStableId,
  stringArrayOr,
  stringOr,
  uniqueStrings,
} from "../src/loop/routine-utils.mjs";

test("safeId: only allows id-safe characters", () => {
  assert.equal(safeId("routine_123.v-2"), true);
  assert.equal(safeId("../etc"), false);
  assert.equal(safeId("has space"), false);
  assert.equal(safeId(42), false, "non-strings are not safe ids");
});

test("safePathSegment: no path separators survive, trims, caps length, never empty", () => {
  assert.equal(safePathSegment("a/b c"), "a-b-c", "slashes and spaces become dashes");
  const seg = safePathSegment("My Routine/../x");
  assert.ok(!seg.includes("/") && !seg.includes("\\"), "no separator can survive (single segment)");
  assert.equal(safePathSegment("///"), "routine", "all-unsafe falls back");
  assert.ok(safePathSegment("a".repeat(200)).length <= 120);
});

test("shortStableId: deterministic 8-hex FNV hash, differs by input", () => {
  const a = shortStableId("alpha");
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(a, shortStableId("alpha"), "stable for the same input");
  assert.notEqual(a, shortStableId("beta"));
});

test("uniqueStrings: dedups and drops falsy", () => {
  assert.deepEqual(uniqueStrings(["a", "a", "", "b", null, "b"]), ["a", "b"]);
  assert.deepEqual(uniqueStrings(undefined), []);
});

test("*Or coercers fall back on the wrong type", () => {
  assert.equal(positiveIntegerOr(3, 1), 3);
  assert.equal(positiveIntegerOr(0, 1), 1);
  assert.equal(positiveIntegerOr(2.5, 1), 1);
  assert.equal(nonNegativeIntegerOr(0, 9), 0);
  assert.equal(nonNegativeIntegerOr(-1, 9), 9);
  assert.equal(stringOr("", "fb"), "fb");
  assert.equal(stringOr("x", "fb"), "x");
  assert.equal(booleanOr(true, false), true);
  assert.equal(booleanOr("yes", false), false);
  assert.deepEqual(stringArrayOr(["a", "b"], []), ["a", "b"]);
  assert.deepEqual(stringArrayOr(["a", 1], ["fb"]), ["fb"], "non-string members reject the whole array");
});
