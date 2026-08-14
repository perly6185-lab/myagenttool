import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { LOCAL_TEAM_ID, teamOf } from "../runtime/auth.mjs";

export const LOCAL_CONTENT_CATALOG_SCHEMA_VERSION = 1;
export const LOCAL_CONTENT_KINDS = new Set(["article", "mail", "task", "task_input", "task_output"]);

const MAX_EXTRACTED_BYTES = 256 * 1024;
const MAX_SEARCH_TEXT = 300_000;
const MAX_SEARCH_QUERY = 500;
const MAX_SEARCH_LIMIT = 100;

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
  `);
  const current = db.prepare("SELECT value FROM local_content_meta WHERE key = 'schema_version'").get();
  if (current && Number(current.value) !== LOCAL_CONTENT_CATALOG_SCHEMA_VERSION) {
    throw new Error(`Unsupported local content catalog schema ${current.value}.`);
  }
  db.prepare("INSERT OR REPLACE INTO local_content_meta(key, value) VALUES('schema_version', ?)")
    .run(String(LOCAL_CONTENT_CATALOG_SCHEMA_VERSION));
}

export function createLocalContentCatalogService({
  state,
  stateStorePath,
  now = () => new Date().toISOString(),
  databasePath = localContentCatalogPath(stateStorePath),
  openDatabase = openLocalContentCatalogDatabase,
} = {}) {
  let databasePromise = null;

  const database = () => {
    databasePromise ??= Promise.resolve(openDatabase({ path: databasePath }));
    return databasePromise;
  };

  async function rebuild(_input = {}, actor = null) {
    const db = await database();
    const built = collectLocalContent({ state, stateStorePath, indexedAt: now() });
    replaceCatalog(db, built);
    const teamId = actor?.teamId ?? LOCAL_TEAM_ID;
    return {
      status: 200,
      body: {
        catalog: summarizeCatalog(db, teamId),
        rebuild: {
          records: built.records.filter((record) => record.ownerTeamId === teamId).length,
          relations: built.relations.filter((relation) => relation.ownerTeamId === teamId).length,
          indexedAt: built.indexedAt,
          originalFilesChanged: false,
        },
      },
    };
  }

  async function stats(actor = null) {
    const db = await database();
    return { status: 200, body: { catalog: summarizeCatalog(db, actor?.teamId ?? LOCAL_TEAM_ID) } };
  }

  async function search({ query = "", kinds = [], projectId = null, limit = 30, offset = 0 } = {}, actor = null) {
    const teamId = actor?.teamId ?? LOCAL_TEAM_ID;
    const normalizedProjectId = projectId == null || projectId === "" ? null : String(projectId);
    if (normalizedProjectId) {
      const project = (state.projects ?? []).find((item) => item.id === normalizedProjectId);
      if (!project || teamOf(project) !== teamId) {
        return { status: 404, body: { error: "project_not_found" } };
      }
    }
    const normalizedKinds = normalizeKinds(kinds);
    if (!normalizedKinds.ok) return { status: 400, body: { error: "local_content_kind_invalid" } };
    const normalizedQuery = normalizeQuery(query);
    const boundedLimit = Math.min(MAX_SEARCH_LIMIT, Math.max(1, Number.parseInt(limit, 10) || 30));
    const boundedOffset = Math.min(10_000, Math.max(0, Number.parseInt(offset, 10) || 0));
    const db = await database();
    const rows = searchCatalog(db, {
      teamId,
      projectId: normalizedProjectId,
      kinds: normalizedKinds.value,
      query: normalizedQuery,
      limit: boundedLimit,
      offset: boundedOffset,
    });
    const results = publicRecordsWithRelations(db, rows, teamId);
    return {
      status: 200,
      body: {
        results,
        count: results.length,
        query: normalizedQuery,
        limit: boundedLimit,
        offset: boundedOffset,
        hasMore: results.length === boundedLimit,
        retrieval: { mode: normalizedQuery ? "fts_with_metadata_fallback" : "metadata_recent", offline: true },
      },
    };
  }

  async function close() {
    if (!databasePromise) return;
    const db = await databasePromise;
    db.close();
    databasePromise = null;
  }

  return { rebuild, search, stats, close, databasePath };
}

export function collectLocalContent({ state, stateStorePath, indexedAt }) {
  const records = [];
  const relations = [];
  const byKey = new Map();
  const tasks = new Map();
  const articlePaths = new Map();
  const dataRoot = resolve(dirname(stateStorePath));

  const addRecord = (record, key = null) => {
    if (records.some((candidate) => candidate.id === record.id)) return record.id;
    records.push(record);
    if (key) byKey.set(key, record.id);
    return record.id;
  };
  const addRelation = (ownerTeamId, sourceId, targetId, relationType, metadata = {}) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    relations.push({
      id: contentId("relation", ownerTeamId, sourceId, targetId, relationType),
      ownerTeamId,
      sourceId,
      targetId,
      relationType,
      metadata,
    });
  };

  for (const item of state.workItems ?? []) {
    const project = (state.projects ?? []).find((candidate) => candidate.id === item.projectId);
    const ownerTeamId = item.ownerTeamId ?? teamOf(project);
    const id = contentId("task", ownerTeamId, item.id);
    const body = [item.body, ...(item.acceptanceCriteria ?? []), ...(item.labels ?? [])].filter(Boolean).join("\n");
    addRecord(catalogRecord({
      id,
      ownerTeamId,
      projectId: item.projectId ?? null,
      workItemId: item.id,
      kind: "task",
      title: item.title || item.localRef || "Local task",
      body,
      summary: boundedSummary(body, item.localRef || "Local task"),
      storageMode: "state_record",
      stateCollection: "workItems",
      stateId: item.id,
      sourceType: "local_task",
      sourceId: item.localRef ?? item.id,
      occurredAt: item.createdAt ?? item.updatedAt ?? null,
      importedAt: item.createdAt ?? null,
      modifiedAt: item.updatedAt ?? null,
      originalAvailable: true,
      indexStatus: "ready",
      metadata: { localRef: item.localRef ?? null, status: item.status ?? item.state ?? null },
      indexedAt,
    }), `task:${item.id}`);
    tasks.set(item.id, { item, ownerTeamId, contentId: id, project });
  }

  for (const job of state.articleImportJobs ?? []) {
    if (job.state !== "completed" || !job.result?.markdownPath) continue;
    const task = tasks.get(job.workItemId);
    if (!task) continue;
    const root = contentRootFor(state, task.item, { worktreeId: job.worktreeId });
    const path = safeRelativePath(job.result.markdownPath);
    const inspected = inspectOriginal(root?.path, path);
    const body = inspected.available ? readBoundedText(inspected.absolutePath, inspected.size) : "";
    const title = articleTitle(body) || task.item.title || basename(path || "article.md");
    const id = contentId("article", task.ownerTeamId, job.id);
    addRecord(catalogRecord({
      id,
      ownerTeamId: task.ownerTeamId,
      projectId: task.item.projectId ?? null,
      workItemId: task.item.id,
      kind: "article",
      title,
      body,
      summary: boundedSummary(body, title),
      storageMode: "referenced",
      rootKind: root?.kind ?? "worktree",
      rootId: root?.id ?? job.worktreeId ?? null,
      relativePath: path,
      mimeType: "text/markdown",
      size: inspected.size,
      sha256: inspected.available ? fileDigest(inspected.absolutePath, inspected.size) : null,
      sourceType: "article_import",
      sourceId: job.canonicalUrl ?? job.sourceUrl ?? job.id,
      occurredAt: job.completedAt ?? job.createdAt ?? null,
      importedAt: job.completedAt ?? null,
      modifiedAt: inspected.modifiedAt,
      originalAvailable: inspected.available,
      unavailableReason: inspected.reason,
      indexStatus: inspected.available ? "ready" : "missing",
      metadata: {
        articleImportJobId: job.id,
        canonicalUrl: job.canonicalUrl ?? null,
        manifestPath: job.result.manifestPath ?? null,
        htmlPath: job.result.htmlPath ?? null,
      },
      indexedAt,
    }), rootPathKey(root, path));
    articlePaths.set(rootPathKey(root, path), id);
    addRelation(task.ownerTeamId, task.contentId, id, "produces_output");
  }

  for (const task of tasks.values()) {
    for (const asset of task.item.inputAssets ?? []) {
      const source = taskInputSource(state, stateStorePath, task.item, asset);
      const id = contentId("task_input", task.ownerTeamId, task.item.id, asset.id ?? asset.path);
      addRecord(assetRecord({
        id,
        ownerTeamId: task.ownerTeamId,
        projectId: task.item.projectId ?? null,
        workItemId: task.item.id,
        kind: "task_input",
        asset,
        source,
        taskTitle: task.item.title,
        indexedAt,
      }), rootPathKey(source, source.relativePath));
      addRelation(task.ownerTeamId, task.contentId, id, "uses_input");
    }
    for (const asset of task.item.outputAssets ?? []) {
      const source = taskAssetSource(state, task.item, asset);
      const key = rootPathKey(source, source.relativePath);
      const articleId = articlePaths.get(key);
      if (articleId) {
        addRelation(task.ownerTeamId, task.contentId, articleId, "produces_output");
        continue;
      }
      const id = contentId("task_output", task.ownerTeamId, task.item.id, asset.id ?? asset.path);
      addRecord(assetRecord({
        id,
        ownerTeamId: task.ownerTeamId,
        projectId: task.item.projectId ?? null,
        workItemId: task.item.id,
        kind: "task_output",
        asset,
        source,
        taskTitle: task.item.title,
        indexedAt,
      }), key);
      addRelation(task.ownerTeamId, task.contentId, id, "produces_output");
    }
  }

  const mailByMessage = collectMailMessages(state);
  for (const mail of mailByMessage.values()) {
    const id = contentId("mail", mail.ownerTeamId, mail.messageId);
    const archived = validMailArchiveReceipt(mail.archive);
    addRecord(catalogRecord({
      id,
      ownerTeamId: mail.ownerTeamId,
      projectId: null,
      workItemId: null,
      kind: "mail",
      title: mail.subject || "(no subject)",
      body: mail.body ?? "",
      summary: boundedSummary(mail.body, mail.from || "Mail message"),
      storageMode: archived ? "managed" : "state_record",
      rootKind: archived ? "mail_archive" : null,
      rootId: archived ? mail.archive.ref : null,
      stateCollection: "applicationResults",
      stateId: mail.recordId,
      mimeType: archived ? "message/rfc822" : null,
      size: archived ? mail.archive.size : null,
      sha256: archived ? mail.archive.sha256 : null,
      sourceType: archived ? "mail_archive" : "mail_cache",
      sourceId: mail.messageId,
      occurredAt: mail.date ?? mail.createdAt ?? null,
      importedAt: mail.createdAt ?? null,
      modifiedAt: mail.updatedAt ?? mail.createdAt ?? null,
      originalAvailable: archived,
      unavailableReason: archived ? null : mail.archive?.reason ?? "mail_original_not_archived",
      indexStatus: archived ? "ready" : "partial",
      metadata: {
        from: mail.from ?? null,
        folderId: mail.folderId ?? null,
        hasHtml: Boolean(mail.bodyHtml),
        attachmentCount: mail.attachments?.length ?? 0,
        archiveAvailability: mail.archive?.availability ?? "not_archived",
      },
      indexedAt,
    }), `mail:${mail.ownerTeamId}:${mail.messageId}`);
  }

  for (const link of state.mailTaskLinks ?? []) {
    const task = tasks.get(link.workItemId);
    if (!task) continue;
    const mailId = byKey.get(`mail:${task.ownerTeamId}:${link.messageId}`);
    addRelation(task.ownerTeamId, mailId, task.contentId, "converted_to_task");
  }

  const firstByHash = new Map();
  for (const record of records) {
    if (!record.sha256) continue;
    const key = `${record.ownerTeamId}:${record.sha256}`;
    const first = firstByHash.get(key);
    if (first) addRelation(record.ownerTeamId, first, record.id, "same_content");
    else firstByHash.set(key, record.id);
  }

  return { records, relations: dedupeRelations(relations), indexedAt, dataRoot };
}

function replaceCatalog(db, { records, relations, indexedAt }) {
  const insertRecord = db.prepare(`
    INSERT INTO local_content_records(
      id, owner_team_id, project_id, work_item_id, kind, title, summary, search_text,
      storage_mode, root_kind, root_id, relative_path, state_collection, state_id,
      mime_type, size, sha256, source_type, source_id, occurred_at, imported_at,
      modified_at, original_available, unavailable_reason, index_status, metadata_json, indexed_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = db.prepare("INSERT INTO local_content_fts(id, title, summary, body) VALUES(?, ?, ?, ?)");
  const insertRelation = db.prepare(`
    INSERT INTO local_content_relations(id, owner_team_id, source_id, target_id, relation_type, metadata_json)
    VALUES(?, ?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM local_content_relations; DELETE FROM local_content_fts; DELETE FROM local_content_records;");
    for (const record of records) {
      insertRecord.run(
        record.id, record.ownerTeamId, record.projectId, record.workItemId, record.kind,
        record.title, record.summary, record.searchText, record.storageMode, record.rootKind,
        record.rootId, record.relativePath, record.stateCollection, record.stateId, record.mimeType,
        record.size, record.sha256, record.sourceType, record.sourceId, record.occurredAt,
        record.importedAt, record.modifiedAt, record.originalAvailable ? 1 : 0,
        record.unavailableReason, record.indexStatus, JSON.stringify(record.metadata), record.indexedAt,
      );
      insertFts.run(record.id, record.title, record.summary, record.searchBody);
    }
    for (const relation of relations) {
      insertRelation.run(
        relation.id,
        relation.ownerTeamId,
        relation.sourceId,
        relation.targetId,
        relation.relationType,
        JSON.stringify(relation.metadata),
      );
    }
    db.prepare("INSERT OR REPLACE INTO local_content_meta(key, value) VALUES('last_rebuilt_at', ?)").run(indexedAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function searchCatalog(db, { teamId, projectId, kinds, query, limit, offset }) {
  const filters = ["r.owner_team_id = ?"];
  const params = [teamId];
  if (projectId) {
    filters.push("r.project_id = ?");
    params.push(projectId);
  }
  if (kinds.length) {
    filters.push(`r.kind IN (${kinds.map(() => "?").join(", ")})`);
    params.push(...kinds);
  }
  const where = filters.join(" AND ");
  if (!query) {
    return db.prepare(`
      SELECT r.*, 0 AS rank FROM local_content_records r
      WHERE ${where}
      ORDER BY COALESCE(r.occurred_at, r.imported_at, r.modified_at, r.indexed_at) DESC, r.id
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
  }

  const targetCount = Math.min(10_100, limit + offset);
  const rows = [];
  const seen = new Set();
  const match = ftsQuery(query);
  if (match) {
    try {
      const ftsRows = db.prepare(`
        SELECT r.*, bm25(local_content_fts, 8.0, 3.0, 1.0) AS rank
        FROM local_content_fts
        JOIN local_content_records r ON r.id = local_content_fts.id
        WHERE local_content_fts MATCH ? AND ${where}
        ORDER BY rank, COALESCE(r.occurred_at, r.imported_at, r.indexed_at) DESC
        LIMIT ?
      `).all(match, ...params, targetCount);
      for (const row of ftsRows) {
        rows.push(row);
        seen.add(row.id);
      }
    } catch {
      // Bounded metadata fallback below is the deterministic degraded path.
    }
  }
  if (rows.length < targetCount) {
    const remaining = targetCount - rows.length;
    const parsedTerms = searchTerms(query);
    const terms = parsedTerms.length ? parsedTerms : [query];
    const likes = terms.map((term) => `%${term.toLocaleLowerCase()}%`);
    const primaryLike = likes[0] ?? `%${query.toLocaleLowerCase()}%`;
    const fallback = db.prepare(`
      SELECT r.*, 1000 AS rank FROM local_content_records r
      WHERE ${where} AND ${likes.map(() => "lower(r.search_text) LIKE ?").join(" AND ")}
      ORDER BY
        CASE WHEN lower(r.title) LIKE ? THEN 0 WHEN lower(r.summary) LIKE ? THEN 1 ELSE 2 END,
        COALESCE(r.occurred_at, r.imported_at, r.indexed_at) DESC,
        r.id
      LIMIT ? OFFSET ?
    `).all(...params, ...likes, primaryLike, primaryLike, remaining + rows.length, 0);
    for (const row of fallback) {
      if (seen.has(row.id)) continue;
      rows.push(row);
      seen.add(row.id);
      if (rows.length >= targetCount) break;
    }
  }
  return rows.slice(offset, offset + limit);
}

