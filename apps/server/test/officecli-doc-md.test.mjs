/*
 * Whole-document markdown alignment (L1b). The alignment feeds computeBlockOps, so
 * the test asserts the assigned paraIds (or null) for each editing shape — edit,
 * insert, delete, reorder, split, merge — and confirms the end-to-end result via
 * computeBlockOps for the common cases.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDocumentMd, similarity, alignBlocks } from "../src/services/officecli-doc-md.mjs";
import { computeBlockOps } from "../src/services/officecli-block-ops.mjs";

const orig = (path, md) => ({ path, md });
const paths = (aligned) => aligned.map((a) => a.path);

test("parseDocumentMd splits on blank lines, trims, drops empties", () => {
  assert.deepEqual(parseDocumentMd("# Title\n\nbody one\n\n\nbody two\n"), ["# Title", "body one", "body two"]);
  assert.deepEqual(parseDocumentMd("   \n\n  "), []);
  assert.deepEqual(parseDocumentMd("soft\nwrap kept"), ["soft\nwrap kept"]);
});

test("similarity: identical=1, disjoint=0, near-edit high", () => {
  assert.equal(similarity("hello", "hello"), 1);
  assert.equal(similarity("abc", "xyz"), 0);
  assert.ok(similarity("the quick brown fox", "the quick brwn fox") > 0.8);
});

test("all-exact aligns every block to its paraId in order", () => {
  const o = [orig("p1", "# Title"), orig("p2", "alpha"), orig("p3", "beta")];
  const aligned = alignBlocks(o, ["# Title", "alpha", "beta"]);
  assert.deepEqual(paths(aligned), ["p1", "p2", "p3"]);
});

test("a light edit keeps the paraId (similarity match)", () => {
  const o = [orig("p1", "alpha"), orig("p2", "the quick brown fox"), orig("p3", "beta")];
  const aligned = alignBlocks(o, ["alpha", "the quick brwn fox", "beta"]);
  assert.deepEqual(paths(aligned), ["p1", "p2", "p3"]);
});

test("insertion -> null path; original order preserved", () => {
  const o = [orig("p1", "alpha"), orig("p2", "beta")];
  const aligned = alignBlocks(o, ["alpha", "NEW middle", "beta"]);
  assert.deepEqual(paths(aligned), ["p1", null, "p2"]);
});

test("deletion -> the original simply doesn't appear in the aligned output", () => {
  const o = [orig("p1", "alpha"), orig("p2", "beta"), orig("p3", "gamma")];
  const aligned = alignBlocks(o, ["alpha", "gamma"]);
  assert.deepEqual(paths(aligned), ["p1", "p3"]);
  // computeBlockOps then removes p2.
  const original = [
    { path: "p1", text: "alpha", style: null },
    { path: "p2", text: "beta", style: null },
    { path: "p3", text: "gamma", style: null },
  ];
  const { commands } = computeBlockOps({ original, edited: aligned });
  assert.ok(commands.some((c) => c.command === "remove" && c.path === "p2"));
});

test("reorder: exact matches keep paraIds, computeBlockOps moves", () => {
  const o = [orig("p1", "a"), orig("p2", "b"), orig("p3", "c")];
  const aligned = alignBlocks(o, ["c", "a", "b"]);
  assert.deepEqual(paths(aligned), ["p3", "p1", "p2"]);
});

test("split: one paragraph becomes two — one keeps the paraId, one inserts", () => {
  const o = [orig("p1", "alpha beta gamma")];
  const aligned = alignBlocks(o, ["alpha beta", "gamma delta epsilon"]);
  // exactly one block keeps p1; the other is an insertion (null)
  const assigned = paths(aligned);
  assert.equal(assigned.filter((p) => p === "p1").length, 1);
  assert.equal(assigned.filter((p) => p === null).length, 1);
});

test("merge: two paragraphs become one — one paraId kept, the other deleted", () => {
  const o = [orig("p1", "alpha beta"), orig("p2", "gamma delta")];
  const aligned = alignBlocks(o, ["alpha beta gamma delta"]);
  assert.equal(aligned.length, 1);
  assert.ok(aligned[0].path === "p1" || aligned[0].path === "p2");
});

test("a same-position replacement is an in-place edit (keeps the paraId, classic-diff semantics)", () => {
  // One block in, one out, at the same position → treat as an edit so the paraId
  // (and, via computeBlockOps, the formatting) is preserved. This is what fixes the
  // short-edit case below; a delete+insert would drop formatting and the paraId.
  const o = [orig("p1", "the quick brown fox")];
  assert.deepEqual(paths(alignBlocks(o, ["completely different content here"])), ["p1"]);
});

test("short in-place edits below the similarity threshold keep their paraId (F4)", () => {
  // `**TODO**`→`**DONE**` (Dice ~0.43) and `Yes`→`No` (Dice 0) are edits, not
  // delete+insert — positional pairing keeps the paraId so formatting survives.
  assert.deepEqual(paths(alignBlocks([orig("p1", "**TODO**")], ["**DONE**"])), ["p1"]);
  assert.deepEqual(paths(alignBlocks([orig("p1", "Yes")], ["No"])), ["p1"]);
  assert.deepEqual(
    paths(alignBlocks([orig("p1", "Draft"), orig("p2", "body stays")], ["Final", "body stays"])),
    ["p1", "p2"],
  );
});

test("the positional pass never pairs onto a COMPLEX original (no silent edit-drop + wrong delete)", () => {
  // A complex paragraph (inline picture) can't be rewritten by computeBlockOps, so
  // pairing an unrelated new block onto it would drop the edit AND delete the kept
  // paragraph. It must fall through to the correct outcome instead.
  const o = [{ path: "p1", md: "X", complex: true }, { path: "p2", md: "Y" }];
  // typed a single new paragraph -> pairs onto the plain p2, complex p1 deletes.
  assert.deepEqual(paths(alignBlocks(o, ["Z"])), ["p2"]);
  // an exact (unchanged) projection of a complex paragraph still matches it (no-op),
  // so keeping its text verbatim preserves it.
  assert.deepEqual(paths(alignBlocks(o, ["X", "Ynew"])), ["p1", "p2"]);
});

test("a genuine insert and delete in DIFFERENT places don't cross-pair into an edit", () => {
  // delete p2, insert a new block later — anchors (p1, p3) keep the gaps apart, so
  // p2 is a delete and the new block is an insert (not a spurious p2→new edit).
  const o = [orig("p1", "alpha"), orig("p2", "beta"), orig("p3", "gamma")];
  assert.deepEqual(paths(alignBlocks(o, ["alpha", "gamma", "NEW tail"])), ["p1", "p3", null]);
});

test("duplicate paragraphs pair by rank, not all onto the first", () => {
  const o = [orig("p1", "same"), orig("p2", "same"), orig("p3", "tail")];
  const aligned = alignBlocks(o, ["same", "same", "tail"]);
  assert.deepEqual(paths(aligned), ["p1", "p2", "p3"]);
});
