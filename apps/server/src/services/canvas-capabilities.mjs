/*
 * Governed Canvas capabilities (#1353). Provider-neutral capability specs +
 * in-process handlers over the durable canvas scene service (#1352). Codex and
 * Claude invoke the identical capability contract.
 *
 * Split: the SPECS (id/risk/schema) are static and drive projection, action
 * resolution, and approval gating in applications.mjs (a pure read path, so they
 * must be importable without a service instance). The HANDLERS close over the
 * live canvasSceneService and are injected into the execution path. See
 * docs/design/CANVAS_AGENT_INTEGRATION.md.
 */

import { canvasSceneBounds } from "@myagenttool/protocol/canvas";

/** Stable built-in Application id so handlers + specs key off the same value. */
export const CANVAS_APPLICATION_ID = "app_canvas";

const sceneIdSchema = { type: "string", maxLength: 200 };
const revisionSchema = { type: "integer", minimum: 1 };
const elementsSchema = { type: "array", maxItems: canvasSceneBounds.maxElements, items: { type: "object" } };
const filesSchema = { type: "object" };

/**
 * The 7 governed capabilities. Reads (list/get/export) are low-risk and
 * non-destructive; create/add/update are medium (bounded schema + revision);
 * remove_elements is high-risk, approval-gated, single-use, and audited.
 * `additionalProperties: false` means an undeclared field (e.g. a forged token
 * on a read) is rejected by the capability gateway before the handler runs.
 */
export const canvasCapabilitySpecs = [
  {
    id: "list",
    displayName: "List canvas scenes",
    description: "List the team's canvas scenes (id, name, revision). Start here to find or resume a scene; agents and the user share the same scenes.",
    kind: "read",
    riskLevel: "low",
    riskTags: ["read_only", "application_asset"],
    requiresApproval: false,
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    id: "get",
    displayName: "Read a canvas scene",
    description: "Read a scene's full elements and current revision. Read before you write, and pass the returned revision back as expectedRevision on the next write. On a canvas_scene_revision_conflict, call get again to rebase \u2014 never retry with a stale revision.",
    kind: "read",
    riskLevel: "low",
    riskTags: ["read_only", "application_asset"],
    requiresApproval: false,
    inputSchema: { type: "object", additionalProperties: false, required: ["sceneId"], properties: { sceneId: sceneIdSchema } },
  },
  {
    id: "create",
    displayName: "Create a canvas scene",
    description: "Create a new scene. Prefer building it up with add_elements over one large payload; the user can edit it live as you go.",
    kind: "write",
    riskLevel: "medium",
    riskTags: ["write_control", "application_asset"],
    requiresApproval: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", maxLength: canvasSceneBounds.maxNameLength },
        projectId: { type: "string", maxLength: 200 },
        elements: elementsSchema,
        files: filesSchema,
      },
    },
  },
  {
    id: "add_elements",
    displayName: "Add elements to a canvas scene",
    description: "Add bounded Excalidraw elements to a scene. The server assigns durable element ids (use the returned changedElementIds to reference them later) and remaps intra-batch bindings, so connect shapes with arrows and attach text labels here rather than replacing the whole scene. To place a standalone image, add an `image` element plus its binary in `files` (a data: or https: dataURL — e.g. a local worktree image fetched as base64) in the same call. Carry the current expectedRevision.",
    kind: "write",
    riskLevel: "medium",
    riskTags: ["write_control", "application_asset"],
    requiresApproval: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sceneId", "expectedRevision", "elements"],
      properties: { sceneId: sceneIdSchema, expectedRevision: revisionSchema, elements: elementsSchema, files: filesSchema },
    },
  },
  {
    id: "update_elements",
    displayName: "Update elements in a canvas scene",
    description: "Update existing elements by their server id, preserving element identity (never recreate an element you can update \u2014 the user may have edited it). Carry expectedRevision.",
    kind: "write",
    riskLevel: "medium",
    riskTags: ["write_control", "application_asset"],
    requiresApproval: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sceneId", "expectedRevision", "elements"],
      properties: { sceneId: sceneIdSchema, expectedRevision: revisionSchema, elements: elementsSchema, files: filesSchema },
    },
  },
  {
    id: "remove_elements",
    displayName: "Remove elements from a canvas scene",
    description: "Remove elements by id. Destructive: requires a governed approval grant (approvalToken) and carries expectedRevision. Prefer update_elements unless deletion is intended.",
    kind: "write",
    riskLevel: "high",
    riskTags: ["write_control", "destructive", "application_asset"],
    requiresApproval: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sceneId", "expectedRevision", "elementIds"],
      properties: {
        sceneId: sceneIdSchema,
        expectedRevision: revisionSchema,
        elementIds: { type: "array", maxItems: canvasSceneBounds.maxElements, items: { type: "string", maxLength: 200 } },
        approvalToken: { type: "string", maxLength: 400 },
      },
    },
  },
  {
    id: "export",
    displayName: "Export a canvas scene",
    description: "Export the authoritative scene as Excalidraw/JSON. Read-only.",
    kind: "read",
    riskLevel: "low",
    riskTags: ["read_only", "application_asset"],
    requiresApproval: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sceneId"],
      properties: { sceneId: sceneIdSchema, format: { type: "string", enum: ["excalidraw", "json"] } },
    },
  },
];

