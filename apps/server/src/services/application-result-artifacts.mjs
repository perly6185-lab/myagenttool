import { createHash } from "node:crypto";
import { isApplicationResultArtifactImporter, mcpResultImporterForInvocation, publicMcpResultImporter } from "./mcp-result-importers.mjs";

const COLLECTION = "applicationResultArtifacts";
const MAX_SUMMARY_TEXT = 260;
const MAX_PREVIEW_ITEMS = 12;

export function createApplicationResultArtifactService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon,
}) {
  function recordApplicationResultArtifact({ invocation, result, agent }) {
    const metadata = invocation?.options?.metadata ?? {};
    if (invocation?.status !== "succeeded") return [];
    if (metadata.providerType !== "mcp") return [];
    const applicationId = metadata.applicationId;
    if (!applicationId) return [];
    const importer = publicMcpResultImporter(mcpResultImporterForInvocation(invocation, agent));
    if (!isApplicationResultArtifactImporter(importer)) return [];

    const payload = parseArtifactPayload(result);
    if (payload.value == null && !payload.text) return [];
    const generatedAt = stringOrNull(payload.generatedAt) ?? invocation.completedAt ?? now();
    const id = nextId("app_artifact");
    const shape = dataShape(payload.value, payload.text);
    const summary = artifactSummary({
      importer,
      toolName: metadata.mcpToolName,
      value: payload.value,
      text: payload.text,
      shape,
    });
    const record = {
      id,
      applicationId,
      invocationId: invocation.id,
      agentId: agent?.id ?? invocation.agentId ?? null,
      capability: metadata.capability ?? null,
      mcpToolName: metadata.mcpToolName ?? null,
      importer,
      outputCollection: importer.outputCollection ?? COLLECTION,
      artifactType: importer.artifactType ?? "artifact",
      evidenceType: importer.evidenceType ?? "mcp_result",
      summary,
      dataShape: shape,
      dataHash: sha256(payload.hashSource),
      byteLength: Buffer.byteLength(payload.hashSource, "utf8"),
      metadata: sanitizeMetadata(payload.metadata),
      payload: payload.value,
      text: payload.text,
      preview: payloadPreview(payload.value, payload.text),
      resultRef: applicationResultArtifactRef(applicationId, id),
      governance: defaultResultGovernance(),
      generatedAt,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    };

    state.applicationResultArtifacts ??= [];
    state.applicationResultArtifacts.unshift(record);

    const publicRecord = publicApplicationResultArtifact(record);
    invocation.result = summarizeInvocationResult(result, publicRecord);
    invocation.options.metadata.outputCollection = record.outputCollection;
    invocation.options.metadata.artifactResultRef = publicRecord.resultRef;
    invocation.options.metadata.resultImporter = importer;

    appendEvent({
      invocationId: invocation.id,
      type: "application_result_artifact_recorded",
      level: "info",
      message: `Application result artifact recorded for ${metadata.capability ?? applicationId}.`,
      data: publicRecord,
    });
    persistStateSoon();
    return [publicRecord];
  }

  function getApplicationResultArtifact(applicationId, resultId) {
    return (state.applicationResultArtifacts ?? []).find((item) =>
      item.id === resultId && item.applicationId === applicationId) ?? null;
  }

  function latestApplicationResultArtifact(applicationId) {
    return (state.applicationResultArtifacts ?? [])
      .filter((item) => item.applicationId === applicationId)
      .sort((left, right) => Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? ""))[0] ?? null;
  }

  function listApplicationResultArtifacts(applicationId, filters = {}) {
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
    return (state.applicationResultArtifacts ?? [])
      .filter((item) => item.applicationId === applicationId)
      .filter((item) => !toolName || item.mcpToolName === toolName || item.capability === toolName)
      .filter((item) => !artifactType || item.artifactType === artifactType)
      .filter((item) => !evidenceType || item.evidenceType === evidenceType)
      .filter((item) => !agentId || item.agentId === agentId)
      .filter((item) => !source || resultSource(item) === source)
      .filter((item) => matchesGovernance(item, { pinned, archived, includeArchived }))
      .filter((item) => matchesSearch(artifactSearchValues(item), q))
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

  function updateApplicationResultArtifactGovernance(applicationId, resultId, body = {}, actor = {}) {
    const record = getApplicationResultArtifact(applicationId, resultId);
    if (!record) return null;
    updateResultGovernance(record, body, actor, now());
    appendEvent({
      invocationId: record.invocationId ?? null,
      type: "application_result_governance_updated",
      level: "info",
      message: `Application result governance updated for ${record.capability ?? applicationId}.`,
      data: publicApplicationResultArtifact(record),
    });
    persistStateSoon();
    return record;
  }

  return {
    getApplicationResultArtifact,
    latestApplicationResultArtifact,
    listApplicationResultArtifacts,
    recordApplicationResultArtifact,
    updateApplicationResultArtifactGovernance,
  };
}

