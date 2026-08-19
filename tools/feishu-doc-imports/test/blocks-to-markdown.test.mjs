import { test } from "node:test";
import assert from "node:assert/strict";

import { blocksToMarkdown, textOf, extractImageTokens } from "../src/blocks-to-markdown.mjs";

/** Build a single text block value with ordered segments. */
function textValue(...parts) {
  const text = {};
  parts.forEach((p, i) => {
    text[i] = p;
  });
  return { initialAttributedTexts: { text } };
}

function doc(blocks, sequence, rootId = "root") {
  return blocksToMarkdown({ blockMap: blocks, blockSequence: sequence, rootId });
}

test("textOf: joins segments in numeric key order regardless of insertion order", () => {
  const b = { data: { text: textValue("A", "B") } };
  // shuffle keys object
  const shuffled = { data: { text: { initialAttributedTexts: { text: { 2: "C", 0: "A", 1: "B" } } } } };
  assert.equal(textOf(b), "AB");
  assert.equal(textOf(shuffled), "ABC");
  assert.equal(textOf({ data: {} }), "");
  assert.equal(textOf(undefined), "");
});

test("blocksToMarkdown: renders headings (capped at 6), paragraphs, divider", () => {
  const blocks = {
    root: { data: { type: "page", children: ["h9", "p", "div"] } },
    h9: { data: { type: "heading9", text: textValue("Deep") } },
    p: { data: { type: "text", text: textValue("Body") } },
    div: { data: { type: "divider" } },
  };
  const { markdown } = doc(blocks, ["root", "h9", "p", "div"]);
  assert.match(markdown, /^###### Deep/m);
  assert.match(markdown, /^Body$/m);
  assert.match(markdown, /^---$/m);
});

test("blocksToMarkdown: image emits feishu-asset placeholder + images list", () => {
  const blocks = {
    root: { data: { type: "page", children: ["img"] } },
    img: { data: { type: "image", image: { token: "TOK123" } } },
  };
  const { markdown, images } = doc(blocks, ["root", "img"]);
  assert.ok(markdown.includes("![](feishu-asset://TOK123)"));
  assert.deepEqual(images, [{ token: "TOK123", blockId: "img" }]);
});

test("blocksToMarkdown: callout recurses children exactly once (no duplication)", () => {
  const blocks = {
    root: { data: { type: "page", children: ["callout"] } },
    callout: { data: { type: "callout", children: ["inner"], text: textValue("note") } },
    inner: { data: { type: "text", text: textValue("inside") } },
  };
  // `inner` appears in the flat sequence too (as Feishu ships it), which must
  // NOT cause a second render.
  const { markdown } = doc(blocks, ["root", "callout", "inner"]);
  assert.equal((markdown.match(/inside/g) || []).length, 1);
  assert.match(markdown, /> note/);
});

test("blocksToMarkdown: grid -> grid_column -> text recurse", () => {
  const blocks = {
    root: { data: { type: "page", children: ["grid"] } },
    grid: { data: { type: "grid", children: ["col"] } },
    col: { data: { type: "grid_column", children: ["t"] } },
    t: { data: { type: "text", text: textValue("cell") } },
  };
  const { markdown } = doc(blocks, ["root", "grid", "col", "t"]);
  assert.match(markdown, /cell/);
  assert.equal((markdown.match(/cell/g) || []).length, 1);
});

test("blocksToMarkdown: ordered/bullet/todo rendered", () => {
  const blocks = {
    root: { data: { type: "page", children: ["o", "b", "td"] } },
    o: { data: { type: "ordered", text: textValue("one") } },
    b: { data: { type: "bullet", text: textValue("two") } },
    td: { data: { type: "todo", todo: { style: { done: true } }, text: textValue("done") } },
  };
  const { markdown } = doc(blocks, ["root", "o", "b", "td"]);
  assert.match(markdown, /1\. one/);
  assert.match(markdown, /- two/);
  assert.match(markdown, /- \[x\] done/);
});

test("extractImageTokens: tree-order tokens across nested containers", () => {
  const blocks = {
    root: { data: { type: "page", children: ["a", "callout"] } },
    a: { data: { type: "image", image: { token: "TOK_A" } } },
    callout: { data: { type: "callout", children: ["b"] } },
    b: { data: { type: "image", image: { token: "TOK_B" } } },
  };
  const toks = extractImageTokens(blocks, ["root", "a", "callout", "b"], "root");
  assert.deepEqual(toks.map((t) => t.token), ["TOK_A", "TOK_B"]);
});

test("blocksToMarkdown: empty/missing input is safe", () => {
  assert.deepEqual(blocksToMarkdown({}), { markdown: "", images: [] });
  assert.deepEqual(blocksToMarkdown({ blockMap: {} }), { markdown: "", images: [] });
});