/**
 * Handlers keyed by capability action, closing over the live scene service. Each
 * returns the service's `{ ok:false, status, body }` failure envelope verbatim
 * (so the gateway propagates the exact status), or a `{ summary, output }`
 * success shape carrying sceneId, revision, and changed element ids.
 */
export function createCanvasCapabilityHandlers(canvasSceneService) {
  const ok = (envelope, summarize) =>
    envelope.ok === false ? envelope : { summary: summarize(envelope.body), output: { source: "application", ...envelope.body } };

  return {
    list: ({ input, actor }) =>
      ok(canvasSceneService.listScenes(actor), (b) => `Listed ${b.count} canvas scene(s).`),
    get: ({ input, actor }) =>
      ok(canvasSceneService.getScene({ sceneId: input?.sceneId }, actor), (b) => `Canvas scene ${b.scene?.id} read.`),
    create: ({ input, actor }) =>
      ok(
        canvasSceneService.createScene(
          { name: input?.name, projectId: input?.projectId ?? null, elements: input?.elements, files: input?.files },
          actor,
        ),
        (b) => `Canvas scene ${b.scene?.id} created (revision ${b.scene?.revision}).`,
      ),
    add_elements: ({ input, actor }) =>
      ok(
        canvasSceneService.addElements({ sceneId: input?.sceneId, elements: input?.elements, files: input?.files, expectedRevision: input?.expectedRevision }, actor),
        (b) => `Added ${b.changedElementIds?.length ?? 0} element(s) to ${b.scene?.id} (revision ${b.revision}).`,
      ),
    update_elements: ({ input, actor }) =>
      ok(
        canvasSceneService.updateElements({ sceneId: input?.sceneId, elements: input?.elements, files: input?.files, expectedRevision: input?.expectedRevision }, actor),
        (b) => `Updated ${b.changedElementIds?.length ?? 0} element(s) in ${b.scene?.id} (revision ${b.revision}).`,
      ),
    remove_elements: ({ input, actor }) =>
      ok(
        canvasSceneService.removeElements({ sceneId: input?.sceneId, elementIds: input?.elementIds, expectedRevision: input?.expectedRevision }, actor),
        (b) => `Removed ${b.removedElementIds?.length ?? 0} element(s) from ${b.scene?.id} (revision ${b.revision}).`,
      ),
    export: ({ input, actor }) =>
      ok(canvasSceneService.exportScene({ sceneId: input?.sceneId, format: input?.format }, actor), (b) => `Canvas scene ${b.scene?.id} exported as ${b.format}.`),
  };
}
