import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

// On-disk archive for rows evicted by in-memory caps. The caps keep /api/state
// lean, but audit-critical collections (recovery actions, approval broker
// requests, consumed approval grants) must not lose history SILENTLY — an
// evicted row is appended as one JSONL line to
// <stateDir>/archive/<collection>.jsonl before the cap drops it. Append-only,
// best-effort (archival must never break the write path), greppable offline.

export function createRetentionArchive({ stateStorePath, enabled = true, now = () => new Date().toISOString(), appendHistory = null }) {
  const archiveDir = join(dirname(stateStorePath ?? "."), "archive");
  const invocationEventArchiveDir = join(archiveDir, "events-by-invocation");
  let eventHighWater = null;

  // ADR 0019 B-2: dual-write evicted rows to the durable, indexed history table
  // when a SQLite store is present, alongside the JSONL. Best-effort — a store
  // failure never breaks the archive (the JSONL stays authoritative on rollback).
  function dualWriteHistory(collection, rows) {
    if (typeof appendHistory !== "function") return;
    try {
      appendHistory(collection, rows);
    } catch {
      /* best-effort — the JSONL line already landed */
    }
  }

  function archiveEvicted(collection, rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: true, archivedCount: 0, error: null };
    }
    if (!enabled) {
      return { ok: false, archivedCount: 0, error: "archive_disabled" };
    }
    try {
      ensureDirectoryDurableSync(archiveDir);
      const archivedAt = now();
      const lines = rows.map((row) => JSON.stringify({ archivedAt, collection, row }));
      durableAppendFileSync(join(archiveDir, `${collection}.jsonl`), `${lines.join("\n")}\n`);
      dualWriteHistory(collection, rows);
      return { ok: true, archivedCount: rows.length, error: null };
    } catch (error) {
      // Disk full / permissions: the in-memory cap still applies; losing the
      // archive line is strictly no worse than the silent eviction it replaces.
      return {
        ok: false,
        archivedCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Read the durable event-id floor before the shared id allocator starts.
   * Every invocation shard is fsynced before its event leaves the hot ring, so
   * its maximum archived id is itself the high-water record. Scanning occurs
   * once during startup, never on the live detail-request path.
   */
  function prepareInvocationEventArchive() {
    if (eventHighWater) return eventHighWater;
    if (!enabled) {
      eventHighWater = { maxOrdinal: 0, readError: null };
      return eventHighWater;
    }

    let files;
    try {
      files = readdirSync(invocationEventArchiveDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        eventHighWater = { maxOrdinal: 0, readError: null };
      } else {
        eventHighWater = {
          maxOrdinal: 0,
          readError: error instanceof Error ? error.message : String(error),
        };
      }
      return eventHighWater;
    }

    let maxOrdinal = 0;
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      let text;
      try {
        text = readFileSync(join(invocationEventArchiveDir, file.name), "utf8");
      } catch (error) {
        eventHighWater = {
          maxOrdinal: 0,
          readError: error instanceof Error ? error.message : String(error),
        };
        return eventHighWater;
      }
      // These are dedicated invocation-event shards, so boot only needs a
      // conservative numeric-id floor. Avoid JSON.parse for every archived row:
      // a mature local instance can hold tens of thousands of events across
      // thousands of shards, and parsing their complete payloads delayed the
      // HTTP listener long enough for the desktop readiness timeout to abort.
      // Scanning every intact id token is fail-safe: nested ids may raise the
      // allocator floor, but can never lower it or permit an id collision; torn
      // final rows still contribute any intact prefix exactly as before.
      for (const match of text.matchAll(/"id"\s*:\s*"[^"]*_(\d+)"/g)) {
        const ordinal = Number(match[1]);
        if (Number.isSafeInteger(ordinal) && ordinal >= 0) {
          maxOrdinal = Math.max(maxOrdinal, ordinal);
        }
      }
    }
    eventHighWater = { maxOrdinal, readError: null };
    return eventHighWater;
  }

  /**
   * Durable writer used only by the hot invocation-event ring. Event rows are
   * sharded by a hash of invocation id, so a live detail poll reads one run's
   * file rather than synchronously scanning the unbounded global archive.
   */
  function archiveInvocationEvents(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: true, archivedCount: 0, error: null };
    }
    if (!enabled) {
      return { ok: false, archivedCount: 0, error: "archive_disabled" };
    }
    const prepared = prepareInvocationEventArchive();
    if (prepared.readError) {
      return { ok: false, archivedCount: 0, error: prepared.readError };
    }

    const ordinals = rows.map((row) => numericIdOrdinal(row?.id));
    if (ordinals.some((ordinal) => ordinal === null)) {
      return { ok: false, archivedCount: 0, error: "event_archive_id_has_no_numeric_ordinal" };
    }

    try {
      ensureDirectoryDurableSync(archiveDir);
      ensureDirectoryDurableSync(invocationEventArchiveDir);
      const archivedAt = now();
      const byInvocation = new Map();
      for (const row of rows) {
        if (typeof row?.invocationId !== "string" || !row.invocationId) continue;
        const grouped = byInvocation.get(row.invocationId) ?? [];
        grouped.push(row);
        byInvocation.set(row.invocationId, grouped);
      }
      for (const [invocationId, invocationRows] of byInvocation) {
        invocationRows.sort((left, right) => numericIdOrdinal(left.id) - numericIdOrdinal(right.id));
        const lines = invocationRows.map((row) => JSON.stringify({ archivedAt, collection: "events", row }));
        // Start on a fresh line even if a crash left a torn final JSON row.
        // Empty lines after normal appends are ignored by readers.
        durableAppendFileSync(invocationEventPath(invocationId), `\n${lines.join("\n")}\n`);
      }
      prepared.maxOrdinal = Math.max(prepared.maxOrdinal, ...ordinals);
      return {
        ok: true,
        archivedCount: [...byInvocation.values()].reduce((total, invocationRows) => total + invocationRows.length, 0),
        error: null,
      };
    } catch (error) {
      return {
        ok: false,
        archivedCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function readInvocationEventArchive(invocationId) {
    if (!enabled) return { entries: [], malformedLines: 0, readError: null };
    let text;
    try {
      text = readFileSync(invocationEventPath(invocationId), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return { entries: [], malformedLines: 0, readError: null };
      return {
        entries: [],
        malformedLines: 0,
        readError: error instanceof Error ? error.message : String(error),
      };
    }

    const entries = [];
    let malformedLines = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        malformedLines += 1;
        continue;
      }
      if (
        !parsed
        || parsed.collection !== "events"
        || !parsed.row
        || parsed.row.invocationId !== invocationId
      ) {
        malformedLines += 1;
        continue;
      }
      entries.push({ archivedAt: parsed.archivedAt ?? null, row: parsed.row });
    }
    return { entries, malformedLines, readError: null };
  }

  function invocationEventPath(invocationId) {
    const shard = createHash("sha256").update(String(invocationId)).digest("hex");
    return join(invocationEventArchiveDir, `${shard}.jsonl`);
  }

  /** Cap a list, archiving (not dropping) the overflow. Returns the capped list. */
  function capWithArchive(list, max, collection) {
    if (!Array.isArray(list) || list.length <= max) return Array.isArray(list) ? list : [];
    archiveEvicted(collection, list.slice(max));
    return list.slice(0, max);
  }

  /**
   * The read half of the archive — the loop the audit trail was missing: what the
   * cap evicted is recoverable, not just greppable by hand. Reads the whole
   * append-only file, skips torn lines, applies an optional row filter, and returns
   * the most-recently-archived `limit` matches newest-first as `{ archivedAt, row }`.
   * Ordered by archivedAt, NOT file position: one eviction batch is written
   * newest-first, so raw file order would misrank within a batch; the sort is
   * stable, so a batch's own order is preserved when stamps tie. Best-effort: no
   * file yet → honest empty, never a throw. Reading the full file is fine for an
   * occasional audit; a tail-read is the follow-up if archives outgrow memory.
   */
  function readArchiveWithMetadata(collection, { filter = null } = {}) {
    let text;
    try {
      text = readFileSync(join(archiveDir, `${collection}.jsonl`), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { entries: [], malformedLines: 0, readError: null };
      }
      return {
        entries: [],
        malformedLines: 0,
        readError: error instanceof Error ? error.message : String(error),
      };
    }
    const matches = [];
    let malformedLines = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        malformedLines += 1;
        continue; // a torn final line from a crash mid-append — skip, don't fail
      }
      if (!parsed || parsed.collection !== collection || !("row" in parsed)) {
        malformedLines += 1;
        continue;
      }
      try {
        if (filter && !filter(parsed.row)) continue;
      } catch {
        malformedLines += 1;
        continue;
      }
      matches.push({ archivedAt: parsed.archivedAt ?? null, row: parsed.row });
    }
    matches.sort((a, b) => String(b.archivedAt ?? "").localeCompare(String(a.archivedAt ?? "")));
    return { entries: matches, malformedLines, readError: null };
  }

  function readArchive(collection, { filter = null, limit = 50 } = {}) {
    const { entries } = readArchiveWithMetadata(collection, { filter });
    return entries.slice(0, Math.max(1, limit));
  }

  return {
    archiveEvicted,
    archiveInvocationEvents,
    capWithArchive,
    prepareInvocationEventArchive,
    readArchive,
    readArchiveWithMetadata,
    readInvocationEventArchive,
    archiveDir,
    invocationEventArchiveDir,
  };
}

