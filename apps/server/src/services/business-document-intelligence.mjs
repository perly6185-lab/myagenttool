import { createHash } from "node:crypto";

import {
  businessDocumentTypes,
  businessFieldKeys,
  normalizeBusinessFieldProposals,
} from "@myagenttool/protocol/business-routine";
import { detectPromptInjection } from "@myagenttool/protocol/issue-prompt";

import { LOCAL_TEAM_ID, LOCAL_USER_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

export const BUSINESS_DOCUMENT_CLASSIFIER_VERSION = 2;
export const BUSINESS_FIELD_EXTRACTOR_VERSION = 1;

const MAX_ANALYSIS_TEXT = 96 * 1024;
const DEFAULT_ANALYSIS_CONCURRENCY = 2;
const SUPPORTED_ENTITY_TYPES = new Set(["inquiry", "quotation", "order"]);
const SECRET_VALUE_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/i;
const UNSAFE_FORMULA_RE = /^[=+@]|^-(?!\d)/;
const CHINESE_INSTRUCTION_RE = /忽略.{0,40}(?:指令|规则|系统提示)|(?:执行|运行).{0,30}(?:命令|脚本)/i;
const CONFIRMATION_STATES = new Set(["proposed", "confirmed", "corrected"]);

const TYPE_LABELS = {
  inquiry_ledger: ["询价台账", "询价登记表", "inquiry ledger", "rfq register", "inquiry register"],
  quotation_ledger: ["报价台账", "报价登记表", "quotation ledger", "quote register", "quotation register"],
  order_ledger: ["订单台账", "订单登记表", "order ledger", "purchase order register"],
  price_list: ["价格表", "价目表", "产品价格", "price list", "pricing table", "rate card"],
  customer_reference: ["客户资料", "客户信息", "客户档案", "customer profile", "customer record", "account profile"],
  inquiry: ["询价单", "询价函", "询价编号", "rfq", "request for quotation", "inquiry number", "inquiry"],
  quotation: ["报价单", "报价函", "报价编号", "quotation number", "quotation", "quote number"],
  order: ["采购订单", "销售订单", "订单编号", "purchase order", "sales order", "order number"],
  other_reference: ["参考资料", "产品资料", "技术资料", "reference material", "product reference"],
};

const FIELD_DEFINITIONS = [
  { key: "customer", labels: ["客户名称", "客户", "采购方", "买方", "customer name", "customer", "client", "buyer"] },
  { key: "product", labels: ["产品名称", "产品", "品名", "物料名称", "product name", "product", "item", "material"] },
  { key: "quantity", labels: ["数量", "采购数量", "订购数量", "quantity", "qty"] },
  { key: "currency", labels: ["币种", "货币", "currency"] },
  { key: "amount", labels: ["总金额", "报价金额", "订单金额", "合计", "amount", "total amount", "grand total"] },
  { key: "document_date", labels: ["日期", "询价日期", "报价日期", "订单日期", "date", "document date"] },
  { key: "inquiry_number", labels: ["询价编号", "询价单号", "rfq number", "rfq no", "inquiry number", "inquiry no"] },
  { key: "quotation_number", labels: ["报价编号", "报价单号", "quotation number", "quotation no", "quote number", "quote no"] },
  { key: "order_number", labels: ["订单编号", "订单号", "采购订单号", "purchase order number", "po number", "order number", "order no"] },
];

const FIELD_BY_KEY = new Map(FIELD_DEFINITIONS.map((field) => [field.key, field]));

function boundedText(value, max = 1_000) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text && text.length <= max ? text : null;
}

