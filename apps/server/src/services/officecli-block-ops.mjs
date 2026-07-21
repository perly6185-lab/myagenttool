/*
 * OfficeCLI block-ops mapper (L1, in-app) — the pure logic behind markdown-style
 * block editing of a .docx.
 *
 * The docx is the source of truth and is NEVER regenerated. A human edits a flat,
 * path-addressed list of blocks (one per <w:p>), and this module translates the
 * change into a minimal set of SURGICAL operations — the item list of one governed
 * `batch` write. Every op is keyed on the block's native OOXML paraId path (the
 * `path` the outline already carries), so there is no fuzzy diff: which block an
 * edit belongs to is known exactly. Content the projection can't express (tables,
 * images, runs, non-heading styles) is preserved by never being touched.
 *
 * Scope (v0): heading level (via style) + paragraph text + add / delete / reorder.
 * L1.5 adds inline bold/italic: a paragraph's runs project to `**`/`*` markdown,
 * and a formatted edit rebuilds that paragraph's runs (reverse-remove + append) —
 * plain-text edits stay on the simple `set text` path. A whole-document markdown
 * textarea is a later slice; this module is the shared, unit-tested core. No I/O —
 * pure functions over the outline shape from readOfficecliDocParagraphs.
 */

import { parseInline, runsToInlineMd, normalizeRuns } from "./officecli-inline.mjs";

/**
 * @typedef {{ text: string, bold: boolean, italic: boolean }} Run
 * @typedef {{ path: string, style: string|null, text: string, runs?: Run[] }} OutlineParagraph
 * @typedef {{ path: string|null, md: string }} EditedBlock
 * @typedef {Record<string, unknown>} BatchCommand
 */

