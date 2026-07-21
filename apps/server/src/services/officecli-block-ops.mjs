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
 * Inline formatting (bold/italic → runs) and a free-form whole-document markdown
 * textarea are later slices; this module is the shared, unit-tested core they build
 * on. No I/O — pure functions over the outline shape from readOfficecliDocParagraphs.
 */

/**
 * @typedef {{ path: string, style: string|null, text: string }} OutlineParagraph
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

/** One outline paragraph → its markdown source line. */
export function paragraphToMd(para) {
  const level = headingLevelForStyle(para?.style);
  const text = typeof para?.text === "string" ? para.text : "";
  return level > 0 ? `${"#".repeat(level)} ${text}` : text;
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
  const props = { text: block.text };
  if (block.headingLevel > 0) props.style = styleForHeadingLevel(block.headingLevel);
  return { command: "add", parent: "/body", type: "paragraph", props, ...position };
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

  // Normalize each edited block: parse its md, resolve identity. A `path` that
  // doesn't match a real original block is treated as a new (unanchored) block.
  const editedNorm = (Array.isArray(edited) ? edited : []).map((eb) => {
    const parsed = parseBlockMd(eb?.md ?? "");
    const orig = eb && typeof eb.path === "string" ? origByPath.get(eb.path) : undefined;
    return { orig: orig ?? null, headingLevel: parsed.headingLevel, text: parsed.text };
  });

  const commands = [];

  // Phase 1 — sets on surviving existing blocks (order-independent; paraId stable).
  for (const eb of editedNorm) {
    if (!eb.orig) continue;
    const props = {};
    if (eb.text !== eb.orig.text) props.text = eb.text;
    // Only touch style when the heading markup actually changed — this preserves
    // non-heading custom styles (Quote/Title/…) the md view can't represent.
    if (eb.headingLevel !== headingLevelForStyle(eb.orig.style)) {
      props.style = styleForHeadingLevel(eb.headingLevel);
    }
    if (Object.keys(props).length > 0) commands.push({ command: "set", path: eb.orig.path, props });
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
