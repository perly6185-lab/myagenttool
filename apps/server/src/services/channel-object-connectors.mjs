import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";

const MAX_SYNC_ROWS = 500;
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const KINDS = new Set(["contact", "order"]);
const STATUSES = new Set(["enabled", "disabled"]);
const SAFE_FIELDS = new Set(["name", "email", "phone", "company", "order_number", "customer"]);
const SYNC_APPROVAL_ACTION = "channel_object_connector_sync_confirm";

function teamOf(actor) { return actor?.teamId ?? LOCAL_TEAM_ID; }
function clean(value, max = 300) {
  const result = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return result ? result.slice(0, max) : null;
}
function publicConnector(adapter, configured = false) {
  return { id: adapter.id, name: adapter.name, mode: "read_only", kinds: adapter.kinds ?? [], configured };
}
function publicConfig(config) {
  return {
    id: config.id, projectId: config.projectId, connectorId: config.connectorId,
    name: config.name, kinds: config.kinds, status: config.status,
    credentialConfigured: Boolean(config.credentialRef), health: config.health,
    lastTestAt: config.lastTestAt ?? null, errorCode: config.errorCode ?? null,
    revision: config.revision, createdAt: config.createdAt, updatedAt: config.updatedAt,
  };
}
function publicPreview(preview) {
  return {
    id: preview.id, projectId: preview.projectId, connectorId: preview.connectorId,
    configId: preview.configId, kind: preview.kind, status: preview.status,
    creates: preview.creates, updates: preview.updates, unchanged: preview.unchanged,
    totalRows: preview.rows.length, sampleRows: preview.rows.slice(0, 20).map((row) => ({
      label: row.label, businessKey: row.businessKey, change: row.change,
    })), expiresAt: preview.expiresAt, createdAt: preview.createdAt,
  };
}