const HEADING_RE = /^heading([1-6])$/;
const MD_HEADING_RE = /^(#{1,6})[ \t]+([\s\S]*)$/;
const NORMAL_STYLE = "Normal";

/** OOXML paragraph style → markdown heading level (0 = not a heading). */
export function headingLevelForStyle(style) {
  const norm = String(style ?? "").toLowerCase().replace(/\s+/g, "");
  const m = HEADING_RE.exec(norm);
  return m ? Number(m[1]) : 0;
}

/** Markdown heading level → the OOXML style name to write (0 → Normal). */
export function styleForHeadingLevel(level) {
  return level >= 1 && level <= 6 ? `Heading${level}` : NORMAL_STYLE;
}

/** One outline paragraph → its markdown source line (heading prefix + inline). */
export function paragraphToMd(para) {
  const level = headingLevelForStyle(para?.style);
  const prefix = level > 0 ? `${"#".repeat(level)} ` : "";
  const runs = Array.isArray(para?.runs) ? para.runs : null;
  const inline = runs && runs.length ? runsToInlineMd(runs) : typeof para?.text === "string" ? para.text : "";
  return prefix + inline;
}

function runsEqual(a, b) {
  const x = normalizeRuns(a);
  const y = normalizeRuns(b);
  if (x.length !== y.length) return false;
  return x.every((r, i) => r.text === y[i].text && r.bold === y[i].bold && r.italic === y[i].italic);
}

/** Markdown source → { headingLevel, text }. A leading `#{1,6} ` is the heading. */
export function parseBlockMd(md) {
  const src = typeof md === "string" ? md : "";
  const m = MD_HEADING_RE.exec(src);
  if (m) return { headingLevel: m[1].length, text: m[2] };
  return { headingLevel: 0, text: src };
}

/** Outline paragraphs → editor blocks (each carries its stable path + md source). */
export function projectParagraphsToBlocks(paragraphs) {
  const list = Array.isArray(paragraphs) ? paragraphs : [];
  return list
    .filter((p) => p && typeof p.path === "string")
    .map((p) => ({
      path: p.path,
      style: typeof p.style === "string" ? p.style : null,
      text: typeof p.text === "string" ? p.text : "",
      md: paragraphToMd(p),
    }));
}

// Indices (into `arr`) of one longest strictly-increasing subsequence — the
// survivors we can leave in place so reordering emits the fewest moves.
function longestIncreasingSubsequenceIndices(arr) {
  const n = arr.length;
  if (n === 0) return [];
  const tails = [];
  const prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[tails[mid]] < arr[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    if (lo === tails.length) tails.push(i);
    else tails[lo] = i;
  }
  const res = [];
  let k = tails[tails.length - 1];
  while (k !== -1) {
    res.push(k);
    k = prev[k];
  }
  return res.reverse();
}

function addCommand(block, position) {
  // A new paragraph is created with its PLAIN text (markers stripped) — its paraId
  // isn't known mid-batch, so its runs can't be formatted in this same write.
  const props = { text: block.plainText };
  if (block.headingLevel > 0) props.style = styleForHeadingLevel(block.headingLevel);
  return { command: "add", parent: "/body", type: "paragraph", props, ...position };
}

// The set/rebuild ops for one surviving paragraph: a style change, and either a
// plain `set text` or a run-rebuild (reverse-remove existing runs + append the new
// run sequence) when inline formatting is involved.
function surviveContentCommands(eb) {
  const paraPath = eb.orig.path;
  const out = [];
  const styleChanged = eb.headingLevel !== headingLevelForStyle(eb.orig.style);
  const targetStyle = styleForHeadingLevel(eb.headingLevel);

  const origRuns = eb.orig.runs ?? [];
  const newFormatted = eb.newRuns.some((r) => r.bold || r.italic);
  const origFormatted = normalizeRuns(origRuns).some((r) => r.bold || r.italic);

  if (!newFormatted && !origFormatted) {
    // Plain path — combine an optional style + text change into one `set`.
    const props = {};
    if (styleChanged) props.style = targetStyle;
    if (eb.plainText !== eb.orig.text) props.text = eb.plainText;
    if (Object.keys(props).length > 0) out.push({ command: "set", path: paraPath, props });
    return out;
  }

  if (styleChanged) out.push({ command: "set", path: paraPath, props: { style: targetStyle } });
  if (!runsEqual(eb.newRuns, origRuns)) {
    // Reverse-remove the actual runs (r[1..n], including empties), then append the
    // new run sequence. The paragraph's paraId is preserved throughout.
    for (let k = origRuns.length; k >= 1; k--) out.push({ command: "remove", path: `${paraPath}/r[${k}]` });
    for (const r of eb.newRuns) {
      const props = { text: r.text };
      if (r.bold) props.bold = "true";
      if (r.italic) props.italic = "true";
      out.push({ command: "add", parent: paraPath, type: "run", props });
    }
  }
  return out;
}

/**
 * Diff the original outline against the edited block list and emit the item list
 * for ONE governed `batch` write. All ops are anchored on stable (existing) paraId
 * paths; new blocks are never used as anchors.
 *
 * @param {{ original?: OutlineParagraph[], edited?: EditedBlock[] }} input
 * @returns {{ commands: BatchCommand[] }}
 */
export function computeBlockOps({ original = [], edited = [] } = {}) {
  const origByPath = new Map();
  const origOrder = new Map();
  original.forEach((b, i) => {
    if (b && typeof b.path === "string") {
      origByPath.set(b.path, b);
      origOrder.set(b.path, i);
    }
  });

  // Normalize each edited block: parse its md (heading prefix + inline runs),
  // resolve identity. A `path` that doesn't match a real original block is treated
  // as a new (unanchored) block.
  const editedNorm = (Array.isArray(edited) ? edited : []).map((eb) => {
    const parsed = parseBlockMd(eb?.md ?? "");
    const newRuns = parseInline(parsed.text);
    const orig = eb && typeof eb.path === "string" ? origByPath.get(eb.path) : undefined;
    return {
      orig: orig ?? null,
      rawMd: typeof eb?.md === "string" ? eb.md : "",
      headingLevel: parsed.headingLevel,
      newRuns,
      plainText: newRuns.map((r) => r.text).join(""),
    };
  });

  const commands = [];

  // Phase 1 — content on surviving existing blocks (order-independent; paraId
  // stable). A style change (heading markup) is only emitted when it actually
  // changed, preserving non-heading custom styles (Quote/Title/…). Inline
  // formatting triggers a run-rebuild; plain edits stay a single `set text`.
  for (const eb of editedNorm) {
    if (!eb.orig) continue;
    // An untouched block (the client echoed the exact projection) emits nothing —
    // this is the safety guarantee: a paragraph is only ever rebuilt when its
    // markdown string actually changed, so the ambiguous adjacent-emphasis case
    // can never silently rewrite a paragraph the user did not edit.
    if (paragraphToMd(eb.orig) === eb.rawMd) continue;
    for (const cmd of surviveContentCommands(eb)) commands.push(cmd);
  }

  // Phase 2 — removes: originals no longer present in the edited list.
  const survivingPaths = new Set(editedNorm.filter((e) => e.orig).map((e) => e.orig.path));
  for (const b of original) {
    if (b && typeof b.path === "string" && !survivingPaths.has(b.path)) {
      commands.push({ command: "remove", path: b.path });
    }
  }

  // Phase 3a — reorder survivors into target order, keeping the LIS in place so
  // only genuinely-moved blocks emit a `move`, each anchored to the preceding
  // (already-finalized) survivor. A leading survivor that must move (no preceding
  // survivor yet) anchors `before` the first kept survivor — a stable spine head
  // that never moves — so the whole run lands in front of it in target order.
  const survivors = editedNorm.filter((e) => e.orig);
  const seq = survivors.map((s) => origOrder.get(s.orig.path));
  const keepArr = longestIncreasingSubsequenceIndices(seq);
  const keep = new Set(keepArr);
  const firstKeptPath = survivors.length ? survivors[keepArr[0]].orig.path : null;
  let prevPath = null;
  survivors.forEach((s, i) => {
    if (!keep.has(i)) {
      commands.push(prevPath
        ? { command: "move", path: s.orig.path, after: prevPath }
        : { command: "move", path: s.orig.path, before: firstKeptPath });
    }
    prevPath = s.orig.path;
  });

  // Phase 3b — insert new blocks. Group consecutive new blocks into runs bounded
  // by their surrounding survivors; anchor every insert on a stable paraId.
  let leftAnchor = null;
  let run = [];
  const runs = [];
  for (const eb of editedNorm) {
    if (eb.orig) {
      if (run.length) runs.push({ left: leftAnchor, right: eb.orig.path, blocks: run });
      run = [];
      leftAnchor = eb.orig.path;
    } else {
      run.push(eb);
    }
  }
  if (run.length) runs.push({ left: leftAnchor, right: null, blocks: run });

  for (const r of runs) {
    if (r.left) {
      // After a stable left anchor: emit in REVERSE so the run ends up forward
      // without ever needing a not-yet-created block's paraId as an anchor.
      for (let k = r.blocks.length - 1; k >= 0; k--) commands.push(addCommand(r.blocks[k], { after: r.left }));
    } else if (r.right) {
      // Leading run before the first survivor: `before` the right anchor, forward.
      for (const nb of r.blocks) commands.push(addCommand(nb, { before: r.right }));
    } else {
      // No survivors at all (empty document): append in order.
      for (const nb of r.blocks) commands.push(addCommand(nb, {}));
    }
  }

  return { commands };
}
