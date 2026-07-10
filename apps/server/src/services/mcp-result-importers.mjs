const APPLICATION_RENDER_HTML_IMPORTER = "application_render_html";
const APPLICATION_JSON_SUMMARY_IMPORTER = "application_json_summary";
const APPLICATION_OPTION_CATALOG_IMPORTER = "application_option_catalog";
const APPLICATION_EVIDENCE_RECORD_IMPORTER = "application_evidence_record";
const NONE_IMPORTER = "none";
const DEFAULT_OUTPUT_COLLECTIONS = {
  [APPLICATION_RENDER_HTML_IMPORTER]: "applicationRenderResults",
  [APPLICATION_JSON_SUMMARY_IMPORTER]: "applicationResultArtifacts",
  [APPLICATION_OPTION_CATALOG_IMPORTER]: "applicationResultArtifacts",
  [APPLICATION_EVIDENCE_RECORD_IMPORTER]: "applicationResultArtifacts",
};

export function normalizeMcpResultImporters(value, { allowedTools = [] } = {}) {
  const disabledTools = new Set();
  const explicit = new Map();
  for (const entry of mcpResultImporterEntries(value)) {
    const normalized = normalizeMcpResultImporter(entry);
    if (!normalized) continue;
    if (normalized.disabled) {
      disabledTools.add(normalized.toolName);
      explicit.set(normalized.toolName, normalized);
      continue;
    }
    explicit.set(normalized.toolName, normalized);
  }

  for (const toolName of normalizeStringList(allowedTools)) {
    if (explicit.has(toolName) || disabledTools.has(toolName)) continue;
    const fallback = defaultMcpResultImporterForTool(toolName);
    if (fallback) explicit.set(toolName, fallback);
  }

  return Object.fromEntries([...explicit.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

export function mcpResultImporterForTool(agent, toolName) {
  const name = String(toolName ?? "").trim();
  if (!name) return null;
  const rawImporters = agent?.resultImporters ?? agent?.adapter?.resultImporters ?? null;
  if (mcpResultImporterExplicitlyDisabled(rawImporters, name)) return null;
  const importers = normalizeMcpResultImporters(
    rawImporters,
    { allowedTools: agent?.adapter?.allowedTools ?? [] },
  );
  return importers[name] ?? defaultMcpResultImporterForTool(name);
}

export function mcpResultImporterForInvocation(invocation, agent = null) {
  const metadata = invocation?.options?.metadata ?? {};
  const metadataImporter = normalizeMcpResultImporter(metadata.resultImporter ?? metadata.mcpResultImporter);
  if (metadataImporter?.disabled) return null;
  if (metadataImporter) return metadataImporter;
  return mcpResultImporterForTool(agent, metadata.mcpToolName ?? invocation?.options?.toolName);
}

export function mcpResultPathForImporter(importer) {
  const spec = normalizeMcpResultImporter(importer);
  if (!spec || spec.disabled) {
    return {
      outputCollection: "invocations",
      resultImport: null,
      evidenceCenter: false,
    };
  }
  return {
    outputCollection: spec.outputCollection,
    resultImport: publicMcpResultImporter(spec),
    evidenceCenter: spec.outputCollection !== "invocations",
  };
}

export function publicMcpResultImporter(importer) {
  const spec = normalizeMcpResultImporter(importer);
  if (!spec || spec.disabled) return null;
  return {
    toolName: spec.toolName,
    importer: spec.importer,
    outputCollection: spec.outputCollection,
    artifactType: spec.artifactType,
    evidenceType: spec.evidenceType,
    largeArtifactPolicy: spec.largeArtifactPolicy,
  };
}

export function isApplicationRenderHtmlImporter(importer) {
  const spec = normalizeMcpResultImporter(importer);
  return spec?.importer === APPLICATION_RENDER_HTML_IMPORTER;
}

export function isApplicationResultArtifactImporter(importer) {
  const spec = normalizeMcpResultImporter(importer);
  return spec
    && !spec.disabled
    && [
      APPLICATION_JSON_SUMMARY_IMPORTER,
      APPLICATION_OPTION_CATALOG_IMPORTER,
      APPLICATION_EVIDENCE_RECORD_IMPORTER,
    ].includes(spec.importer);
}

export function defaultMcpResultImporterForTool(toolName) {
  const name = String(toolName ?? "").trim();
  if (name === "render_markdown") {
    return normalizeMcpResultImporter({
      toolName: name,
      importer: APPLICATION_RENDER_HTML_IMPORTER,
      artifactType: "html",
      evidenceType: "rendered_markdown",
      largeArtifactPolicy: "private_result_ref",
    });
  }
  if (/^list_[a-z0-9_]+$/i.test(name)) {
    return normalizeMcpResultImporter({
      toolName: name,
      importer: APPLICATION_OPTION_CATALOG_IMPORTER,
      artifactType: "option_catalog",
      evidenceType: "mcp_option_catalog",
      largeArtifactPolicy: "private_result_ref",
    });
  }
  if (/^get_.*options?$/i.test(name) || /^explain_/i.test(name)) {
    return normalizeMcpResultImporter({
      toolName: name,
      importer: APPLICATION_JSON_SUMMARY_IMPORTER,
      artifactType: "json_summary",
      evidenceType: "mcp_json_summary",
      largeArtifactPolicy: "private_result_ref",
    });
  }
  return null;
}

export function normalizeMcpResultImporter(value) {
  if (!value) return null;
  if (value === false) return null;
  if (typeof value === "string") {
    return normalizeMcpResultImporter({ toolName: value, importer: defaultImporterForToolName(value) });
  }
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const toolName = stringOrNull(value.toolName ?? value.tool ?? value.name);
  if (!toolName) return null;
  const importer = stringOrNull(value.importer ?? value.kind ?? value.type ?? value.resultType) ?? defaultImporterForToolName(toolName);
  if (!importer || importer === NONE_IMPORTER || value.enabled === false) {
    return {
      toolName,
      importer: NONE_IMPORTER,
      outputCollection: "invocations",
      artifactType: null,
      evidenceType: null,
      largeArtifactPolicy: null,
      disabled: true,
    };
  }
  const outputCollection = stringOrNull(value.outputCollection) ?? DEFAULT_OUTPUT_COLLECTIONS[importer] ?? "invocations";
  return {
    toolName,
    importer,
    outputCollection,
    artifactType: stringOrNull(value.artifactType) ?? defaultArtifactType(importer),
    evidenceType: stringOrNull(value.evidenceType) ?? defaultEvidenceType(importer),
    largeArtifactPolicy: stringOrNull(value.largeArtifactPolicy) ?? (importer === APPLICATION_RENDER_HTML_IMPORTER ? "private_result_ref" : "summary_only"),
  };
}

function mcpResultImporterEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== "object") return [];
  const entries = [];
  for (const [toolName, raw] of Object.entries(value)) {
    if (raw === false || raw === null) {
      entries.push({ toolName, importer: NONE_IMPORTER });
    } else if (typeof raw === "string") {
      entries.push({ toolName, importer: raw });
    } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      entries.push({ toolName, ...raw });
    }
  }
  return entries;
}

