const PLUGIN_ID = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const OPERATION_ID = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;
const EXECUTOR_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const RISK_LEVELS = new Set(["low", "medium", "high"]);
const MODES = new Set(["read", "write"]);
const AUTH_METHODS = new Set(["none", "persistent_profile", "credential"]);
const HEARTBEAT_TIERS = new Set(["manual", "logged_in"]);

/**
 * Normalize the declarative half of an executable site capability plugin.
 * The manifest deliberately names a trusted executor id, never a command or
 * script path. Product-owned code resolves executor ids after installation.
 */
export function normalizeSiteCapabilityManifest(input, { trustedExecutorIds = null } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw contractError("invalid_site_capability_manifest");
  const schemaVersion = Number(input.schemaVersion);
  const id = bounded(input.id, 64).toLowerCase();
  const name = bounded(input.name, 100);
  const version = bounded(input.version, 80);
  const executorId = bounded(input.executorId, 128).toLowerCase();
  if (schemaVersion !== 1 || input.kind !== "site_capability" || !PLUGIN_ID.test(id) || !name || !VERSION.test(version)) {
    throw contractError("invalid_site_capability_manifest");
  }
  if (!EXECUTOR_ID.test(executorId)) throw contractError("invalid_site_capability_executor");
  if (trustedExecutorIds && !new Set(trustedExecutorIds).has(executorId)) throw contractError("untrusted_site_capability_executor");

  const hosts = uniqueStrings(input.hosts, 10).map((host) => host.toLowerCase());
  if (!hosts.length || hosts.some((host) => !HOST.test(host) || host === "localhost")) {
    throw contractError("invalid_site_capability_hosts");
  }

  const authMethod = bounded(input.session?.authMethod ?? "none", 40);
  const heartbeatTier = bounded(input.session?.heartbeatTier ?? "manual", 40);
  if (!AUTH_METHODS.has(authMethod) || !HEARTBEAT_TIERS.has(heartbeatTier)) {
    throw contractError("invalid_site_capability_session");
  }
  const session = Object.freeze({
    required: input.session?.required === true,
    authMethod,
    heartbeatTier,
    accountScoped: input.session?.accountScoped !== false,
  });

  const rawOperations = Array.isArray(input.operations) ? input.operations : [];
  if (!rawOperations.length || rawOperations.length > 30) throw contractError("site_capability_operations_required");
  const seen = new Set();
  const operations = rawOperations.map((operation) => {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) throw contractError("invalid_site_capability_operation");
    const operationId = bounded(operation.id, 100).toLowerCase();
    const mode = bounded(operation.mode, 20).toLowerCase();
    const riskLevel = bounded(operation.riskLevel ?? (mode === "write" ? "medium" : "low"), 20).toLowerCase();
    if (!OPERATION_ID.test(operationId) || seen.has(operationId) || !MODES.has(mode) || !RISK_LEVELS.has(riskLevel)) {
      throw contractError("invalid_site_capability_operation");
    }
    if (mode === "write" && operation.requiresApproval !== true) throw contractError("site_write_operation_approval_required");
    seen.add(operationId);
    return Object.freeze({
      id: operationId,
      displayName: bounded(operation.displayName ?? operationId, 120),
      mode,
      riskLevel,
      requiresApproval: operation.requiresApproval === true,
      userTakeover: operation.userTakeover === true,
      inputArtifactKinds: Object.freeze(uniqueStrings(operation.inputArtifactKinds, 20)),
      outputArtifactKinds: Object.freeze(uniqueStrings(operation.outputArtifactKinds, 20)),
      riskTags: Object.freeze(uniqueStrings(operation.riskTags, 20)),
    });
  });

  return Object.freeze({
    schemaVersion: 1,
    id,
    name,
    version,
    kind: "site_capability",
    executorId,
    hosts: Object.freeze(hosts),
    session,
    operations: Object.freeze(operations),
  });
}

export function siteCapabilityOperation(manifest, operationId) {
  const normalized = normalizeSiteCapabilityManifest(manifest);
  return normalized.operations.find((operation) => operation.id === String(operationId ?? "").trim().toLowerCase()) ?? null;
}

function uniqueStrings(value, max) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw contractError("invalid_site_capability_list");
  const values = [...new Set(value.map((item) => bounded(item, 200)).filter(Boolean))];
  if (values.length > max) throw contractError("site_capability_list_too_large");
  return values;
}

function bounded(value, max) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : "";
}

function contractError(code) {
  return Object.assign(new Error(code), { code });
}
