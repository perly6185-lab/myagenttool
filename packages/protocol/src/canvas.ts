/*
 * Canvas scene contract (types). Runtime values (id prefix, bounds, URL policy)
 * live in canvas.mjs. See docs/design/CANVAS_AGENT_INTEGRATION.md.
 */
import type { IsoDateTime, ProjectId, TeamId, UserId } from "./common.js";

export type CanvasSceneId = `cvs_${string}`;

/**
 * A durable, team-owned Excalidraw scene. `ownerTeamId` is stamped from the
 * authenticated actor (never the request body); `revision` is monotonic and
 * powers optimistic concurrency (writes carry `expectedRevision`).
 */
export interface CanvasScene {
  id: CanvasSceneId;
  ownerTeamId: TeamId;
  projectId: ProjectId | null;
  name: string;
  revision: number;
  elements: unknown[];
  files: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  createdBy: UserId;
  lastModifiedBy: UserId;
}

/** The scene shape returned to clients (summary form omits heavy element/file bodies). */
export interface CanvasSceneSummary {
  id: CanvasSceneId;
  ownerTeamId: TeamId;
  projectId: ProjectId | null;
  name: string;
  revision: number;
  elementCount: number;
  fileCount: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  lastModifiedBy: UserId;
}

export interface CanvasSceneBounds {
  maxNameLength: number;
  maxElements: number;
  maxTextLength: number;
  maxFiles: number;
  maxSceneBytes: number;
  maxAggregateBytes: number;
}