// Append the whole eviction batch and force it to stable storage before the hot
// collection is trimmed. A crash after this point may leave the same row in the
// archive and the previous state snapshot; detail readers deliberately de-dupe
// by row id, making that safe.
function durableAppendFileSync(path, data) {
  const bytes = Buffer.from(data);
  const created = !existsSync(path);
  const fd = openSync(path, "a");
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new Error("archive_write_made_no_progress");
      offset += written;
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  // Persist a newly-created archive file's directory entry once. Re-fsyncing the
  // unchanged directory for every subsequent event needlessly stalls the Node
  // event loop; the file itself is still fsynced on every durable append.
  if (!created) return;
  fsyncDirectorySync(dirname(path));
}

function ensureDirectoryDurableSync(path) {
  if (existsSync(path)) return;
  mkdirSync(path, { recursive: true });
  fsyncDirectorySync(dirname(path));
}

function fsyncDirectorySync(path) {
  let dirFd;
  try {
    dirFd = openSync(path, "r");
    fsyncSync(dirFd);
  } catch {
    // Best effort for platforms without directory fsync support.
  } finally {
    if (dirFd !== undefined) closeSync(dirFd);
  }
}

function numericIdOrdinal(id) {
  const match = typeof id === "string" ? /_(\d+)$/.exec(id) : null;
  if (!match) return null;
  const ordinal = Number(match[1]);
  return Number.isSafeInteger(ordinal) && ordinal >= 0 ? ordinal : null;
}
