const MAX_SCHEMA_DEPTH = 8;
const MAX_SCHEMA_KEYS = 160;
const MAX_SCHEMA_ARRAY = 80;

export function emptyMcpToolInputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {},
  };
}

export function normalizeMcpToolSchemas(value, { allowedTools = [] } = {}) {
  const object = toolSchemaObject(value);
  if (!object) return {};
  const allowed = new Set(normalizeStringList(allowedTools));
  const entries = [];
  for (const [toolName, rawSchema] of Object.entries(object)) {
    const name = stringOrNull(toolName);
    if (!name || (allowed.size > 0 && !allowed.has(name))) continue;
    const schema = normalizeMcpToolSchema(rawSchema);
    if (schema) entries.push([name, schema]);
  }
  return Object.fromEntries(entries);
}

export function normalizeMcpToolSchema(value) {
  const schema = schemaCandidate(value);
  if (!schema) return null;
  const json = sanitizeJson(schema);
  return json && typeof json === "object" && !Array.isArray(json) ? json : null;
}

export function mcpToolSchemaForTool(agent, toolName) {
  return normalizeMcpToolSchema(
    agent?.toolSchemas?.[toolName]
      ?? agent?.adapter?.toolSchemas?.[toolName]
      ?? agent?.mcpAgent?.toolSchemas?.[toolName],
  ) ?? emptyMcpToolInputSchema();
}

export function publicMcpToolSchemas(value, { allowedTools = [] } = {}) {
  return normalizeMcpToolSchemas(value, { allowedTools });
}

export function mcpToolSchemasFromTools(tools) {
  if (!Array.isArray(tools)) return {};
  const entries = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) continue;
    const name = stringOrNull(tool.name);
    if (!name) continue;
    const schema = normalizeMcpToolSchema(tool);
    if (schema) entries.push([name, schema]);
  }
  return Object.fromEntries(entries);
}

export function mcpToolNamesFromTools(tools) {
  if (!Array.isArray(tools)) return [];
  return uniqueStringList(tools.map((tool) =>
    typeof tool === "string" ? tool : tool?.name,
  ));
}

function toolSchemaObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Array.isArray(value.tools)) {
    return mcpToolSchemasFromTools(value.tools);
  }
  return value;
}

function schemaCandidate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fromInput = value.inputSchema && typeof value.inputSchema === "object" && !Array.isArray(value.inputSchema)
    ? value.inputSchema
    : null;
  const fromSchema = value.schema && typeof value.schema === "object" && !Array.isArray(value.schema)
    ? value.schema
    : null;
  return fromInput ?? fromSchema ?? value;
}

function sanitizeJson(value, depth = 0, seen = { count: 0 }) {
  if (depth > MAX_SCHEMA_DEPTH) return null;
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_SCHEMA_ARRAY).map((item) => sanitizeJson(item, depth + 1, seen));
  }
  if (value && typeof value === "object") {
    const entries = [];
    for (const [key, raw] of Object.entries(value)) {
      if (seen.count >= MAX_SCHEMA_KEYS) break;
      seen.count += 1;
      const sanitized = sanitizeJson(raw, depth + 1, seen);
      if (sanitized !== undefined) entries.push([key, sanitized]);
    }
    return Object.fromEntries(entries);
  }
  return undefined;
}

function uniqueStringList(values) {
  return [...new Set(normalizeStringList(values))];
}

function normalizeStringList(values) {
  const array = Array.isArray(values) ? values : values == null ? [] : [values];
  return array.map(stringOrNull).filter(Boolean);
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
