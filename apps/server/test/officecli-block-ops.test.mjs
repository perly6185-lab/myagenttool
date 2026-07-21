/*
 * OfficeCLI block-ops mapper (L1). The projection is lossy by design, so the guard
 * is twofold: (1) unit-check each mapping rule, and (2) a batch SIMULATOR that
 * applies the emitted ops to the original and asserts the result equals the edited
 * target — the real proof the ordering algorithm (moves + reverse-inserts) is
 * correct across arbitrary edit combinations, not just the cases hand-written here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  headingLevelForStyle,
  styleForHeadingLevel,
  paragraphToMd,
  parseBlockMd,
  projectParagraphsToBlocks,
  computeBlockOps,
} from "../src/services/officecli-block-ops.mjs";

// --- helpers ---------------------------------------------------------------

let seq = 0;
function para(path, text, style = null) {
  return { path, text, style };
}
// Build an edited block from an original (identity kept) or a fresh new block.
function keep(orig, md) {
  return { path: orig.path, md: md ?? paragraphToMd(orig) };
}
function fresh(md) {
  return { path: null, md };
}

// A minimal, faithful model of `officecli batch` item semantics over a flat list
// of {path, text, style}. New paragraphs get a synthetic path (officecli mints a
// real paraId). Enough to verify order + content, which is all the ops control.
function applyBatch(original, commands) {
  const list = original.map((p) => ({ ...p }));
  const idx = (path) => list.findIndex((e) => e.path === path);
  for (const c of commands) {
    if (c.command === "set") {
      const i = idx(c.path);
      assert.ok(i >= 0, `set target missing: ${c.path}`);
      if (c.props && "text" in c.props) list[i].text = c.props.text;
      if (c.props && "style" in c.props) list[i].style = c.props.style;
    } else if (c.command === "remove") {
      const i = idx(c.path);
      assert.ok(i >= 0, `remove target missing: ${c.path}`);
      list.splice(i, 1);
    } else if (c.command === "move") {
      const i = idx(c.path);
      assert.ok(i >= 0, `move target missing: ${c.path}`);
      const [item] = list.splice(i, 1);
      insertRelative(list, item, c);
    } else if (c.command === "add") {
      assert.equal(c.parent, "/body");
      const item = { path: `new_${seq++}`, text: c.props?.text ?? "", style: c.props?.style ?? null };
      insertRelative(list, item, c);
    } else {
      throw new Error(`unexpected command ${c.command}`);
    }
  }
  return list;
}
function insertRelative(list, item, c) {
  if (c.after !== undefined) {
    const j = list.findIndex((e) => e.path === c.after);
    assert.ok(j >= 0, `after anchor missing: ${c.after}`);
    list.splice(j + 1, 0, item);
  } else if (c.before !== undefined) {
    const j = list.findIndex((e) => e.path === c.before);
    assert.ok(j >= 0, `before anchor missing: ${c.before}`);
    list.splice(j, 0, item);
  } else {
    list.push(item);
  }
}

// Compare a resulting list to the intended edited target by (headingLevel, text) —
// new blocks have synthetic paths so identity can't be compared, but the visible
// content and order can.
function assertMatchesTarget(result, edited) {
  const got = result.map((e) => ({ level: headingLevelForStyle(e.style), text: e.text }));
  const want = edited.map((e) => {
    const p = parseBlockMd(e.md);
    return { level: p.headingLevel, text: p.text };
  });
  assert.deepEqual(got, want);
}

// Round-trip: run the mapper, simulate the batch, assert it reconstructs the target.
function roundTrip(original, edited) {
  const { commands } = computeBlockOps({ original, edited });
  const result = applyBatch(original, commands);
  assertMatchesTarget(result, edited);
  return commands;
}

// --- projection / parsing --------------------------------------------------

test("heading style <-> level mapping (case/space tolerant)", () => {
  assert.equal(headingLevelForStyle("Heading1"), 1);
  assert.equal(headingLevelForStyle("heading 3"), 3);
  assert.equal(headingLevelForStyle("Normal"), 0);
  assert.equal(headingLevelForStyle(null), 0);
  assert.equal(headingLevelForStyle("Quote"), 0);
  assert.equal(styleForHeadingLevel(2), "Heading2");
  assert.equal(styleForHeadingLevel(0), "Normal");
  assert.equal(styleForHeadingLevel(9), "Normal");
});

test("paragraphToMd prefixes headings only", () => {
  assert.equal(paragraphToMd(para("p1", "Title", "Heading1")), "# Title");
  assert.equal(paragraphToMd(para("p2", "body", "Normal")), "body");
  assert.equal(paragraphToMd(para("p3", "body", null)), "body");
});

test("parseBlockMd splits a leading heading marker, requires a space", () => {
  assert.deepEqual(parseBlockMd("# Hi"), { headingLevel: 1, text: "Hi" });
  assert.deepEqual(parseBlockMd("###   x"), { headingLevel: 3, text: "x" });
  assert.deepEqual(parseBlockMd("plain"), { headingLevel: 0, text: "plain" });
  assert.deepEqual(parseBlockMd("#nospace"), { headingLevel: 0, text: "#nospace" });
  assert.deepEqual(parseBlockMd("####### too many"), { headingLevel: 0, text: "####### too many" });
});

test("projectParagraphsToBlocks carries path + md", () => {
  const blocks = projectParagraphsToBlocks([para("p1", "T", "Heading1"), para("p2", "b", null)]);
  assert.deepEqual(blocks, [
    { path: "p1", style: "Heading1", text: "T", md: "# T" },
    { path: "p2", style: null, text: "b", md: "b" },
  ]);
});

// --- change classification -------------------------------------------------

test("no change emits no commands", () => {
  const orig = [para("p1", "a", "Heading1"), para("p2", "b", null)];
  const { commands } = computeBlockOps({ original: orig, edited: [keep(orig[0]), keep(orig[1])] });
  assert.deepEqual(commands, []);
});

test("edit text only -> one set with props.text", () => {
  const orig = [para("p1", "a", null)];
  const commands = roundTrip(orig, [keep(orig[0], "a changed")]);
  assert.deepEqual(commands, [{ command: "set", path: "p1", props: { text: "a changed" } }]);
});

test("change heading level -> set props.style", () => {
  const orig = [para("p1", "a", "Heading1")];
  const commands = roundTrip(orig, [keep(orig[0], "## a")]);
  assert.deepEqual(commands, [{ command: "set", path: "p1", props: { style: "Heading2" } }]);
});

test("promote plain to heading and demote heading to plain", () => {
  const orig = [para("p1", "a", null), para("p2", "b", "Heading2")];
  roundTrip(orig, [keep(orig[0], "# a"), keep(orig[1], "b")]);
});

test("edit text + heading together -> one set with both props", () => {
  const orig = [para("p1", "a", "Heading1")];
  const commands = roundTrip(orig, [keep(orig[0], "### A!")]);
  assert.deepEqual(commands, [{ command: "set", path: "p1", props: { text: "A!", style: "Heading3" } }]);
});

test("non-heading custom style is preserved when heading markup unchanged", () => {
  // A Quote block projects with no prefix; editing only its text must NOT flatten
  // the style to Normal.
  const orig = [para("p1", "quoted", "Quote")];
  const { commands } = computeBlockOps({ original: orig, edited: [keep(orig[0], "quoted!")] });
  assert.deepEqual(commands, [{ command: "set", path: "p1", props: { text: "quoted!" } }]);
});

test("delete a block -> remove", () => {
  const orig = [para("p1", "a", null), para("p2", "b", null), para("p3", "c", null)];
  const commands = roundTrip(orig, [keep(orig[0]), keep(orig[2])]);
  assert.deepEqual(commands, [{ command: "remove", path: "p2" }]);
});

// --- inserts ---------------------------------------------------------------

test("insert a new block after an existing one", () => {
  const orig = [para("p1", "a", null)];
  const commands = roundTrip(orig, [keep(orig[0]), fresh("# New")]);
  assert.deepEqual(commands, [
    { command: "add", parent: "/body", type: "paragraph", props: { text: "New", style: "Heading1" }, after: "p1" },
  ]);
});

test("two consecutive new blocks after an anchor emit in reverse (forward result)", () => {
  const orig = [para("p1", "a", null)];
  const commands = roundTrip(orig, [keep(orig[0]), fresh("B"), fresh("C")]);
  // reverse: C after p1 first, then B after p1 -> p1, B, C
  assert.deepEqual(commands, [
    { command: "add", parent: "/body", type: "paragraph", props: { text: "C" }, after: "p1" },
    { command: "add", parent: "/body", type: "paragraph", props: { text: "B" }, after: "p1" },
  ]);
});

test("leading new blocks before the first survivor use `before`, forward", () => {
  const orig = [para("p1", "a", null)];
  const commands = roundTrip(orig, [fresh("X"), fresh("Y"), keep(orig[0])]);
  assert.deepEqual(commands, [
    { command: "add", parent: "/body", type: "paragraph", props: { text: "X" }, before: "p1" },
    { command: "add", parent: "/body", type: "paragraph", props: { text: "Y" }, before: "p1" },
  ]);
});

test("all-new document appends in order", () => {
  const commands = roundTrip([], [fresh("# One"), fresh("Two")]);
  assert.deepEqual(commands, [
    { command: "add", parent: "/body", type: "paragraph", props: { text: "One", style: "Heading1" } },
    { command: "add", parent: "/body", type: "paragraph", props: { text: "Two" } },
  ]);
});

// --- reorder ---------------------------------------------------------------

test("swap two blocks -> a single move", () => {
  const orig = [para("p1", "a", null), para("p2", "b", null)];
  const commands = roundTrip(orig, [keep(orig[1]), keep(orig[0])]);
  assert.equal(commands.filter((c) => c.command === "move").length, 1);
});

test("move the first block to the end", () => {
  const orig = [para("p1", "a", null), para("p2", "b", null), para("p3", "c", null)];
  roundTrip(orig, [keep(orig[1]), keep(orig[2]), keep(orig[0])]);
});

test("reverse the whole document", () => {
  const orig = [para("p1", "a", null), para("p2", "b", null), para("p3", "c", null), para("p4", "d", null)];
  roundTrip(orig, [keep(orig[3]), keep(orig[2]), keep(orig[1]), keep(orig[0])]);
});

// --- combined + property (exhaustive small cases) --------------------------

test("edit + delete + insert + reorder in one batch reconstructs the target", () => {
  const orig = [para("p1", "a", "Heading1"), para("p2", "b", null), para("p3", "c", null)];
  roundTrip(orig, [
    fresh("intro"),          // new leading
    keep(orig[2], "## c!"),  // moved up + heading changed
    keep(orig[0], "a edited"), // demoted heading + text
    fresh("outro"),          // new trailing
    // p2 deleted
  ]);
});

test("property: every permutation with edits/inserts/deletes reconstructs", () => {
  // Exhaustively try reorderings and deletions of a 4-block doc plus an inserted
  // block at each gap — the simulator asserts correctness for each.
  const orig = [para("p1", "a", null), para("p2", "b", "Heading1"), para("p3", "c", null), para("p4", "d", null)];
  const perms = permutations([0, 1, 2, 3]);
  let checked = 0;
  for (const perm of perms) {
    for (let dropMask = 0; dropMask < 16; dropMask++) {
      const editedKept = perm
        .filter((i) => !(dropMask & (1 << i)))
        .map((i) => keep(orig[i], `${orig[i].text}*`)); // also edit every kept block's text
      if (editedKept.length === 0) continue; // skip empty-doc case here
      // insert a new block at the front and one at the back
      const edited = [fresh("HEAD"), ...editedKept, fresh("TAIL")];
      roundTrip(orig, edited);
      checked++;
    }
  }
  assert.ok(checked > 300, `expected many permutation checks, ran ${checked}`);
});

// --- L1.5 inline formatting (run rebuild) --------------------------------

const RUN = (text, bold = false, italic = false) => ({ text, bold, italic });
function paraR(path, runs, style = null) {
  return { path, text: runs.map((r) => r.text).join(""), style, runs };
}

test("bold a plain paragraph -> run rebuild", () => {
  const orig = [paraR("p1", [RUN("hello")])];
  const { commands } = computeBlockOps({ original: orig, edited: [{ path: "p1", md: "**hello**" }] });
  assert.deepEqual(commands, [
    { command: "remove", path: "p1/r[1]" },
    { command: "add", parent: "p1", type: "run", props: { text: "hello", bold: "true" } },
  ]);
});

test("unchanged formatted paragraph emits nothing (md-string guard)", () => {
  const orig = [paraR("p1", [RUN("Hi "), RUN("bold", true)])];
  const { commands } = computeBlockOps({ original: orig, edited: [{ path: "p1", md: "Hi **bold**" }] });
  assert.deepEqual(commands, []);
});

test("edit text inside a formatted paragraph rebuilds the run sequence", () => {
  const orig = [paraR("p1", [RUN("Hi "), RUN("bold", true)])];
  const { commands } = computeBlockOps({ original: orig, edited: [{ path: "p1", md: "Hey **bold**!" }] });
  assert.deepEqual(commands, [
    { command: "remove", path: "p1/r[2]" },
    { command: "remove", path: "p1/r[1]" },
    { command: "add", parent: "p1", type: "run", props: { text: "Hey " } },
    { command: "add", parent: "p1", type: "run", props: { text: "bold", bold: "true" } },
    { command: "add", parent: "p1", type: "run", props: { text: "!" } },
  ]);
});

test("removing all formatting still rebuilds (was formatted)", () => {
  const orig = [paraR("p1", [RUN("word", true)])];
  const { commands } = computeBlockOps({ original: orig, edited: [{ path: "p1", md: "word" }] });
  assert.deepEqual(commands, [
    { command: "remove", path: "p1/r[1]" },
    { command: "add", parent: "p1", type: "run", props: { text: "word" } },
  ]);
});

test("heading change on a formatted paragraph with unchanged runs -> style only", () => {
  const orig = [paraR("p1", [RUN("Title", true)], "Normal")];
  const { commands } = computeBlockOps({ original: orig, edited: [{ path: "p1", md: "## **Title**" }] });
  assert.deepEqual(commands, [{ command: "set", path: "p1", props: { style: "Heading2" } }]);
});

test("italic + bold combined run", () => {
  const orig = [paraR("p1", [RUN("plain")])];
  const { commands } = computeBlockOps({ original: orig, edited: [{ path: "p1", md: "***x***" }] });
  assert.deepEqual(commands, [
    { command: "remove", path: "p1/r[1]" },
    { command: "add", parent: "p1", type: "run", props: { text: "x", bold: "true", italic: "true" } },
  ]);
});

test("new block with formatting is created plain (markers stripped)", () => {
  const { commands } = computeBlockOps({ original: [], edited: [{ path: null, md: "**bold** new" }] });
  assert.deepEqual(commands, [
    { command: "add", parent: "/body", type: "paragraph", props: { text: "bold new" } },
  ]);
});

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}
