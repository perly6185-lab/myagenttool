import {
  existsSync,
  lstatSync,
  readFileSync,
  watch as watchFileSystem,
} from "node:fs";
import { basename, dirname, extname, join, posix, resolve } from "node:path";

import { LOCAL_TEAM_ID, teamOf } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import {
  extractionText,
  parseWorkflowDocument,
} from "./workflow-document-parser.mjs";
import {
  LOCAL_CONTENT_CATALOG_SCHEMA_VERSION,
  localContentCatalogPath,
  migrateLocalContentCatalog,
  openLocalContentCatalogDatabase,
} from "./local-content-catalog-database.mjs";
import { collectLocalContent } from "./local-content-collector.mjs";
import {
  decodeSearchCursor,
  encodeSearchCursor,
  LOCAL_CONTENT_INDEX_SOURCES,
  LOCAL_CONTENT_KINDS,
  MAX_SEARCH_OFFSET,
  normalizeChoice,
  normalizeIndexSources,
  normalizeKinds,
  normalizeQuery,
  parseIndexSources,
  searchCursorBinding,
  sourceForKind,
} from "./local-content-catalog-query.mjs";
import {
  applyCatalogDelta,
  browseCatalogDirectory,
  catalogRecordsForSources,
  publicRecordsWithRelations,
  replaceCatalog,
  searchCatalog,
  summarizeCatalog,
} from "./local-content-catalog-store.mjs";
import {
  boundedText,
  contentId,
  parseJson,
} from "./local-content-records.mjs";
import {
  catalogFileLocator,
  confinedCandidate,
  confinedExistingContainer,
  defaultMailArchiveRoot,
  DOCUMENT_PREVIEW_EXTENSIONS,
  inspectOriginal,
  originalNameFor,
  readFileRange,
  readFilePrefix,
  resolveCatalogOriginal,
  resolveStateRecord,
  safeMarkupPreview,
  unresolved,
} from "./local-content-originals.mjs";

export {
  collectLocalContent,
  LOCAL_CONTENT_CATALOG_SCHEMA_VERSION,
  LOCAL_CONTENT_INDEX_SOURCES,
  LOCAL_CONTENT_KINDS,
  localContentCatalogPath,
  migrateLocalContentCatalog,
  openLocalContentCatalogDatabase,
};

