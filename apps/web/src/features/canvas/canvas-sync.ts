/*
 * Pure sync logic for the server-authoritative Web Canvas (#1354). Kept free of
 * React/Excalidraw so the conflict + offline rules are unit-testable. The editor
 * drives the effects; this module only decides.
 */

export type CanvasSaveStatus = "idle" | "saving" | "saved" | "conflict" | "offline" | "error";

export type ReconcileAction = "idle" | "apply-server" | "conflict";

/**
 * Decide what a background refresh does when the fetched server scene has moved:
 *  - server not ahead of the editor        → idle (nothing to do)
 *  - server ahead + NO unsaved local edits → apply the server scene (safe; e.g.
 *    an agent's change appears without a reload)
 *  - server ahead + unsaved local edits    → conflict (never silently overwrite
 *    the user's work, and never silently drop the newer server revision)
 */
export function reconcile({
  localRevision,
  dirty,
  serverRevision,
}: {
  localRevision: number;
  dirty: boolean;
  serverRevision: number;
}): ReconcileAction {
  if (serverRevision <= localRevision) return "idle";
  return dirty ? "conflict" : "apply-server";
}

// --- Image-load normalization (#1401 / reload-render) -------------------------
// Excalidraw prunes image elements whose binary isn't ready at first mount, and
// only resolves an image against the file cache when the element is "saved". The
// editor re-asserts the scene until images stick; these two pure helpers decide
// WHAT to normalize and WHICH images to wait for, so the contract is unit-testable
// without a browser.

type CanvasElementLike = Record<string, unknown>;

/**
 * Flip any image element whose binary we actually hold (`fileId` in `fileIds`)
 * from "pending" to "saved" — a "pending" image is treated as still-uploading and
 * renders blank. An image whose file is absent is left untouched (nothing to
 * render against). Non-image elements pass through unchanged.
 */
export function normalizeLoadedImageElements(elements: CanvasElementLike[], fileIds: Set<string>): CanvasElementLike[] {
  return elements.map((el) =>
    el && el.type === "image" && el.status !== "saved" && fileIds.has(el.fileId as string)
      ? { ...el, status: "saved" }
      : el,
  );
}

/**
 * The ids of image elements whose binary is present — i.e. the ones that CAN
 * stick once the file cache is warm, so the reassert loop has a reachable target.
 * An image with a missing file is excluded: Excalidraw prunes it permanently, so
 * waiting for it would burn the whole retry budget on every load.
 */
export function heldImageElementIds(elements: CanvasElementLike[], fileIds: Set<string>): string[] {
  return elements
    .filter((el) => el && el.type === "image" && fileIds.has(el.fileId as string))
    .map((el) => el.id as string);
}

// Offline draft: when a save fails with a network error, the user's work is
// preserved locally keyed by scene id and reconciled ONLY on an explicit action.
const OFFLINE_DRAFT_PREFIX = "myagenttool-canvas-offline:";

export function offlineDraftKey(sceneId: string): string {
  return `${OFFLINE_DRAFT_PREFIX}${sceneId}`;
}

export function loadOfflineDraft(sceneId: string): string | null {
  try {
    return localStorage.getItem(offlineDraftKey(sceneId));
  } catch {
    return null;
  }
}

export function saveOfflineDraft(sceneId: string, json: string): void {
  try {
    localStorage.setItem(offlineDraftKey(sceneId), json);
  } catch {
    /* quota / private mode — best effort */
  }
}

export function clearOfflineDraft(sceneId: string): void {
  try {
    localStorage.removeItem(offlineDraftKey(sceneId));
  } catch {
    /* ignore */
  }
}