function publicRecordsWithRelations(db, rows, teamId) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const relations = db.prepare(`
    SELECT source_id, target_id, relation_type, metadata_json
    FROM local_content_relations
    WHERE owner_team_id = ? AND (source_id IN (${placeholders}) OR target_id IN (${placeholders}))
  `).all(teamId, ...ids, ...ids);
  const byId = new Map(ids.map((id) => [id, []]));
  for (const relation of relations) {
    if (byId.has(relation.source_id)) {
      byId.get(relation.source_id).push({
        direction: "outgoing",
        type: relation.relation_type,
        contentId: relation.target_id,
        metadata: parseJson(relation.metadata_json),
      });
    }
    if (byId.has(relation.target_id)) {
      byId.get(relation.target_id).push({
        direction: "incoming",
        type: relation.relation_type,
        contentId: relation.source_id,
        metadata: parseJson(relation.metadata_json),
      });
    }
  }
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    projectId: row.project_id,
    workItemId: row.work_item_id,
    storageMode: row.storage_mode,
    root: row.root_kind ? { kind: row.root_kind, id: row.root_id } : null,
    relativePath: row.relative_path,
    stateLocator: row.state_collection ? { collection: row.state_collection, id: row.state_id } : null,
    mimeType: row.mime_type,
    size: row.size,
    source: { type: row.source_type, id: row.source_id },
    occurredAt: row.occurred_at,
    importedAt: row.imported_at,
    modifiedAt: row.modified_at,
    original: { available: row.original_available === 1, reason: row.unavailable_reason },
    indexStatus: row.index_status,
    metadata: parseJson(row.metadata_json),
    relations: byId.get(row.id) ?? [],
  }));
}

