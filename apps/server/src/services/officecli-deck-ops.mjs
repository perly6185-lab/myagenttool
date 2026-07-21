/*
 * OfficeCLI pptx deck-ops mapper (v0). A presentation is slides, each holding
 * shapes; a text shape (textbox) has a stable `@id` path
 * (`/slide[1]/shape[@id=100000]`). Editing is the simplest of the three formats:
 * no paraId alignment, no ordering, no run-rebuild — a changed shape's text maps to
 * one surgical `set <shape-path> --prop text=`, and the whole edit is one governed
 * `batch`.
 *
 * Pure functions, no I/O.
 */

/**
 * @typedef {{ path: string, type: string, text: string }} Shape
 * @typedef {Record<string, unknown>} BatchCommand
 */

// A shape addressed by its stable id under a positional slide.
const SHAPE_PATH = /^\/slide\[\d+\]\/shape\[@id=\d+\]$/;

/** Only text shapes are editable here; pictures/other shapes are shown read-only. */
export function shapeIsEditable(shape) {
  return shape?.type === "textbox";
}

/**
 * Diff the edited shape-text map against the original and emit the item list for
 * one governed `batch`. Only shapes present in the original (from the read) and
 * whose text changed produce a `set`; the path is re-validated as a slide/shape
 * selector as defense-in-depth.
 *
 * @param {{ original?: Record<string,string>, edited?: Record<string,string> }} input
 * @returns {{ commands: BatchCommand[] }}
 */
export function computeDeckOps({ original = {}, edited = {} } = {}) {
  const commands = [];
  const orig = original && typeof original === "object" ? original : {};
  const next = edited && typeof edited === "object" ? edited : {};
  for (const path of Object.keys(next)) {
    if (!Object.prototype.hasOwnProperty.call(orig, path)) continue; // only known shapes
    if (!SHAPE_PATH.test(path)) continue; // the path is a document selector
    const newText = typeof next[path] === "string" ? next[path] : "";
    if (newText === orig[path]) continue;
    commands.push({ command: "set", path, props: { text: newText } });
  }
  return { commands };
}
