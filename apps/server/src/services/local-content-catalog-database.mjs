import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const LOCAL_CONTENT_CATALOG_SCHEMA_VERSION = 1;

export function localContentCatalogPath(stateStorePath) {
  return resolve(dirname(stateStorePath), "indexes", "local-content-catalog-v1.sqlite");
}

export async function openLocalContentCatalogDatabase({ path }) {
  const { DatabaseSync } = await import("node:sqlite");
  if (path !== ":memory:") {
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const directoryInfo = lstatSync(directory);
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
      throw new Error("Local content catalog directory is not a private directory.");
    }
    if (existsSync(path)) {
      const fileInfo = lstatSync(path);
      if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) {
        throw new Error("Local content catalog path is not a regular file.");
      }
    }
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrateLocalContentCatalog(db);
  return db;
}

export function migrateLocalContentCatalog(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_content_meta(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_content_records(
      id TEXT PRIMARY KEY,
      owner_team_id TEXT NOT NULL,
      project_id TEXT,
      work_item_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      search_text TEXT NOT NULL,
      search_body TEXT NOT NULL DEFAULT '',
      storage_mode TEXT NOT NULL,
      root_kind TEXT,
      root_id TEXT,
      relative_path TEXT,
      state_collection TEXT,
      state_id TEXT,
      mime_type TEXT,
      size INTEGER,
      sha256 TEXT,
      source_type TEXT,
      source_id TEXT,
      occurred_at TEXT,
      imported_at TEXT,
      modified_at TEXT,
      original_available INTEGER NOT NULL,
      unavailable_reason TEXT,
      index_status TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      content_signature TEXT,
      indexed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS local_content_by_team_kind
      ON local_content_records(owner_team_id, kind, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS local_content_by_team_project
      ON local_content_records(owner_team_id, project_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS local_content_by_work_item
      ON local_content_records(owner_team_id, work_item_id);
    CREATE INDEX IF NOT EXISTS local_content_by_hash
      ON local_content_records(owner_team_id, sha256);
    CREATE TABLE IF NOT EXISTS local_content_relations(
      id TEXT PRIMARY KEY,
      owner_team_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      FOREIGN KEY(source_id) REFERENCES local_content_records(id) ON DELETE CASCADE,
      FOREIGN KEY(target_id) REFERENCES local_content_records(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS local_content_relation_source
      ON local_content_relations(owner_team_id, source_id, relation_type);
    CREATE INDEX IF NOT EXISTS local_content_relation_target
      ON local_content_relations(owner_team_id, target_id, relation_type);
    CREATE VIRTUAL TABLE IF NOT EXISTS local_content_fts USING fts5(
      id UNINDEXED,
      title,
      summary,
      body,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TABLE IF NOT EXISTS local_content_index_jobs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reason TEXT NOT NULL,
      sources_json TEXT NOT NULL DEFAULT '["articles","mail","work_items"]',
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS local_content_index_jobs_status
      ON local_content_index_jobs(status, requested_at);
  `);
  const columns = db.prepare("PRAGMA table_info(local_content_records)").all();
  if (!columns.some((column) => column.name === "content_signature")) {
    db.exec("ALTER TABLE local_content_records ADD COLUMN content_signature TEXT;");
  }
  if (!columns.some((column) => column.name === "search_body")) {
    db.exec("ALTER TABLE local_content_records ADD COLUMN search_body TEXT NOT NULL DEFAULT '';");
  }
  const jobColumns = db.prepare("PRAGMA table_info(local_content_index_jobs)").all();
  if (!jobColumns.some((column) => column.name === "sources_json")) {
    db.exec("ALTER TABLE local_content_index_jobs ADD COLUMN sources_json TEXT NOT NULL DEFAULT '[\"articles\",\"mail\",\"work_items\"]';");
  }
  db.prepare("UPDATE local_content_index_jobs SET status = 'queued', started_at = NULL WHERE status = 'running'").run();
  const current = db.prepare("SELECT value FROM local_content_meta WHERE key = 'schema_version'").get();
  if (current && Number(current.value) !== LOCAL_CONTENT_CATALOG_SCHEMA_VERSION) {
    throw new Error(`Unsupported local content catalog schema ${current.value}.`);
  }
  db.prepare("INSERT OR REPLACE INTO local_content_meta(key, value) VALUES('schema_version', ?)")
    .run(String(LOCAL_CONTENT_CATALOG_SCHEMA_VERSION));
}
