/*
 * xlsx grid-ops mapper (v0). Cell edits are independent (stable A1 addresses), so
 * the tests assert the emitted `set` items per editing shape — value, formula,
 * clear, unchanged, new cell — plus the address helpers.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cellEditableText,
  computeSheetOps,
  columnToIndex,
  indexToColumn,
  parseAddr,
} from "../src/services/officecli-sheet-ops.mjs";

const cell = (text, formula = null) => ({ text, formula });

test("cellEditableText: formula shows =…, else value", () => {
  assert.equal(cellEditableText(cell("84", "B2*2")), "=B2*2");
  assert.equal(cellEditableText(cell("Widget")), "Widget");
  assert.equal(cellEditableText(null), "");
  assert.equal(cellEditableText(cell("", "")), ""); // empty formula string → value
});

test("changed value -> one set with props.value", () => {
  const { commands } = computeSheetOps({ sheet: "Sheet1", original: { A1: cell("Name") }, edited: { A1: "Item" } });
  assert.deepEqual(commands, [{ command: "set", path: "/Sheet1/A1", props: { value: "Item" } }]);
});

test("a value starting with = becomes a formula set", () => {
  const { commands } = computeSheetOps({ original: { C2: cell("0") }, edited: { C2: "=B2*2" } });
  assert.deepEqual(commands, [{ command: "set", path: "/Sheet1/C2", props: { formula: "B2*2" } }]);
});

test("editing a formula cell compares against its =form", () => {
  const original = { C2: cell("84", "B2*2") };
  // unchanged: the client echoes "=B2*2"
  assert.deepEqual(computeSheetOps({ original, edited: { C2: "=B2*2" } }).commands, []);
  // changed formula
  assert.deepEqual(computeSheetOps({ original, edited: { C2: "=B2*3" } }).commands, [
    { command: "set", path: "/Sheet1/C2", props: { formula: "B2*3" } },
  ]);
  // replaced with a plain value
  assert.deepEqual(computeSheetOps({ original, edited: { C2: "100" } }).commands, [
    { command: "set", path: "/Sheet1/C2", props: { value: "100" } },
  ]);
});

test("clearing a cell sets an empty value", () => {
  const { commands } = computeSheetOps({ original: { A2: cell("Widget") }, edited: { A2: "" } });
  assert.deepEqual(commands, [{ command: "set", path: "/Sheet1/A2", props: { value: "" } }]);
});

test("a new cell in an empty address sets its value (officecli auto-creates)", () => {
  const { commands } = computeSheetOps({ original: {}, edited: { A6: "FarCell" } });
  assert.deepEqual(commands, [{ command: "set", path: "/Sheet1/A6", props: { value: "FarCell" } }]);
});

test("unchanged cells emit nothing; a custom sheet name is honoured", () => {
  const { commands } = computeSheetOps({
    sheet: "Data",
    original: { A1: cell("x"), B1: cell("y") },
    edited: { A1: "x", B1: "z" },
  });
  assert.deepEqual(commands, [{ command: "set", path: "/Data/B1", props: { value: "z" } }]);
});

test("invalid addresses are ignored (path is a document selector)", () => {
  const { commands } = computeSheetOps({ original: {}, edited: { "../evil": "x", "A": "y", A1: "ok" } });
  assert.deepEqual(commands, [{ command: "set", path: "/Sheet1/A1", props: { value: "ok" } }]);
});

test("address helpers round-trip", () => {
  assert.equal(columnToIndex("A"), 1);
  assert.equal(columnToIndex("Z"), 26);
  assert.equal(columnToIndex("AA"), 27);
  assert.equal(indexToColumn(1), "A");
  assert.equal(indexToColumn(26), "Z");
  assert.equal(indexToColumn(27), "AA");
  assert.deepEqual(parseAddr("AB12"), { col: columnToIndex("AB"), row: 12 });
  assert.equal(parseAddr("bad"), null);
});
