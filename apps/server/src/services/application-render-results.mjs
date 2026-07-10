import { createHash } from "node:crypto";
import { isApplicationRenderHtmlImporter, mcpResultImporterForInvocation, publicMcpResultImporter } from "./mcp-result-importers.mjs";

const COLLECTION = "applicationRenderResults";
const MAX_SUMMARY_TEXT = 240;
const MAX_METADATA_KEYS = 24;

export function createApplicationRenderResultService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon,
}) {
  function recordApplicationRenderResult({ invocation, result, agent }) {
    const metadata = invocation?.options?.metadata ?? {};
    if (invocation?.status !== "succeeded") return [];
    if (metadata.providerType !== "mcp") return [];
    const applicationId = metadata.applicationId;
    if (!applicationId) return [];
    const importer = publicMcpResultImporter(mcpResultImporterForInvocation(invocation, agent));
    if (!isApplicationRenderHtmlImporter(importer)) return [];

    const parsed = parseRenderPayload(result);
    const html = parsed.html;
    if (!html) return [];

    const toolArguments = invocation.options?.toolArguments && typeof invocation.options.toolArguments === "object" && !Array.isArray(invocation.options.toolArguments)
      ? invocation.options.toolArguments
      : {};
    const markdown = typeof toolArguments.markdown === "string" ? toolArguments.markdown : "";
    const generatedAt = parsed.generatedAt ?? invocation.completedAt ?? now();
    const theme = stringOrNull(parsed.theme) ?? stringOrNull(toolArguments.theme) ?? "default";
    const id = nextId("app_render");
    const htmlHash = sha256(html);
    const markdownHash = markdown ? sha256(markdown) : null;
    const htmlSummary = summarizeHtml(html);
    const record = {
      id,
      applicationId,
      invocationId: invocation.id,
      agentId: agent?.id ?? invocation.agentId ?? null,
      capability: metadata.capability ?? null,
      mcpToolName: metadata.mcpToolName ?? null,
      importer,
      artifactType: importer.artifactType ?? "html",
      evidenceType: importer.evidenceType ?? "rendered_markdown",
      theme,
      markdownHash,
      htmlHash,
      htmlByteLength: Buffer.byteLength(html, "utf8"),
      htmlSummary,
      metadata: sanitizeMetadata(parsed.metadata),
      html,
      resultRef: applicationRenderResultRef(applicationId, id),
      governance: defaultResultGovernance(),
      generatedAt,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    };

    state.applicationRenderResults ??= [];
    state.applicationRenderResults.unshift(record);

    const publicRecord = publicApplicationRenderResult(record);
    invocation.result = summarizeInvocationResult(result, publicRecord);
    invocation.options.metadata.outputCollection = importer.outputCollection ?? COLLECTION;
    invocation.options.metadata.renderResultRef = publicRecord.resultRef;
    invocation.options.metadata.resultImporter = importer;

    appendEvent({
      invocationId: invocation.id,
      type: "application_render_result_recorded",
      level: "info",
      message: `Rendered markdown result recorded for ${metadata.capability ?? applicationId}.`,
      data: publicRecord,
    });
    persistStateSoon();
    return [publicRecord];
  }

  function recordApplicationEditorRenderResult({ application, input = {}, actor = null } = {}) {
    if (!application) {
      return { ok: false, status: 404, body: { error: "application_not_found" } };
    }
    if (application.status === "archived") {
      return { ok: false, status: 409, body: { error: "application_archived", applicationId: application.id } };
    }
    const html = stringOrNull(input.html ?? input.renderedHtml ?? input.content);
    if (!html) {
      return {
        ok: false,
        status: 422,
        body: {
          error: "editor_result_html_required",
          message: "Editor result import requires rendered HTML.",
        },
      };
    }
    const markdown = stringOrNull(input.markdown);
    const importedAt = now();
    const id = nextId("app_render");
    const theme = stringOrNull(input.theme) ?? "default";
    const importer = {
      importer: "application_web_editor",
      outputCollection: COLLECTION,
      artifactType: "html",
      evidenceType: "editor_rendered_markdown",
    };
    const metadata = sanitizeMetadata({
      ...(input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : {}),
      source: "application_web_editor",
      sourceUrl: stringOrNull(input.sourceUrl),
      editorUrl: stringOrNull(input.editorUrl ?? input.sourceUrl),
      note: stringOrNull(input.note),
      title: stringOrNull(input.title),
      postTitle: stringOrNull(input.postTitle ?? input.title),
      theme,
      markdownLength: markdown ? markdown.length : 0,
      htmlByteLength: Buffer.byteLength(html, "utf8"),
      importedBy: stringOrNull(actor?.userId),
    });
    const record = {
      id,
      applicationId: application.id,
      invocationId: null,
      agentId: null,
      capability: "application.web_editor.import",
      applicationAction: "web_editor_import",
      mcpToolName: null,
      importer,
      artifactType: "html",
      evidenceType: "editor_rendered_markdown",
      theme,
      markdownHash: markdown ? sha256(markdown) : null,
      htmlHash: sha256(html),
      htmlByteLength: Buffer.byteLength(html, "utf8"),
      htmlSummary: summarizeHtml(html),
      metadata,
      html,
      resultRef: applicationRenderResultRef(application.id, id),
      governance: defaultResultGovernance(),
      lineageSource: "application_web_editor",
      generatedAt: importedAt,
      createdAt: importedAt,
      updatedAt: importedAt,
    };

    state.applicationRenderResults ??= [];
    state.applicationRenderResults.unshift(record);
    const publicRecord = publicApplicationRenderResult(record);
    const applicationResult = {
      applicationId: application.id,
      capability: record.capability,
      applicationAction: record.applicationAction,
      outputCollection: COLLECTION,
      resultImport: "application_web_editor",
      mcpToolName: null,
      importedRecordIds: [record.id],
      importedRecordCount: 1,
      resultRef: publicRecord.resultRef,
      renderResult: publicRecord,
      artifactResult: null,
      invocationId: null,
      status: "succeeded",
      completedAt: importedAt,
    };
    application.latestResult = applicationResult;
    application.updatedAt = importedAt;

    appendEvent({
      invocationId: null,
      type: "application_editor_result_imported",
      level: "info",
      message: `Editor result imported for ${application.name ?? application.id}.`,
      data: {
        applicationId: application.id,
        resultRef: publicRecord.resultRef,
        theme,
      },
    });
    appendEvent({
      invocationId: null,
      type: "application_result_recorded",
      level: "info",
      message: `Application result recorded for ${application.name ?? application.id}.`,
      data: applicationResult,
    });
    persistStateSoon();
    return { ok: true, status: 201, record, publicRecord, applicationResult };
  }

  function getApplicationRenderResult(applicationId, resultId) {
    const record = (state.applicationRenderResults ?? []).find((item) =>
      item.id === resultId && item.applicationId === applicationId);
    return record ?? null;
  }

  function latestApplicationRenderResult(applicationId) {
    return (state.applicationRenderResults ?? [])
      .filter((item) => item.applicationId === applicationId)
      .sort((left, right) => Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? ""))[0] ?? null;
  }

  function listApplicationRenderResults(applicationId, filters = {}) {
    const toolName = filterValue(filters, "toolName");
    const artifactType = filterValue(filters, "artifactType");
    const evidenceType = filterValue(filters, "evidenceType");
    const agentId = filterValue(filters, "agentId");
    const status = filterValue(filters, "status");
    const source = filterValue(filters, "source");
    const q = filterValue(filters, "q") ?? filterValue(filters, "search");
    const pinned = booleanFilter(filters, "pinned");
    const archived = booleanFilter(filters, "archived");
    const includeArchived = booleanFilter(filters, "includeArchived") === true;
    const from = timestampFilter(filters, "from");
    const to = timestampFilter(filters, "to");
    const limit = limitFilter(filters, 20, 100);
    if (status && status !== "succeeded") return [];
    return (state.applicationRenderResults ?? [])
      .filter((item) => item.applicationId === applicationId)
      .filter((item) => !toolName || item.mcpToolName === toolName || item.capability === toolName)
      .filter((item) => !artifactType || item.artifactType === artifactType)
      .filter((item) => !evidenceType || item.evidenceType === evidenceType)
      .filter((item) => !agentId || item.agentId === agentId)
      .filter((item) => !source || resultSource(item) === source)
      .filter((item) => matchesGovernance(item, { pinned, archived, includeArchived }))
      .filter((item) => matchesSearch(renderSearchValues(item), q))
      .filter((item) => {
        const timestamp = Date.parse(item.createdAt ?? item.generatedAt ?? "");
        if (!Number.isFinite(timestamp)) return !from && !to;
        if (from && timestamp < from) return false;
        if (to && timestamp > to) return false;
        return true;
      })
      .sort((left, right) => Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? ""))
      .slice(0, limit);
  }

  function updateApplicationRenderResultGovernance(applicationId, resultId, body = {}, actor = {}) {
    const record = getApplicationRenderResult(applicationId, resultId);
    if (!record) return null;
    updateResultGovernance(record, body, actor, now());
    appendEvent({
      invocationId: record.invocationId ?? null,
      type: "application_result_governance_updated",
      level: "info",
      message: `Application result governance updated for ${record.capability ?? applicationId}.`,
      data: publicApplicationRenderResult(record),
    });
    persistStateSoon();
    return record;
  }

  return {
    getApplicationRenderResult,
    latestApplicationRenderResult,
    listApplicationRenderResults,
    recordApplicationEditorRenderResult,
    recordApplicationRenderResult,
    updateApplicationRenderResultGovernance,
  };
}

