import { createHash } from "node:crypto";

import { LOCAL_CONTENT_CATALOG_SCHEMA_VERSION } from "./local-content-catalog-database.mjs";
import {
  ftsQuery,
  indexKindsForSources,
  LOCAL_CONTENT_INDEX_SOURCES,
  searchTerms,
} from "./local-content-catalog-query.mjs";
import {
  contentId,
  friendlySourceLabel,
  matchedSnippet,
  parseJson,
} from "./local-content-records.mjs";

export function replaceCatalog(db, { records, relations, indexedAt }) {
  const insertRecord = db.prepare(`
    INSERT INTO local_content_records(
      id, owner_team_id, project_id, work_item_id, kind, title, summary, search_text, search_body,
      storage_mode, root_kind, root_id, relative_path, state_collection, state_id,
      mime_type, size, sha256, source_type, source_id, occurred_at, imported_at,
      modified_at, original_available, unavailable_reason, index_status, metadata_json, content_signature, indexed_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        record.title, record.summary, record.searchText, record.searchBody, record.storageMode, record.rootKind,
        record.rootId, record.relativePath, record.stateCollection, record.stateId, record.mimeType,
        record.size, record.sha256, record.sourceType, record.sourceId, record.occurredAt,
        record.importedAt, record.modifiedAt, record.originalAvailable ? 1 : 0,
        record.unavailableReason, record.indexStatus, JSON.stringify(record.metadata), recordSignature(record), record.indexedAt,
      );
      insertFts.run(record.id, record.title, record.summary, record.searchBody);
    }
    for (const relation of relations) {
      insertRelationIfAvailable(db, insertRelation, relation);
    }
    rebuildSameContentRelations(db, insertRelation);
    db.prepare("INSERT OR REPLACE INTO local_content_meta(key, value) VALUES('last_rebuilt_at', ?)").run(indexedAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function applyCatalogDelta(db, { records, relations, indexedAt }, { sources = [...LOCAL_CONTENT_INDEX_SOURCES] } = {}) {
  const kinds = indexKindsForSources(sources);
  const placeholders = kinds.map(() => "?").join(", ");
  const existing = new Map(db.prepare(`SELECT id, content_signature FROM local_content_records WHERE kind IN (${placeholders})`)
    .all(...kinds).map((row) => [row.id, row.content_signature]));
  const nextIds = new Set(records.map((record) => record.id));
  const removedIds = [...existing.keys()].filter((id) => !nextIds.has(id));
  const affectedIds = new Set([...existing.keys(), ...nextIds]);
  const insertRecord = db.prepare(`
    INSERT OR REPLACE INTO local_content_records(
      id, owner_team_id, project_id, work_item_id, kind, title, summary, search_text, search_body,
      storage_mode, root_kind, root_id, relative_path, state_collection, state_id,
      mime_type, size, sha256, source_type, source_id, occurred_at, imported_at,
      modified_at, original_available, unavailable_reason, index_status, metadata_json, content_signature, indexed_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = db.prepare("INSERT INTO local_content_fts(id, title, summary, body) VALUES(?, ?, ?, ?)");
  const insertRelation = db.prepare(`
    INSERT INTO local_content_relations(id, owner_team_id, source_id, target_id, relation_type, metadata_json)
    VALUES(?, ?, ?, ?, ?, ?)
  `);
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let relationCount = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    const deleteRelations = db.prepare("DELETE FROM local_content_relations WHERE source_id = ? OR target_id = ?");
    for (const id of affectedIds) deleteRelations.run(id, id);
    for (const id of removedIds) {
      db.prepare("DELETE FROM local_content_fts WHERE id = ?").run(id);
      db.prepare("DELETE FROM local_content_records WHERE id = ?").run(id);
    }
    for (const record of records) {
      const signature = recordSignature(record);
      if (existing.get(record.id) === signature) {
        unchanged += 1;
        continue;
      }
      if (existing.has(record.id)) updated += 1;
      else added += 1;
      db.prepare("DELETE FROM local_content_fts WHERE id = ?").run(record.id);
      insertRecord.run(
        record.id, record.ownerTeamId, record.projectId, record.workItemId, record.kind,
        record.title, record.summary, record.searchText, record.searchBody, record.storageMode, record.rootKind,
        record.rootId, record.relativePath, record.stateCollection, record.stateId, record.mimeType,
        record.size, record.sha256, record.sourceType, record.sourceId, record.occurredAt,
        record.importedAt, record.modifiedAt, record.originalAvailable ? 1 : 0,
        record.unavailableReason, record.indexStatus, JSON.stringify(record.metadata), signature, record.indexedAt,
      );
      insertFts.run(record.id, record.title, record.summary, record.searchBody);
    }
    for (const relation of relations) {
      if (!affectedIds.has(relation.sourceId) && !affectedIds.has(relation.targetId)) continue;
      if (insertRelationIfAvailable(db, insertRelation, relation)) relationCount += 1;
    }
    db.prepare("DELETE FROM local_content_relations WHERE relation_type = 'same_content'").run();
    relationCount += rebuildSameContentRelations(db, insertRelation);
    db.prepare("INSERT OR REPLACE INTO local_content_meta(key, value) VALUES('last_incremental_at', ?)").run(indexedAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { added, updated, removed: removedIds.length, unchanged, relations: relationCount };
}

export function catalogRecordsForSources(db, sources) {
  const kinds = indexKindsForSources(sources);
  const placeholders = kinds.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT r.*
    FROM local_content_records r
    WHERE r.kind IN (${placeholders})
  `).all(...kinds);
  return new Map(rows.map((row) => [row.id, row]));
}

function insertRelationIfAvailable(db, insertRelation, relation) {
  const endpoints = db.prepare("SELECT COUNT(*) AS count FROM local_content_records WHERE owner_team_id = ? AND id IN (?, ?)")
    .get(relation.ownerTeamId, relation.sourceId, relation.targetId);
  if (Number(endpoints?.count) !== 2) return false;
  insertRelation.run(
    relation.id,
    relation.ownerTeamId,
    relation.sourceId,
    relation.targetId,
    relation.relationType,
    JSON.stringify(relation.metadata),
  );
  return true;
}

function rebuildSameContentRelations(db, insertRelation) {
  const rows = db.prepare(`
    SELECT id, owner_team_id, root_kind, root_id, relative_path
    FROM local_content_records
    WHERE storage_mode != 'state_record'
      AND root_kind IS NOT NULL
      AND relative_path IS NOT NULL
    ORDER BY id
  `).all();
  const firstByLocation = new Map();
  let count = 0;
  for (const row of rows) {
    const key = JSON.stringify([row.owner_team_id, row.root_kind, row.root_id, row.relative_path]);
    const first = firstByLocation.get(key);
    if (!first) {
      firstByLocation.set(key, row.id);
      continue;
    }
    insertRelation.run(
      contentId("relation", row.owner_team_id, first, row.id, "same_content"),
      row.owner_team_id,
      first,
      row.id,
      "same_content",
      "{}",
    );
    count += 1;
  }
  return count;
}

function recordSignature(record) {
  return createHash("sha256").update(JSON.stringify([
    record.ownerTeamId, record.projectId, record.workItemId, record.kind, record.title,
    record.summary, record.searchText, record.searchBody, record.storageMode, record.rootKind,
    record.rootId, record.relativePath, record.stateCollection, record.stateId, record.mimeType,
    record.size, record.sha256, record.sourceType, record.sourceId, record.occurredAt,
    record.importedAt, record.modifiedAt, record.originalAvailable, record.unavailableReason,
    record.indexStatus, record.metadata,
  ])).digest("hex");
}

export function searchCatalog(db, {
  teamId, projectId, workItemId, sourceType, yearMonth, availability, indexStatus,
  kinds, query, limit, offset,
}) {
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
  if (workItemId) {
    filters.push("r.work_item_id = ?");
    params.push(workItemId);
  }
  if (sourceType) {
    filters.push("r.source_type = ?");
    params.push(sourceType);
  }
  if (yearMonth) {
    filters.push("substr(COALESCE(r.occurred_at, r.imported_at, r.modified_at, r.indexed_at), 1, 7) = ?");
    params.push(yearMonth);
  }
  if (availability) filters.push(`r.original_available = ${availability === "available" ? 1 : 0}`);
  if (indexStatus) {
    filters.push("r.index_status = ?");
    params.push(indexStatus);
  }
  const where = filters.join(" AND ");
  if (!query) {
    return db.prepare(`
      SELECT r.*, 0 AS rank
      FROM local_content_records r
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
  if (rows.length === 0) {
    const remaining = targetCount;
    const parsedTerms = searchTerms(query);
    const terms = parsedTerms.length ? parsedTerms : [query];
    const likes = terms.map((term) => `%${term.toLocaleLowerCase()}%`);
    const primaryLike = likes[0] ?? `%${query.toLocaleLowerCase()}%`;
    const fallback = db.prepare(`
      SELECT r.*, 1000 AS rank
      FROM local_content_records r
      WHERE ${where} AND ${likes.map(() => "lower(r.search_text) LIKE ?").join(" AND ")}
      ORDER BY
        CASE WHEN lower(r.title) LIKE ? THEN 0 WHEN lower(r.summary) LIKE ? THEN 1 ELSE 2 END,
        COALESCE(r.occurred_at, r.imported_at, r.indexed_at) DESC,
        r.id
      LIMIT ? OFFSET ?
    `).all(...params, ...likes, primaryLike, primaryLike, remaining, 0);
    for (const row of fallback) {
      if (seen.has(row.id)) continue;
      rows.push(row);
      seen.add(row.id);
      if (rows.length >= targetCount) break;
    }
  }
  return rows.slice(offset, offset + limit);
}

export function publicRecordsWithRelations(db, rows, teamId, query = "") {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const relations = db.prepare(`
    SELECT source_id, target_id, relation_type, metadata_json
    FROM local_content_relations
    WHERE owner_team_id = ? AND (source_id IN (${placeholders}) OR target_id IN (${placeholders}))
  `).all(teamId, ...ids, ...ids);
  const relatedIds = [...new Set(relations.flatMap((relation) => [relation.source_id, relation.target_id]))];
  const relatedPlaceholders = relatedIds.map(() => "?").join(", ");
  const relatedRows = relatedIds.length
    ? db.prepare(`SELECT id, kind, title FROM local_content_records WHERE owner_team_id = ? AND id IN (${relatedPlaceholders})`).all(teamId, ...relatedIds)
    : [];
  const relatedById = new Map(relatedRows.map((row) => [row.id, row]));
  const byId = new Map(ids.map((id) => [id, []]));
  for (const relation of relations) {
    if (byId.has(relation.source_id)) {
      byId.get(relation.source_id).push({
        direction: "outgoing",
        type: relation.relation_type,
        contentId: relation.target_id,
        kind: relatedById.get(relation.target_id)?.kind ?? null,
        title: relatedById.get(relation.target_id)?.title ?? null,
        metadata: parseJson(relation.metadata_json),
      });
    }
    if (byId.has(relation.target_id)) {
      byId.get(relation.target_id).push({
        direction: "incoming",
        type: relation.relation_type,
        contentId: relation.source_id,
        kind: relatedById.get(relation.source_id)?.kind ?? null,
        title: relatedById.get(relation.source_id)?.title ?? null,
        metadata: parseJson(relation.metadata_json),
      });
    }
  }
  const canonicalById = new Map();
  for (const row of rows) {
    const sameRelations = (byId.get(row.id) ?? []).filter((relation) => relation.type === "same_content");
    const incoming = sameRelations.find((relation) => relation.direction === "incoming");
    if (incoming) canonicalById.set(row.id, incoming.contentId);
    else if (sameRelations.length) canonicalById.set(row.id, row.id);
  }
  const canonicalIds = [...new Set(canonicalById.values())];
  const appearanceCounts = new Map();
  if (canonicalIds.length) {
    const canonicalPlaceholders = canonicalIds.map(() => "?").join(", ");
    const counts = db.prepare(`
      SELECT source_id, COUNT(*) + 1 AS appearances
      FROM local_content_relations
      WHERE owner_team_id = ? AND relation_type = 'same_content'
        AND source_id IN (${canonicalPlaceholders})
      GROUP BY source_id
    `).all(teamId, ...canonicalIds);
    for (const count of counts) appearanceCounts.set(count.source_id, Number(count.appearances));
  }
  return rows.map((row) => {
    const metadata = parseJson(row.metadata_json);
    const recordRelations = byId.get(row.id) ?? [];
    const canonicalContentId = canonicalById.get(row.id);
    return ({
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
    metadata,
    sourceLabel: friendlySourceLabel(row, metadata),
    matchSnippet: query ? matchedSnippet(row.search_body || row.summary, query) : null,
    sameContent: canonicalContentId
      ? { canonicalContentId, appearances: appearanceCounts.get(canonicalContentId) ?? 2 }
      : null,
    relations: recordRelations,
    });
  });
}

export function summarizeCatalog(db, teamId) {
  const rows = db.prepare(`
    SELECT kind, COUNT(*) AS count,
      SUM(CASE WHEN original_available = 1 THEN 1 ELSE 0 END) AS available
    FROM local_content_records WHERE owner_team_id = ? GROUP BY kind ORDER BY kind
  `).all(teamId);
  const indexed = db.prepare("SELECT value FROM local_content_meta WHERE key IN ('last_incremental_at', 'last_rebuilt_at') ORDER BY value DESC LIMIT 1").get();
  const jobCounts = Object.fromEntries(db.prepare("SELECT status, COUNT(*) AS count FROM local_content_index_jobs WHERE status IN ('queued', 'running', 'failed') GROUP BY status").all()
    .map((row) => [row.status, Number(row.count)]));
  return {
    schemaVersion: LOCAL_CONTENT_CATALOG_SCHEMA_VERSION,
    total: rows.reduce((sum, row) => sum + Number(row.count), 0),
    available: rows.reduce((sum, row) => sum + Number(row.available), 0),
    byKind: Object.fromEntries(rows.map((row) => [row.kind, { count: Number(row.count), available: Number(row.available) }])),
    facets: summarizeFacets(db, teamId),
    lastRebuiltAt: indexed?.value ?? null,
    rebuildable: true,
    indexing: {
      queued: jobCounts.queued ?? 0,
      running: jobCounts.running ?? 0,
      failed: jobCounts.failed ?? 0,
    },
  };
}

function summarizeFacets(db, teamId) {
  const group = (expression, extra = "") => db.prepare(`
    SELECT ${expression} AS value, COUNT(*) AS count
    FROM local_content_records
    WHERE owner_team_id = ? ${extra}
    GROUP BY value
    HAVING value IS NOT NULL AND value != ''
    ORDER BY count DESC, value
    LIMIT 200
  `).all(teamId).map((row) => ({ value: row.value, count: Number(row.count) }));
  return {
    projects: group("project_id"),
    workItems: group("work_item_id"),
    sources: group("source_type"),
    months: group("substr(COALESCE(occurred_at, imported_at, modified_at, indexed_at), 1, 7)"),
    availability: group("CASE WHEN original_available = 1 THEN 'available' ELSE 'unavailable' END"),
    indexStatuses: group("index_status"),
  };
}