export function publicApplicationResultArtifact(record) {
  if (!record) return null;
  return {
    id: record.id,
    applicationId: record.applicationId,
    invocationId: record.invocationId,
    agentId: record.agentId ?? null,
    capability: record.capability ?? null,
    mcpToolName: record.mcpToolName ?? null,
    importer: record.importer ?? null,
    outputCollection: record.outputCollection ?? record.importer?.outputCollection ?? COLLECTION,
    artifactType: record.artifactType ?? null,
    evidenceType: record.evidenceType ?? null,
    summary: record.summary ?? null,
    htmlSummary: record.summary ?? null,
    dataShape: record.dataShape ?? null,
    dataHash: record.dataHash ?? null,
    byteLength: record.byteLength ?? null,
    metadata: record.metadata ?? {},
    preview: record.preview ?? null,
    resultRef: record.resultRef ?? applicationResultArtifactRef(record.applicationId, record.id),
    lineage: applicationResultLineage(record),
    governance: publicResultGovernance(record),
    generatedAt: record.generatedAt ?? record.createdAt ?? null,
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
  };
}

export function applicationResultArtifactRef(applicationId, resultId) {
  return {
    type: "application_result_artifact",
    id: resultId,
    href: `/api/applications/${encodeURIComponent(applicationId)}/results/${encodeURIComponent(resultId)}`,
  };
}

function parseArtifactPayload(result) {
  const output = result?.output;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    return {
      value: output,
      text: null,
      metadata: output.metadata ?? {},
      generatedAt: output.generatedAt,
      hashSource: stableStringify(output),
    };
  }
  const text = typeof output === "string" ? output : typeof result?.summary === "string" ? result.summary : "";
  const parsed = maybeJson(text);
  if (parsed !== null) {
    return {
      value: parsed,
      text,
      metadata: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed.metadata ?? {} : {},
      generatedAt: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed.generatedAt : null,
      hashSource: stableStringify(parsed),
    };
  }
  return {
    value: null,
    text,
    metadata: {},
    generatedAt: result?.generatedAt,
    hashSource: text,
  };
}

function summarizeInvocationResult(result, artifactRecord) {
  const outputSummary = artifactRecord.summary ?? result?.summary ?? "Application result artifact recorded.";
  return {
    ...result,
    output: outputSummary,
    outputPreview: outputSummary,
    applicationArtifact: artifactRecord,
    resultRef: artifactRecord.resultRef,
    touchedUserFiles: false,
  };
}

