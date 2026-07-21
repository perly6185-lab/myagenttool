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
  const news = (Array.isArray(newBlocks) ? newBlocks : []).map((md, idx) => ({ idx, md, path: null, matched: false, origIdx: -1 }));

  const claim = (n, o) => {
    o.used = true;
    n.path = o.path;
    n.matched = true;
    n.origIdx = o.i;
  };

  // Pass 1 — exact md, order-aware for duplicates. Matching ALL equal-md blocks
  // (moved or not) lets computeBlockOps realize a reorder with `move` ops.
  const byMd = new Map();
  for (const o of origs) {
    if (!byMd.has(o.md)) byMd.set(o.md, []);
    byMd.get(o.md).push(o);
  }
  for (const n of news) {
    const q = byMd.get(n.md);
    if (q && q.length) claim(n, q.shift());
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
    if (best) claim(n, best);
  }

  // Pass 3 — positional fallback. Similarity is unreliable for short paragraphs
  // (`Yes`→`No` shares no bigrams, yet is an in-place edit), so pair each remaining
  // unmatched block with the unused original at the CORRESPONDING position. Anchors
  // = the order-preserving (monotonic) subset of the matches so far; within each
  // anchor-bounded gap, residue is paired 1:1 in order (an in-place edit — keeps the
  // paraId + formatting). A genuine insert and delete in DIFFERENT gaps are kept
  // apart by the anchors, so they never cross-pair into a spurious edit.
  const matched = news.filter((n) => n.matched).map((n) => ({ ni: n.idx, oi: n.origIdx }));
  const anchorNi = new Set(monotonicAnchors(matched));
  const anchors = matched.filter((m) => anchorNi.has(m.ni)).sort((a, b) => a.ni - b.ni);
  let prevNi = -1;
  let prevOi = -1;
  for (const a of [...anchors, { ni: news.length, oi: origs.length }]) {
    const gapNews = news.filter((n) => n.idx > prevNi && n.idx < a.ni && !n.matched);
    const gapOrigs = origs.filter((o) => o.i > prevOi && o.i < a.oi && !o.used);
    const k = Math.min(gapNews.length, gapOrigs.length);
    for (let t = 0; t < k; t++) claim(gapNews[t], gapOrigs[t]);
    prevNi = a.ni;
    prevOi = a.oi;
  }

  return news.map((n) => ({ path: n.path, md: n.md }));
}

// Given matched {ni, oi} pairs sorted by ni, return the ni's of a longest subset
// whose oi is strictly increasing — the order-preserving anchors that partition
// both sequences into gaps (a non-monotonic match is a MOVE, left out of the
// anchors so it doesn't define a gap boundary).
function monotonicAnchors(matched) {
  const arr = [...matched].sort((a, b) => a.ni - b.ni);
  const oi = arr.map((m) => m.oi);
  const n = oi.length;
  if (n === 0) return [];
  const tails = [];
  const prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (oi[tails[mid]] < oi[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    if (lo === tails.length) tails.push(i);
    else tails[lo] = i;
  }
  const out = [];
  let k = tails[tails.length - 1];
  while (k !== -1) {
    out.push(arr[k].ni);
    k = prev[k];
  }
  return out;
}