export function publicApplicationRenderResult(record) {
  if (!record) return null;
  return {
    id: record.id,
    applicationId: record.applicationId,
    invocationId: record.invocationId,
    agentId: record.agentId ?? null,
    capability: record.capability ?? null,
    mcpToolName: record.mcpToolName ?? null,
    importer: record.importer ?? null,
    outputCollection: record.importer?.outputCollection ?? COLLECTION,
    artifactType: record.artifactType ?? null,
    evidenceType: record.evidenceType ?? null,
    theme: record.theme ?? null,
    markdownHash: record.markdownHash ?? null,
    htmlHash: record.htmlHash ?? null,
    htmlByteLength: record.htmlByteLength ?? null,
    htmlSummary: record.htmlSummary ?? null,
    metadata: record.metadata ?? {},
    resultRef: record.resultRef ?? applicationRenderResultRef(record.applicationId, record.id),
    lineage: applicationResultLineage(record, COLLECTION),
    governance: publicResultGovernance(record),
    generatedAt: record.generatedAt ?? record.createdAt ?? null,
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
  };
}

export function applicationRenderResultRef(applicationId, resultId) {
  return {
    type: "application_render_result",
    id: resultId,
    href: `/api/applications/${encodeURIComponent(applicationId)}/results/${encodeURIComponent(resultId)}`,
  };
}