function summarizeCatalog(db, teamId) {
  const rows = db.prepare(`
    SELECT kind, COUNT(*) AS count,
      SUM(CASE WHEN original_available = 1 THEN 1 ELSE 0 END) AS available
    FROM local_content_records WHERE owner_team_id = ? GROUP BY kind ORDER BY kind
  `).all(teamId);
  const rebuilt = db.prepare("SELECT value FROM local_content_meta WHERE key = 'last_rebuilt_at'").get();
  return {
    schemaVersion: LOCAL_CONTENT_CATALOG_SCHEMA_VERSION,
    total: rows.reduce((sum, row) => sum + Number(row.count), 0),
    available: rows.reduce((sum, row) => sum + Number(row.available), 0),
    byKind: Object.fromEntries(rows.map((row) => [row.kind, { count: Number(row.count), available: Number(row.available) }])),
    lastRebuiltAt: rebuilt?.value ?? null,
    rebuildable: true,
  };
}

function catalogRecord(input) {
  const title = boundedText(input.title, 500) || "Untitled local content";
  const body = boundedText(input.body, MAX_SEARCH_TEXT);
  const summary = boundedText(input.summary, 1_000) || boundedSummary(body, title);
  return {
    id: input.id,
    ownerTeamId: input.ownerTeamId ?? LOCAL_TEAM_ID,
    projectId: input.projectId ?? null,
    workItemId: input.workItemId ?? null,
    kind: input.kind,
    title,
    summary,
    searchText: boundedText([
      title,
      summary,
      body,
      input.sourceId,
      metadataSearchText(input.metadata),
    ].filter(Boolean).join("\n"), MAX_SEARCH_TEXT),
    searchBody: body,
    storageMode: input.storageMode,
    rootKind: input.rootKind ?? null,
    rootId: input.rootId ?? null,
    relativePath: input.relativePath ?? null,
    stateCollection: input.stateCollection ?? null,
    stateId: input.stateId ?? null,
    mimeType: input.mimeType ?? null,
    size: Number.isSafeInteger(input.size) ? input.size : null,
    sha256: input.sha256 ?? null,
    sourceType: input.sourceType ?? null,
    sourceId: boundedText(input.sourceId, 2_000) || null,
    occurredAt: validTimestamp(input.occurredAt),
    importedAt: validTimestamp(input.importedAt),
    modifiedAt: validTimestamp(input.modifiedAt),
    originalAvailable: input.originalAvailable === true,
    unavailableReason: input.unavailableReason ?? null,
    indexStatus: input.indexStatus,
    metadata: input.metadata ?? {},
    indexedAt: input.indexedAt,
  };
}

