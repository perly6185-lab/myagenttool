# Canvas Agent Integration

Design record for the governed Excalidraw Canvas (Epic #1350). It defines the
durable scene model and the boundary every surface — Web console, server API,
and agent capabilities — operates through. This document is the Source Doc the
epic's issues reference; it is published with the scene API (#1352) and extended
as the later tasks land.

## Architecture boundary

- **The server scene record is authoritative.** The browser scene (#1351) is an
  offline **draft** in `localStorage`, never a source of truth.
- **Every scene is team-scoped**, optionally project-scoped. Ownership is stamped
  from the authenticated actor, never from the request body.
- **Every write carries an expected revision** and fails visibly on conflict — a
  stale user or agent write can never silently overwrite a newer one.
- **Agent writes (later tasks) are bounded element operations**, not arbitrary
  scene JSON or scripts.
- **CLI execution (#1356) is optional** and governed by the Desktop Bridge
  allowlist; it fails closed when the local runtime is unavailable.

## Scene record

A `CanvasScene` (`packages/protocol/src/canvas.ts`) is stored in the durable
`state.canvasScenes` collection:

| Field | Meaning |
| --- | --- |
| `id` | `cvs_*` server-assigned id |
| `ownerTeamId` | Owning team — stamped from the actor |
| `projectId` | Optional project scope (`null` = team-only) |
| `name` | Human label (bounded) |
| `revision` | Monotonic integer, starts at 1, bumped on every update |
| `elements` | Bounded Excalidraw elements |
| `files` | Bounded Excalidraw binary files |
| `createdAt` / `updatedAt` | Timestamps |
| `createdBy` / `lastModifiedBy` | Actor attribution |

## HTTP contract

All handlers are owner-team scoped inside the service (`routes/canvas-scenes.mjs`
→ `services/canvas-scenes.mjs`). Responses use the repo's uniform envelope
(`{ error, message }` for failures).

| Method + path | Behavior |
| --- | --- |
| `GET /api/canvas/scenes` | List the actor's team scenes (summaries: no element/file bodies) |
| `POST /api/canvas/scenes` | Create; stamps ownership from the actor; validates project scope + bounds; `201` |
| `GET /api/canvas/scenes/:id` | Read one full scene, or `404` |
| `PUT /api/canvas/scenes/:id` | Update; requires `expectedRevision`; bumps revision |
| `DELETE /api/canvas/scenes/:id` | Delete; requires `expectedRevision` |

## Tenancy

- The actor + team come from `resolveActor` (`Authorization: Bearer <token>`),
  threaded to every route.
- `findOwnScene(id, actor)` returns `null` for both a **missing** and a
  **foreign-team** scene; the route then returns an **identical** `404
  { error: "canvas_scene_not_found" }`. Foreign existence is unobservable — ids
  cannot be enumerated across teams (TENANCY_ROUTE_MATRIX.md).
- `projectId`, when supplied, is validated with `actorCanAccessProject`; a
  foreign/unknown project is hidden as `404 { error: "project_not_found" }`.
- Ownership (`ownerTeamId`, `createdBy`) is always taken from the actor; any
  `ownerTeamId`/`createdBy` in the body is ignored (integration test asserts this).

## Optimistic concurrency

There was no generic revision primitive in the codebase (the nearest precedent
is `descriptorRevision` on applications). Canvas establishes the explicit form:

- `revision` starts at 1 and increments by 1 on each successful update.
- `PUT` and `DELETE` require `expectedRevision`. A missing/non-integer value is
  `400 expected_revision_required`; a mismatch is `409
  canvas_scene_revision_conflict` carrying `currentRevision`, and performs **no
  mutation**. The client refetches, rebases, and retries.

## Bounds & validation (fail closed)

Every write is validated before it touches the store; anything malformed or
over-limit is rejected `400`. Limits live in `packages/protocol/src/canvas.mjs`
(`canvasSceneBounds`) so they are a documented contract:

- `maxElements` 5000; each element must be an object with string `id` + `type`.
- `maxTextLength` 20000 per text-bearing element.
- `maxFiles` 100; each file must carry a string `mimeType` + `dataURL`.
- `maxSceneBytes` 5 MiB (elements JSON); `maxAggregateBytes` 12 MiB (elements +
  files).
- **Embedded-URL policy** (`canvasAllowedUrlSchemes` = `https:`, `data:`): element
  `link`s and file `dataURL`s must use those schemes. `javascript:`, `http:`,
  `file:`, `blob:`, `vbscript:`, and schemeless values are rejected
  (`unsupported_canvas_url`) so a stored scene can never carry an executable or
  SSRF-prone reference.

## Durability & audit

- Writes go through the Store transaction boundary (`makeRunTx` →
  `store.transaction`), committed by `persistStateNow` (whole-state atomic
  snapshot). `canvasScenes` is registered in `persistedArrayKeys`, so scenes
  survive restart (a completeness test enforces the classification).
- Each write emits an audit event (`canvas_scene_created|updated|deleted`) inside
  the same transaction, so the record and its audit commit atomically.

## Where the other tasks plug in

- **#1351 (Web draft, shipped)** — the offline browser scene + import/export. It
  remains a draft; #1354 syncs it to these authoritative scenes.
- **#1353** — a built-in Canvas Application exposes governed **Canvas
  capabilities** (list/read/create/add/update/remove bounded elements) over this
  same service; agent writes are structured element ops, never raw JSON.
- **#1354** — the Web console reads/writes authoritative scenes through this API,
  with a scene selector and safe conflict handling built on `expectedRevision`.
- **#1355** — Codex and Claude use the identical Canvas capability contract to
  create and revise diagrams a user can then edit directly.
- **#1356** — optional `excalidraw-cli` layout/export via the Desktop Bridge
  allowlist, failing closed when the runtime is absent.

## Out of scope

Realtime multi-user collaboration (live cursors / CRDT merge) is explicitly out
of scope; optimistic revision sync is the collaboration model.
