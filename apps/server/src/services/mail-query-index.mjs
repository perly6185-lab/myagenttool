import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

export const MAIL_QUERY_INDEX_SCHEMA_VERSION = 2;

const DEFAULT_AUDIT_INTERVAL_MS = 5 * 60 * 1000;

export function mailQueryIndexPath(stateStorePath) {
  return resolve(dirname(stateStorePath), "indexes", "mail-query-v1.sqlite");
}

export async function openMailQueryIndexDatabase({ path }) {
  const { DatabaseSync } = await import("node:sqlite");
  if (path !== ":memory:") {
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const directoryInfo = lstatSync(directory);
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
      throw new Error("Mail query index directory is not a private directory.");
    }
    if (existsSync(path)) {
      const fileInfo = lstatSync(path);
      if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) {
        throw new Error("Mail query index path is not a regular file.");
      }
    }
  }
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  migrateMailQueryIndex(database);
  return database;
}

export function migrateMailQueryIndex(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS mail_query_meta(
      owner_team_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      built_at TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      content_digest TEXT,
      aggregate_digest TEXT,
      checked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS mail_query_messages(
      owner_team_id TEXT NOT NULL,
      message_key TEXT NOT NULL,
      message_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      folder_id TEXT NOT NULL,
      sort_at INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      unread INTEGER NOT NULL,
      smart_view TEXT NOT NULL,
      classified INTEGER NOT NULL,
      search_text TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      row_digest TEXT,
      PRIMARY KEY(owner_team_id, message_key)
    );
    CREATE INDEX IF NOT EXISTS mail_query_by_folder_recent
      ON mail_query_messages(owner_team_id, folder_id, sort_at DESC, ordinal ASC);
    CREATE INDEX IF NOT EXISTS mail_query_by_folder_view_recent
      ON mail_query_messages(owner_team_id, folder_id, smart_view, sort_at DESC, ordinal ASC);
    CREATE INDEX IF NOT EXISTS mail_query_by_folder_unread
      ON mail_query_messages(owner_team_id, folder_id, unread);
  `);
  addColumn(database, "mail_query_meta", "content_digest", "TEXT");
  addColumn(database, "mail_query_meta", "aggregate_digest", "TEXT");
  addColumn(database, "mail_query_meta", "checked_at", "TEXT");
  addColumn(database, "mail_query_messages", "row_digest", "TEXT");
}

function addColumn(database, table, column, type) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function createMailQueryIndex({
  database,
  now = () => new Date().toISOString(),
  auditIntervalMs = DEFAULT_AUDIT_INTERVAL_MS,
  onDiagnostic = () => {},
} = {}) {
  if (!database) return null;

  const readMeta = database.prepare(`
      SELECT fingerprint, row_count, built_at, schema_version, content_digest, aggregate_digest, checked_at
      FROM mail_query_meta
      WHERE owner_team_id = ?
    `);
  const countRows = database.prepare("SELECT COUNT(*) AS count FROM mail_query_messages WHERE owner_team_id = ?");
  const readDigests = database.prepare(`
    SELECT message_key, row_digest
    FROM mail_query_messages
    WHERE owner_team_id = ?
    ORDER BY message_key ASC
  `);
  const readAuditRows = database.prepare(`
    SELECT message_key, message_id, account_id, folder_id, sort_at, ordinal,
           unread, smart_view, classified, search_text, payload_json, row_digest
    FROM mail_query_messages
    WHERE owner_team_id = ?
    ORDER BY message_key ASC
  `);
  const readStoredRow = database.prepare(`
    SELECT message_key, message_id, account_id, folder_id, sort_at, ordinal,
           unread, smart_view, classified, search_text, payload_json, row_digest
    FROM mail_query_messages
    WHERE owner_team_id = ? AND message_key = ?
  `);
  const removeRows = database.prepare("DELETE FROM mail_query_messages WHERE owner_team_id = ?");
  const removeRow = database.prepare("DELETE FROM mail_query_messages WHERE owner_team_id = ? AND message_key = ?");
  const insertRow = database.prepare(`
    INSERT INTO mail_query_messages(
      owner_team_id, message_key, message_id, account_id, folder_id,
      sort_at, ordinal, unread, smart_view, classified, search_text, payload_json, row_digest
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_team_id, message_key) DO UPDATE SET
      message_id = excluded.message_id,
      account_id = excluded.account_id,
      folder_id = excluded.folder_id,
      sort_at = excluded.sort_at,
      ordinal = excluded.ordinal,
      unread = excluded.unread,
      smart_view = excluded.smart_view,
      classified = excluded.classified,
      search_text = excluded.search_text,
      payload_json = excluded.payload_json,
      row_digest = excluded.row_digest
  `);
  const writeMeta = database.prepare(`
    INSERT INTO mail_query_meta(
      owner_team_id, fingerprint, row_count, built_at, schema_version,
      content_digest, aggregate_digest, checked_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_team_id) DO UPDATE SET
      fingerprint = excluded.fingerprint,
      row_count = excluded.row_count,
      built_at = excluded.built_at,
      schema_version = excluded.schema_version,
      content_digest = excluded.content_digest,
      aggregate_digest = excluded.aggregate_digest,
      checked_at = excluded.checked_at
  `);
  const updateAudit = database.prepare(`
    UPDATE mail_query_meta
    SET checked_at = ?, content_digest = ?, aggregate_digest = ?, row_count = ?
    WHERE owner_team_id = ?
  `);

  function metaFor(teamId) {
    return readMeta.get(teamId) ?? null;
  }

  function replaceTeam(teamId, fingerprint, rows) {
    const prepared = prepareRows(rows);
    const timestamp = now();
    database.exec("BEGIN IMMEDIATE;");
    try {
      removeRows.run(teamId);
      for (const row of prepared) writePreparedRow(teamId, row);
      writeMeta.run(
        teamId, fingerprint, prepared.length, timestamp, MAIL_QUERY_INDEX_SCHEMA_VERSION,
        contentDigest(prepared), aggregateDigest(prepared), timestamp,
      );
      verifyStoredRows(teamId, prepared);
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
    return {
      mode: "rebuilt",
      inserted: prepared.length,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      total: prepared.length,
    };
  }

  function incrementTeam(teamId, fingerprint, rows, previousCheckedAt = null) {
    const prepared = prepareRows(rows);
    const existingRows = readDigests.all(teamId);
    const existing = new Map(existingRows.map((row) => [row.message_key, row.row_digest]));
    const currentKeys = new Set(prepared.map((row) => row.messageKey));
    const changed = prepared.filter((row) => existing.get(row.messageKey) !== row.rowDigest);
    const deleted = existingRows.filter((row) => !currentKeys.has(row.message_key));
    const insertedCount = changed.filter((row) => !existing.has(row.messageKey)).length;
    const updatedCount = changed.length - insertedCount;
    const timestamp = now();

    database.exec("BEGIN IMMEDIATE;");
    try {
      for (const row of changed) writePreparedRow(teamId, row);
      for (const row of deleted) removeRow.run(teamId, row.message_key);
      writeMeta.run(
        teamId, fingerprint, prepared.length, timestamp, MAIL_QUERY_INDEX_SCHEMA_VERSION,
        contentDigest(prepared), aggregateDigest(prepared), previousCheckedAt,
      );
      verifyIncrementalRows(teamId, prepared, changed);
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
    return {
      mode: "incremental",
      inserted: insertedCount,
      updated: updatedCount,
      deleted: deleted.length,
      unchanged: prepared.length - changed.length,
      total: prepared.length,
    };
  }

  function writePreparedRow(teamId, row) {
    insertRow.run(
      teamId,
      row.messageKey,
      row.messageId,
      row.accountId,
      row.folderId,
      row.sortAt,
      row.ordinal,
      row.unread,
      row.smartView,
      row.classified,
      row.searchText,
      row.payloadJson,
      row.rowDigest,
    );
  }

  function auditTeam(teamId, meta, { force = false } = {}) {
    const count = Number(countRows.get(teamId)?.count) || 0;
    if (count !== Number(meta?.row_count)) return { healthy: false, reason: "row_count" };
    if (!force && !auditDue(meta?.checked_at, now(), auditIntervalMs)) return { healthy: true, audited: false };
    const actual = storedPreparedRows(teamId);
    const digest = contentDigest(actual);
    if (!meta?.content_digest || digest !== meta.content_digest) return { healthy: false, reason: "content_digest" };
    const aggregates = aggregateDigestFromDatabase(database, teamId);
    if (!meta?.aggregate_digest || aggregates !== meta.aggregate_digest) return { healthy: false, reason: "aggregate_digest" };
    updateAudit.run(now(), digest, aggregates, count, teamId);
    return { healthy: true, audited: true };
  }

  function storedPreparedRows(teamId) {
    return readAuditRows.all(teamId).map((row) => ({
      messageKey: row.message_key,
      messageId: row.message_id,
      accountId: row.account_id,
      folderId: row.folder_id,
      sortAt: Number(row.sort_at) || 0,
      ordinal: Number(row.ordinal) || 0,
      unread: Number(row.unread) || 0,
      smartView: row.smart_view,
      classified: Number(row.classified) || 0,
      searchText: row.search_text,
      payloadJson: row.payload_json,
      rowDigest: rowDigest({
        messageKey: row.message_key,
        messageId: row.message_id,
        accountId: row.account_id,
        folderId: row.folder_id,
        sortAt: Number(row.sort_at) || 0,
        ordinal: Number(row.ordinal) || 0,
        unread: Number(row.unread) || 0,
        smartView: row.smart_view,
        classified: Number(row.classified) || 0,
        searchText: row.search_text,
        payloadJson: row.payload_json,
      }),
    }));
  }

  function verifyStoredRows(teamId, expected) {
    const actual = storedPreparedRows(teamId);
    if (actual.length !== expected.length) throw new Error("mail_query_index_row_count_mismatch");
    if (contentDigest(actual) !== contentDigest(expected)) throw new Error("mail_query_index_content_digest_mismatch");
    if (aggregateDigest(actual) !== aggregateDigest(expected)) throw new Error("mail_query_index_aggregate_digest_mismatch");
  }

  function verifyIncrementalRows(teamId, expected, changed) {
    const actualCount = Number(countRows.get(teamId)?.count) || 0;
    if (actualCount !== expected.length) throw new Error("mail_query_index_row_count_mismatch");
    if (aggregateDigestFromDatabase(database, teamId) !== aggregateDigest(expected)) {
      throw new Error("mail_query_index_aggregate_digest_mismatch");
    }
    for (const expectedRow of changed) {
      const stored = readStoredRow.get(teamId, expectedRow.messageKey);
      if (!stored) throw new Error("mail_query_index_changed_row_missing");
      const actualDigest = rowDigest({
        messageKey: stored.message_key,
        messageId: stored.message_id,
        accountId: stored.account_id,
        folderId: stored.folder_id,
        sortAt: Number(stored.sort_at) || 0,
        ordinal: Number(stored.ordinal) || 0,
        unread: Number(stored.unread) || 0,
        smartView: stored.smart_view,
        classified: Number(stored.classified) || 0,
        searchText: stored.search_text,
        payloadJson: stored.payload_json,
      });
      if (actualDigest !== expectedRow.rowDigest || stored.row_digest !== expectedRow.rowDigest) {
        throw new Error("mail_query_index_changed_row_mismatch");
      }
    }
  }

  function ensureCurrent({ teamId, fingerprint, buildRows }) {
    let meta = metaFor(teamId);
    if (!meta || Number(meta.schema_version) !== MAIL_QUERY_INDEX_SCHEMA_VERSION) {
      return replaceTeam(teamId, fingerprint, buildRows());
    }
    if (meta.fingerprint !== fingerprint) {
      const rows = buildRows();
      try {
        return incrementTeam(teamId, fingerprint, rows, meta.checked_at);
      } catch (error) {
        diagnostic({ kind: "repair", reason: "incremental_integrity", error });
        return { ...replaceTeam(teamId, fingerprint, rows), repaired: true, repairReason: "incremental_integrity" };
      }
    }
    const audit = auditTeam(teamId, meta);
    if (!audit.healthy) {
      diagnostic({ kind: "repair", reason: audit.reason });
      return { ...replaceTeam(teamId, fingerprint, buildRows()), repaired: true, repairReason: audit.reason };
    }
    return {
      mode: "reused", inserted: 0, updated: 0, deleted: 0,
      unchanged: Number(meta.row_count) || 0, total: Number(meta.row_count) || 0,
      audited: audit.audited === true,
    };
  }

  function query(input) {
    const maintenance = ensureCurrent(input);
    try {
      return readQuery(input, maintenance);
    } catch (error) {
      // A malformed derived payload or a drift that escaped the lightweight
      // audit is recoverable. Rebuild once from the authoritative projection;
      // persistent SQLite failures still escape so the mailbox can fail open.
      if (maintenance.mode === "rebuilt" || maintenance.repaired) throw error;
      diagnostic({ kind: "repair", reason: "query", error });
      const repaired = { ...replaceTeam(input.teamId, input.fingerprint, input.buildRows()), repaired: true, repairReason: "query" };
      return readQuery(input, repaired);
    }
  }

  function readQuery({ teamId, folderId, searchQuery = "", view = "all", page, pageSize, classifierVersion = 1 }, maintenance) {

    const baseWhere = "owner_team_id = ? AND folder_id = ? AND (? = '' OR instr(search_text, ?) > 0)";
    const baseParams = [teamId, folderId, searchQuery, searchQuery];
    const summaryRows = database.prepare(`
      SELECT smart_view, COUNT(*) AS count, SUM(classified) AS classified
      FROM mail_query_messages
      WHERE ${baseWhere}
      GROUP BY smart_view
    `).all(...baseParams);
    const counts = { all: 0, needs_attention: 0, important: 0, notifications: 0, subscriptions: 0, other: 0 };
    let classified = 0;
    for (const row of summaryRows) {
      const count = Number(row.count) || 0;
      counts.all += count;
      if (Object.hasOwn(counts, row.smart_view)) counts[row.smart_view] += count;
      classified += Number(row.classified) || 0;
    }

    const selectedWhere = view === "all" ? baseWhere : `${baseWhere} AND smart_view = ?`;
    const selectedParams = view === "all" ? baseParams : [...baseParams, view];
    const total = Number(database.prepare(`SELECT COUNT(*) AS count FROM mail_query_messages WHERE ${selectedWhere}`).get(...selectedParams)?.count) || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const selectedPage = Math.min(totalPages, Math.max(1, page));
    const offset = (selectedPage - 1) * pageSize;
    const messages = database.prepare(`
      SELECT payload_json
      FROM mail_query_messages
      WHERE ${selectedWhere}
      ORDER BY sort_at DESC, ordinal ASC
      LIMIT ? OFFSET ?
    `).all(...selectedParams, pageSize, offset).map((row) => JSON.parse(row.payload_json));
    const folderCounts = new Map(database.prepare(`
      SELECT folder_id, COUNT(*) AS count, SUM(unread) AS unread
      FROM mail_query_messages
      WHERE owner_team_id = ?
      GROUP BY folder_id
    `).all(teamId).map((row) => [row.folder_id, { count: Number(row.count) || 0, unread: Number(row.unread) || 0 }]));

    return {
      messages,
      folderCounts,
      classificationSummary: {
        counts,
        classified,
        pending: Math.max(0, counts.all - classified),
        classifierVersion,
      },
      pagination: { page: selectedPage, pageSize, total, totalPages, offset },
      rebuilt: maintenance.mode === "rebuilt",
      maintenance,
    };
  }

  return {
    query,
    audit(teamId, { repair = false, fingerprint = null, buildRows = null } = {}) {
      const meta = metaFor(teamId);
      if (!meta) return { healthy: true, empty: true };
      const result = auditTeam(teamId, meta, { force: true });
      if (result.healthy || !repair) return result;
      if (!fingerprint || typeof buildRows !== "function") return result;
      diagnostic({ kind: "repair", reason: result.reason });
      return { healthy: true, repaired: true, repairReason: result.reason, maintenance: replaceTeam(teamId, fingerprint, buildRows()) };
    },
    close: () => database.close(),
  };

  function diagnostic(value) {
    try {
      onDiagnostic({ kind: value.kind, reason: value.reason, errorCode: value.error?.code ?? null });
    } catch {
      // Diagnostics are optional and must never affect the derived query path.
    }
  }
}

function prepareRows(rows) {
  const byKey = new Map();
  for (const input of Array.isArray(rows) ? rows : []) {
    const messageKey = String(input?.messageKey ?? "");
    if (!messageKey) continue;
    const prepared = {
      messageKey,
      messageId: String(input?.messageId ?? ""),
      accountId: String(input?.accountId ?? "mail"),
      folderId: String(input?.folderId ?? "inbox"),
      sortAt: Number.isFinite(input?.sortAt) ? Number(input.sortAt) : 0,
      ordinal: Number.isInteger(input?.ordinal) ? input.ordinal : 0,
      unread: input?.unread === true ? 1 : 0,
      smartView: String(input?.smartView ?? "other"),
      classified: input?.classified === true ? 1 : 0,
      searchText: String(input?.searchText ?? ""),
      payloadJson: JSON.stringify(input?.payload ?? null),
    };
    prepared.rowDigest = rowDigest(prepared);
    byKey.set(messageKey, prepared);
  }
  return [...byKey.values()];
}

function rowDigest(row) {
  return digest([
    row.messageKey, row.messageId, row.accountId, row.folderId, row.sortAt,
    row.ordinal, row.unread, row.smartView, row.classified, row.searchText, row.payloadJson,
  ]);
}

function contentDigest(rows) {
  const hash = createHash("sha256");
  for (const row of [...rows].sort((left, right) => left.messageKey.localeCompare(right.messageKey))) {
    hash.update(row.messageKey);
    hash.update("\0");
    hash.update(row.rowDigest ?? "");
    hash.update("\0");
  }
  return hash.digest("hex");
}

function aggregateDigest(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.folderId}\0${row.smartView}`;
    const value = groups.get(key) ?? { count: 0, unread: 0, classified: 0 };
    value.count += 1;
    value.unread += Number(row.unread) || 0;
    value.classified += Number(row.classified) || 0;
    groups.set(key, value);
  }
  return digest([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function aggregateDigestFromDatabase(database, teamId) {
  const rows = database.prepare(`
    SELECT folder_id, smart_view, COUNT(*) AS count, SUM(unread) AS unread, SUM(classified) AS classified
    FROM mail_query_messages
    WHERE owner_team_id = ?
    GROUP BY folder_id, smart_view
    ORDER BY folder_id ASC, smart_view ASC
  `).all(teamId).map((row) => [
    `${row.folder_id}\0${row.smart_view}`,
    { count: Number(row.count) || 0, unread: Number(row.unread) || 0, classified: Number(row.classified) || 0 },
  ]);
  return digest(rows);
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function auditDue(checkedAt, current, intervalMs) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return true;
  const checked = Date.parse(checkedAt ?? "");
  const timestamp = Date.parse(current ?? "");
  return !Number.isFinite(checked) || !Number.isFinite(timestamp) || timestamp - checked >= intervalMs;
}