function artifactSummary({ importer, toolName, value, text, shape }) {
  if (importer.importer === "application_option_catalog") {
    const catalog = catalogInfo(value);
    if (catalog.key) {
      return `${catalog.label} catalog from ${toolName ?? "MCP tool"} with ${catalog.count} item(s).`;
    }
  }
  if (value && typeof value === "object") {
    const keys = Array.isArray(value) ? [] : Object.keys(value).slice(0, 6);
    const noun = importer.importer === "application_evidence_record" ? "Evidence artifact" : "JSON artifact";
    return summarizeString(`${noun} from ${toolName ?? "MCP tool"}${keys.length ? `: ${keys.join(", ")}` : ` (${shape.type})`}.`, MAX_SUMMARY_TEXT);
  }
  return summarizeString(text || `Artifact from ${toolName ?? "MCP tool"}.`, MAX_SUMMARY_TEXT);
}

function dataShape(value, text) {
  if (Array.isArray(value)) {
    return { type: "array", itemCount: value.length, keys: [] };
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    const catalog = catalogInfo(value);
    return {
      type: "object",
      keys: keys.slice(0, 20),
      catalogKey: catalog.key,
      itemCount: catalog.count,
    };
  }
  return { type: "text", byteLength: Buffer.byteLength(String(text ?? ""), "utf8"), keys: [] };
}

function catalogInfo(value) {
  if (Array.isArray(value)) return { key: "items", label: "items", count: value.length };
  if (!value || typeof value !== "object") return { key: null, label: null, count: 0 };
  const entry = Object.entries(value).find(([, raw]) => Array.isArray(raw));
  if (!entry) return { key: null, label: null, count: 0 };
  return { key: entry[0], label: entry[0], count: entry[1].length };
}

function payloadPreview(value, text) {
  if (Array.isArray(value)) return value.slice(0, MAX_PREVIEW_ITEMS).map(previewValue);
  if (value && typeof value === "object") {
    const catalog = catalogInfo(value);
    if (catalog.key && Array.isArray(value[catalog.key])) {
      return {
        [catalog.key]: value[catalog.key].slice(0, MAX_PREVIEW_ITEMS).map(previewValue),
      };
    }
    return Object.fromEntries(Object.entries(value).slice(0, MAX_PREVIEW_ITEMS).map(([key, raw]) => [key, previewValue(raw)]));
  }
  return summarizeString(text ?? "", MAX_SUMMARY_TEXT);
}

function previewValue(value) {
  if (value == null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 6).map(previewValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 8).map(([key, raw]) => [key, previewValue(raw)]));
  }
  return String(value);
}

function sanitizeMetadata(value) {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(object)
    .filter(([key]) => !["html", "content", "markdown"].includes(key))
    .slice(0, 24)
    .map(([key, raw]) => [key, previewValue(raw)]));
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

function stableStringify(value) {
  return JSON.stringify(value, Object.keys(flattenKeys(value)).sort());
}

function flattenKeys(value, keys = {}) {
  if (value && typeof value === "object") {
    for (const [key, raw] of Object.entries(value)) {
      keys[key] = true;
      flattenKeys(raw, keys);
    }
  }
  return keys;
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

function artifactSearchValues(record) {
  return [
    record.id,
    record.applicationId,
    record.invocationId,
    record.agentId,
    record.capability,
    record.mcpToolName,
    record.importer?.importer,
    record.outputCollection,
    record.artifactType,
    record.evidenceType,
    record.summary,
    record.dataHash,
    JSON.stringify(record.dataShape ?? {}),
    JSON.stringify(record.metadata ?? {}),
    JSON.stringify(record.preview ?? {}),
  ];
}

function applicationResultLineage(record) {
  return {
    source: "application_mcp_result",
    applicationId: record.applicationId,
    invocationId: record.invocationId ?? null,
    agentId: record.agentId ?? null,
    capability: record.capability ?? null,
    mcpToolName: record.mcpToolName ?? null,
    outputCollection: record.outputCollection ?? record.importer?.outputCollection ?? COLLECTION,
    resultRef: record.resultRef ?? applicationResultArtifactRef(record.applicationId, record.id),
    generatedAt: record.generatedAt ?? record.createdAt ?? null,
  };
}

function summarizeString(value, maxLength) {
  const text = String(value ?? "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}
