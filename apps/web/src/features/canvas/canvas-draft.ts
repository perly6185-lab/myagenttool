/**
 * Canvas file helpers: import validation, download, and filenames — kept free of
 * Excalidraw imports so they stay unit-testable and never pull the heavy editor
 * bundle. Draft persistence moved to per-scene offline drafts in canvas-sync.ts
 * when the canvas became server-authoritative (#1352/#1354).
 */

export interface ImportedScene {
  elements: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

/**
 * Parse and validate an imported `.excalidraw` file's text. Throws on anything
 * that is not a well-formed Excalidraw scene so a bad upload fails visibly
 * instead of corrupting the canvas.
 */
export function parseImportedScene(text: string): ImportedScene {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Not a valid .excalidraw file (invalid JSON).");
  }
  if (!data || typeof data !== "object") {
    throw new Error("Not a valid .excalidraw file.");
  }
  const scene = data as Record<string, unknown>;
  if (scene.type !== "excalidraw" || !Array.isArray(scene.elements)) {
    throw new Error("Not a valid .excalidraw file (missing elements).");
  }
  return {
    elements: scene.elements,
    appState: isRecord(scene.appState) ? scene.appState : undefined,
    files: isRecord(scene.files) ? scene.files : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

/** A stable, sortable scene filename, e.g. `canvas-2026-07-20T07-12-00.png`. */
export function sceneFilename(ext: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `canvas-${stamp}.${ext}`;
}

/** Trigger a browser download of a Blob (or string) as `filename`. */
export function downloadBlob(data: Blob | string, filename: string, mime = "application/json"): void {
  const blob = typeof data === "string" ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
