/*
 * OfficeCLI whole-document markdown alignment (L1b). The block editor keeps each
 * paragraph's paraId in memory, so editing is exact. A free-form markdown textarea
 * loses that mapping — the text is just lines — so before it can drive the tested
 * `computeBlockOps`, the edited blocks must be RE-ALIGNED to the original paraIds.
 *
 * This module does only that: split the document markdown into blocks, then assign
 * each edited block an original paraId (or null for an insertion) by an exact-match
 * pass followed by a similarity pass. The result is the same `edited` list the block
 * editor produces, so all the surgical set/remove/move/add/run-rebuild logic is
 * reused unchanged. Mis-alignment can never corrupt silently: everything is still a
 * governed batch, reviewed in the before/after diff before promotion.
 *
 * Pure functions, no I/O.
 */

/** Split document markdown into paragraph blocks (blank-line separated). */
export function parseDocumentMd(text) {
  return String(text ?? "")
    .split(/\n[ \t]*\n/)
    .map((b) => b.replace(/^\n+|\n+$/g, ""))
    .filter((b) => b.trim().length > 0);
}

function bigrams(s) {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

// Sørensen–Dice coefficient over character bigrams: cheap, order-insensitive, and
// robust for "same paragraph, lightly edited". 1 = identical, 0 = nothing shared.
export function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  const counts = new Map();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let inter = 0;
  for (const g of B) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      inter += 1;
      counts.set(g, c - 1);
    }
  }
  return (2 * inter) / (A.length + B.length);
}

/**
 * Align edited markdown blocks to the original paragraphs, returning the `edited`
 * list ({path|null, md}) for computeBlockOps.
 *
 * Pass 1 (exact) pairs blocks whose markdown is identical, order-aware so a
 * duplicated paragraph pairs with the duplicate at the same rank. Pass 2 pairs each
 * still-unmatched edited block with the most similar still-unmatched original above
 * `threshold` — that is a light edit (keep the paraId, surgical). Anything left over
 * is an insertion (edited, path null) or a deletion (original absent from output).
 *
 * @param {{path:string, md:string}[]} original
 * @param {string[]} newBlocks
 * @returns {{path:string|null, md:string}[]}
 */
export function alignBlocks(original, newBlocks, { threshold = 0.5 } = {}) {
  const origs = (Array.isArray(original) ? original : []).map((o, i) => ({ i, path: o.path, md: o.md, used: false }));
  const news = (Array.isArray(newBlocks) ? newBlocks : []).map((md) => ({ md, path: null, matched: false }));

  // Pass 1 — exact md, order-aware for duplicates.
  const byMd = new Map();
  for (const o of origs) {
    if (!byMd.has(o.md)) byMd.set(o.md, []);
    byMd.get(o.md).push(o);
  }
  for (const n of news) {
    const q = byMd.get(n.md);
    if (q && q.length) {
      const o = q.shift();
      o.used = true;
      n.path = o.path;
      n.matched = true;
    }
  }

  // Pass 2 — best similarity above threshold among the remaining originals.
  for (const n of news) {
    if (n.matched) continue;
    let best = null;
    let bestScore = threshold;
    for (const o of origs) {
      if (o.used) continue;
      const s = similarity(n.md, o.md);
      if (s >= bestScore) {
        bestScore = s;
        best = o;
      }
    }
    if (best) {
      best.used = true;
      n.path = best.path;
      n.matched = true;
    }
  }

  return news.map((n) => ({ path: n.path, md: n.md }));
}
