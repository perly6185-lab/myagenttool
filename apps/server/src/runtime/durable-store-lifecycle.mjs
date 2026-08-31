import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export class DurableStoreStartupError extends Error {
  constructor(message, { code, cause, diagnostic }) {
    super(message, { cause });
    this.name = "DurableStoreStartupError";
    this.code = code;
    this.diagnostic = Object.freeze(diagnostic);
  }
}

export function sqlitePathForState(stateStorePath) {
  return `${stateStorePath.replace(/\.json$/, "")}.sqlite`;
}

/**
 * Opens the production durable store without exposing adapter loading to the
 * server entry point. Persistence-enabled runtimes are SQLite-only: selecting a
 * different adapter or failing to open SQLite aborts startup instead of silently
 * serving an older JSON export as current state.
 */
export async function openDurableStoreLifecycle({
  persistenceEnabled,
  requestedStore = "sqlite",
  stateStorePath,
  openSqlite = defaultOpenSqlite,
  logger = console,
  now = () => new Date().toISOString(),
}) {
  const normalizedRequest = String(requestedStore ?? "sqlite").trim().toLowerCase();
  if (!persistenceEnabled) {
    return inactiveLifecycle({ backing: "memory", requested: normalizedRequest, reason: "persistence_disabled" });
  }
  if (normalizedRequest !== "sqlite") {
    const diagnostic = {
      requested: normalizedRequest,
      backing: null,
      status: "failed",
      path: null,
      reason: "unsupported_durable_store",
      error: `Persistence-enabled runtimes require SQLite; received ${normalizedRequest || "an empty store name"}.`,
    };
    const startupError = new DurableStoreStartupError(diagnostic.error, {
      code: diagnostic.reason,
      diagnostic,
    });
    logStartupFailure(logger, `[store:sqlite] ${startupError.message}`);
    throw startupError;
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
    let recoveryDirectory = null;
    let backupError = null;
    if (error?.code === "sqlite_integrity_failed") {
      try {
        recoveryDirectory = backupSqliteStoreFiles({ path, now });
      } catch (copyError) {
        backupError = copyError?.message ?? String(copyError);
      }
    }
    const code = error?.code === "sqlite_integrity_failed"
      ? "durable_store_integrity_failed"
      : "durable_store_open_failed";
    const backupDetail = recoveryDirectory
      ? ` A forensic copy was saved at ${recoveryDirectory}.`
      : backupError
        ? ` The forensic copy also failed (${backupError}).`
        : "";
    const diagnostic = {
      requested: normalizedRequest,
      backing: null,
      status: "failed",
      path,
      reason: code,
      error: reason,
      recoveryDirectory,
      backupError,
    };
    const startupError = new DurableStoreStartupError(
      `SQLite durable state at ${path} could not be opened (${reason}).${backupDetail} Startup was aborted; the JSON export was not loaded as live state.`,
      { code, cause: error, diagnostic },
    );
    logStartupFailure(logger, `[store:sqlite] ${startupError.message}`);
    throw startupError;
  }
}

export function backupSqliteStoreFiles({ path, now = () => new Date().toISOString() }) {
  const sources = [path, `${path}-wal`, `${path}-shm`].filter((candidate) => existsSync(candidate));
  if (sources.length === 0) return null;

  const stamp = String(now()).replace(/[^0-9A-Za-z_-]/g, "-");
  const base = `${path}.recovery-${stamp}`;
  let recoveryDirectory = base;
  for (let suffix = 2; existsSync(recoveryDirectory); suffix += 1) {
    recoveryDirectory = `${base}-${suffix}`;
  }
  mkdirSync(recoveryDirectory, { recursive: false, mode: 0o700 });
  for (const source of sources) {
    const destination = join(recoveryDirectory, basename(source));
    copyFileSync(source, destination);
    chmodSync(destination, 0o600);
  }
  return recoveryDirectory;
}

function logStartupFailure(logger, message) {
  if (typeof logger?.error === "function") {
    logger.error(message);
  } else {
    logger?.warn?.(message);
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
      status: "disabled",
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