function parseRenderPayload(result) {
  const output = result?.output;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    return {
      html: stringOrNull(output.html) ?? stringOrNull(output.content) ?? "",
      theme: output.theme,
      generatedAt: stringOrNull(output.generatedAt),
      metadata: output.metadata ?? output,
    };
  }
  const text = typeof output === "string" ? output : typeof result?.html === "string" ? result.html : "";
  const parsed = maybeJson(text);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return {
      html: stringOrNull(parsed.html) ?? stringOrNull(parsed.content) ?? text,
      theme: parsed.theme,
      generatedAt: stringOrNull(parsed.generatedAt),
      metadata: parsed.metadata ?? parsed,
    };
  }
  return {
    html: text,
    theme: result?.theme,
    generatedAt: stringOrNull(result?.generatedAt),
    metadata: result?.metadata ?? {},
  };
}

function summarizeInvocationResult(result, renderRecord) {
  const outputSummary = renderRecord.htmlSummary ?? result?.summary ?? "Markdown rendered.";
  return {
    ...result,
    output: outputSummary,
    outputPreview: outputSummary,
    renderMarkdown: renderRecord,
    resultRef: renderRecord.resultRef,
    touchedUserFiles: false,
  };
}

function summarizeHtml(html) {
  const text = String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const summary = text || "Rendered HTML artifact.";
  return summary.length <= MAX_SUMMARY_TEXT ? summary : `${summary.slice(0, MAX_SUMMARY_TEXT - 3)}...`;
}

function sanitizeMetadata(value) {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const entries = [];
  for (const [key, raw] of Object.entries(object)) {
    if (["html", "content", "markdown"].includes(key)) continue;
    if (entries.length >= MAX_METADATA_KEYS) break;
    if (raw == null) {
      entries.push([key, null]);
    } else if (["string", "number", "boolean"].includes(typeof raw)) {
      const text = typeof raw === "string" ? summarizeString(raw, 300) : raw;
      entries.push([key, text]);
    } else if (Array.isArray(raw)) {
      entries.push([key, raw.slice(0, 20).map((item) => typeof item === "string" ? summarizeString(item, 160) : item)]);
    }
  }
  return Object.fromEntries(entries);
}

