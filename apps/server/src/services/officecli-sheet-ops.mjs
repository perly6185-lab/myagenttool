/*
 * OfficeCLI xlsx grid-ops mapper (v0). A worksheet is a grid of cells at stable A1
 * addresses (`/Sheet1/A1`), so editing is far simpler than the docx paragraph case:
 * no paraId alignment, no run-rebuild, no ordering. Each changed cell maps to one
 * surgical `set` keyed on its address; the whole edit is one governed `batch`.
 *
 * A formula cell exposes `format.formula` (e.g. `B2*2`) with the computed value in
 * `text`; it is edited as `=B2*2`. officecli's `set` auto-creates a cell/row at any
 * address, so entering data in a new row needs no add-row op — just a `set`.
 *
 * Pure functions, no I/O.
 */

/**
 * @typedef {{ text?: string, formula?: string|null, type?: string|null }} Cell
 * @typedef {Record<string, unknown>} BatchCommand
 */

// A1-style cell address: one-or-more column letters + a 1-based row number.
const CELL_ADDR = /^[A-Z]+[1-9][0-9]*$/;

/** The editable markdown-free text for a cell: a formula shows as `=…`, else the value. */
export function cellEditableText(cell) {
  if (!cell) return "";
  if (typeof cell.formula === "string" && cell.formula.length > 0) return `=${cell.formula}`;
  return typeof cell.text === "string" ? cell.text : "";
}

/**
 * Diff the edited cell map against the original and emit the item list for one
 * governed `batch`. Only changed cells produce a `set`; a value starting with `=`
 * is written as a formula, an emptied cell clears the value. Addresses that aren't
 * valid A1 references are ignored (defensive — the path is a document selector).
 *
 * @param {{ sheet?: string, original?: Record<string, Cell>, edited?: Record<string, string> }} input
 * @returns {{ commands: BatchCommand[] }}
 */
export function computeSheetOps({ sheet = "Sheet1", original = {}, edited = {} } = {}) {
  const commands = [];
  const orig = original && typeof original === "object" ? original : {};
  const next = edited && typeof edited === "object" ? edited : {};
  for (const addr of Object.keys(next)) {
    if (!CELL_ADDR.test(addr)) continue;
    const newText = typeof next[addr] === "string" ? next[addr] : "";
    const origText = cellEditableText(orig[addr]);
    if (newText === origText) continue;
    const path = `/${sheet}/${addr}`;
    if (newText.length > 1 && newText.startsWith("=")) {
      commands.push({ command: "set", path, props: { formula: newText.slice(1) } });
    } else {
      commands.push({ command: "set", path, props: { value: newText } });
    }
  }
  return { commands };
}

// --- address helpers (shared with the reader/UI) ---------------------------

/** Column letters → 1-based index ("A"→1, "Z"→26, "AA"→27). */
export function columnToIndex(letters) {
  let n = 0;
  for (const ch of String(letters)) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** 1-based index → column letters (1→"A", 27→"AA"). */
export function indexToColumn(index) {
  let n = Math.max(1, Math.floor(index));
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Parse "AB12" → { col, row } (1-based), or null if not an A1 address. */
export function parseAddr(addr) {
  const m = /^([A-Z]+)([1-9][0-9]*)$/.exec(String(addr ?? ""));
  if (!m) return null;
  return { col: columnToIndex(m[1]), row: Number(m[2]) };
}
