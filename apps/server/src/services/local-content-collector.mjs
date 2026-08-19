import { basename, dirname, extname, join, resolve } from "node:path";

import { LOCAL_TEAM_ID, teamOf } from "../runtime/auth.mjs";
import { LOCAL_CONTENT_INDEX_SOURCES, normalizeIndexSources } from "./local-content-catalog-query.mjs";
import { backfillMailFacts, mailFactRecords } from "./mail-facts.mjs";
import {
  DOCUMENT_PREVIEW_EXTENSIONS,
  fileDigest,
  inspectOriginal,
  MAX_EXTRACTED_BYTES,
  readBoundedText,
} from "./local-content-originals.mjs";
import {
  articleTitle,
  boundedSummary,
  boundedText,
  catalogRecord,
  contentId,
  dedupeRelations,
  mimeTypeFor,
  normalizeDigest,
  parseJson,
  plainText,
  rootPathKey,
  safeRelativePath,
  storageKey,
  textExtension,
  validMailArchiveReceipt,
} from "./local-content-records.mjs";
import {
  extractionText,
  parseWorkflowDocument,
  WORKFLOW_DOCUMENT_PARSER_VERSION,
} from "./workflow-document-parser.mjs";

export async function collectLocalContent({
  state,
  stateStorePath,
  indexedAt,
  sources = [...LOCAL_CONTENT_INDEX_SOURCES],
  existingRecords = new Map(),
  parseDocument = parseWorkflowDocument,
}) {
  const selectedSources = new Set(normalizeIndexSources(sources));
  const records = [];
  const recordIds = new Set();
  const relations = [];
  const byKey = new Map();
  const tasks = new Map();
  const articlePaths = new Map();
  const outputsByTask = new Map();
  const dataRoot = resolve(dirname(stateStorePath));

  const addRecord = (record, key = null) => {
    if (recordIds.has(record.id)) return record.id;
    records.push(record);
    recordIds.add(record.id);
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
    if (selectedSources.has("work_items")) {
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
        metadata: {
          localRef: item.localRef ?? null,
          status: item.status ?? item.state ?? null,
          taskTitle: item.title ?? null,
          projectName: project?.name ?? null,
        },
        indexedAt,
      }), `task:${item.id}`);
    }
    byKey.set(`task:${item.id}`, id);
    tasks.set(item.id, { item, ownerTeamId, contentId: id, project });
  }

  for (const job of state.articleImportJobs ?? []) {
    if (job.state !== "completed" || !job.result?.markdownPath) continue;
    const task = tasks.get(job.workItemId);
    if (!task) continue;
    const root = contentRootFor(state, task.item, { worktreeId: job.worktreeId });
    const path = safeRelativePath(job.result.markdownPath);
    const id = contentId("article", task.ownerTeamId, job.id);
    if (selectedSources.has("articles")) {
      const inspected = inspectOriginal(root?.path, path);
      const cached = reusableExtraction(existingRecords.get(id), inspected, false);
      const body = cached?.body ?? (inspected.available ? readBoundedText(inspected.absolutePath, inspected.size) : "");
      const title = articleTitle(body) || task.item.title || basename(path || "article.md");
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
        sha256: cached?.sha256 ?? (inspected.available ? fileDigest(inspected.absolutePath, inspected.size) : null),
        sourceType: "article_import",
        sourceId: job.canonicalUrl ?? job.sourceUrl ?? job.id,
        occurredAt: job.completedAt ?? job.createdAt ?? null,
        importedAt: job.completedAt ?? null,
        modifiedAt: inspected.modifiedAt,
        originalAvailable: inspected.available,
        unavailableReason: inspected.reason,
        indexStatus: inspected.available ? (inspected.size > MAX_EXTRACTED_BYTES ? "partial" : "ready") : "missing",
        metadata: {
          articleImportJobId: job.id,
          canonicalUrl: job.canonicalUrl ?? null,
          manifestPath: job.result.manifestPath ?? null,
          htmlPath: job.result.htmlPath ?? null,
          taskTitle: task.item.title ?? null,
          projectName: task.project?.name ?? null,
          extraction: inspected.available ? {
            state: inspected.size > MAX_EXTRACTED_BYTES ? "partial" : "ready",
            reason: inspected.size > MAX_EXTRACTED_BYTES ? "search_text_truncated" : null,
            truncated: inspected.size > MAX_EXTRACTED_BYTES,
          } : null,
        },
        indexedAt,
      }), rootPathKey(root, path));
    }
    articlePaths.set(rootPathKey(root, path), id);
    addRelation(task.ownerTeamId, task.contentId, id, "produces_output");
  }

  for (const task of tasks.values()) {
    for (const asset of task.item.inputAssets ?? []) {
      const source = taskInputSource(state, stateStorePath, task.item, asset);
      const id = contentId("task_input", task.ownerTeamId, task.item.id, asset.id ?? asset.path);
      if (selectedSources.has("work_items")) {
        addRecord(await assetRecord({
          id,
          ownerTeamId: task.ownerTeamId,
          projectId: task.item.projectId ?? null,
          workItemId: task.item.id,
          kind: "task_input",
          asset,
          source,
          taskTitle: task.item.title,
          projectName: task.project?.name ?? null,
          indexedAt,
          existingRecord: existingRecords.get(id),
          parseDocument,
        }), rootPathKey(source, source.relativePath));
      }
      addRelation(task.ownerTeamId, task.contentId, id, "uses_input");
    }
    for (const asset of task.item.outputAssets ?? []) {
      const source = taskAssetSource(state, task.item, asset);
      const key = rootPathKey(source, source.relativePath);
      const articleId = articlePaths.get(key);
      if (articleId) {
        const outputs = outputsByTask.get(task.item.id) ?? [];
        outputs.push(articleId);
        outputsByTask.set(task.item.id, outputs);
        addRelation(task.ownerTeamId, task.contentId, articleId, "produces_output");
        continue;
      }
      const id = contentId("task_output", task.ownerTeamId, task.item.id, asset.id ?? asset.path);
      if (selectedSources.has("work_items")) {
        addRecord(await assetRecord({
          id,
          ownerTeamId: task.ownerTeamId,
          projectId: task.item.projectId ?? null,
          workItemId: task.item.id,
          kind: "task_output",
          asset,
          source,
          taskTitle: task.item.title,
          projectName: task.project?.name ?? null,
          indexedAt,
          existingRecord: existingRecords.get(id),
          parseDocument,
        }), key);
      }
      const outputs = outputsByTask.get(task.item.id) ?? [];
      outputs.push(id);
      outputsByTask.set(task.item.id, outputs);
      addRelation(task.ownerTeamId, task.contentId, id, "produces_output");
    }
  }

  const mailByMessage = collectMailMessages(state);
  for (const mail of mailByMessage.values()) {
    const id = contentId("mail", mail.ownerTeamId, mail.messageId);
    const archived = validMailArchiveReceipt(mail.archive);
    if (selectedSources.has("mail")) addRecord(catalogRecord({
      id,
      ownerTeamId: mail.ownerTeamId,
      projectId: null,
      workItemId: null,
      kind: "mail",
      title: mail.subject || "(no subject)",
      body: mail.body || plainText(mail.bodyHtml),
      summary: boundedSummary(mail.body || plainText(mail.bodyHtml), mail.from || "Mail message"),
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
        applicationId: mail.applicationId ?? null,
        mailAccountId: mail.mailAccountId ?? mail.applicationId ?? null,
        folderId: mail.folderId ?? "unknown",
        folderPath: mail.folderPath ?? null,
        hasHtml: Boolean(mail.bodyHtml),
        attachmentCount: mail.attachments?.length ?? 0,
        attachmentNames: (mail.attachments ?? []).slice(0, 50).map((attachment) => boundedText(attachment?.filename ?? attachment?.name, 240)).filter(Boolean),
        accountLabel: mail.accountLabel ?? null,
        archiveAvailability: mail.archive?.availability ?? "not_archived",
      },
      indexedAt,
    }), `mail:${mail.ownerTeamId}:${mail.messageId}`);
    byKey.set(`mail:${mail.ownerTeamId}:${mail.messageId}`, id);
  }

  for (const link of state.mailTaskLinks ?? []) {
    const task = tasks.get(link.workItemId);
    if (!task) continue;
    const mailId = byKey.get(`mail:${task.ownerTeamId}:${link.messageId}`);
    addRelation(task.ownerTeamId, mailId, task.contentId, "converted_to_task");
  }

  for (const task of tasks.values()) {
    for (const reference of task.item.localContentRefs ?? []) {
      const targetId = String(reference?.contentId ?? "");
      if (!targetId) continue;
      addRelation(task.ownerTeamId, task.contentId, targetId, "uses_input", {
        referenceId: reference.id ?? null,
        purpose: reference.purpose ?? "reference",
      });
      for (const outputId of outputsByTask.get(task.item.id) ?? []) {
        addRelation(task.ownerTeamId, outputId, targetId, "derived_from", {
          workItemId: task.item.id,
          referenceId: reference.id ?? null,
        });
      }
    }
  }

  return { records, relations: dedupeRelations(relations), indexedAt, dataRoot, sources: [...selectedSources] };
}

