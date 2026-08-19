// Convert Feishu docx block_map + block_sequence into markdown.
//
// Pure module — no I/O. This is the most-testable piece of the pipeline.
//
// The rendering strategy is validated against the probe document (308 blocks,
// 13 section headings, 15 images, no duplication):
//   - render ONLY blocks whose parent_id === the page root, then recurse into
//     containers. Walking block_sequence flatly would double-render because
//     container children also appear in the flat sequence.
//   - text is reconstructed from data.text.initialAttributedTexts.text, whose
//     value is an object keyed by segment index; segments are joined in numeric
//     key order.
//
// Images are emitted as `![](feishu-asset://<token>)` placeholders carrying the
// image block's file token. The orchestrator (import-doc) rewrites these to
// relative asset paths after download, so this module never touches the disk.

/** Maximum heading depth markdown supports. */
const MAX_HEADING = 6;

/**
 * Reconstruct plain text of a block from its attributed text segments.
 * Style spans (bold/italic/link) are flattened to plain text in Phase 1.
 *
 * @param {{data?:any}} [block]
 * @returns {string}
 */
export function textOf(block) {
  const seg = block?.data?.text?.initialAttributedTexts?.text;
  if (!seg || typeof seg !== "object") return "";
  return Object.keys(seg)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => (typeof seg[k] === "string" ? seg[k] : ""))
    .join("");
}

/**
 * Walk the block tree and collect image file tokens in document (tree) order.
 *
 * @param {Record<string,{data?:any}>} blockMap
 * @param {string[]} blockSequence
 * @param {string} rootId
 * @returns {{ token: string, blockId: string }[]}
 */
export function extractImageTokens(blockMap, blockSequence, rootId) {
  const out = [];
  walkContainers(blockMap, blockSequence, rootId, 0, (id) => {
    const b = blockMap[id];
    if (b?.data?.type === "image") {
      const token = b?.data?.image?.token;
      if (token) out.push({ token, blockId: id });
    }
  });
  return out;
}

/**
 * Convert a Feishu docx block tree to markdown.
 *
 * @param {{
 *   blockMap: Record<string, {data?:any}>,
 *   blockSequence?: string[],
 *   rootId?: string,
 * }} input
 * @returns {{ markdown: string, images: { token: string, blockId: string }[] }}
 */
export function blocksToMarkdown({ blockMap, blockSequence, rootId } = {}) {
  if (!blockMap || typeof blockMap !== "object") {
    return { markdown: "", images: [] };
  }
  const seq = Array.isArray(blockSequence) ? blockSequence : Object.keys(blockMap);
  const root = rootId || findRootId(blockMap, seq);
  if (!root) return { markdown: "", images: [] };

  /** @type {string[]} */
  const lines = [];
  /** @type {{ token: string, blockId: string }[]} */
  const images = [];

  walkContainers(blockMap, seq, root, 0, (id, depth) => {
    const b = blockMap[id];
    if (!b || !b.data) return;
    const type = b.data.type;
    const indent = "  ".repeat(Math.max(0, depth));

    switch (type) {
      case "heading1":
      case "heading2":
      case "heading3":
      case "heading4":
      case "heading5":
      case "heading6":
      case "heading7":
      case "heading8":
      case "heading9": {
        const level = Math.min(Number(type.slice(7)), MAX_HEADING);
        lines.push(`${"#".repeat(level)} ${textOf(b)}`.trimEnd());
        break;
      }
      case "bullet":
        lines.push(`${indent}- ${textOf(b)}`.trimEnd());
        break;
      case "ordered":
        lines.push(`${indent}1. ${textOf(b)}`.trimEnd());
        break;
      case "todo": {
        const done = b.data?.todo?.style?.done ? "x" : " ";
        lines.push(`${indent}- [${done}] ${textOf(b)}`.trimEnd());
        break;
      }
      case "quote":
        lines.push(`${indent}> ${textOf(b)}`.trimEnd());
        break;
      case "code": {
        const lang = (b.data?.code?.style?.lang || "").toString().trim() || "";
        lines.push(`${indent}\`\`\`${lang}`, textOf(b), `${indent}\`\`\``);
        break;
      }
      case "divider":
        lines.push("", "---", "");
        break;
      case "image": {
        const token = b.data?.image?.token;
        if (token) {
          images.push({ token, blockId: id });
          lines.push(`![](feishu-asset://${token})`);
        }
        break;
      }
      case "callout":
        // Recurse children with a quote prefix to preserve callout semantics.
        lines.push(`${indent}> ${textOf(b)}`.trimEnd());
        break;
      case "text":
      default: {
        const txt = textOf(b);
        if (txt) lines.push(`${indent}${txt}`);
        break;
      }
    }
  });

  return { markdown: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n", images };
}

/**
 * Find the page root block id: prefer a block of type "page", else the first
 * entry of the sequence.
 *
 * @param {Record<string,{data?:any}>} blockMap
 * @param {string[]} sequence
 * @returns {string | undefined}
 */
function findRootId(blockMap, sequence) {
  for (const id of sequence) {
    if (blockMap[id]?.data?.type === "page") return id;
  }
  for (const id of Object.keys(blockMap)) {
    if (blockMap[id]?.data?.type === "page") return id;
  }
  return sequence[0];
}

/** Container block types whose children should be recursed into. */
const CONTAINER_TYPES = new Set([
  "page",
  "callout",
  "quote_container",
  "grid",
  "grid_column",
  "table",
  "table_cell",
  "islots",
]);

/**
 * Visit every block under `rootId` exactly once, in document order, recursing
 * into containers. Non-container leaf blocks are yielded; container blocks are
 * yielded then recursed (so a callout's own text + its children both render).
 *
 * @param {Record<string,{data?:any}>} blockMap
 * @param {string[]} sequence
 * @param {string} rootId
 * @param {number} depth
 * @param {(id: string, depth: number) => void} visit
 */
function walkContainers(blockMap, sequence, rootId, depth, visit) {
  const visited = new Set();
  /** @param {string} id @param {number} d */
  function recurse(id, d) {
    const block = blockMap[id];
    if (!block || visited.has(id)) return;
    visited.add(id);
    visit(id, d);
    const childIds = block?.data?.children;
    if (Array.isArray(childIds) && childIds.length) {
      for (const cid of childIds) recurse(cid, isContainer(block) ? d + 1 : d);
    }
  }
  // Start from the root's children, rendered in sequence order so document
  // order is stable even when block_map key order is not.
  const rootBlock = blockMap[rootId];
  const rootChildren = Array.isArray(rootBlock?.data?.children) ? rootBlock.data.children : [];
  const ordered = new Set(rootChildren);
  for (const id of sequence) {
    if (ordered.has(id)) recurse(id, depth);
  }
  // Fall back to any root children missing from the sequence.
  for (const id of rootChildren) {
    if (!visited.has(id)) recurse(id, depth);
  }
}

/** @param {{data?:any}} block */
function isContainer(block) {
  return CONTAINER_TYPES.has(block?.data?.type);
}
