/*
 * Built-in Canvas Application (#1353, Epic #1350). A manual-source Application
 * with NO external runtime — its governed capabilities run in-process through
 * the Application Control agent (application_control execution mode), so it is
 * ready without the Desktop Bridge. The 7 governed capabilities are projected
 * from the managed-capability registry (services/managed-capability-registry.mjs),
 * not from wrapper commands or agent facades. See
 * docs/design/CANVAS_AGENT_INTEGRATION.md.
 */

import { CANVAS_APPLICATION_ID } from "./canvas-capabilities.mjs";

export { CANVAS_APPLICATION_ID };

export function createCanvasApplicationRegistration({ autoOnline = false, projectId = null } = {}) {
  return {
    id: CANVAS_APPLICATION_ID,
    name: "Canvas",
    autoOnline,
    ...(projectId ? { projectId } : {}),
    source: {
      type: "manual",
      manifest: {
        description: "Governed Excalidraw scene capabilities (list, get, create, add/update/remove elements, export). Built-in; no external runtime.",
      },
    },
  };
}