async function assetRecord({
  id, ownerTeamId, projectId, workItemId, kind, asset, source, taskTitle, projectName, indexedAt, existingRecord = null,
  parseDocument = parseWorkflowDocument,
}) {
  const inspected = inspectOriginal(source.path, source.relativePath);
  const title = asset.originalName || basename(source.relativePath || asset.path || kind);
  const sourceExtension = extname(source.relativePath ?? "").toLowerCase();
  const titleExtension = extname(title).toLowerCase();
  const extension = DOCUMENT_PREVIEW_EXTENSIONS.has(sourceExtension) ? sourceExtension : titleExtension;
  const cached = reusableExtraction(existingRecord, inspected, DOCUMENT_PREVIEW_EXTENSIONS.has(extension));
  let extraction = cached?.extraction ?? null;
  let body = cached?.body ?? "";
  let sha256 = cached?.sha256 ?? normalizeDigest(asset.hash);
  if (inspected.available && !cached) {
    sha256 = fileDigest(inspected.absolutePath, inspected.size);
    extraction = DOCUMENT_PREVIEW_EXTENSIONS.has(extension)
      ? await parseDocument({
          path: inspected.absolutePath,
          extension,
          readMode: "supported_text",
          size: inspected.size,
        })
      : null;
    body = extraction?.state === "ready"
      ? extractionText(extraction)
      : readBoundedText(inspected.absolutePath, inspected.size);
  }
  const extractionStatus = extraction?.state ?? null;
  const nativeTextTruncated = !extraction && inspected.available && textExtension(inspected.absolutePath) && inspected.size > MAX_EXTRACTED_BYTES;
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
    sha256,
    sourceType: kind,
    sourceId: asset.id ?? asset.path,
    occurredAt: null,
    importedAt: null,
    modifiedAt: inspected.modifiedAt,
    originalAvailable: inspected.available,
    unavailableReason: inspected.reason,
    indexStatus: inspected.available
      ? (nativeTextTruncated || extraction?.truncated || extraction?.truncatedPages
          ? "partial"
          : body ? "ready" : extraction && extraction.state !== "ready" ? "partial" : "metadata_only")
      : "missing",
    metadata: {
      family: asset.family ?? null,
      resourceClass: asset.resourceClass ?? null,
      extraction: extraction ? {
        state: extractionStatus,
        parserVersion: extraction.parserVersion ?? WORKFLOW_DOCUMENT_PARSER_VERSION,
        reason: extraction.reason ?? extraction.errorCode ?? null,
        characterCount: extraction.characterCount ?? 0,
        pageCount: extraction.pageCount ?? null,
        cellCount: extraction.cellCount ?? null,
        needsOcr: Boolean(extraction.needsOcr),
        truncated: Boolean(extraction.truncated || extraction.truncatedPages),
      } : nativeTextTruncated ? {
        state: "partial",
        parserVersion: null,
        reason: "search_text_truncated",
        characterCount: body.length,
        pageCount: null,
        cellCount: null,
        needsOcr: false,
        truncated: true,
      } : null,
      taskTitle: taskTitle ?? null,
      projectName: projectName ?? null,
    },
    indexedAt,
  });
}

