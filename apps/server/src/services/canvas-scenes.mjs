/*
 * Canvas scene service (#1352, Epic #1350). The durable, team-owned source of
 * truth for Excalidraw scenes; the browser scene (#1351) is an offline draft.
 *
 * Load-bearing properties:
 *   1. Tenancy — ownerTeamId is stamped from the authenticated actor, never the
 *      request body. A foreign or missing scene returns an IDENTICAL 404 so ids
 *      cannot be enumerated across teams (TENANCY_ROUTE_MATRIX.md).
 *   2. Optimistic concurrency — every scene carries a monotonic `revision`;
 *      update/delete require a matching `expectedRevision` or fail with a typed
 *      409 and NO mutation, so a stale user/agent write cannot clobber a newer one.
 *   3. Fail-closed bounds — element/text/file counts, per-scene and aggregate
 *      byte sizes, and an embedded-URL scheme allowlist ({https:, data:}) are
 *      enforced on every write; anything malformed or over-limit is rejected 400.
 */

import { canvasAllowedUrlSchemes, canvasSceneBounds, canvasSceneIdPrefix } from "@myagenttool/protocol/canvas";
import { actorCanAccessProject, LOCAL_TEAM_ID, LOCAL_USER_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const SCHEME_RE = /^([a-z][a-z0-9+.\-]*:)/i;

/** A link/data URL is allowed when absent, or when its scheme is on the allowlist. */
function urlAllowed(value) {
  if (value == null || value === "") return true;
  if (typeof value !== "string") return false;
  const match = value.match(SCHEME_RE);
  if (!match) return false; // schemeless → reject (fail closed)
  return canvasAllowedUrlSchemes.includes(match[1].toLowerCase());
}

function byteLength(value) {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value ?? null), "utf8");
}

/**
 * Validate + normalize a scene payload. Returns `{ error, message }` on any
 * violation (fail closed) or `{ value: { name, elements, files } }` when clean.
 */
function validateScenePayload({ name, elements, files }) {
  const b = canvasSceneBounds;

  const normalizedName = String(name ?? "").trim().slice(0, b.maxNameLength) || "Untitled scene";

  if (!Array.isArray(elements)) {
    return { error: "invalid_canvas_scene", message: "elements must be an array." };
  }
  if (elements.length > b.maxElements) {
    return { error: "canvas_scene_too_large", message: `A scene may hold at most ${b.maxElements} elements.` };
  }
  for (const element of elements) {
    if (!element || typeof element !== "object" || Array.isArray(element)) {
      return { error: "invalid_canvas_element", message: "Every element must be an object." };
    }
    if (typeof element.type !== "string" || typeof element.id !== "string") {
      return { error: "invalid_canvas_element", message: "Every element needs a string id and type." };
    }
    if (element.text != null && (typeof element.text !== "string" || element.text.length > b.maxTextLength)) {
      return { error: "invalid_canvas_element", message: `Element text must be a string under ${b.maxTextLength} chars.` };
    }
    if (element.link != null && !urlAllowed(element.link)) {
      return { error: "unsupported_canvas_url", message: "Element links must be https: or data: URLs." };
    }
  }

  if (files == null || typeof files !== "object" || Array.isArray(files)) {
    return { error: "invalid_canvas_files", message: "files must be an object." };
  }
  const fileEntries = Object.entries(files);
  if (fileEntries.length > b.maxFiles) {
    return { error: "canvas_scene_too_large", message: `A scene may hold at most ${b.maxFiles} binary files.` };
  }
  for (const [fileId, file] of fileEntries) {
    if (!fileId || !file || typeof file !== "object" || Array.isArray(file)) {
      return { error: "invalid_canvas_file", message: "Every binary file must be a keyed object." };
    }
    if (typeof file.mimeType !== "string" || typeof file.dataURL !== "string") {
      return { error: "invalid_canvas_file", message: "Each file needs a string mimeType and dataURL." };
    }
    if (!urlAllowed(file.dataURL)) {
      return { error: "unsupported_canvas_url", message: "File data must be a data: or https: URL." };
    }
  }

  const sceneBytes = byteLength({ elements });
  if (sceneBytes > b.maxSceneBytes) {
    return { error: "canvas_scene_too_large", message: `Scene JSON exceeds ${b.maxSceneBytes} bytes.` };
  }
  if (sceneBytes + byteLength(files) > b.maxAggregateBytes) {
    return { error: "canvas_scene_too_large", message: `Scene plus files exceed ${b.maxAggregateBytes} bytes.` };
  }

  return { value: { name: normalizedName, elements, files } };
}