function assetRecord({ id, ownerTeamId, projectId, workItemId, kind, asset, source, taskTitle, indexedAt }) {
  const inspected = inspectOriginal(source.path, source.relativePath);
  const body = inspected.available ? readBoundedText(inspected.absolutePath, inspected.size) : "";
  const title = asset.originalName || basename(source.relativePath || asset.path || kind);
  return catalogRecord({
    id,
    ownerTeamId,
    projectId,
    workItemId,
    kind,
    title,
    body,
    summary: boundedSummary(body, `${kind === "task_input" ? "Input for" : "Output from"} ${taskTitle || "local task"}`),
    storageMode: source.kind === "application_data" ? "managed" : "referenced",
    rootKind: source.kind,
    rootId: source.id,
    relativePath: source.relativePath,
    mimeType: asset.mimeType ?? mimeTypeFor(title),
    size: inspected.size ?? asset.size ?? null,
    sha256: inspected.available ? fileDigest(inspected.absolutePath, inspected.size) : normalizeDigest(asset.hash),
    sourceType: kind,
    sourceId: asset.id ?? asset.path,
    occurredAt: null,
    importedAt: null,
    modifiedAt: inspected.modifiedAt,
    originalAvailable: inspected.available,
    unavailableReason: inspected.reason,
    indexStatus: inspected.available ? (body ? "ready" : "metadata_only") : "missing",
    metadata: { family: asset.family ?? null, resourceClass: asset.resourceClass ?? null },
    indexedAt,
  });
}