function reusableExtraction(existingRecord, inspected, documentExtractionRequired) {
  if (!existingRecord || !inspected.available || existingRecord.original_available !== 1) return null;
  if (Number(existingRecord.size) !== inspected.size || existingRecord.modified_at !== inspected.modifiedAt) return null;
  const metadata = parseJson(existingRecord.metadata_json);
  const extraction = metadata.extraction && typeof metadata.extraction === "object" ? metadata.extraction : null;
  if (documentExtractionRequired && extraction?.parserVersion !== WORKFLOW_DOCUMENT_PARSER_VERSION) return null;
  return {
    body: String(existingRecord.search_body ?? ""),
    sha256: existingRecord.sha256 ?? null,
    extraction,
  };
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
        storageKey(draft.ownerTeamId),
        storageKey(draft.projectId),
        storageKey(draft.id),
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

function collectMailMessages(state) {
  const messages = new Map();
  backfillMailFacts(state);
  const results = [...mailFactRecords(state)].sort((left, right) =>
    Date.parse(left.createdAt ?? 0) - Date.parse(right.createdAt ?? 0));
  for (const record of results) {
    const application = (state.applications ?? []).find((candidate) => candidate.id === record.applicationId);
    const accountApplication = canonicalMailApplication(state, application ?? { id: record.applicationId, ownerTeamId: record.ownerTeamId });
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
      const key = `${ownerTeamId}:${record.accountId ?? record.applicationId ?? "mail"}:${messageId}`;
      const previous = messages.get(key) ?? {};
      messages.set(key, {
        ...previous,
        ...candidate,
        messageId,
        ownerTeamId,
        applicationId: application?.id ?? record.applicationId ?? null,
        mailAccountId: accountApplication?.id ?? application?.id ?? record.applicationId ?? null,
        accountLabel: accountApplication?.displayName ?? accountApplication?.name ?? application?.displayName ?? application?.name ?? null,
        folderId: candidate.folderId ?? previous.folderId ?? null,
        folderPath: candidate.folderPath ?? previous.folderPath ?? null,
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

function canonicalMailApplication(state, application) {
  let current = application;
  const visited = new Set();
  for (let depth = 0; current?.id && depth < 20 && !visited.has(current.id); depth += 1) {
    visited.add(current.id);
    const successorId = current.successorApplicationId;
    if (!successorId) break;
    const successor = (state.applications ?? []).find((candidate) =>
      candidate.id === successorId && candidate.ownerTeamId === current.ownerTeamId);
    if (!successor) break;
    current = successor;
  }
  return current;
}
