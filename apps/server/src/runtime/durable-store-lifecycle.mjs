import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function sqlitePathForState(stateStorePath) {
  return `${stateStorePath.replace(/\.json$/, "")}.sqlite`;
}

/**
 * Opens the requested durable store without exposing adapter loading or fallback
 * decisions to the server entry point. SQLite remains the normal backing. Any
 * non-SQLite request preserves the legacy JSON path, while a failed SQLite open
 * degrades loudly and returns structured startup evidence.
 */
export async function openDurableStoreLifecycle({
  persistenceEnabled,
  requestedStore = "sqlite",
  stateStorePath,
  openSqlite = defaultOpenSqlite,
  logger = console,
}) {
  const normalizedRequest = String(requestedStore ?? "sqlite").trim().toLowerCase();
  if (!persistenceEnabled) {
    return inactiveLifecycle({ backing: "memory", requested: normalizedRequest, reason: "persistence_disabled" });
  }
  if (normalizedRequest !== "sqlite") {
    return inactiveLifecycle({ backing: "json", requested: normalizedRequest, reason: "sqlite_not_requested" });
  }

  const path = sqlitePathForState(stateStorePath);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const store = await openSqlite({ path });
    logger.log(`[store:sqlite] durable backing at ${path}`);
    let closed = false;
    return {
      store,
      backing: "sqlite",
      path,
      close() {
        if (closed) return;
        closed = true;
        store.close();
      },
      diagnostic: Object.freeze({
        requested: normalizedRequest,
        backing: "sqlite",
        status: "ready",
        path,
        reason: null,
      }),
    };
  } catch (error) {
    const reason = error?.message ?? String(error);
    logger.warn(`[store:sqlite] requested but unavailable (${reason}); falling back to the JSON snapshot backing.`);
    return inactiveLifecycle({
      backing: "json",
      requested: normalizedRequest,
      reason: "sqlite_unavailable",
      error: reason,
      path,
    });
  }
}

function inactiveLifecycle({ backing, requested, reason, error = null, path = null }) {
  return {
    store: null,
    backing,
    path,
    close() {},
    diagnostic: Object.freeze({
      requested,
      backing,
      status: backing === "memory" ? "disabled" : "fallback",
      path,
      reason,
      error,
    }),
  };
}

async function defaultOpenSqlite(options) {
  const { openSqliteStore } = await import("./store/sqlite-store.mjs");
  return openSqliteStore(options);
}