function maybeJson(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function filterValue(filters, key) {
  if (!filters) return null;
  const value = typeof filters.get === "function" ? filters.get(key) : filters[key];
  return stringOrNull(value);
}

function limitFilter(filters, defaultLimit, maxLimit) {
  const raw = typeof filters?.get === "function" ? filters.get("limit") : filters?.limit;
  const parsed = Number(raw ?? defaultLimit);
  if (!Number.isFinite(parsed)) return defaultLimit;
  return Math.min(Math.max(Math.trunc(parsed), 1), maxLimit);
}

function timestampFilter(filters, key) {
  const value = filterValue(filters, key);
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function booleanFilter(filters, key) {
  const value = typeof filters?.get === "function" ? filters.get(key) : filters?.[key];
  if (value === true || value === false) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes"].includes(text)) return true;
  if (["false", "0", "no"].includes(text)) return false;
  return null;
}

function defaultResultGovernance() {
  return {
    pinned: false,
    archived: false,
    retentionPolicy: "standard",
    note: null,
    pinnedAt: null,
    archivedAt: null,
    updatedAt: null,
    updatedBy: null,
  };
}

function publicResultGovernance(record) {
  const governance = record?.governance && typeof record.governance === "object" && !Array.isArray(record.governance)
    ? record.governance
    : {};
  return {
    pinned: Boolean(governance.pinned),
    archived: Boolean(governance.archived),
    retentionPolicy: stringOrNull(governance.retentionPolicy) ?? "standard",
    note: stringOrNull(governance.note),
    pinnedAt: stringOrNull(governance.pinnedAt),
    archivedAt: stringOrNull(governance.archivedAt),
    updatedAt: stringOrNull(governance.updatedAt),
    updatedBy: stringOrNull(governance.updatedBy),
  };
}

function updateResultGovernance(record, body, actor, timestamp) {
  const current = publicResultGovernance(record);
  const next = { ...current };
  if (typeof body?.pinned === "boolean" && body.pinned !== current.pinned) {
    next.pinned = body.pinned;
    next.pinnedAt = body.pinned ? timestamp : null;
  }
  if (typeof body?.archived === "boolean" && body.archived !== current.archived) {
    next.archived = body.archived;
    next.archivedAt = body.archived ? timestamp : null;
  }
  if (Object.prototype.hasOwnProperty.call(body ?? {}, "retentionPolicy")) {
    next.retentionPolicy = stringOrNull(body.retentionPolicy) ?? "standard";
  }
  if (Object.prototype.hasOwnProperty.call(body ?? {}, "note")) {
    next.note = stringOrNull(body.note);
  }
  next.updatedAt = timestamp;
  next.updatedBy = stringOrNull(actor?.userId);
  record.governance = next;
  record.updatedAt = timestamp;
}

function matchesGovernance(record, { pinned, archived, includeArchived }) {
  const governance = publicResultGovernance(record);
  if (pinned !== null && governance.pinned !== pinned) return false;
  if (archived !== null) return governance.archived === archived;
  if (!includeArchived && governance.archived) return false;
  return true;
}

function matchesSearch(values, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return values.some((value) => String(value ?? "").toLowerCase().includes(needle));
}

function resultSource(record) {
  const metadataSource = typeof record?.metadata?.source === "string" && record.metadata.source.trim()
    ? record.metadata.source.trim()
    : null;
  return metadataSource ?? record?.lineage?.source ?? record?.importer?.source ?? null;
}

function renderSearchValues(record) {
  return [
    record.id,
    record.applicationId,
    record.invocationId,
    record.agentId,
    record.capability,
    record.mcpToolName,
    record.artifactType,
    record.evidenceType,
    record.theme,
    record.markdownHash,
    record.htmlHash,
    record.htmlSummary,
    JSON.stringify(record.metadata ?? {}),
  ];
}

function applicationResultLineage(record, outputCollection) {
  return {
    source: record.lineageSource ?? "application_mcp_result",
    applicationId: record.applicationId,
    invocationId: record.invocationId ?? null,
    agentId: record.agentId ?? null,
    capability: record.capability ?? null,
    mcpToolName: record.mcpToolName ?? null,
    outputCollection,
    resultRef: record.resultRef ?? applicationRenderResultRef(record.applicationId, record.id),
    generatedAt: record.generatedAt ?? record.createdAt ?? null,
  };
}

function summarizeString(value, maxLength) {
  const text = String(value ?? "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}