function taskInputSource(state, stateStorePath, item, asset) {
  const draft = (state.taskMaterialDrafts ?? []).find((candidate) =>
    candidate.workItemId === item.id && (candidate.assets ?? []).some((entry) => entry.id === asset.id));
  const sourceAsset = draft?.assets?.find((entry) => entry.id === asset.id);
  if (draft && sourceAsset) {
    return {
      kind: "application_data",
      id: "task-materials",
      path: resolve(dirname(stateStorePath)),
      relativePath: safeRelativePath(join(
        "task-materials",
        safeSegment(draft.ownerTeamId),
        safeSegment(draft.projectId),
        safeSegment(draft.id),
        sourceAsset.storedName,
      )),
    };
  }
  return taskAssetSource(state, item, asset);
}

function taskAssetSource(state, item, asset) {
  const root = contentRootFor(state, item, asset);
  return { ...root, relativePath: safeRelativePath(asset.path) };
}

function contentRootFor(state, item, asset = {}) {
  const worktree = asset.worktreeId
    ? (state.worktrees ?? []).find((candidate) => candidate.id === asset.worktreeId)
    : null;
  if (worktree?.path || worktree?.worktreePath) {
    return { kind: "worktree", id: worktree.id, path: worktree.path ?? worktree.worktreePath };
  }
  const project = (state.projects ?? []).find((candidate) => candidate.id === item?.projectId);
  return project?.path
    ? { kind: "project", id: project.id, path: project.path }
    : { kind: "project", id: item?.projectId ?? null, path: null };
}

