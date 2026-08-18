import { createHash } from "node:crypto";

function clean(value, max = 300) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, max) : null;
}

function key(value) {
  return clean(value, 300)?.normalize("NFKC").toLocaleLowerCase() ?? null;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function relationView(relation, requirements, recordsByRequirement) {
  const from = requirements.find((item) => item.id === relation.fromRequirementId);
  const to = requirements.find((item) => item.id === relation.toRequirementId);
  const fromRows = recordsByRequirement.get(from?.id) ?? [];
  const toRows = recordsByRequirement.get(to?.id) ?? [];
  const fromField = relation.fromField;
  const toField = relation.toField;
  const missingFields = [];
  if (fromRows.some((row) => !Object.hasOwn(row.fields ?? {}, fromField))) missingFields.push(`${from?.label ?? from?.id}.${fromField}`);
  if (toRows.some((row) => !Object.hasOwn(row.fields ?? {}, toField))) missingFields.push(`${to?.label ?? to?.id}.${toField}`);
  const targetIndex = new Map();
  for (const row of toRows) {
    const value = key(row.fields?.[toField]);
    if (!value) continue;
    const bucket = targetIndex.get(value) ?? [];
    bucket.push(row);
    targetIndex.set(value, bucket);
  }
  let matchedRows = 0;
  let unmatchedRows = 0;
  const unmatchedSamples = [];
  for (const row of fromRows) {
    const value = key(row.fields?.[fromField]);
    const matches = value ? targetIndex.get(value) ?? [] : [];
    if (matches.length) matchedRows += 1;
    else {
      unmatchedRows += 1;
      if (unmatchedSamples.length < 5) unmatchedSamples.push(clean(row.label ?? row.businessKey, 160));
    }
  }
  const duplicateTargetValues = [...targetIndex.values()].filter((bucket) => bucket.length > 1).length;
  const state = missingFields.length
    ? "invalid_field"
    : relation.required && unmatchedRows > 0
      ? "unmatched"
      : "ready";
  return {
    id: relation.id,
    type: relation.type,
    fromRequirementId: relation.fromRequirementId,
    fromField,
    toRequirementId: relation.toRequirementId,
    toField,
    required: relation.required,
    state,
    fromRowCount: fromRows.length,
    toRowCount: toRows.length,
    matchedRows,
    unmatchedRows,
    duplicateTargetValues,
    missingFields,
    unmatchedSamples: unmatchedSamples.filter(Boolean),
  };
}

export function buildDataRelationPreview({ state, plan, projectId, ownerTeamId } = {}) {
  if (!plan || plan.status === "not_required") {
    const empty = { schemaVersion: 1, status: "not_required", relations: [], objectSnapshot: [] };
    return { ...empty, digest: digest(empty) };
  }
  if (plan.status !== "ready") {
    const waiting = { schemaVersion: 1, status: "waiting_for_data_plan", relations: [], objectSnapshot: [] };
    return { ...waiting, digest: digest(waiting) };
  }
  const records = (state?.channelObjectRecords ?? [])
    .filter((record) => record.ownerTeamId === ownerTeamId
      && record.projectId === projectId
      && record.status !== "disabled");
  const recordsBySource = new Map();
  for (const record of records) {
    const bucket = recordsBySource.get(record.sourceId) ?? [];
    bucket.push(record);
    recordsBySource.set(record.sourceId, bucket);
  }
  const recordsByRequirement = new Map();
  for (const requirement of plan.requirements ?? []) {
    recordsByRequirement.set(requirement.id, recordsBySource.get(requirement.sourceId) ?? []);
  }
  const relations = (plan.relations ?? []).map((relation) => relationView(relation, plan.requirements ?? [], recordsByRequirement));
  const requiredFailures = relations.filter((relation) => relation.required && relation.state !== "ready");
  const objectSnapshot = [...new Map(
    [...recordsByRequirement.values()].flatMap((rows) => rows).map((record) => [record.id, {
      id: record.id,
      sourceId: record.sourceId ?? null,
      revision: Number.isInteger(Number(record.revision)) ? Number(record.revision) : null,
    }]),
  ).values()].slice(0, 2_000);
  const result = {
    schemaVersion: 1,
    status: requiredFailures.length ? "needs_review" : "ready",
    relations,
    objectSnapshot,
  };
  return { ...result, digest: digest(result) };
}

export function dataRelationPreviewMatchesCurrent({ state, preview, plan, projectId, ownerTeamId } = {}) {
  const current = buildDataRelationPreview({ state, plan, projectId, ownerTeamId });
  return { ok: current.digest === preview?.digest && current.status === preview?.status, current };
}

export function normalizeDataRelationPreview(input) {
  if (input == null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const status = ["not_required", "waiting_for_data_plan", "ready", "needs_review", "stale"].includes(input.status)
    ? input.status
    : "waiting_for_data_plan";
  const relations = Array.isArray(input.relations) ? input.relations.slice(0, 20).map((relation) => ({
    id: clean(relation?.id, 80),
    type: clean(relation?.type, 30),
    fromRequirementId: clean(relation?.fromRequirementId, 80),
    fromField: clean(relation?.fromField, 120),
    toRequirementId: clean(relation?.toRequirementId, 80),
    toField: clean(relation?.toField, 120),
    required: relation?.required !== false,
    state: ["ready", "invalid_field", "unmatched"].includes(relation?.state) ? relation.state : "unmatched",
    fromRowCount: Number.isInteger(Number(relation?.fromRowCount)) ? Number(relation.fromRowCount) : 0,
    toRowCount: Number.isInteger(Number(relation?.toRowCount)) ? Number(relation.toRowCount) : 0,
    matchedRows: Number.isInteger(Number(relation?.matchedRows)) ? Number(relation.matchedRows) : 0,
    unmatchedRows: Number.isInteger(Number(relation?.unmatchedRows)) ? Number(relation.unmatchedRows) : 0,
    duplicateTargetValues: Number.isInteger(Number(relation?.duplicateTargetValues)) ? Number(relation.duplicateTargetValues) : 0,
    missingFields: Array.isArray(relation?.missingFields) ? relation.missingFields.slice(0, 10).map((value) => clean(value, 160)).filter(Boolean) : [],
    unmatchedSamples: Array.isArray(relation?.unmatchedSamples) ? relation.unmatchedSamples.slice(0, 5).map((value) => clean(value, 160)).filter(Boolean) : [],
  })) : [];
  const objectSnapshot = Array.isArray(input.objectSnapshot) ? input.objectSnapshot.slice(0, 2_000).map((record) => ({
    id: clean(record?.id, 200),
    sourceId: clean(record?.sourceId, 200),
    revision: Number.isInteger(Number(record?.revision)) ? Number(record.revision) : null,
  })).filter((record) => record.id) : [];
  return {
    schemaVersion: 1,
    status,
    relations,
    objectSnapshot,
    digest: clean(input.digest, 128),
  };
}
