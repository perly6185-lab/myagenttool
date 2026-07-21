/*
 * OfficeCLI inline markdown <-> runs (L1.5). A paragraph is a sequence of runs,
 * each carrying inline formatting; this module projects a run sequence to inline
 * markdown (`**bold**`, `*italic*`, `***both***`) and parses it back. Scope is
 * deliberately just bold/italic — officecli has no hyperlink verb, and colour/font
 * live in run format markdown can't express (preserved by not editing that run).
 *
 * Pure functions, no I/O. The round-trip is normalizing: parseInline(runsToInlineMd(x))
 * equals x with adjacent same-format runs merged and empty runs dropped.
 */

/** @typedef {{ text: string, bold: boolean, italic: boolean }} Run */

// Merge neighbouring runs with identical formatting and drop empties — the
// canonical form both directions converge to.
export function normalizeRuns(runs) {
  const out = [];
  for (const r of Array.isArray(runs) ? runs : []) {
    const text = typeof r?.text === "string" ? r.text : "";
    if (!text) continue;
    const bold = Boolean(r?.bold);
    const italic = Boolean(r?.italic);
    const prev = out[out.length - 1];
    if (prev && prev.bold === bold && prev.italic === italic) prev.text += text;
    else out.push({ text, bold, italic });
  }
  return out;
}

// Escape the two characters that would otherwise be read as markup.
function escapeInline(text) {
  return text.replace(/([\\*])/g, "\\$1");
}

/** A run sequence -> inline markdown. */
export function runsToInlineMd(runs) {
  return normalizeRuns(runs)
    .map((r) => {
      const body = escapeInline(r.text);
      if (r.bold && r.italic) return `***${body}***`;
      if (r.bold) return `**${body}**`;
      if (r.italic) return `*${body}*`;
      return body;
    })
    .join("");
}

// Scan inline markdown into runs. A single left-to-right pass: `\` escapes the
// next char to a literal; a `*`-run of length 1/2/3 opens emphasis and the
// matching closer (same length, honouring escapes) sets the span's format. An
// unmatched opener is treated as literal text — never a parse error.
export function parseInline(md) {
  const src = typeof md === "string" ? md : "";
  const runs = [];
  let buf = "";
  let bold = false;
  let italic = false;
  const flush = () => {
    if (buf) runs.push({ text: buf, bold, italic });
    buf = "";
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\" && i + 1 < src.length) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (c === "*") {
      // Measure this delimiter run (unescaped stars).
      let n = 0;
      while (src[i + n] === "*") n += 1;
      const want = n >= 3 ? { bold: true, italic: true, len: 3 } : n === 2 ? { bold: true, italic: false, len: 2 } : { bold: false, italic: true, len: 1 };
      const close = findCloser(src, i + want.len, want.len);
      if (close === -1) {
        // No matching closer — literal stars.
        buf += "*".repeat(want.len);
        i += want.len;
        continue;
      }
      flush();
      // Parse the inner span with this emphasis applied on top of nothing (spans
      // don't nest in v1 scope beyond the combined ***form***).
      const inner = parseInline(src.slice(i + want.len, close));
      for (const r of inner) runs.push({ text: r.text, bold: r.bold || want.bold, italic: r.italic || want.italic });
      i = close + want.len;
      continue;
    }
    buf += c;
    i += 1;
  }
  flush();
  return normalizeRuns(runs);
}

// Index of the closer delimiter run of exactly `len` stars starting at/after
// `from`, honouring `\` escapes. Returns the index of the first star of the
// closer, or -1.
function findCloser(src, from, len) {
  let i = from;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === "*") {
      let n = 0;
      while (src[i + n] === "*") n += 1;
      if (n >= len) return i + (n - len); // align to the last `len` stars of the run
      i += n;
      continue;
    }
    i += 1;
  }
  return -1;
}