function inspectOriginal(root, relativePath) {
  if (!root || !relativePath) return { available: false, reason: "original_path_unresolved", size: null, modifiedAt: null };
  try {
    const rootPath = resolve(root);
    if (!existsSync(rootPath) || lstatSync(rootPath).isSymbolicLink() || !lstatSync(rootPath).isDirectory()) {
      return { available: false, reason: "original_root_unavailable", size: null, modifiedAt: null };
    }
    const normalized = safeRelativePath(relativePath);
    if (!normalized) return { available: false, reason: "original_path_invalid", size: null, modifiedAt: null };
    const candidate = resolve(rootPath, normalized);
    const lexical = relative(rootPath, candidate);
    if (!lexical || lexical.startsWith("..") || isAbsolute(lexical)) {
      return { available: false, reason: "original_path_outside_root", size: null, modifiedAt: null };
    }
    let cursor = rootPath;
    for (const part of lexical.split(sep)) {
      cursor = join(cursor, part);
      if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
        return { available: false, reason: "original_path_symlink", size: null, modifiedAt: null };
      }
    }
    if (!existsSync(candidate)) return { available: false, reason: "original_missing", size: null, modifiedAt: null };
    const info = lstatSync(candidate);
    if (!info.isFile()) return { available: false, reason: "original_not_file", size: null, modifiedAt: null };
    const realRoot = realpathSync(rootPath);
    const realCandidate = realpathSync(candidate);
    const confined = relative(realRoot, realCandidate);
    if (!confined || confined.startsWith("..") || isAbsolute(confined)) {
      return { available: false, reason: "original_path_outside_root", size: null, modifiedAt: null };
    }
    return {
      available: true,
      reason: null,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      absolutePath: realCandidate,
    };
  } catch {
    return { available: false, reason: "original_unreadable", size: null, modifiedAt: null };
  }
}

