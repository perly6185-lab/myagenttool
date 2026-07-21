/*
 * pptx deck-ops mapper (v0). Shape text edits are independent (stable @id paths),
 * so the tests assert the emitted `set` items per shape, plus the safety gates
 * (only known shapes, valid selector paths).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeDeckOps, shapeIsEditable } from "../src/services/officecli-deck-ops.mjs";

const S1 = "/slide[1]/shape[@id=100000]";
const S2 = "/slide[1]/shape[@id=100001]";
const S3 = "/slide[2]/shape[@id=100002]";

test("shapeIsEditable: textbox only", () => {
  assert.equal(shapeIsEditable({ type: "textbox" }), true);
  assert.equal(shapeIsEditable({ type: "shape" }), false);
  assert.equal(shapeIsEditable({ type: "picture" }), false);
  assert.equal(shapeIsEditable(null), false);
});

test("changed shape text -> one set with props.text", () => {
  const { commands } = computeDeckOps({ original: { [S1]: "Title" }, edited: { [S1]: "New Title" } });
  assert.deepEqual(commands, [{ command: "set", path: S1, props: { text: "New Title" } }]);
});

test("unchanged shapes emit nothing", () => {
  const { commands } = computeDeckOps({ original: { [S1]: "a", [S2]: "b" }, edited: { [S1]: "a", [S2]: "b" } });
  assert.deepEqual(commands, []);
});

test("clearing a shape sets empty text", () => {
  const { commands } = computeDeckOps({ original: { [S1]: "Title" }, edited: { [S1]: "" } });
  assert.deepEqual(commands, [{ command: "set", path: S1, props: { text: "" } }]);
});

test("multiple slides, only changed shapes emit", () => {
  const { commands } = computeDeckOps({
    original: { [S1]: "a", [S2]: "b", [S3]: "c" },
    edited: { [S1]: "a", [S2]: "B!", [S3]: "c" },
  });
  assert.deepEqual(commands, [{ command: "set", path: S2, props: { text: "B!" } }]);
});

test("an unknown shape path (not in original) is ignored", () => {
  const { commands } = computeDeckOps({ original: { [S1]: "a" }, edited: { "/slide[9]/shape[@id=999]": "x" } });
  assert.deepEqual(commands, []);
});

test("a malformed selector path is ignored even if present in original", () => {
  const bad = "/slide[1]/shape[@id=1]; rm -rf";
  const { commands } = computeDeckOps({ original: { [bad]: "a" }, edited: { [bad]: "b" } });
  assert.deepEqual(commands, []);
});