export function createChannelObjectConnectorService({
  state, now, nextId, appendEvent, persistStateSoon, store, upsertChannelObject, adapters = {}, validateApprovalToken,
} = {}) {
  state.channelObjectSyncs ??= [];
  state.channelObjectConnectorConfigs ??= [];
  state.channelObjectSyncPreviews ??= [];
  const external = Object.values(adapters)
    .filter((adapter) => adapter && typeof adapter.list === "function")
    .map((adapter) => ({ ...adapter, id: adapter.id ?? "external" }));
  const runTx = makeRunTx({ store, persistStateSoon });
  const builtIn = {
    id: "business_entities", name: "本地业务实体", kinds: ["contact", "order"], builtIn: true,
    async list({ projectId, actor, kind }) {
      return (state.businessEntities ?? [])
        .filter((row) => row.ownerTeamId === teamOf(actor) && row.projectId === projectId)
        .filter((row) => !kind || (kind === "contact" ? row.entityType === "customer" : row.entityType === kind))
        .map((row) => ({
          kind: row.entityType === "customer" ? "contact" : "order",
          label: row.fields?.name ?? row.fields?.customer ?? row.businessKey,
          businessKey: row.businessKey, fields: row.fields ?? {}, sourceRef: row.id,
        }));
    },
    async test() { return { ok: true }; },
  };

  function connectorFor(id) { return [builtIn, ...external].find((candidate) => candidate.id === id) ?? null; }
  function projectVisible(projectId, actor) {
    return (state.projects ?? []).some((project) => project.id === projectId
      && (project.ownerTeamId ?? LOCAL_TEAM_ID) === teamOf(actor));
  }
  function configFor(id, actor) {
    return state.channelObjectConnectorConfigs.find((config) => config.id === id && config.ownerTeamId === teamOf(actor)) ?? null;
  }
  function configConnector(config) { return connectorFor(config?.connectorId); }
  function normalizeRow(row, kind, rowNumber) {
    if (!row || typeof row !== "object" || !KINDS.has(kind)) return null;
    const source = row.fields && typeof row.fields === "object" ? row.fields : row;
    const fields = {};
    for (const [key, value] of Object.entries(source)) {
      if (SAFE_FIELDS.has(key) && clean(value)) fields[key] = clean(value, 300);
    }
    const label = clean(row.label ?? fields.name ?? fields.customer ?? fields.order_number);
    if (!label) return null;
    const businessKey = clean(row.businessKey ?? fields.order_number ?? fields.email ?? label);
    return { rowNumber, kind, label, businessKey, fields, sourceRef: clean(row.sourceRef, 300) };
  }
  async function fetchRows({ connector, config, projectId, actor, kind }) {
    if (!connector) return { error: "channel_object_connector_not_found" };
    if (!connector.builtIn && !config?.credentialRef) return { error: "channel_object_connector_credentials_not_configured" };
    try {
      const rows = await connector.list({ projectId, actor, kind, config: config ? { ...config } : null, limit: MAX_SYNC_ROWS });
      if (!Array.isArray(rows)) return { error: "channel_object_connector_invalid_rows" };
      return { rows: rows.slice(0, MAX_SYNC_ROWS).map((row, index) => normalizeRow(row, row.kind ?? kind, index + 1)).filter(Boolean) };
    } catch (error) {
      return { error: error && typeof error.code === "string" ? error.code.slice(0, 100) : "channel_object_connector_sync_failed" };
    }
  }
  function diffRows(rows, projectId, actor) {
    const existing = state.channelObjectRecords.filter((row) => row.ownerTeamId === teamOf(actor) && row.projectId === projectId);
    let creates = 0; let updates = 0; let unchanged = 0;
    const withChanges = rows.map((row) => {
      const match = existing.find((candidate) => candidate.kind === row.kind && candidate.businessKey === row.businessKey);
      if (!match) { creates += 1; return { ...row, change: "create" }; }
      const changed = match.label !== row.label || JSON.stringify(match.fields ?? {}) !== JSON.stringify(row.fields);
      if (changed) { updates += 1; return { ...row, change: "update", existingId: match.id }; }
      unchanged += 1;
      return { ...row, change: "unchanged", existingId: match.id };
    });
    return { rows: withChanges, creates, updates, unchanged };
  }

  function listChannelObjectConnectors({ projectId = null } = {}, actor = null) {
    const configs = state.channelObjectConnectorConfigs.filter((config) => config.ownerTeamId === teamOf(actor)
      && (!projectId || config.projectId === projectId));
    const connectorRows = [builtIn, ...external].map((adapter) => publicConnector(adapter,
      adapter.builtIn || configs.some((config) => config.connectorId === adapter.id && config.status === "enabled")));
    return { status: 200, body: { connectors: connectorRows } };
  }

  function listChannelObjectConnectorConfigs({ projectId = null } = {}, actor = null) {
    const configs = state.channelObjectConnectorConfigs.filter((config) => config.ownerTeamId === teamOf(actor)
      && (!projectId || config.projectId === projectId));
    return { status: 200, body: { configs: configs.map(publicConfig), count: configs.length } };
  }

  function upsertChannelObjectConnectorConfig(input = {}, actor = null) {
    const connector = connectorFor(input.connectorId);
    const projectId = clean(input.projectId, 200);
    const name = clean(input.name ?? connector?.name, 200);
    const kinds = Array.isArray(input.kinds) ? [...new Set(input.kinds.filter((kind) => KINDS.has(kind)))] : connector?.kinds ?? [];
    if (!connector || !projectId || !projectVisible(projectId, actor) || !name || !kinds.length || kinds.some((kind) => !(connector.kinds ?? []).includes(kind))) {
      return { status: 400, body: { error: "invalid_channel_object_connector_config" } };
    }
    const teamId = teamOf(actor);
    const existing = input.id
      ? state.channelObjectConnectorConfigs.find((config) => config.id === input.id && config.ownerTeamId === teamId)
      : state.channelObjectConnectorConfigs.find((config) => config.ownerTeamId === teamId && config.projectId === projectId && config.connectorId === connector.id);
    const credentialRef = connector.builtIn ? null : (input.credentialRef == null ? existing?.credentialRef ?? null : clean(input.credentialRef, 300));
    if (!connector.builtIn && (!credentialRef || /(?:token|password|secret|credential)=/i.test(credentialRef))) {
      return { status: 400, body: { error: "channel_object_connector_credential_ref_required" } };
    }
    const timestamp = now();
    if (existing) {
      if (input.expectedRevision != null && Number(input.expectedRevision) !== existing.revision) return { status: 409, body: { error: "channel_object_connector_revision_conflict", currentRevision: existing.revision } };
      runTx(() => Object.assign(existing, { name, kinds, credentialRef, status: STATUSES.has(input.status) ? input.status : existing.status, revision: existing.revision + 1, updatedAt: timestamp, updatedBy: actor?.userId ?? null }));
      return { status: 200, body: { config: publicConfig(existing), updated: true } };
    }
    const config = { id: textId(input.id) ?? nextId("cconn"), schemaVersion: 1, ownerTeamId: teamId, projectId, connectorId: connector.id, name, kinds, credentialRef, status: "enabled", health: "unknown", lastTestAt: null, errorCode: null, revision: 1, createdAt: timestamp, updatedAt: timestamp, createdBy: actor?.userId ?? null, updatedBy: actor?.userId ?? null };
    runTx(() => state.channelObjectConnectorConfigs.push(config));
    return { status: 201, body: { config: publicConfig(config), created: true } };
  }
  function textId(value) { return clean(value, 200); }

  function setChannelObjectConnectorConfigStatus(id, input = {}, actor = null) {
    const config = configFor(id, actor);
    if (!config) return { status: 404, body: { error: "channel_object_connector_config_not_found" } };
    if (!STATUSES.has(input.status) || Number(input.expectedRevision) !== config.revision) return { status: 409, body: { error: "channel_object_connector_revision_conflict", currentRevision: config.revision } };
    runTx(() => Object.assign(config, { status: input.status, revision: config.revision + 1, updatedAt: now(), updatedBy: actor?.userId ?? null }));
    return { status: 200, body: { config: publicConfig(config) } };
  }

  async function testChannelObjectConnectorConfig(id, actor = null) {
    const config = configFor(id, actor);
    const connector = configConnector(config);
    if (!config || !connector) return { status: 404, body: { error: "channel_object_connector_config_not_found" } };
    let result;
    try { result = connector.test ? await connector.test({ config: { ...config }, actor }) : { ok: false, error: "channel_object_connector_test_not_supported" }; } catch { result = { ok: false, error: "channel_object_connector_test_failed" }; }
    runTx(() => Object.assign(config, { health: result.ok ? "ready" : "error", errorCode: result.ok ? null : clean(result.error, 100), lastTestAt: now(), updatedAt: now() }));
    return { status: result.ok ? 200 : 502, body: { config: publicConfig(config), ok: Boolean(result.ok), error: result.ok ? null : config.errorCode } };
  }

  async function previewChannelObjectConnectorSync(input = {}, actor = null) {
    const config = input.configId ? configFor(input.configId, actor) : null;
    const connector = config ? configConnector(config) : connectorFor(input.connectorId);
    const projectId = clean(input.projectId ?? config?.projectId, 200);
    const kind = clean(input.kind, 60);
    if (!connector || !projectId || !projectVisible(projectId, actor) || !KINDS.has(kind) || (config && config.status !== "enabled")) return { status: 404, body: { error: "channel_object_connector_sync_not_available" } };
    const fetched = await fetchRows({ connector, config, projectId, actor, kind });
    if (fetched.error) return { status: fetched.error.includes("credential") ? 503 : 502, body: { error: fetched.error } };
    const diff = diffRows(fetched.rows, projectId, actor);
    const timestamp = now();
    const preview = { id: nextId("csync_preview"), schemaVersion: 1, ownerTeamId: teamOf(actor), projectId, connectorId: connector.id, configId: config?.id ?? null, kind, rows: diff.rows, creates: diff.creates, updates: diff.updates, unchanged: diff.unchanged, status: "preview", createdAt: timestamp, expiresAt: new Date(new Date(timestamp).getTime() + PREVIEW_TTL_MS).toISOString() };
    runTx(() => state.channelObjectSyncPreviews.push(preview));
    return { status: 201, body: { preview: publicPreview(preview), canConfirm: diff.creates + diff.updates > 0 } };
  }

  function confirmChannelObjectConnectorSync(input = {}, actor = null) {
    const preview = state.channelObjectSyncPreviews.find((row) => row.id === input.previewId && row.ownerTeamId === teamOf(actor));
    if (!preview) return { status: 404, body: { error: "channel_object_sync_preview_not_found" } };
    if (preview.status === "confirmed") return { status: 200, body: { preview: publicPreview(preview), replayed: true } };
    if (preview.status !== "preview") return { status: 409, body: { error: "channel_object_sync_preview_not_confirmable" } };
    if (new Date(preview.expiresAt).getTime() <= new Date(now()).getTime()) return { status: 409, body: { error: "channel_object_sync_preview_expired" } };
    const approval = validateApprovalToken?.(input.approvalToken, {
      action: SYNC_APPROVAL_ACTION,
      targetId: preview.id,
      actor,
      allowLegacy: false,
    });
    if (!approval?.approved) {
      return { status: 409, body: { error: "channel_object_sync_approval_required", reason: approval?.reason ?? "approval_validator_unavailable" } };
    }
    const sync = { id: nextId("csync"), ownerTeamId: teamOf(actor), projectId: preview.projectId, connectorId: preview.connectorId, configId: preview.configId, kind: preview.kind, status: "running", startedAt: now(), completedAt: null, imported: 0, failed: 0 };
    for (const row of preview.rows.filter((candidate) => candidate.change !== "unchanged")) {
      const result = upsertChannelObject({ kind: row.kind, projectId: preview.projectId, label: row.label, businessKey: row.businessKey, fields: row.fields, source: preview.connectorId, sourceRef: row.sourceRef }, actor);
      if (result.status >= 400) sync.failed += 1; else sync.imported += 1;
    }
    sync.status = sync.failed ? "succeeded_with_errors" : "succeeded";
    sync.completedAt = now();
    runTx(() => { preview.status = "confirmed"; state.channelObjectSyncs.push(sync); appendEvent?.({ invocationId: null, type: "channel_object_connector_sync_confirmed", level: sync.failed ? "warn" : "info", message: `Channel object connector ${preview.connectorId} sync confirmed.`, data: { syncId: sync.id, previewId: preview.id, imported: sync.imported, failed: sync.failed, approvalGrantId: approval.grantId ?? null } }); });
    return { status: 200, body: { preview: publicPreview(preview), sync, replayed: false } };
  }

  async function syncChannelObjectConnector(input = {}, actor = null) {
    const preview = await previewChannelObjectConnectorSync(input, actor);
    if (preview.status >= 400) {
      const failedSync = { id: nextId("csync"), ownerTeamId: teamOf(actor), projectId: clean(input.projectId, 200) ?? null, connectorId: clean(input.connectorId, 100) ?? null, configId: clean(input.configId, 200) ?? null, kind: clean(input.kind, 60) ?? null, status: "failed", startedAt: now(), completedAt: now(), imported: 0, failed: 0, error: clean(preview.body?.error, 100) };
      runTx(() => state.channelObjectSyncs.push(failedSync));
      return { ...preview, body: { ...preview.body, sync: failedSync } };
    }
    return {
      ...preview,
      body: {
        ...preview.body,
        approvalRequired: true,
        approval: { action: SYNC_APPROVAL_ACTION, targetId: preview.body.preview.id },
      },
    };
  }
  async function retryChannelObjectConnectorSync(id, actor = null) {
    const sync = state.channelObjectSyncs.find((row) => row.id === id && row.ownerTeamId === teamOf(actor));
    if (!sync) return { status: 404, body: { error: "channel_object_sync_not_found" } };
    if (sync.status !== "failed" && sync.status !== "succeeded_with_errors") return { status: 409, body: { error: "channel_object_sync_not_retryable" } };
    return syncChannelObjectConnector({ configId: sync.configId, connectorId: sync.connectorId, projectId: sync.projectId, kind: sync.kind }, actor);
  }
  function listChannelObjectSyncs({ projectId = null } = {}, actor = null) {
    const syncs = state.channelObjectSyncs.filter((row) => row.ownerTeamId === teamOf(actor) && (!projectId || row.projectId === projectId)).slice(-50).reverse().map((row) => ({ ...row, error: row.error ? clean(row.error, 100) : undefined }));
    return { status: 200, body: { syncs } };
  }
  return {
    listChannelObjectConnectors,
    listChannelObjectConnectorConfigs,
    upsertChannelObjectConnectorConfig,
    setChannelObjectConnectorConfigStatus,
    testChannelObjectConnectorConfig,
    previewChannelObjectConnectorSync,
    confirmChannelObjectConnectorSync,
    syncChannelObjectConnector,
    retryChannelObjectConnectorSync,
    listChannelObjectSyncs,
  };
}

export { SYNC_APPROVAL_ACTION as CHANNEL_OBJECT_SYNC_APPROVAL_ACTION };