export function createCanvasSceneService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
  store,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  const actorTeam = (actor) => actor?.teamId ?? LOCAL_TEAM_ID;
  const actorUser = (actor) => actor?.userId ?? LOCAL_USER_ID;

  // Foreign team sees exactly "does not exist" — 404, never 403.
  function findOwnScene(sceneId, actor) {
    const scene = (state.canvasScenes ?? []).find((row) => row.id === String(sceneId ?? ""));
    if (!scene) return null;
    if (actor?.teamId && (scene.ownerTeamId ?? LOCAL_TEAM_ID) !== actor.teamId) return null;
    return scene;
  }

  const notFound = () => ({ ok: false, status: 404, body: { error: "canvas_scene_not_found" } });

  function sceneSummary(scene) {
    return {
      id: scene.id,
      ownerTeamId: scene.ownerTeamId,
      projectId: scene.projectId,
      name: scene.name,
      revision: scene.revision,
      elementCount: scene.elements.length,
      fileCount: Object.keys(scene.files ?? {}).length,
      createdAt: scene.createdAt,
      updatedAt: scene.updatedAt,
      lastModifiedBy: scene.lastModifiedBy,
    };
  }

  /** Full scene, including element + file bodies (the detail read). */
  function publicScene(scene) {
    return { ...scene };
  }

  function listScenes(actor = null) {
    const rows = (state.canvasScenes ?? []).filter(
      (row) => !actor?.teamId || (row.ownerTeamId ?? LOCAL_TEAM_ID) === actor.teamId,
    );
    return { ok: true, status: 200, body: { scenes: rows.map(sceneSummary), count: rows.length } };
  }

  function getScene({ sceneId } = {}, actor = null) {
    const scene = findOwnScene(sceneId, actor);
    if (!scene) return notFound();
    return { ok: true, status: 200, body: { scene: publicScene(scene) } };
  }

  function createScene({ name, projectId = null, elements = [], files = {} } = {}, actor = null) {
    const requestedProjectId = projectId == null ? null : String(projectId);
    // A foreign/unknown project is hidden as not-found (existence-hiding).
    if (requestedProjectId != null && !actorCanAccessProject(state, actor, requestedProjectId)) {
      return { ok: false, status: 404, body: { error: "project_not_found" } };
    }
    const validated = validateScenePayload({ name, elements, files });
    if (validated.error) {
      return { ok: false, status: 400, body: { error: validated.error, message: validated.message } };
    }
    const timestamp = now();
    const userId = actorUser(actor);
    const scene = {
      id: nextId(canvasSceneIdPrefix),
      ownerTeamId: actorTeam(actor),
      projectId: requestedProjectId,
      name: validated.value.name,
      revision: 1,
      elements: validated.value.elements,
      files: validated.value.files,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: userId,
      lastModifiedBy: userId,
    };
    runTx(() => {
      state.canvasScenes.push(scene);
      appendEvent({
        invocationId: null,
        type: "canvas_scene_created",
        level: "info",
        message: `Canvas scene ${scene.id} created (${scene.elements.length} elements).`,
        data: { canvasSceneId: scene.id, projectId: scene.projectId, revision: scene.revision },
      });
    });
    return { ok: true, status: 201, body: { scene: publicScene(scene) } };
  }

  /** Stale-write guard shared by update + delete: typed 409, no mutation. */
  function checkRevision(scene, expectedRevision) {
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_revision_required", currentRevision: scene.revision } };
    }
    if (expectedRevision !== scene.revision) {
      return { ok: false, status: 409, body: { error: "canvas_scene_revision_conflict", currentRevision: scene.revision } };
    }
    return null;
  }

  function updateScene({ sceneId, name, elements, files, expectedRevision } = {}, actor = null) {
    const scene = findOwnScene(sceneId, actor);
    if (!scene) return notFound();
    const conflict = checkRevision(scene, expectedRevision);
    if (conflict) return conflict;
    const validated = validateScenePayload({
      name: name ?? scene.name,
      elements: elements ?? scene.elements,
      files: files ?? scene.files,
    });
    if (validated.error) {
      return { ok: false, status: 400, body: { error: validated.error, message: validated.message } };
    }
    runTx(() => {
      scene.name = validated.value.name;
      scene.elements = validated.value.elements;
      scene.files = validated.value.files;
      scene.revision += 1;
      scene.updatedAt = now();
      scene.lastModifiedBy = actorUser(actor);
      appendEvent({
        invocationId: null,
        type: "canvas_scene_updated",
        level: "info",
        message: `Canvas scene ${scene.id} updated to revision ${scene.revision}.`,
        data: { canvasSceneId: scene.id, revision: scene.revision },
      });
    });
    return { ok: true, status: 200, body: { scene: publicScene(scene) } };
  }

  function deleteScene({ sceneId, expectedRevision } = {}, actor = null) {
    const scene = findOwnScene(sceneId, actor);
    if (!scene) return notFound();
    const conflict = checkRevision(scene, expectedRevision);
    if (conflict) return conflict;
    runTx(() => {
      state.canvasScenes = (state.canvasScenes ?? []).filter((row) => row.id !== scene.id);
      appendEvent({
        invocationId: null,
        type: "canvas_scene_deleted",
        level: "info",
        message: `Canvas scene ${scene.id} deleted.`,
        data: { canvasSceneId: scene.id, revision: scene.revision },
      });
    });
    return { ok: true, status: 200, body: { deleted: scene.id } };
  }

  return {
    listScenes,
    getScene,
    createScene,
    updateScene,
    deleteScene,
    findOwnScene,
  };
}
