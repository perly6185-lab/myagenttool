/*
 * Canvas scene contract (runtime mirror) — the durable, team-owned Excalidraw
 * scene the server persists authoritatively (#1352, Epic #1350). The browser
 * scene (#1351) is an offline draft; this is the source of truth. Bounds and the
 * embedded-URL policy are part of the API contract, so they live here (imported
 * by the server service) and are documented in docs/design/CANVAS_AGENT_INTEGRATION.md.
 */

/** Id prefix for a durable canvas scene, e.g. `cvs_0001`. */
export const canvasSceneIdPrefix = "cvs";

/** Id prefix for a server-assigned canvas element, e.g. `cel_0001` (#1353). */
export const canvasElementIdPrefix = "cel";

/**
 * Governed Canvas capability ids (#1353). Reads are low-risk; create/add/update
 * are medium (bounded schema + revision); remove is high-risk + approval-gated.
 */
export const canvasCapabilityIds = [
  "list",
  "get",
  "create",
  "add_elements",
  "update_elements",
  "remove_elements",
  "export",
];

/**
 * Payload bounds. Every write fails closed (400) when any bound is exceeded — a
 * scene is user/agent-authored content that must never grow heap or disk without
 * limit, and must never carry an unbounded element/text/binary count.
 */
export const canvasSceneBounds = {
  maxNameLength: 120,
  maxElements: 5000,
  /** Per text-bearing element (`text` / `label.text`). */
  maxTextLength: 20000,
  maxFiles: 100,
  /** Serialized `{ elements }` JSON. */
  maxSceneBytes: 5 * 1024 * 1024,
  /** Scene JSON + all binary file payloads combined. */
  maxAggregateBytes: 12 * 1024 * 1024,
};

/**
 * Embedded URLs (element links and binary file data) are restricted to this
 * scheme allowlist. `https:` covers external references; `data:` covers inlined
 * images. Everything else — `javascript:`, `http:`, `file:`, `blob:`,
 * `vbscript:` — is rejected so a stored scene can never carry an executable or
 * SSRF-prone reference. (#1352, medium policy.)
 */
export const canvasAllowedUrlSchemes = ["https:", "data:"];
