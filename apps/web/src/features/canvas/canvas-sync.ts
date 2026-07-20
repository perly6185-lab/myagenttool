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
