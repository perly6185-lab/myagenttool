/*
 * Registry of built-in "managed" capability specs — in-process governed
 * capabilities that run synchronously through the Application Control agent (no
 * Desktop Bridge). Keyed by Application id. This is the generic extension point
 * projectApplicationCapabilities / action resolution / the approval gate consult
 * so that applications.mjs holds no per-application special cases; adding a
 * future built-in adds one entry here (#1353).
 *
 * Only the static SPECS live here (id/risk/schema). Handlers close over live
 * services and are injected separately into the execution path.
 */

import { CANVAS_APPLICATION_ID, canvasCapabilitySpecs } from "./canvas-capabilities.mjs";

/** applicationId → managed capability specs. */
export const MANAGED_CAPABILITY_SPECS = {
  [CANVAS_APPLICATION_ID]: canvasCapabilitySpecs,
};

/** The union of every registered managed action id, for action-name resolution. */
export const REGISTERED_MANAGED_ACTIONS = new Set(
  Object.values(MANAGED_CAPABILITY_SPECS).flatMap((specs) => specs.map((spec) => spec.id)),
);

export function managedSpecsForApp(applicationId) {
  return MANAGED_CAPABILITY_SPECS[applicationId] ?? [];
}

export function managedSpecFor(applicationId, action) {
  return managedSpecsForApp(applicationId).find((spec) => spec.id === action) ?? null;
}