function mcpResultImporterExplicitlyDisabled(value, toolName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value[toolName];
  if (raw === false || raw === null) return true;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const importer = stringOrNull(raw.importer ?? raw.kind ?? raw.type ?? raw.resultType);
    return raw.enabled === false || importer === NONE_IMPORTER;
  }
  return false;
}

function defaultImporterForToolName(toolName) {
  return defaultMcpResultImporterForTool(toolName)?.importer ?? null;
}

function defaultArtifactType(importer) {
  if (importer === APPLICATION_RENDER_HTML_IMPORTER) return "html";
  if (importer === APPLICATION_OPTION_CATALOG_IMPORTER) return "option_catalog";
  if (importer === APPLICATION_JSON_SUMMARY_IMPORTER) return "json_summary";
  if (importer === APPLICATION_EVIDENCE_RECORD_IMPORTER) return "evidence_record";
  return "artifact";
}

function defaultEvidenceType(importer) {
  if (importer === APPLICATION_RENDER_HTML_IMPORTER) return "rendered_markdown";
  if (importer === APPLICATION_OPTION_CATALOG_IMPORTER) return "mcp_option_catalog";
  if (importer === APPLICATION_JSON_SUMMARY_IMPORTER) return "mcp_json_summary";
  if (importer === APPLICATION_EVIDENCE_RECORD_IMPORTER) return "mcp_evidence_record";
  return "mcp_result";
}

function normalizeStringList(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean))];
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