const MAX_SEARCH_LIMIT = 100;
const MAX_DIRECTORY_LIMIT = 100;
const MAX_PREVIEW_BYTES = 1024 * 1024;
const MAX_RETRIEVAL_CHUNK_CHARACTERS = 32 * 1024;
const MAX_MANAGED_PREVIEW_ASSET_BYTES = 10 * 1024 * 1024;
const DEFAULT_INDEX_DEBOUNCE_MS = 250;
const MAX_ORIGINAL_WATCH_DIRECTORIES = 512;
const MANAGED_PREVIEW_IMAGE_TYPES = new Map([
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

export function createLocalContentCatalogService({
  state,
  stateStorePath,
  now = () => new Date().toISOString(),
  persistStateSoon = () => {},
  store,
  databasePath = localContentCatalogPath(stateStorePath),
  openDatabase = openLocalContentCatalogDatabase,
  mailArchiveRoot = defaultMailArchiveRoot(),
  autoIndex = false,
  indexDebounceMs = DEFAULT_INDEX_DEBOUNCE_MS,
  collectContent = collectLocalContent,
  parseDocument = parseWorkflowDocument,
  watchOriginals = autoIndex,
  watchDirectory = watchFileSystem,
} = {}) {
  let databasePromise = null;
  const runTx = makeRunTx({ store, persistStateSoon });
  let indexTimer = null;
  let incrementalPromise = null;
  let indexOperationChain = Promise.resolve();
  const originalWatchers = new Map();
  let started = false;
  let closed = false;

  const managedChannelContentRow = (requestedId, teamId) => {
    const item = (state.channelKnowledgeItems ?? []).find((candidate) =>
      candidate?.status === "ready"
      && (candidate.ownerTeamId ?? LOCAL_TEAM_ID) === teamId
      && contentId("article", candidate.ownerTeamId ?? LOCAL_TEAM_ID, candidate.id) === requestedId) ?? null;
    if (item?.markdownPath) {
      return {
        id: requestedId,
        owner_team_id: teamId,
        project_id: item.projectId ?? null,
        work_item_id: item.workItemId ?? null,
        kind: "article",
        title: item.title ?? "未命名资料",
        summary: item.title ?? "未命名资料",
        storage_mode: "managed",
        root_kind: "application_data",
        root_id: "channel-knowledge",
        relative_path: item.markdownPath,
        state_collection: null,
        state_id: null,
        mime_type: "text/markdown",
        size: null,
        sha256: null,
        source_type: "channel_article_import",
        source_id: item.canonicalUrl ?? item.sourceUrl ?? item.id,
        metadata_json: JSON.stringify({ channelKnowledgeItemId: item.id }),
      };
    }
    const attachment = (state.channelAttachmentKnowledgeItems ?? []).find((candidate) =>
      candidate?.status === "ready"
      && (candidate.ownerTeamId ?? LOCAL_TEAM_ID) === teamId
      && contentId("material", candidate.ownerTeamId ?? LOCAL_TEAM_ID, candidate.id) === requestedId) ?? null;
    if (!attachment?.relativePath) return null;
    return {
      id: requestedId,
      owner_team_id: teamId,
      project_id: attachment.projectId ?? null,
      work_item_id: null,
      kind: "material",
      title: attachment.originalName ?? "Channel 资料",
      summary: attachment.originalName ?? "Channel 资料",
      storage_mode: "managed",
      root_kind: "application_data",
      root_id: "channel-attachments",
      relative_path: attachment.relativePath,
      state_collection: null,
      state_id: null,
      mime_type: attachment.mimeType ?? null,
      size: attachment.size ?? null,
      sha256: attachment.sha256 ?? null,
      source_type: "channel_attachment_import",
      source_id: attachment.sha256 ?? attachment.assetId ?? attachment.id,
      metadata_json: JSON.stringify({ channelAttachmentKnowledgeItemId: attachment.id }),
    };
  };

  const database = () => {
    databasePromise ??= Promise.resolve(openDatabase({ path: databasePath }));
    return databasePromise;
  };

  function runIndexOperation(operation) {
    const run = indexOperationChain.then(operation, operation);
    indexOperationChain = run.then(() => undefined, () => undefined);
    return run;
  }

  function closeOriginalWatchers() {
    for (const entry of originalWatchers.values()) entry.watcher.close();
    originalWatchers.clear();
  }

  function syncOriginalWatchers(db) {
    if (!watchOriginals || closed) return;
    const desired = new Map();
    const rows = db.prepare(`
      SELECT kind, root_kind, root_id, relative_path
      FROM local_content_records
      WHERE storage_mode != 'state_record' AND (relative_path IS NOT NULL OR root_kind = 'mail_archive')
    `).all();
    for (const row of rows) {
      const locator = catalogFileLocator({ row, state, stateStorePath, mailArchiveRoot });
      if (!locator?.rootPath || !locator.relativePath) continue;
      const inspected = inspectOriginal(locator.rootPath, locator.relativePath);
      const candidate = inspected.absolutePath ?? confinedCandidate(locator.rootPath, locator.relativePath);
      const safeTarget = confinedExistingContainer(locator.rootPath, locator.relativePath);
      if (!candidate || !safeTarget) continue;
      let directory;
      try {
        const targetInfo = lstatSync(safeTarget);
        directory = targetInfo.isDirectory() ? safeTarget : dirname(safeTarget);
      } catch {
        continue;
      }
      if (!existsSync(directory)) continue;
      if (!desired.has(directory) && desired.size >= MAX_ORIGINAL_WATCH_DIRECTORIES) continue;
      const current = desired.get(directory) ?? { names: new Set(), sources: new Set() };
      current.names.add(basename(candidate).toLocaleLowerCase());
      current.sources.add(sourceForKind(row.kind));
      desired.set(directory, current);
    }
    for (const [directory, entry] of originalWatchers) {
      if (desired.has(directory)) continue;
      entry.watcher.close();
      originalWatchers.delete(directory);
    }
    for (const [directory, target] of desired) {
      const existing = originalWatchers.get(directory);
      if (existing) {
        existing.names = target.names;
        existing.sources = target.sources;
        continue;
      }
      try {
        const entry = { watcher: null, names: target.names, sources: target.sources };
        entry.watcher = watchDirectory(directory, { persistent: false }, (_eventType, fileName) => {
          if (closed) return;
          const changedName = fileName == null ? null : String(fileName).toLocaleLowerCase();
          if (changedName && !entry.names.has(changedName)) return;
          void requestIncremental({
            reason: "original_file_changed",
            sources: [...entry.sources],
          }).catch(() => {});
        });
        entry.watcher.on?.("error", () => {
          entry.watcher.close();
          originalWatchers.delete(directory);
        });
        originalWatchers.set(directory, entry);
      } catch {
        // The durable state journal and manual refresh remain the fallback.
      }
    }
  }

  async function rebuild(_input = {}, actor = null) {
    return runIndexOperation(async () => {
      const db = await database();
      // Jobs already queued when the rebuild starts are covered by this complete
      // snapshot. Jobs created while collection is in progress must survive and
      // run afterwards, because their state may have changed after its source was read.
      db.prepare("DELETE FROM local_content_index_jobs WHERE status IN ('queued', 'failed')").run();
      const built = await collectContent({ state, stateStorePath, indexedAt: now(), parseDocument });
      replaceCatalog(db, built);
      syncOriginalWatchers(db);
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
    });
  }

  function scheduleIncremental(delay = indexDebounceMs) {
    if (closed || indexTimer) return;
    indexTimer = setTimeout(() => {
      indexTimer = null;
      void flushIncremental().catch(() => {});
    }, Math.max(0, delay));
    indexTimer.unref?.();
  }

  async function requestIncremental({ reason = "state_changed", sources = [...LOCAL_CONTENT_INDEX_SOURCES], immediate = false } = {}, _actor = null) {
    const db = await database();
    const requestedAt = now();
    const normalizedSources = normalizeIndexSources(sources);
    const pending = db.prepare("SELECT id, sources_json FROM local_content_index_jobs WHERE status = 'queued' ORDER BY id LIMIT 1").get();
    if (pending) {
      const mergedSources = normalizeIndexSources([...parseIndexSources(pending.sources_json), ...normalizedSources]);
      db.prepare("UPDATE local_content_index_jobs SET reason = ?, sources_json = ?, requested_at = ? WHERE id = ? AND status = 'queued'")
        .run(boundedText(reason, 120) || "state_changed", JSON.stringify(mergedSources), requestedAt, pending.id);
    } else {
      db.prepare("INSERT INTO local_content_index_jobs(reason, sources_json, status, requested_at) VALUES(?, ?, 'queued', ?)")
        .run(boundedText(reason, 120) || "state_changed", JSON.stringify(normalizedSources), requestedAt);
    }
    scheduleIncremental(immediate ? 0 : indexDebounceMs);
    return { status: 202, body: { queued: true, requestedAt } };
  }

  async function requestAutomaticIncremental(input = {}, actor = null) {
    if (!started || closed) return { status: 202, body: { queued: false, reason: "automatic_index_not_started" } };
    return requestIncremental(input, actor);
  }

  async function flushIncremental(_input = {}, actor = null) {
    if (incrementalPromise) return incrementalPromise;
    incrementalPromise = runIndexOperation(async () => {
      const db = await database();
      const job = db.prepare("SELECT * FROM local_content_index_jobs WHERE status = 'queued' ORDER BY id LIMIT 1").get();
      if (!job) return { status: 200, body: { catalog: summarizeCatalog(db, actor?.teamId ?? LOCAL_TEAM_ID), incremental: { processed: false } } };
      const startedAt = now();
      db.prepare("UPDATE local_content_index_jobs SET status = 'running', attempts = attempts + 1, started_at = ?, last_error = NULL WHERE id = ?")
        .run(startedAt, job.id);
      try {
        const sources = parseIndexSources(job.sources_json);
        const existingRecords = catalogRecordsForSources(db, sources);
        const built = await collectContent({
          state, stateStorePath, indexedAt: startedAt, sources, existingRecords, parseDocument,
        });
        const delta = applyCatalogDelta(db, built, { sources });
        syncOriginalWatchers(db);
        const completedAt = now();
        db.prepare("UPDATE local_content_index_jobs SET status = 'completed', completed_at = ? WHERE id = ?").run(completedAt, job.id);
        db.prepare("DELETE FROM local_content_index_jobs WHERE status = 'failed' AND id < ?").run(job.id);
        db.prepare("DELETE FROM local_content_index_jobs WHERE status = 'completed' AND id NOT IN (SELECT id FROM local_content_index_jobs WHERE status = 'completed' ORDER BY id DESC LIMIT 50)").run();
        return {
          status: 200,
          body: {
            catalog: summarizeCatalog(db, actor?.teamId ?? LOCAL_TEAM_ID),
            incremental: { processed: true, jobId: job.id, reason: job.reason, sources, ...delta, indexedAt: startedAt, originalFilesChanged: false },
          },
        };
      } catch (error) {
        db.prepare("UPDATE local_content_index_jobs SET status = 'failed', completed_at = ?, last_error = ? WHERE id = ?")
          .run(now(), boundedText(error instanceof Error ? error.message : String(error), 500), job.id);
        throw error;
      }
    });
    try {
      return await incrementalPromise;
    } finally {
      incrementalPromise = null;
      const db = await database();
      if (db.prepare("SELECT 1 FROM local_content_index_jobs WHERE status = 'queued' LIMIT 1").get()) scheduleIncremental(0);
    }
  }

  async function stats(actor = null) {
    const db = await database();
    return { status: 200, body: { catalog: summarizeCatalog(db, actor?.teamId ?? LOCAL_TEAM_ID) } };
  }

  async function get({ contentId } = {}, actor = null) {
    const db = await database();
    const teamId = actor?.teamId ?? LOCAL_TEAM_ID;
    const row = db.prepare("SELECT * FROM local_content_records WHERE id = ? AND owner_team_id = ?")
      .get(String(contentId ?? ""), teamId);
    if (!row) return { status: 404, body: { error: "local_content_not_found" } };
    return { status: 200, body: { content: publicRecordsWithRelations(db, [row], teamId)[0] } };
  }

  async function resolveOriginal({ contentId, projectId = null } = {}, actor = null) {
    const db = await database();
    const teamId = actor?.teamId ?? LOCAL_TEAM_ID;
    const requestedId = String(contentId ?? "");
    const row = db.prepare("SELECT * FROM local_content_records WHERE id = ? AND owner_team_id = ?")
      .get(requestedId, teamId) ?? managedChannelContentRow(requestedId, teamId);
    if (!row) return { ok: false, status: 404, error: "local_content_not_found" };
    if (projectId && row.project_id && row.project_id !== String(projectId)) {
      return { ok: false, status: 404, error: "local_content_not_found" };
    }
    const resolved = resolveCatalogOriginal({ row, state, stateStorePath, mailArchiveRoot });
    if (!resolved.ok) return resolved;
    return {
      ...resolved,
      record: {
        id: row.id,
        kind: row.kind,
        title: row.title,
        summary: row.summary,
        projectId: row.project_id,
        workItemId: row.work_item_id,
        mimeType: row.mime_type,
        storageMode: row.storage_mode,
        fingerprint: resolved.sha256,
      },
    };
  }

  async function preview({ contentId } = {}, actor = null) {
    const resolved = await resolveOriginal({ contentId }, actor);
    if (!resolved.ok) return { status: resolved.status, body: { error: resolved.error } };
    const mimeType = String(resolved.record?.mimeType ?? "").toLowerCase();
    const extension = extname(resolved.originalName ?? "").toLowerCase();
    if (resolved.record?.kind === "mail" && mimeType === "message/rfc822") {
      const db = await database();
      const row = db.prepare(`
        SELECT r.metadata_json, r.search_body AS body
        FROM local_content_records r
        WHERE r.id = ? AND r.owner_team_id = ?
      `).get(resolved.record.id, actor?.teamId ?? LOCAL_TEAM_ID);
      const metadata = parseJson(row?.metadata_json);
      const text = [
        metadata.from ? `From: ${metadata.from}` : "",
        `Subject: ${resolved.record.title}`,
        "",
        String(row?.body ?? "").trim(),
        ...(Array.isArray(metadata.attachmentNames) && metadata.attachmentNames.length
          ? ["", "Attachments:", ...metadata.attachmentNames.map((name) => `- ${name}`)]
          : []),
      ].filter((value, index) => value || index === 2).join("\n").trim();
      return {
        status: 200,
        body: {
          preview: {
            contentId: resolved.record.id,
            title: resolved.record.title,
            kind: resolved.record.kind,
            format: "plain_text",
            text: text || resolved.record.summary,
            truncated: false,
            bytesRead: resolved.size,
            totalBytes: resolved.size,
            mimeType: resolved.record.mimeType,
            originalName: resolved.originalName,
            activeContentExecuted: false,
            remoteResourcesLoaded: false,
          },
        },
      };
    }
    if (resolved.sourceType === "file" && DOCUMENT_PREVIEW_EXTENSIONS.has(extension)) {
      const extraction = await parseDocument({
        path: resolved.localPath,
        extension,
        readMode: "supported_text",
        size: resolved.size,
      });
      if (extraction.state !== "ready") {
        const error = extraction.state === "limited"
          ? "local_content_preview_too_large"
          : extraction.state === "needs_ocr"
            ? "local_content_preview_needs_ocr"
            : "local_content_preview_extraction_failed";
        return {
          status: extraction.state === "limited" ? 413 : 415,
          body: { error, reason: extraction.reason ?? extraction.errorCode ?? null },
        };
      }
      return {
        status: 200,
        body: {
          preview: {
            contentId: resolved.record.id,
            title: resolved.record.title,
            kind: resolved.record.kind,
            format: "plain_text",
            text: extractionText(extraction),
            truncated: Boolean(extraction.truncated || extraction.truncatedPages),
            bytesRead: resolved.size,
            totalBytes: resolved.size,
            mimeType: resolved.record.mimeType,
            originalName: resolved.originalName,
            extraction: {
              parserVersion: extraction.parserVersion,
              pageCount: extraction.pageCount,
              cellCount: extraction.cellCount,
            },
            activeContentExecuted: false,
            remoteResourcesLoaded: false,
          },
        },
      };
    }
    const previewable = mimeType.startsWith("text/")
      || ["application/json", "application/xml", "message/rfc822"].includes(mimeType)
      || [".md", ".markdown", ".txt", ".log", ".json", ".csv", ".tsv", ".xml", ".yaml", ".yml", ".html", ".htm", ".eml"].includes(extension);
    if (!previewable) return { status: 415, body: { error: "local_content_preview_unsupported" } };
    const totalBytes = resolved.size;
    const bytes = resolved.sourceType === "bytes"
      ? resolved.bytes.subarray(0, MAX_PREVIEW_BYTES)
      : readFilePrefix(resolved.localPath, Math.min(totalBytes, MAX_PREVIEW_BYTES));
    if (!bytes || bytes.includes(0)) return { status: 415, body: { error: "local_content_preview_unsupported" } };
    let text = bytes.toString("utf8");
    const markup = mimeType.includes("html") || [".html", ".htm"].includes(extension);
    if (markup) text = safeMarkupPreview(text);
    return {
      status: 200,
      body: {
        preview: {
          contentId: resolved.record.id,
          title: resolved.record.title,
          kind: resolved.record.kind,
          format: "plain_text",
          text,
          truncated: totalBytes > bytes.length,
          bytesRead: bytes.length,
          totalBytes,
          mimeType: resolved.record.mimeType,
          originalName: resolved.originalName,
          activeContentExecuted: false,
          remoteResourcesLoaded: false,
        },
      },
    };
  }

  async function readTextChunk({ contentId, offset = 0, limit = 8_192 } = {}, actor = null) {
    const boundedOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
    const boundedLimit = Math.min(MAX_RETRIEVAL_CHUNK_CHARACTERS, Math.max(1, Number.parseInt(limit, 10) || 8_192));
    const resolved = await resolveOriginal({ contentId }, actor);
    if (!resolved.ok) return { status: resolved.status, body: { error: resolved.error } };
    const mimeType = String(resolved.record?.mimeType ?? "").toLowerCase();
    const extension = extname(resolved.originalName ?? "").toLowerCase();
    const requiresExtraction = (resolved.record?.kind === "mail" && mimeType === "message/rfc822")
      || (resolved.sourceType === "file" && DOCUMENT_PREVIEW_EXTENSIONS.has(extension));
    if (requiresExtraction) {
      const result = await preview({ contentId }, actor);
      if (result.status !== 200) return result;
      const extracted = Array.from(String(result.body.preview.text ?? ""));
      const textCharacters = extracted.slice(boundedOffset, boundedOffset + boundedLimit);
      const text = textCharacters.join("");
      const nextOffset = boundedOffset + textCharacters.length;
      const reachedExtractionEnd = nextOffset >= extracted.length;
      const sourceTruncated = Boolean(result.body.preview.truncated);
      return {
        status: 200,
        body: {
          chunk: {
            contentId: result.body.preview.contentId,
            title: result.body.preview.title,
            kind: result.body.preview.kind,
            mimeType: result.body.preview.mimeType,
            format: "plain_text",
            offset: boundedOffset,
            text,
            nextOffset: reachedExtractionEnd ? null : nextOffset,
            eof: reachedExtractionEnd && !sourceTruncated,
            sourceTruncated,
            continuationUnavailable: reachedExtractionEnd && sourceTruncated,
          },
        },
      };
    }
    const previewable = mimeType.startsWith("text/")
      || ["application/json", "application/xml"].includes(mimeType)
      || [".md", ".markdown", ".txt", ".log", ".json", ".csv", ".tsv", ".xml", ".yaml", ".yml", ".html", ".htm"].includes(extension);
    if (!previewable) return { status: 415, body: { error: "local_content_preview_unsupported" } };
    const totalBytes = resolved.sourceType === "bytes" ? resolved.bytes.length : resolved.size;
    if (boundedOffset >= totalBytes) {
      return { status: 200, body: { chunk: {
        contentId: resolved.record.id, title: resolved.record.title, kind: resolved.record.kind,
        mimeType: resolved.record.mimeType, format: "plain_text", offset: boundedOffset,
        text: "", nextOffset: null, eof: true, sourceTruncated: false, continuationUnavailable: false,
      } } };
    }
    const readLength = Math.min(boundedLimit * 4, totalBytes - boundedOffset);
    const bytes = resolved.sourceType === "bytes"
      ? resolved.bytes.subarray(boundedOffset, boundedOffset + readLength)
      : readFileRange(resolved.localPath, boundedOffset, readLength);
    if (!bytes || bytes.includes(0)) return { status: 415, body: { error: "local_content_preview_unsupported" } };
    if (bytes.length && (bytes[0] & 0xc0) === 0x80) {
      return { status: 400, body: { error: "local_content_retrieval_offset_invalid" } };
    }
    const safeLength = utf8SafePrefixLength(bytes);
    if (!safeLength && bytes.length) return { status: 415, body: { error: "local_content_preview_unsupported" } };
    let decoded;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, safeLength));
    } catch {
      return { status: 415, body: { error: "local_content_preview_unsupported" } };
    }
    const sourceText = Array.from(decoded).slice(0, boundedLimit).join("");
    const consumed = Buffer.byteLength(sourceText, "utf8");
    if (!consumed && bytes.length) return { status: 415, body: { error: "local_content_preview_unsupported" } };
    let text = sourceText;
    if (mimeType.includes("html") || [".html", ".htm"].includes(extension)) text = safeMarkupPreview(text);
    const nextOffset = boundedOffset + consumed;
    return {
      status: 200,
      body: {
        chunk: {
          contentId: resolved.record.id,
          title: resolved.record.title,
          kind: resolved.record.kind,
          mimeType: resolved.record.mimeType,
          format: "plain_text",
          offset: boundedOffset,
          text,
          nextOffset: nextOffset < totalBytes ? nextOffset : null,
          eof: nextOffset >= totalBytes,
          sourceTruncated: false,
          continuationUnavailable: false,
        },
      },
    };
  }

  async function search({
    query = "", kinds = [], projectId = null, workItemId = null, sourceType = null,
    yearMonth = null, availability = null, indexStatus = null, mailAccountId = null, mailFolderId = null,
    limit = 30, offset = 0, cursor = null,
  } = {}, actor = null) {
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
    const normalizedAvailability = normalizeChoice(availability, ["available", "unavailable"]);
    if (!normalizedAvailability.ok) return { status: 400, body: { error: "local_content_availability_invalid" } };
    const normalizedIndexStatus = normalizeChoice(indexStatus, ["ready", "partial", "metadata_only", "missing"]);
    if (!normalizedIndexStatus.ok) return { status: 400, body: { error: "local_content_index_status_invalid" } };
    const normalizedYearMonth = yearMonth == null || yearMonth === "" ? null : String(yearMonth);
    if (normalizedYearMonth && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(normalizedYearMonth)) {
      return { status: 400, body: { error: "local_content_year_month_invalid" } };
    }
    const normalizedMailAccountId = mailAccountId == null || mailAccountId === "" ? null : boundedText(mailAccountId, 200);
    const normalizedMailFolderId = mailFolderId == null || mailFolderId === "" ? null : boundedText(mailFolderId, 100);
    if (normalizedMailFolderId && !normalizedMailAccountId) {
      return { status: 400, body: { error: "local_content_mail_account_required" } };
    }
    const normalizedQuery = normalizeQuery(query);
    const boundedLimit = Math.min(MAX_SEARCH_LIMIT, Math.max(1, Number.parseInt(limit, 10) || 30));
    const db = await database();
    const catalogRevision = db.prepare("SELECT value FROM local_content_meta WHERE key = 'catalog_revision'").get()?.value ?? "empty";
    const cursorBinding = searchCursorBinding({
      teamId,
      projectId: normalizedProjectId,
      workItemId: workItemId == null || workItemId === "" ? null : String(workItemId),
      sourceType: sourceType == null || sourceType === "" ? null : String(sourceType),
      yearMonth: normalizedYearMonth,
      availability: normalizedAvailability.value,
      indexStatus: normalizedIndexStatus.value,
      mailAccountId: normalizedMailAccountId,
      mailFolderId: normalizedMailFolderId,
      kinds: [...normalizedKinds.value].sort(),
      query: normalizedQuery,
      catalogRevision,
    });
    const cursorOffset = decodeSearchCursor(cursor, cursorBinding);
    if (cursor && cursorOffset == null) return { status: 400, body: { error: "local_content_cursor_invalid" } };
    const requestedOffset = cursorOffset ?? (Number.parseInt(offset, 10) || 0);
    const boundedOffset = Math.min(MAX_SEARCH_OFFSET, Math.max(0, requestedOffset));
    const rows = searchCatalog(db, {
      teamId,
      projectId: normalizedProjectId,
      workItemId: workItemId == null || workItemId === "" ? null : String(workItemId),
      sourceType: sourceType == null || sourceType === "" ? null : String(sourceType),
      yearMonth: normalizedYearMonth,
      availability: normalizedAvailability.value,
      indexStatus: normalizedIndexStatus.value,
      mailAccountId: normalizedMailAccountId,
      mailFolderId: normalizedMailFolderId,
      kinds: normalizedKinds.value,
      query: normalizedQuery,
      limit: boundedLimit,
      offset: boundedOffset,
    });
    const results = publicRecordsWithRelations(db, rows, teamId, normalizedQuery);
    return {
      status: 200,
      body: {
        results,
        count: results.length,
        query: normalizedQuery,
        limit: boundedLimit,
        offset: boundedOffset,
        hasMore: results.length === boundedLimit,
        nextCursor: results.length === boundedLimit ? encodeSearchCursor(boundedOffset + results.length, cursorBinding) : null,
        retrieval: { mode: normalizedQuery ? "fts_with_metadata_fallback" : "metadata_recent", offline: true },
      },
    };
  }

  async function browseDirectories({ dimension, query = "", limit = 50, cursor = null } = {}, actor = null) {
    const allowedDimensions = new Set(["kind", "project", "work_item", "source", "month", "availability", "index_status"]);
    const normalizedDimension = String(dimension ?? "").trim().toLowerCase();
    if (!allowedDimensions.has(normalizedDimension)) {
      return { status: 400, body: { error: "local_content_directory_dimension_invalid" } };
    }
    const normalizedQuery = normalizeQuery(query).slice(0, 120);
    const boundedLimit = Math.min(MAX_DIRECTORY_LIMIT, Math.max(1, Number.parseInt(limit, 10) || 50));
    const teamId = actor?.teamId ?? LOCAL_TEAM_ID;
    const db = await database();
    const catalogRevision = db.prepare("SELECT value FROM local_content_meta WHERE key = 'catalog_revision'").get()?.value ?? "empty";
    const cursorBinding = searchCursorBinding({ teamId, dimension: normalizedDimension, query: normalizedQuery, catalogRevision });
    const cursorOffset = decodeSearchCursor(cursor, cursorBinding);
    if (cursor && cursorOffset == null) return { status: 400, body: { error: "local_content_cursor_invalid" } };
    const offset = cursorOffset ?? 0;
    const directory = browseCatalogDirectory(db, {
      teamId,
      dimension: normalizedDimension,
      query: normalizedQuery,
      limit: boundedLimit,
      offset,
    });
    const hasMore = offset + directory.entries.length < directory.totalEntries;
    return {
      status: 200,
      body: {
        dimension: normalizedDimension,
        query: normalizedQuery,
        entries: directory.entries,
        count: directory.entries.length,
        totalEntries: directory.totalEntries,
        hasMore,
        nextCursor: hasMore ? encodeSearchCursor(offset + directory.entries.length, cursorBinding) : null,
        retrieval: { mode: "logical_directory", offline: true },
      },
    };
  }

  async function previewAsset({ contentId, relativePath } = {}, actor = null) {
    const resolved = await resolveOriginal({ contentId }, actor);
    if (!resolved.ok) return { status: resolved.status, error: resolved.error };
    if (resolved.record?.kind !== "article" || resolved.sourceType !== "file" || !resolved.localPath) {
      return { status: 409, error: "local_content_asset_not_supported" };
    }
    const requested = String(relativePath ?? "").replaceAll("\\", "/");
    if (!requested || requested.length > 1_000 || requested.startsWith("/") || /^[a-z]:\//i.test(requested)
      || requested.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      return { status: 400, error: "local_content_asset_path_invalid" };
    }
    const mimeType = MANAGED_PREVIEW_IMAGE_TYPES.get(posix.extname(requested).toLowerCase());
    if (!mimeType) return { status: 415, error: "local_content_asset_type_unsupported" };
    const inspected = inspectOriginal(dirname(resolved.localPath), requested);
    if (!inspected.available) return { status: 404, error: "local_content_asset_not_found" };
    if (inspected.size > MAX_MANAGED_PREVIEW_ASSET_BYTES) {
      return { status: 413, error: "local_content_asset_too_large" };
    }
    try {
      return {
        status: 200,
        bytes: readFileSync(inspected.absolutePath),
        mimeType,
        originalName: basename(inspected.absolutePath),
      };
    } catch {
      return { status: 409, error: "local_content_asset_unreadable" };
    }
  }

  async function refresh({ contentId } = {}, actor = null) {
    const db = await database();
    const teamId = actor?.teamId ?? LOCAL_TEAM_ID;
    const row = db.prepare("SELECT kind FROM local_content_records WHERE id = ? AND owner_team_id = ?")
      .get(String(contentId ?? ""), teamId);
    if (!row) return { status: 404, body: { error: "local_content_not_found" } };
    const sources = [sourceForKind(row.kind)];
    return runIndexOperation(async () => {
      const indexedAt = now();
      const existingRecords = catalogRecordsForSources(db, sources);
      const built = await collectContent({
        state, stateStorePath, indexedAt, sources, existingRecords, parseDocument,
      });
      const delta = applyCatalogDelta(db, built, { sources });
      syncOriginalWatchers(db);
      const refreshed = db.prepare("SELECT * FROM local_content_records WHERE id = ? AND owner_team_id = ?")
        .get(String(contentId ?? ""), teamId);
      return {
        status: refreshed ? 200 : 404,
        body: refreshed
          ? { content: publicRecordsWithRelations(db, [refreshed], teamId)[0], refresh: { ...delta, indexedAt } }
          : { error: "local_content_not_found" },
      };
    });
  }

  async function archive({ contentId: requestedContentId } = {}, actor = null) {
    const teamId = actor?.teamId ?? LOCAL_TEAM_ID;
    const requestedId = String(requestedContentId ?? "");
    const article = (state.channelKnowledgeItems ?? []).find((candidate) =>
      candidate?.status === "ready"
      && !candidate.archivedAt
      && (candidate.ownerTeamId ?? LOCAL_TEAM_ID) === teamId
      && contentId("article", candidate.ownerTeamId ?? LOCAL_TEAM_ID, candidate.id) === requestedId) ?? null;
    const attachment = (state.channelAttachmentKnowledgeItems ?? []).find((candidate) =>
      candidate?.status === "ready"
      && !candidate.archivedAt
      && (candidate.ownerTeamId ?? LOCAL_TEAM_ID) === teamId
      && contentId("material", candidate.ownerTeamId ?? LOCAL_TEAM_ID, candidate.id) === requestedId) ?? null;
    const item = article ?? attachment;
    if (!item) return { status: 404, body: { error: "local_content_not_found" } };

    runTx(() => {
      item.archivedAt = now();
      item.updatedAt = now();
    });
    const rebuilt = await rebuild({}, actor);
    return {
      status: 200,
      body: {
        archived: true,
        originalDeleted: false,
        contentId: requestedId,
        rebuild: rebuilt.body?.rebuild ?? null,
      },
    };
  }

  async function health({ contentIds = [] } = {}, actor = null) {
    const teamId = actor?.teamId ?? LOCAL_TEAM_ID;
    const ids = [...new Set((Array.isArray(contentIds) ? contentIds : [contentIds])
      .map((value) => String(value ?? ""))
      .filter((value) => /^lc_[a-f0-9]{32}$/.test(value)))].slice(0, 50);
    if (!ids.length) return { status: 200, body: { health: [] } };
    const db = await database();
    const placeholders = ids.map(() => "?").join(", ");
    const rows = db.prepare(`SELECT * FROM local_content_records WHERE owner_team_id = ? AND id IN (${placeholders})`)
      .all(teamId, ...ids);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      status: 200,
      body: {
        health: ids.map((id) => {
          const row = byId.get(id) ?? managedChannelContentRow(id, teamId);
          if (!row) return { contentId: id, state: "missing_record", available: false, reason: "local_content_not_found" };
          if (row.storage_mode === "state_record") {
            const resolved = resolveStateRecord(row, state);
            return { contentId: id, state: resolved.ok ? "ready" : "missing", available: resolved.ok, reason: resolved.error ?? null, canRefresh: true, canReveal: false };
          }
          const locator = catalogFileLocator({ row, state, stateStorePath, mailArchiveRoot });
          const inspected = inspectOriginal(locator?.rootPath, locator?.relativePath);
          if (!inspected.available) return { contentId: id, state: "missing", available: false, reason: inspected.reason, canRefresh: true, canReveal: Boolean(confinedExistingContainer(locator?.rootPath, locator?.relativePath)) };
          const changed = (row.size != null && Number(row.size) !== inspected.size)
            || Boolean(row.modified_at && row.modified_at !== inspected.modifiedAt);
          return { contentId: id, state: changed ? "changed" : "ready", available: true, reason: changed ? "local_content_original_changed" : null, canRefresh: true, canReveal: true };
        }),
      },
    };
  }

  async function resolveContainer({ contentId } = {}, actor = null) {
    const db = await database();
    const teamId = actor?.teamId ?? LOCAL_TEAM_ID;
    const requestedId = String(contentId ?? "");
    const row = db.prepare("SELECT * FROM local_content_records WHERE id = ? AND owner_team_id = ?")
      .get(requestedId, teamId) ?? managedChannelContentRow(requestedId, teamId);
    if (!row) return { ok: false, status: 404, error: "local_content_not_found" };
    if (row.storage_mode === "state_record") return unresolved("local_content_original_not_file", 409);
    const locator = catalogFileLocator({ row, state, stateStorePath, mailArchiveRoot });
    const target = confinedExistingContainer(locator?.rootPath, locator?.relativePath);
    if (!target) return unresolved("local_content_original_container_unavailable", 409);
    return { ok: true, status: 200, localPath: target, originalName: originalNameFor(row) };
  }

  async function close() {
    closed = true;
    closeOriginalWatchers();
    if (indexTimer) clearTimeout(indexTimer);
    indexTimer = null;
    await incrementalPromise?.catch(() => {});
    await indexOperationChain;
    if (!databasePromise) return;
    const db = await databasePromise;
    db.close();
    databasePromise = null;
  }

  async function start() {
    if (started || closed || !autoIndex) return { status: 200, body: { started: false } };
    started = true;
    const result = await requestIncremental({ reason: "startup", immediate: true });
    return { status: result.status, body: { ...result.body, started: true } };
  }

  const service = {
    rebuild, requestIncremental, requestAutomaticIncremental, flushIncremental, search, browseDirectories, get, preview, previewAsset, readTextChunk, refresh, archive, health,
    resolveOriginal, resolveContainer, stats, start, close, databasePath,
  };
  return service;
}

function utf8SafePrefixLength(bytes) {
  let start = bytes.length - 1;
  while (start >= 0 && (bytes[start] & 0xc0) === 0x80) start -= 1;
  if (start < 0) return 0;
  const lead = bytes[start];
  const expected = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : lead < 0xf8 ? 4 : 1;
  return start + expected <= bytes.length ? bytes.length : start;
}