function unique(values, max = 20) {
  return [...new Set(values.map((value) => boundedText(value, 300)).filter(Boolean))].slice(0, max);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function structuralLocation(location, fallback) {
  if (!location || typeof location !== "object") return fallback;
  const kind = String(location.kind ?? "").replace(/[^a-z0-9_-]/gi, "").slice(0, 30);
  if (!kind) return fallback;
  if (kind === "sheet_row") {
    return `sheet/${Math.max(1, Number(location.sheet) || 1)}/row/${Math.max(1, Number(location.row) || 1)}`;
  }
  if (kind === "html") {
    const path = String(location.path ?? "").replaceAll("\\", "/").replace(/^\/+/, "").slice(0, 240);
    return path ? `html/${path}` : fallback;
  }
  const index = Math.max(1, Number(location.index) || 1);
  return `${kind}/${index}`;
}

function contentEntries({ content = "", blocks = [] } = {}) {
  if (Array.isArray(blocks) && blocks.length) {
    return blocks
      .map((block, index) => ({
        text: boundedText(block?.text, 5_000),
        location: structuralLocation(block?.location, `block/${index + 1}`),
      }))
      .filter((entry) => entry.text)
      .slice(0, 2_000);
  }
  return String(content ?? "")
    .slice(0, MAX_ANALYSIS_TEXT)
    .split(/\r?\n/)
    .map((line, index) => ({ text: boundedText(line, 5_000), location: `line/${index + 1}` }))
    .filter((entry) => entry.text)
    .slice(0, 2_000);
}

function scoreLabels(text, labels) {
  const lower = String(text ?? "").toLowerCase();
  const matches = labels.filter((label) => lower.includes(label.toLowerCase()));
  const score = matches.reduce((total, label) =>
    total + (/(?:台账|登记表|ledger|register)/i.test(label) ? 3 : 1), 0);
  return { score, matches };
}

function rankedTypes(text) {
  return Object.entries(TYPE_LABELS)
    .map(([documentType, labels]) => ({ documentType, ...scoreLabels(text, labels) }))
    .sort((left, right) => right.score - left.score || left.documentType.localeCompare(right.documentType));
}

function normalizeFieldValue(key, value) {
  const text = boundedText(value, 1_000);
  if (!text) return null;
  if (key === "quantity" || key === "amount") {
    const number = text.replace(/[,\s]/g, "").match(/-?\d+(?:\.\d+)?/)?.[0];
    return number ?? text;
  }
  if (key === "currency") {
    const upper = text.toUpperCase();
    if (/[¥￥]|RMB|CNY/.test(upper)) return "CNY";
    if (/\$|USD/.test(upper)) return "USD";
    if (/€|EUR/.test(upper)) return "EUR";
    if (/£|GBP/.test(upper)) return "GBP";
    return upper.slice(0, 20);
  }
  if (key === "document_date") {
    const match = text.match(/\b(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?\b/);
    if (match) {
      return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    }
  }
  if (key.endsWith("_number")) return text.toUpperCase();
  return text;
}

function spreadsheetLabelValue(entry, labels) {
  const cells = tabularCells(entry.text);
  for (let index = 0; index < cells.length - 1; index += 1) {
    if (labels.some((label) => cells[index].toLowerCase() === label.toLowerCase())) {
      return boundedText(cells[index + 1], 1_000);
    }
  }
  return null;
}

function csvCells(text) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\"") {
      if (quoted && text[index + 1] === "\"") {
        value += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (character === "," || character === "\t")) {
      cells.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value.trim());
  return cells;
}

function tabularCells(text) {
  if (text.includes("|")) {
    return text.split("|").map((part) =>
      part.replace(/^\s*[A-Z]{1,3}\s*:\s*/i, "").trim());
  }
  if (text.includes(",") || text.includes("\t")) return csvCells(text);
  return [];
}

function fieldValueFromEntry(entry, definition) {
  const labels = [...definition.labels].sort((left, right) => right.length - left.length);
  const labelled = new RegExp(
    `(?:^|[|;,，；]\\s*)(?:${labels.map(escapeRegExp).join("|")})\\s*[:：=]\\s*([^|;；]{1,1000})`,
    "i",
  ).exec(entry.text)?.[1];
  return boundedText(labelled, 1_000) ?? spreadsheetLabelValue(entry, labels);
}

function extractFieldProposals(artifactId, entries) {
  const proposals = [];
  const riskSignals = [];
  const tabular = new Map();
  for (let index = 0; index < entries.length - 1; index += 1) {
    const headers = tabularCells(entries[index].text);
    const values = tabularCells(entries[index + 1].text);
    if (headers.length < 2 || headers.length !== values.length) continue;
    for (let column = 0; column < headers.length; column += 1) {
      const definition = FIELD_DEFINITIONS.find((field) =>
        field.labels.some((label) => headers[column].toLowerCase() === label.toLowerCase()));
      const value = boundedText(values[column], 1_000);
      if (definition && value && !tabular.has(definition.key)) {
        tabular.set(definition.key, { value, entry: entries[index + 1] });
      }
    }
  }
  for (const definition of FIELD_DEFINITIONS) {
    let found = tabular.get(definition.key) ?? null;
    if (!found) {
      for (const entry of entries) {
        const value = fieldValueFromEntry(entry, definition);
        if (!value) continue;
        found = { value, entry };
        break;
      }
    }
    if (!found) continue;
    if (SECRET_VALUE_RE.test(found.value)) {
      riskSignals.push("secret_like_value_excluded");
      continue;
    }
    if (UNSAFE_FORMULA_RE.test(found.value)) {
      riskSignals.push("spreadsheet_formula_value_excluded");
      continue;
    }
    proposals.push({
      key: definition.key,
      value: found.value,
      normalizedValue: normalizeFieldValue(definition.key, found.value),
      confidence: 0.9,
      evidenceRefs: [{
        artifactId,
        kind: "field",
        field: definition.key,
        location: found.entry.location,
      }],
      confirmationState: "proposed",
    });
  }
  return { proposals, riskSignals };
}

function evidenceForType(artifactId, entries, matches) {
  const refs = [];
  for (const entry of entries) {
    if (!matches.some((label) => entry.text.toLowerCase().includes(label.toLowerCase()))) continue;
    refs.push({ artifactId, kind: "document_type", field: null, location: entry.location });
    if (refs.length >= 10) break;
  }
  return refs;
}

export function analyzeBusinessDocumentDeterministically({
  artifactId,
  artifactFingerprint,
  relativePath,
  content = "",
  blocks = [],
} = {}) {
  const entries = contentEntries({ content, blocks });
  const boundedContent = entries.map((entry) => entry.text).join("\n").slice(0, MAX_ANALYSIS_TEXT);
  const nameRanking = rankedTypes(relativePath);
  const bodyRanking = rankedTypes(boundedContent);
  const nameBest = nameRanking[0]?.score ? nameRanking[0] : null;
  const bodyBest = bodyRanking[0]?.score ? bodyRanking[0] : null;
  const injection = detectPromptInjection(boundedContent);
  const instructionLike = injection.suspicious || CHINESE_INSTRUCTION_RE.test(boundedContent);
  const riskSignals = instructionLike
    ? ["instruction_like_content", ...injection.markers.map((marker) => `prompt_injection_${marker}`)]
    : [];
  let documentType = "unknown";
  let confidence = 0.25;
  let matches = [];
  const reasons = [];

  if (bodyBest) {
    documentType = bodyBest.documentType;
    matches = bodyBest.matches;
    confidence = Math.min(0.96, 0.68 + (bodyBest.score * 0.08));
    reasons.push(`Content contains ${bodyBest.matches.slice(0, 3).map((value) => `“${value}”`).join(", ")}.`);
  } else if (nameBest) {
    documentType = nameBest.documentType;
    matches = nameBest.matches;
    confidence = 0.55;
    reasons.push(`Filename suggests ${nameBest.documentType.replaceAll("_", " ")}.`);
    riskSignals.push("filename_only_evidence");
  } else {
    reasons.push("No reliable business-document signal was found.");
  }

  if (bodyBest && nameBest && bodyBest.documentType !== nameBest.documentType) {
    riskSignals.push("filename_content_conflict");
    confidence = Math.min(confidence, 0.64);
    reasons.push(`Filename suggests ${nameBest.documentType.replaceAll("_", " ")}, but content suggests ${bodyBest.documentType.replaceAll("_", " ")}.`);
  }
  if (instructionLike) confidence = Math.min(confidence, 0.6);

  const fields = extractFieldProposals(artifactId, entries);
  riskSignals.push(...fields.riskSignals);
  return {
    artifactId,
    artifactFingerprint,
    documentType,
    confidence,
    reasons: unique(reasons),
    evidenceRefs: bodyBest
      ? evidenceForType(artifactId, entries, matches)
      : nameBest
        ? [{ artifactId, kind: "filename", field: null, location: "filename" }]
        : [],
    fieldProposals: fields.proposals,
    riskSignals: unique(riskSignals),
    confirmationState: "proposed",
    classifierVersion: BUSINESS_DOCUMENT_CLASSIFIER_VERSION,
    extractorVersion: BUSINESS_FIELD_EXTRACTOR_VERSION,
    analysisState: "deterministic",
    degradedReason: null,
    provider: null,
    model: null,
  };
}

function semanticEvidenceEntry(entries, evidenceText) {
  const needle = boundedText(evidenceText, 300)?.toLowerCase();
  if (!needle) return null;
  return entries.find((entry) => entry.text.toLowerCase().includes(needle)) ?? null;
}

export function normalizeBusinessSemanticResult(result, { artifactId, entries }) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const documentType = businessDocumentTypes.includes(result.documentType) ? result.documentType : null;
  const confidence = Number(result.confidence);
  if (!documentType || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const fields = [];
  for (const candidate of Array.isArray(result.fields) ? result.fields.slice(0, 30) : []) {
    if (!candidate || !businessFieldKeys.includes(candidate.key)) continue;
    const value = boundedText(candidate.value, 1_000);
    const fieldConfidence = Number(candidate.confidence);
    const entry = semanticEvidenceEntry(entries, candidate.evidenceText);
    if (!value || SECRET_VALUE_RE.test(value) || UNSAFE_FORMULA_RE.test(value) || !entry
      || !entry.text.toLowerCase().includes(value.toLowerCase())
      || !Number.isFinite(fieldConfidence) || fieldConfidence < 0 || fieldConfidence > 1) {
      continue;
    }
    fields.push({
      key: candidate.key,
      value,
      normalizedValue: normalizeFieldValue(candidate.key, value),
      confidence: fieldConfidence,
      evidenceRefs: [{
        artifactId,
        kind: "semantic_field",
        field: candidate.key,
        location: entry.location,
      }],
      confirmationState: "proposed",
    });
  }
  const documentEvidenceTexts = [
    ...(Array.isArray(result.evidenceTexts) ? result.evidenceTexts : []),
    ...(result.evidenceText == null ? [] : [result.evidenceText]),
  ].slice(0, 10);
  const evidenceRefs = documentEvidenceTexts
    .map((value) => semanticEvidenceEntry(entries, value))
    .filter(Boolean)
    .map((entry) => ({
      artifactId,
      kind: "semantic_document_type",
      field: null,
      location: entry.location,
    }));
  if (!evidenceRefs.length) {
    evidenceRefs.push(...fields.flatMap((field) => field.evidenceRefs).slice(0, 10));
  }
  return {
    documentType,
    confidence,
    fieldProposals: normalizeBusinessFieldProposals(fields) ?? [],
    evidenceRefs,
  };
}

export function mergeBusinessSemanticAnalysis(deterministic, semantic, { provider, model } = {}) {
  if (!semantic) {
    return {
      ...deterministic,
      analysisState: "degraded",
      degradedReason: "provider_invalid_response",
      provider: provider ?? null,
      model: model ?? null,
    };
  }
  const riskSignals = [...deterministic.riskSignals];
  const semanticEvidenceRefs = Array.isArray(semantic.evidenceRefs) ? semantic.evidenceRefs : [];
  const semanticReason = `Local semantic analysis supports ${semantic.documentType.replaceAll("_", " ")} using source-matched evidence.`;
  let documentType = deterministic.documentType;
  let confidence = deterministic.confidence;
  const reasons = [...deterministic.reasons];
  if (documentType === "unknown" && semantic.confidence >= 0.6 && semanticEvidenceRefs.length) {
    documentType = semantic.documentType;
    confidence = Math.min(0.85, semantic.confidence);
    reasons.push(semanticReason);
  } else if (documentType === "unknown" && semantic.confidence >= 0.6) {
    riskSignals.push("semantic_missing_evidence");
  } else if (semantic.documentType !== documentType && semantic.confidence >= 0.6) {
    riskSignals.push("deterministic_semantic_conflict");
    confidence = Math.min(confidence, 0.6);
    reasons.push(`Semantic analysis suggested ${semantic.documentType.replaceAll("_", " ")}; review is required.`);
  } else if (semantic.documentType === documentType) {
    confidence = Math.min(0.98, Math.max(confidence, semantic.confidence));
    reasons.push(semanticReason);
  }
  const fields = new Map(deterministic.fieldProposals.map((field) => [field.key, field]));
  for (const field of semantic.fieldProposals) {
    if (!fields.has(field.key)) fields.set(field.key, field);
    else if (fields.get(field.key).normalizedValue !== field.normalizedValue) {
      riskSignals.push(`field_conflict_${field.key}`);
    }
  }
  return {
    ...deterministic,
    documentType,
    confidence,
    reasons: unique(reasons),
    fieldProposals: [...fields.values()],
    evidenceRefs: [...deterministic.evidenceRefs, ...semanticEvidenceRefs].slice(0, 20),
    riskSignals: unique(riskSignals),
    analysisState: "hybrid",
    degradedReason: null,
    provider: provider ?? null,
    model: model ?? null,
  };
}

function analysisKey({ artifact, adapter }) {
  return createHash("sha256")
    .update(JSON.stringify([
      artifact.fingerprint,
      BUSINESS_DOCUMENT_CLASSIFIER_VERSION,
      BUSINESS_FIELD_EXTRACTOR_VERSION,
      adapter?.providerId ?? "deterministic",
      adapter?.modelVersion ?? "disabled",
    ]))
    .digest("hex");
}

function entityTypeFor(documentType) {
  return SUPPORTED_ENTITY_TYPES.has(documentType) ? documentType : null;
}

function businessKeyFor(documentType, fields) {
  const preferred = {
    inquiry: "inquiry_number",
    quotation: "quotation_number",
    order: "order_number",
  }[documentType];
  return preferred ? fields.find((field) => field.key === preferred)?.normalizedValue ?? null : null;
}

export function createBusinessDocumentIntelligenceService({
  state,
  now = () => new Date().toISOString(),
  nextId = (prefix) => `${prefix}_${Date.now().toString(36)}`,
  appendEvent = () => {},
  persistStateSoon = () => {},
  semanticAdapter = null,
  listSources,
  listArtifacts,
  getArtifactAnalysisInput,
  recordClassification,
  createBusinessEntity,
  store,
  maxConcurrency = semanticAdapter?.maxConcurrency ?? DEFAULT_ANALYSIS_CONCURRENCY,
} = {}) {
  if (!Array.isArray(state.businessDocumentAnalysisJobs)) state.businessDocumentAnalysisJobs = [];
  const runTx = makeRunTx({ store, persistStateSoon });
  const actorTeam = (actor) => actor?.teamId ?? LOCAL_TEAM_ID;
  const actorUser = (actor) => actor?.userId ?? LOCAL_USER_ID;
  const visible = (row, actor) => row?.ownerTeamId === actorTeam(actor);
  const activeSources = new Map();
  const cancelledJobs = new Set();
  const semanticWaiters = [];
  let activeSemanticCalls = 0;
  const semanticLimit = Math.max(
    1,
    Math.min(8, Number(maxConcurrency) || DEFAULT_ANALYSIS_CONCURRENCY),
  );

  const acquireSemanticSlot = () => {
    if (activeSemanticCalls < semanticLimit) {
      activeSemanticCalls += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => semanticWaiters.push(resolve));
  };
  const releaseSemanticSlot = () => {
    const next = semanticWaiters.shift();
    if (next) next();
    else activeSemanticCalls -= 1;
  };
  const withSemanticSlot = async (operation) => {
    await acquireSemanticSlot();
    try {
      return await operation();
    } finally {
      releaseSemanticSlot();
    }
  };

  for (const job of state.businessDocumentAnalysisJobs) {
    if (job.status !== "running") continue;
    job.status = "recoverable";
    job.lastError = "analysis_interrupted";
    job.updatedAt = now();
    job.revision = Number(job.revision ?? 0) + 1;
  }

  function event(type, message, record, actor, extra = {}) {
    appendEvent({
      invocationId: null,
      type,
      level: type.includes("failed") ? "warning" : "info",
      message,
      data: {
        projectId: record.projectId,
        sourceId: record.sourceId,
        actorTeamId: actorTeam(actor),
        actorId: actorUser(actor),
        ...extra,
      },
    });
  }

  function sourceFor(sourceId, actor) {
    const result = listSources(actor);
    return result.body?.sources?.find((source) => source.id === sourceId) ?? null;
  }

  function listClassifications({ sourceId = null, confirmationState = null } = {}, actor = null) {
    if (sourceId && !sourceFor(sourceId, actor)) {
      return { status: 404, body: { error: "workflow_source_not_found" } };
    }
    if (confirmationState && !CONFIRMATION_STATES.has(confirmationState)) {
      return { status: 400, body: { error: "invalid_business_document_confirmation_state" } };
    }
    const classifications = state.businessDocumentClassifications.filter((row) =>
      visible(row, actor)
      && (!sourceId || row.sourceId === sourceId)
      && (!confirmationState || row.confirmationState === confirmationState));
    return { status: 200, body: { classifications, count: classifications.length } };
  }

  function listAnalysisJobs({ sourceId = null } = {}, actor = null) {
    if (sourceId && !sourceFor(sourceId, actor)) {
      return { status: 404, body: { error: "workflow_source_not_found" } };
    }
    const jobs = state.businessDocumentAnalysisJobs.filter((row) =>
      visible(row, actor) && (!sourceId || row.sourceId === sourceId));
    return { status: 200, body: { jobs, count: jobs.length } };
  }

  async function analyzeArtifactInternal({ artifactId }, actor, { batch = false } = {}) {
    const input = getArtifactAnalysisInput({ artifactId }, actor);
    if (input.status !== 200) return input;
    const { artifact, source, content, blocks } = input.body;
    if (!batch && activeSources.has(source.id)) {
      return { status: 409, body: { error: "business_document_analysis_in_progress" } };
    }
    const key = analysisKey({ artifact, adapter: semanticAdapter });
    const existing = state.businessDocumentClassifications.find((row) =>
      visible(row, actor) && row.artifactId === artifact.id);
    if (existing?.analysisKey === key) {
      return { status: 200, body: { classification: existing, replayed: true } };
    }
    const deterministic = analyzeBusinessDocumentDeterministically({
      artifactId: artifact.id,
      artifactFingerprint: artifact.fingerprint,
      relativePath: artifact.relativePath,
      content,
      blocks,
    });
    let analysis = deterministic;
    if (semanticAdapter) {
      try {
        const entries = contentEntries({ content, blocks });
        const raw = await withSemanticSlot(() => semanticAdapter.analyze({
          fileName: artifact.name,
          extension: artifact.extension,
          text: entries.map((entry) => entry.text).join("\n"),
          deterministic,
        }));
        const semantic = normalizeBusinessSemanticResult(raw, { artifactId: artifact.id, entries });
        analysis = mergeBusinessSemanticAnalysis(deterministic, semantic, {
          provider: semanticAdapter.providerId,
          model: semanticAdapter.modelVersion ?? semanticAdapter.model,
        });
      } catch (error) {
        analysis = {
          ...deterministic,
          analysisState: "degraded",
          degradedReason: String(error?.name === "AbortError"
            ? "provider_timeout"
            : "provider_failed").slice(0, 100),
          provider: semanticAdapter.providerId,
          model: semanticAdapter.modelVersion ?? semanticAdapter.model,
        };
      }
    }
    const recorded = recordClassification({
      ...analysis,
      projectId: source.projectId,
      sourceId: source.id,
      analysisKey: key,
      expectedRevision: existing?.revision,
    }, actor);
    if (![200, 201].includes(recorded.status)) return recorded;
    const classification = recorded.body.classification;
    return {
      status: recorded.status,
      body: { classification, replayed: false },
    };
  }

  function analyzeArtifact(input, actor = null) {
    return analyzeArtifactInternal(input, actor);
  }

  async function analyzeSource({ sourceId } = {}, actor = null) {
    const source = sourceFor(sourceId, actor);
    if (!source) return { status: 404, body: { error: "workflow_source_not_found" } };
    if (source.state !== "active") {
      return { status: 409, body: { error: "workflow_source_revoked" } };
    }
    if (activeSources.has(source.id)) {
      return { status: 409, body: { error: "business_document_analysis_in_progress" } };
    }
    const artifactsResult = listArtifacts({ sourceId: source.id, availability: "available" }, actor);
    if (artifactsResult.status !== 200) return artifactsResult;
    const artifacts = artifactsResult.body.artifacts.filter((artifact) => !artifact.exclusion);
    const timestamp = now();
    const recoverable = [...state.businessDocumentAnalysisJobs].reverse().find((row) =>
      visible(row, actor) && row.sourceId === source.id && row.status === "recoverable");
    const job = recoverable ?? {
      id: nextId("bdj"),
      ownerTeamId: actorTeam(actor),
      projectId: source.projectId,
      sourceId: source.id,
      status: "running",
      attempt: 0,
      total: artifacts.length,
      processed: 0,
      classified: 0,
      replayed: 0,
      failed: 0,
      failures: [],
      lastError: null,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      if (!recoverable) state.businessDocumentAnalysisJobs.push(job);
      job.status = "running";
      job.attempt += 1;
      job.total = artifacts.length;
      job.processed = 0;
      job.classified = 0;
      job.replayed = 0;
      job.failed = 0;
      job.failures = [];
      job.lastError = null;
      job.revision += 1;
      job.updatedAt = timestamp;
      job.updatedBy = actorUser(actor);
      event("business_document_analysis_started", "Business document analysis started.", job, actor, {
        jobId: job.id,
        total: artifacts.length,
      });
    });
    activeSources.set(source.id, job.id);
    const queue = [...artifacts];
    const concurrency = Math.max(1, Math.min(8, Number(maxConcurrency) || DEFAULT_ANALYSIS_CONCURRENCY));
    const worker = async () => {
      while (queue.length && !cancelledJobs.has(job.id)) {
        const artifact = queue.shift();
        const result = await analyzeArtifactInternal({ artifactId: artifact.id }, actor, { batch: true });
        runTx(() => {
          job.processed += 1;
          if ([200, 201].includes(result.status)) {
            if (result.body.replayed) job.replayed += 1;
            else job.classified += 1;
          } else {
            job.failed += 1;
            job.failures.push({
              artifactId: artifact.id,
              error: String(result.body?.error ?? "business_document_analysis_failed").slice(0, 120),
            });
            job.failures = job.failures.slice(-100);
          }
          job.revision += 1;
          job.updatedAt = now();
          job.updatedBy = actorUser(actor);
        });
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, worker));
      runTx(() => {
        job.status = cancelledJobs.has(job.id) ? "cancelled" : "succeeded";
        job.completedAt = now();
        job.revision += 1;
        job.updatedAt = job.completedAt;
        job.updatedBy = actorUser(actor);
        event(
          job.status === "cancelled" ? "business_document_analysis_cancelled" : "business_document_analysis_completed",
          job.status === "cancelled" ? "Business document analysis cancelled." : "Business document analysis completed.",
          job,
          actor,
          { jobId: job.id, processed: job.processed, failed: job.failed },
        );
      });
      return { status: 200, body: { job } };
    } catch (error) {
      runTx(() => {
        job.status = "recoverable";
        job.lastError = "business_document_analysis_failed";
        job.revision += 1;
        job.updatedAt = now();
        event("business_document_analysis_failed", "Business document analysis failed.", job, actor, {
          jobId: job.id,
        });
      });
      return {
        status: 500,
        body: { error: "business_document_analysis_failed", job },
      };
    } finally {
      activeSources.delete(source.id);
      cancelledJobs.delete(job.id);
    }
  }

  function cancelAnalysis({ sourceId } = {}, actor = null) {
    const source = sourceFor(sourceId, actor);
    if (!source) return { status: 404, body: { error: "workflow_source_not_found" } };
    const jobId = activeSources.get(source.id);
    if (!jobId) return { status: 409, body: { error: "business_document_analysis_not_running" } };
    cancelledJobs.add(jobId);
    return { status: 202, body: { sourceId: source.id, jobId, cancellationRequested: true } };
  }

  function confirmClassification({
    classificationId,
    expectedRevision,
    documentType = null,
    fieldCorrections = {},
    excludedFieldKeys = [],
  } = {}, actor = null) {
    const existing = state.businessDocumentClassifications.find((row) =>
      row.id === classificationId && visible(row, actor));
    if (!existing) return { status: 404, body: { error: "business_document_classification_not_found" } };
    if (existing.revision !== expectedRevision) {
      return {
        status: 409,
        body: { error: "business_document_classification_revision_conflict", currentRevision: existing.revision },
      };
    }
    const nextDocumentType = documentType == null ? existing.documentType : documentType;
    if (!businessDocumentTypes.includes(nextDocumentType)
      || !fieldCorrections || typeof fieldCorrections !== "object" || Array.isArray(fieldCorrections)
      || !Array.isArray(excludedFieldKeys)
      || excludedFieldKeys.some((key) => !businessFieldKeys.includes(key))
      || Object.keys(fieldCorrections).some((key) =>
        !businessFieldKeys.includes(key) || excludedFieldKeys.includes(key))) {
      return { status: 400, body: { error: "invalid_business_document_correction" } };
    }
    const excluded = new Set(excludedFieldKeys);
    const fields = existing.fieldProposals
      .filter((field) => !excluded.has(field.key))
      .map((field) => {
        if (!Object.hasOwn(fieldCorrections, field.key)) {
          return { ...field, confirmationState: "confirmed" };
        }
        const value = boundedText(fieldCorrections[field.key], 1_000);
        if (!value || SECRET_VALUE_RE.test(value) || UNSAFE_FORMULA_RE.test(value)) return null;
        return {
          ...field,
          value,
          normalizedValue: normalizeFieldValue(field.key, value),
          confidence: 1,
          confirmationState: "corrected",
        };
      })
      .filter(Boolean);
    for (const [key, candidate] of Object.entries(fieldCorrections)) {
      if (fields.some((field) => field.key === key)) continue;
      const value = boundedText(candidate, 1_000);
      const definition = FIELD_BY_KEY.get(key);
      if (!value || !definition || SECRET_VALUE_RE.test(value) || UNSAFE_FORMULA_RE.test(value)) {
        return { status: 400, body: { error: "invalid_business_document_correction" } };
      }
      fields.push({
        key,
        value,
        normalizedValue: normalizeFieldValue(key, value),
        confidence: 1,
        evidenceRefs: [{
          artifactId: existing.artifactId,
          kind: "human_correction",
          field: key,
          location: "review",
        }],
        confirmationState: "corrected",
      });
    }
    const corrected = nextDocumentType !== existing.documentType
      || Object.keys(fieldCorrections).length > 0
      || excluded.size > 0;
    const recorded = recordClassification({
      ...existing,
      projectId: existing.projectId,
      sourceId: existing.sourceId,
      documentType: nextDocumentType,
      fieldProposals: fields,
      confirmationState: corrected ? "corrected" : "confirmed",
      expectedRevision,
    }, actor);
    if (recorded.status !== 200) return recorded;
    const classification = recorded.body.classification;
    let entity = null;
    const entityType = entityTypeFor(classification.documentType);
    const businessKey = businessKeyFor(classification.documentType, classification.fieldProposals);
    if (entityType && businessKey) {
      const entityInput = {
        projectId: classification.projectId,
        sourceId: classification.sourceId,
        entityType,
        businessKey,
        fields: Object.fromEntries(classification.fieldProposals.map((field) =>
          [field.key, field.normalizedValue ?? field.value])),
        evidenceRefs: classification.fieldProposals.flatMap((field) => field.evidenceRefs),
        confidence: classification.confidence,
      };
      let entityResult = createBusinessEntity(entityInput, actor);
      if (entityResult.status === 200 && entityResult.body.replayed) {
        entityResult = createBusinessEntity({
          ...entityInput,
          expectedRevision: entityResult.body.entity.revision,
        }, actor);
      }
      if ([200, 201].includes(entityResult.status)) entity = entityResult.body.entity;
    }
    return {
      status: 200,
      body: {
        classification,
        entity,
        entityReason: entity ? null : entityType ? "business_key_missing" : "document_type_has_no_primary_entity",
      },
    };
  }

  return {
    analyzeSource,
    cancelAnalysis,
    analyzeArtifact,
    listClassifications,
    listAnalysisJobs,
    confirmClassification,
  };
}