function readBoundedText(path, size) {
  if (!textExtension(path) || !Number.isSafeInteger(size) || size <= 0) return "";
  const length = Math.min(size, MAX_EXTRACTED_BYTES);
  const buffer = Buffer.alloc(length);
  let fd;
  try {
    fd = openSync(path, "r");
    const bytesRead = readSync(fd, buffer, 0, length, 0);
    return plainText(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    return "";
  } finally {
    if (fd != null) closeSync(fd);
  }
}

function fileDigest(path, size) {
  if (!Number.isSafeInteger(size) || size < 0 || size > 64 * 1024 * 1024) return null;
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(Math.min(64 * 1024, Math.max(1, size)));
  let fd;
  try {
    fd = openSync(path, "r");
    let position = 0;
    while (position < size) {
      const bytesRead = readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return position === size ? `sha256:${hash.digest("hex")}` : null;
  } catch {
    return null;
  } finally {
    if (fd != null) closeSync(fd);
  }
}

function collectMailMessages(state) {
  const messages = new Map();
  const results = [...(state.applicationResults ?? [])].sort((left, right) =>
    Date.parse(left.createdAt ?? 0) - Date.parse(right.createdAt ?? 0));
  for (const record of results) {
    const application = (state.applications ?? []).find((candidate) => candidate.id === record.applicationId);
    const ownerTeamId = record.ownerTeamId ?? application?.ownerTeamId ?? LOCAL_TEAM_ID;
    const candidates = record.data?.kind === "message"
      ? [record.data]
      : record.data?.kind === "unread_headers"
        ? record.data.headers ?? []
        : record.data?.kind === "mailbox_sync"
          ? record.data.messages ?? []
          : [];
    for (const candidate of candidates) {
      const messageId = String(candidate?.messageId ?? "").trim();
      if (!messageId) continue;
      const key = `${ownerTeamId}:${messageId}`;
      const previous = messages.get(key) ?? {};
      messages.set(key, {
        ...previous,
        ...candidate,
        messageId,
        ownerTeamId,
        recordId: record.id,
        createdAt: record.createdAt ?? previous.createdAt ?? null,
        updatedAt: record.updatedAt ?? record.createdAt ?? previous.updatedAt ?? null,
        body: typeof candidate.body === "string" ? candidate.body : previous.body ?? "",
        bodyHtml: typeof candidate.bodyHtml === "string" ? candidate.bodyHtml : previous.bodyHtml ?? "",
        attachments: Array.isArray(candidate.attachments) ? candidate.attachments : previous.attachments ?? [],
        archive: candidate.archive && typeof candidate.archive === "object" ? candidate.archive : previous.archive ?? null,
      });
    }
  }
  return messages;
}

function normalizeKinds(input) {
  const values = Array.isArray(input) ? input : String(input ?? "").split(",");
  const kinds = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  return kinds.every((kind) => LOCAL_CONTENT_KINDS.has(kind))
    ? { ok: true, value: kinds }
    : { ok: false, value: [] };
}

function validMailArchiveReceipt(value) {
  return value?.version === 1
    && value.availability === "available"
    && /^mailarc_[a-f0-9]{24}_[a-f0-9]{40}$/.test(String(value.ref ?? ""))
    && /^[a-f0-9]{64}$/.test(String(value.sha256 ?? ""))
    && Number.isSafeInteger(value.size)
    && value.size > 0
    && value.size <= 50 * 1024 * 1024;
}

function normalizeQuery(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, MAX_SEARCH_QUERY);
}

function ftsQuery(value) {
  const tokens = searchTerms(value);
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND ");
}

function searchTerms(value) {
  return value.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 20) ?? [];
}

