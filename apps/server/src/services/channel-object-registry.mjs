import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";

const KINDS = new Set(["contact", "order", "quotation", "shipment", "after_sales", "return", "account", "receivable", "bank_transaction", "publish_target"]);
const STATUSES = new Set(["active", "disabled"]);
const FIELD_KEYS = new Set([
  "name", "email", "phone", "company", "order_number", "quotation_number", "case_number", "return_number", "shipment_number", "receivable_number", "payment_number", "transaction_number", "customer", "issue", "resolution", "return_reason", "platform", "channel",
  "accountName", "accountNumber", "accountNumberLast4", "currency", "reference", "amount", "date", "transaction_date",
  "status", "delivery_status", "payment_status", "payment_date", "return_status", "return_amount", "paid_amount", "quantity",
]);
const SENSITIVE_KEYS = /(?:secret|token|password|credential|raw|iban|routing|cvv)/i;

function text(value, max = 300) {
  const normalized = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, max) : null;
}

function actorTeam(actor) {
  return actor?.teamId ?? LOCAL_TEAM_ID;
}

function normalizeFields(input, kind) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "invalid_channel_object_fields" };
  const fields = {};
  for (const [key, value] of Object.entries(input).slice(0, 30)) {
    if (!FIELD_KEYS.has(key) || SENSITIVE_KEYS.test(key)) continue;
    const normalized = text(value, key === "reference" ? 500 : 200);
    if (normalized) fields[key] = normalized;
  }
  if (kind === "account") {
    const raw = fields.accountNumber;
    if (raw) {
      const digits = raw.replace(/\s+/g, "");
      if (digits.length < 4) return { error: "invalid_channel_object_account" };
      fields.accountNumberLast4 = digits.slice(-4);
      delete fields.accountNumber;
    }
    delete fields.iban;
  }
  return { fields };
}

function publicRecord(record) {
  const fields = { ...(record.fields ?? {}) };
  if (fields.accountNumberLast4) fields.accountNumber = `****${fields.accountNumberLast4}`;
  delete fields.accountNumberLast4;
  return {
    id: record.id,
    kind: record.kind,
    projectId: record.projectId,
    ownerTeamId: record.ownerTeamId,
    label: record.label,
    fields,
    status: record.status,
    source: record.source,
    sourceRef: record.sourceRef ?? null,
    sourceId: record.sourceId ?? null,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createChannelObjectRegistryService({ state, now, nextId, appendEvent, persistStateSoon, store } = {}) {
  state.channelObjectRecords ??= [];
  const runTx = makeRunTx({ store, persistStateSoon });

  function projectFor(projectId, actor) {
    return (state.projects ?? []).find((project) => project.id === projectId
      && (project.ownerTeamId ?? LOCAL_TEAM_ID) === actorTeam(actor));
  }

  function listChannelObjects({ kind = null, projectId = null, status = null } = {}, actor = null) {
    const teamId = actorTeam(actor);
    const rows = state.channelObjectRecords
      .filter((record) => record.ownerTeamId === teamId)
      .filter((record) => !kind || record.kind === kind)
      .filter((record) => !projectId || record.projectId === projectId)
      .filter((record) => !status || record.status === status)
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    return { status: 200, body: { objects: rows.slice(0, 500).map(publicRecord), count: rows.length } };
  }

  function upsertChannelObject(input = {}, actor = null) {
    const kind = text(input.kind, 60);
    const projectId = text(input.projectId, 200);
    const label = text(input.label, 300);
    const source = text(input.source ?? "manual", 60);
    const sourceRef = text(input.sourceRef, 300);
    const sourceId = text(input.sourceId, 200);
    if (!KINDS.has(kind) || !projectId || !label || !source) {
      return { status: 400, body: { error: "invalid_channel_object" } };
    }
    if (!projectFor(projectId, actor)) return { status: 404, body: { error: "channel_object_project_not_found" } };
    const normalized = normalizeFields(input.fields ?? {}, kind);
    if (normalized.error) return { status: 400, body: { error: normalized.error } };
    const businessKey = text(input.businessKey ?? normalized.fields.order_number ?? normalized.fields.email ?? label, 300);
    const teamId = actorTeam(actor);
    const existing = input.id
      ? state.channelObjectRecords.find((record) => record.id === input.id && record.ownerTeamId === teamId)
      : state.channelObjectRecords.find((record) => record.ownerTeamId === teamId
        && record.projectId === projectId && record.kind === kind && record.businessKey === businessKey);
    if (existing) {
      if (input.expectedRevision != null && Number(input.expectedRevision) !== existing.revision) {
        return { status: 409, body: { error: "channel_object_revision_conflict", currentRevision: existing.revision } };
      }
      const timestamp = now();
      runTx(() => {
        Object.assign(existing, {
          label,
          businessKey,
          fields: normalized.fields,
          source,
          sourceRef,
          sourceId,
          status: STATUSES.has(input.status) ? input.status : existing.status,
          revision: existing.revision + 1,
          updatedAt: timestamp,
          updatedBy: actor?.userId ?? null,
        });
        appendEvent?.({ invocationId: null, type: "channel_object_updated", level: "info", message: `Channel object ${existing.id} updated.`, data: { channelObjectId: existing.id, kind } });
      });
      return { status: 200, body: { object: publicRecord(existing), updated: true } };
    }
    const timestamp = now();
    const record = {
      id: text(input.id, 200) ?? nextId("cobj"),
      schemaVersion: 1,
      ownerTeamId: teamId,
      projectId,
      kind,
      label,
      businessKey,
      fields: normalized.fields,
      source,
      sourceRef,
      sourceId,
      status: STATUSES.has(input.status) ? input.status : "active",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actor?.userId ?? null,
      updatedBy: actor?.userId ?? null,
    };
    if (state.channelObjectRecords.some((candidate) => candidate.id === record.id)) {
      return { status: 409, body: { error: "channel_object_id_conflict" } };
    }
    runTx(() => {
      state.channelObjectRecords.push(record);
      appendEvent?.({ invocationId: null, type: "channel_object_created", level: "info", message: `Channel object ${record.id} created.`, data: { channelObjectId: record.id, kind } });
    });
    return { status: 201, body: { object: publicRecord(record), created: true } };
  }

  function setChannelObjectStatus(id, input = {}, actor = null) {
    const record = state.channelObjectRecords.find((candidate) => candidate.id === id && candidate.ownerTeamId === actorTeam(actor));
    if (!record) return { status: 404, body: { error: "channel_object_not_found" } };
    if (!STATUSES.has(input.status) || Number(input.expectedRevision) !== record.revision) {
      return { status: 409, body: { error: "channel_object_revision_conflict", currentRevision: record.revision } };
    }
    const timestamp = now();
    runTx(() => {
      record.status = input.status;
      record.revision += 1;
      record.updatedAt = timestamp;
      record.updatedBy = actor?.userId ?? null;
      appendEvent?.({ invocationId: null, type: "channel_object_status_changed", level: "info", message: `Channel object ${record.id} status changed.`, data: { channelObjectId: record.id, status: record.status } });
    });
    return { status: 200, body: { object: publicRecord(record) } };
  }

  return { listChannelObjects, upsertChannelObject, setChannelObjectStatus };
}