function contentId(kind, ...identity) {
  return `lc_${createHash("sha256").update(JSON.stringify([kind, ...identity])).digest("hex").slice(0, 32)}`;
}

function dedupeRelations(relations) {
  return [...new Map(relations.map((relation) => [relation.id, relation])).values()];
}

function rootPathKey(root, path) {
  return root?.kind && root?.id && path ? `${root.kind}:${root.id}:${safeRelativePath(path)}` : null;
}

function safeRelativePath(value) {
  const normalized = String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) return null;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) return null;
  return parts.join("/").slice(0, 2_000);
}

function safeSegment(value) {
  return String(value ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 160) || "unknown";
}

function articleTitle(text) {
  const frontMatter = /^---\s*\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const yamlTitle = /^title:\s*["']?(.+?)["']?\s*$/im.exec(frontMatter)?.[1];
  const flattenedTitle = /(?:^|\s)title:\s*["']([^"']+)["']/.exec(text)?.[1];
  return boundedText(yamlTitle || flattenedTitle || /^#\s+(.+)$/m.exec(text)?.[1], 500);
}

function boundedSummary(value, fallback) {
  const text = plainText(value).replace(/^---[\s\S]*?---\s*/, "").trim();
  return boundedText(text || fallback, 600);
}

function plainText(value) {
  return String(value ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#|~-]+/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedText(value, limit) {
  return String(value ?? "").slice(0, limit);
}

function validTimestamp(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function textExtension(path) {
  return new Set([".md", ".markdown", ".txt", ".html", ".htm", ".json", ".csv", ".tsv", ".xml", ".yaml", ".yml"])
    .has(extname(path).toLowerCase());
}

function mimeTypeFor(path) {
  const extension = extname(path).toLowerCase();
  if ([".md", ".markdown"].includes(extension)) return "text/markdown";
  if ([".html", ".htm"].includes(extension)) return "text/html";
  if (extension === ".json") return "application/json";
  if (extension === ".csv") return "text/csv";
  if ([".txt", ".log", ".yaml", ".yml", ".xml", ".tsv"].includes(extension)) return "text/plain";
  return null;
}

function normalizeDigest(value) {
  const text = String(value ?? "").toLowerCase();
  if (/^sha256:[a-f0-9]{64}$/.test(text)) return text;
  if (/^[a-f0-9]{64}$/.test(text)) return `sha256:${text}`;
  return null;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function metadataSearchText(value, depth = 0) {
  if (depth > 2 || value == null) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return boundedText(value, 2_000);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => metadataSearchText(item, depth + 1)).join(" ");
  if (typeof value === "object") {
    return Object.entries(value).slice(0, 50).flatMap(([key, item]) => [key, metadataSearchText(item, depth + 1)]).join(" ");
  }
  return "";
}
