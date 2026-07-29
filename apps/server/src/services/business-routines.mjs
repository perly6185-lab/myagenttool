import { createHash } from "node:crypto";

import {
  businessCaseStates,
  businessDocumentTypes,
  businessEntityTypes,
  businessRoutineSchemaVersion,
  ledgerDefinitionStates,
  normalizeBusinessDocumentClassification,
  normalizeLocalIssueRoutineBinding,
  normalizeRoutineEvidenceRefs,
  normalizeRoutineSteps,
  routineArtifactRoles,
} from "@myagenttool/protocol/business-routine";

import { actorCanAccessProject, LOCAL_TEAM_ID, LOCAL_USER_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

export const businessRoutineCollectionKeys = [
  "businessDocumentClassifications",
  "businessEntities",
  "businessCases",
  "routineDefinitions",
  "routineRuns",
  "ledgerDefinitions",
];

const DEFINITION_TRANSITIONS = {
  candidate: { review: "draft" },
  draft: { publish: "published" },
  published: { disable: "disabled", supersede: "superseded" },
  disabled: { enable: "published", supersede: "superseded" },
  superseded: {},
};

const STEP_TRANSITIONS = {
  pending: { start: "running", skip: "skipped", cancel: "cancelled" },
  running: { await_approval: "awaiting_approval", succeed: "succeeded", fail: "failed", cancel: "cancelled" },
  awaiting_approval: { approve: "succeeded", reject: "failed", cancel: "cancelled" },
  failed: { retry: "pending", cancel: "cancelled" },
  succeeded: {},
  skipped: {},
  cancelled: {},
};

const SAFE_FIELD_RE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,119}$/;
const SENSITIVE_FIELD_RE = /(?:password|secret|token|credential|raw_?content|prompt)/i;
const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

function text(value, max = 200) {
  const normalized = String(value ?? "").trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function stringList(values, { maxItems = 100, maxLength = 200 } = {}) {
  if (!Array.isArray(values) || values.length > maxItems) return null;
  const normalized = [...new Set(values.map((value) => text(value, maxLength)).filter(Boolean))];
  return normalized.length <= maxItems ? normalized : null;
}

function confidence(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}

function relativePath(value) {
  const path = text(value, 1_000)?.replaceAll("\\", "/");
  if (!path || path.startsWith("/") || WINDOWS_ABSOLUTE_RE.test(path) || path.split("/").includes("..")) return null;
  return path;
}

function normalizeFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 100) return null;
  const fields = {};
  for (const [key, candidate] of entries) {
    if (!SAFE_FIELD_RE.test(key) || SENSITIVE_FIELD_RE.test(key)) return null;
    if (candidate == null || typeof candidate === "boolean") {
      fields[key] = candidate;
    } else if (typeof candidate === "number" && Number.isFinite(candidate)) {
      fields[key] = candidate;
    } else if (typeof candidate === "string" && candidate.length <= 1_000) {
      fields[key] = candidate;
    } else {
      return null;
    }
  }
  return fields;
}

function normalizeFieldMappings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 100) return null;
  const mappings = {};
  for (const [key, target] of entries) {
    const normalizedTarget = text(target, 200);
    if (!SAFE_FIELD_RE.test(key) || SENSITIVE_FIELD_RE.test(key) || !normalizedTarget) return null;
    mappings[key] = normalizedTarget;
  }
  return mappings;
}

function hashKey(parts) {
  return createHash("sha256")
    .update(JSON.stringify(parts.map((part) => String(part ?? ""))))
    .digest("hex");
}

export function routineIdempotencyKeys({
  ownerTeamId,
  routineDefinitionId,
  routineVersion,
  businessKey,
  stepKey = null,
  outputPath = null,
  ledgerDefinitionId = null,
} = {}) {
  const base = [businessRoutineSchemaVersion, ownerTeamId, routineDefinitionId, routineVersion, businessKey];
  return {
    issue: `business-routine:issue:v1:${hashKey(base)}`,
    step: stepKey ? `business-routine:step:v1:${hashKey([...base, stepKey])}` : null,
    outputPublication: `business-routine:publish:v1:${hashKey([...base, outputPath ?? "*"])}`,
    ledgerUpsert: ledgerDefinitionId
      ? `business-routine:ledger:v1:${hashKey([...base, ledgerDefinitionId])}`
      : null,
  };
}

export function migrateBusinessRoutineState(state) {
  for (const key of businessRoutineCollectionKeys) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  return state;
}

export function createBusinessRoutineService({
  state,
  now = () => new Date().toISOString(),
  nextId = (prefix) => `${prefix}_${Date.now().toString(36)}`,
  appendEvent = () => {},
  persistStateSoon = () => {},
  store,
} = {}) {
  migrateBusinessRoutineState(state);
  const runTx = makeRunTx({ store, persistStateSoon });
  const actorTeam = (actor) => actor?.teamId ?? LOCAL_TEAM_ID;
  const actorUser = (actor) => actor?.userId ?? LOCAL_USER_ID;
  const visible = (row, actor) => row?.ownerTeamId === actorTeam(actor);
  const projectFor = (projectId, actor) =>
    actorCanAccessProject(state, actor, projectId)
      ? state.projects?.find((project) => project.id === projectId) ?? null
      : null;
  const sourceFor = (sourceId, actor, { active = false } = {}) => {
    const source = state.workflowSources?.find((row) => row.id === sourceId && visible(row, actor)) ?? null;
    if (!source || (active && source.state !== "active")) return null;
    return source;
  };
  const artifactFor = (artifactId, actor) =>
    state.workflowArtifacts?.find((row) => row.id === artifactId && visible(row, actor)) ?? null;
  const evidenceBelongsTo = (evidenceRefs, context, actor) =>
    evidenceRefs.every((ref) => {
      const artifact = artifactFor(ref.artifactId, actor);
      return artifact?.projectId === context.projectId && artifact?.sourceId === context.sourceId;
    });

  function event(type, message, record, actor, extra = {}) {
    appendEvent({
      invocationId: null,
      type,
      level: type.includes("disabled") || type.includes("failed") ? "warning" : "info",
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

  function activeContext(input, actor) {
    const projectId = text(input?.projectId);
    const sourceId = text(input?.sourceId);
    const project = projectId ? projectFor(projectId, actor) : null;
    const source = sourceId ? sourceFor(sourceId, actor, { active: true }) : null;
    if (!project || !source || source.projectId !== project.id) {
      return { error: "business_routine_context_not_found" };
    }
    return { project, source, projectId, sourceId };
  }

  function recordDocumentClassification(input = {}, actor = null) {
    const context = activeContext(input, actor);
    if (context.error) return { status: 404, body: { error: context.error } };
    const normalized = normalizeBusinessDocumentClassification(input);
    if (!normalized.ok) return { status: 400, body: { error: normalized.error } };
    const artifact = artifactFor(normalized.value.artifactId, actor);
    if (!artifact || artifact.projectId !== context.projectId || artifact.sourceId !== context.sourceId) {
      return { status: 404, body: { error: "business_document_artifact_not_found" } };
    }
    if (!evidenceBelongsTo(normalized.value.evidenceRefs, context, actor)) {
      return { status: 404, body: { error: "business_document_evidence_not_found" } };
    }
    const existing = state.businessDocumentClassifications.find((row) =>
      visible(row, actor) && row.artifactId === artifact.id);
    if (existing && input.expectedRevision !== existing.revision) {
      return {
        status: 409,
        body: { error: "business_document_classification_revision_conflict", currentRevision: existing.revision },
      };
    }
    const timestamp = now();
    if (existing) {
      runTx(() => {
        Object.assign(existing, normalized.value, {
          revision: existing.revision + 1,
          updatedAt: timestamp,
          updatedBy: actorUser(actor),
        });
        event("business_document_classification_updated", "Business document classification updated.", existing, actor, {
          classificationId: existing.id,
          artifactId: artifact.id,
          documentType: existing.documentType,
          revision: existing.revision,
        });
      });
      return { status: 200, body: { classification: existing } };
    }
    const classification = {
      id: nextId("bdc"),
      ownerTeamId: actorTeam(actor),
      projectId: context.projectId,
      sourceId: context.sourceId,
      ...normalized.value,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      state.businessDocumentClassifications.push(classification);
      event("business_document_classification_recorded", "Business document classification recorded.", classification, actor, {
        classificationId: classification.id,
        artifactId: artifact.id,
        documentType: classification.documentType,
      });
    });
    return { status: 201, body: { classification } };
  }

  function createBusinessEntity(input = {}, actor = null) {
    const context = activeContext(input, actor);
    if (context.error) return { status: 404, body: { error: context.error } };
    const entityType = businessEntityTypes.includes(input.entityType) ? input.entityType : null;
    const businessKey = text(input.businessKey, 200);
    const fields = normalizeFields(input.fields ?? {});
    const evidenceRefs = normalizeRoutineEvidenceRefs(input.evidenceRefs ?? []);
    const score = confidence(input.confidence ?? 1);
    if (!entityType || !businessKey || !fields || !evidenceRefs || score == null) {
      return { status: 400, body: { error: "invalid_business_entity" } };
    }
    if (!evidenceBelongsTo(evidenceRefs, context, actor)) {
      return { status: 404, body: { error: "business_entity_evidence_not_found" } };
    }
    const idempotencyKey = `business-entity:v1:${hashKey([
      actorTeam(actor), context.sourceId, entityType, businessKey,
    ])}`;
    const replay = state.businessEntities.find((row) =>
      visible(row, actor) && row.idempotencyKey === idempotencyKey);
    if (replay) return { status: 200, body: { entity: replay, replayed: true } };
    const timestamp = now();
    const entity = {
      id: nextId("bent"),
      schemaVersion: businessRoutineSchemaVersion,
      ownerTeamId: actorTeam(actor),
      projectId: context.projectId,
      sourceId: context.sourceId,
      entityType,
      businessKey,
      fields,
      evidenceRefs,
      confidence: score,
      idempotencyKey,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      state.businessEntities.push(entity);
      event("business_entity_created", "Business entity created.", entity, actor, {
        businessEntityId: entity.id,
        entityType,
      });
    });
    return { status: 201, body: { entity, replayed: false } };
  }

  function createBusinessCase(input = {}, actor = null) {
    const context = activeContext(input, actor);
    if (context.error) return { status: 404, body: { error: context.error } };
    const businessKey = text(input.businessKey, 200);
    const entityIds = stringList(input.entityIds ?? []);
    const evidenceRefs = normalizeRoutineEvidenceRefs(input.evidenceRefs ?? []);
    const score = confidence(input.confidence ?? 1);
    const stateValue = businessCaseStates.includes(input.state) ? input.state : "proposed";
    if (!businessKey || !entityIds || !evidenceRefs || score == null
      || !Array.isArray(input.artifactBindings) || !input.artifactBindings.length
      || input.artifactBindings.length > 100) {
      return { status: 400, body: { error: "invalid_business_case" } };
    }
    const entities = entityIds.map((id) =>
      state.businessEntities.find((row) => row.id === id && visible(row, actor)));
    if (entities.some((entity) => !entity || entity.sourceId !== context.sourceId)) {
      return { status: 404, body: { error: "business_case_entity_not_found" } };
    }
    if (!evidenceBelongsTo(evidenceRefs, context, actor)) {
      return { status: 404, body: { error: "business_case_evidence_not_found" } };
    }
    const artifactBindings = [];
    for (const binding of input.artifactBindings) {
      const artifactId = text(binding?.artifactId);
      const documentType = businessDocumentTypes.includes(binding?.documentType) ? binding.documentType : null;
      const roles = stringList(binding?.roles ?? [], { maxItems: 4 });
      const artifact = artifactId ? artifactFor(artifactId, actor) : null;
      if (!artifact || artifact.sourceId !== context.sourceId || !documentType || !roles?.length
        || roles.some((role) => !routineArtifactRoles.includes(role))) {
        return { status: 400, body: { error: "invalid_business_case_artifact_binding" } };
      }
      artifactBindings.push({ artifactId, documentType, roles });
    }
    const idempotencyKey = `business-case:v1:${hashKey([
      actorTeam(actor), context.sourceId, businessKey,
    ])}`;
    const replay = state.businessCases.find((row) =>
      visible(row, actor) && row.idempotencyKey === idempotencyKey);
    if (replay) return { status: 200, body: { businessCase: replay, replayed: true } };
    const timestamp = now();
    const businessCase = {
      id: nextId("bcs"),
      schemaVersion: businessRoutineSchemaVersion,
      ownerTeamId: actorTeam(actor),
      projectId: context.projectId,
      sourceId: context.sourceId,
      businessKey,
      state: stateValue,
      entityIds,
      artifactBindings,
      evidenceRefs,
      confidence: score,
      idempotencyKey,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      state.businessCases.push(businessCase);
      event("business_case_created", "Business case created.", businessCase, actor, {
        businessCaseId: businessCase.id,
        artifactCount: artifactBindings.length,
      });
    });
    return { status: 201, body: { businessCase, replayed: false } };
  }

  function createRoutineDefinition(input = {}, actor = null) {
    const context = activeContext(input, actor);
    if (context.error) return { status: 404, body: { error: context.error } };
    const name = text(input.name, 200);
    const triggerDocumentTypes = stringList(input.triggerDocumentTypes ?? [], { maxItems: 20, maxLength: 50 });
    const steps = normalizeRoutineSteps(input.steps);
    const evidenceRefs = normalizeRoutineEvidenceRefs(input.evidenceRefs ?? []);
    const score = confidence(input.confidence ?? 1);
    const requestedState = ["candidate", "draft"].includes(input.state) ? input.state : "candidate";
    if (!name || !triggerDocumentTypes?.length
      || triggerDocumentTypes.some((type) => !businessDocumentTypes.includes(type))
      || !steps.ok || !evidenceRefs || score == null) {
      return { status: 400, body: { error: steps.error ?? "invalid_routine_definition" } };
    }
    if (!evidenceBelongsTo(evidenceRefs, context, actor)
      || steps.value.some((step) => !evidenceBelongsTo(step.evidenceRefs, context, actor))) {
      return { status: 404, body: { error: "routine_definition_evidence_not_found" } };
    }
    const idempotencyKey = `routine-definition:v1:${hashKey([
      actorTeam(actor), context.sourceId, name, evidenceRefs.map((ref) => ref.artifactId).sort(),
    ])}`;
    const replay = state.routineDefinitions.find((row) =>
      visible(row, actor) && row.idempotencyKey === idempotencyKey);
    if (replay) return { status: 200, body: { routineDefinition: replay, replayed: true } };
    const timestamp = now();
    const id = nextId("rtd");
    const routineDefinition = {
      id,
      familyId: id,
      schemaVersion: businessRoutineSchemaVersion,
      ownerTeamId: actorTeam(actor),
      projectId: context.projectId,
      sourceId: context.sourceId,
      name,
      version: 1,
      state: requestedState,
      triggerDocumentTypes,
      steps: steps.value,
      evidenceRefs,
      confidence: score,
      supersedesId: null,
      supersededById: null,
      idempotencyKey,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      state.routineDefinitions.push(routineDefinition);
      event("routine_definition_created", "Business routine definition created.", routineDefinition, actor, {
        routineDefinitionId: id,
        state: routineDefinition.state,
        version: 1,
      });
    });
    return { status: 201, body: { routineDefinition, replayed: false } };
  }

  function transitionRoutineDefinition({
    routineDefinitionId,
    expectedRevision,
    action,
    supersededById = null,
  } = {}, actor = null) {
    const definition = state.routineDefinitions.find((row) =>
      row.id === routineDefinitionId && visible(row, actor));
    if (!definition) return { status: 404, body: { error: "routine_definition_not_found" } };
    if (expectedRevision !== definition.revision) {
      return {
        status: 409,
        body: { error: "routine_definition_revision_conflict", currentRevision: definition.revision },
      };
    }
    if (!sourceFor(definition.sourceId, actor, { active: action !== "disable" && action !== "supersede" })) {
      return { status: 409, body: { error: "routine_definition_source_revoked" } };
    }
    const nextState = DEFINITION_TRANSITIONS[definition.state]?.[action] ?? null;
    if (!nextState) {
      return { status: 409, body: { error: "invalid_routine_definition_transition", currentState: definition.state } };
    }
    let replacement = null;
    if (action === "supersede") {
      replacement = state.routineDefinitions.find((row) =>
        row.id === supersededById && visible(row, actor) && row.familyId === definition.familyId
        && row.state === "published");
      if (!replacement) return { status: 400, body: { error: "invalid_routine_definition_replacement" } };
    }
    runTx(() => {
      definition.state = nextState;
      definition.supersededById = replacement?.id ?? definition.supersededById;
      definition.revision += 1;
      definition.updatedAt = now();
      definition.updatedBy = actorUser(actor);
      event(`routine_definition_${nextState}`, `Business routine definition ${nextState}.`, definition, actor, {
        routineDefinitionId: definition.id,
        state: nextState,
        version: definition.version,
        supersededById: replacement?.id ?? null,
      });
    });
    return { status: 200, body: { routineDefinition: definition } };
  }

  function createLedgerDefinition(input = {}, actor = null) {
    const context = activeContext(input, actor);
    if (context.error) return { status: 404, body: { error: context.error } };
    const name = text(input.name, 200);
    const format = ["csv", "xlsx"].includes(input.format) ? input.format : null;
    const path = relativePath(input.relativePath);
    const sheet = input.sheet == null || input.sheet === "" ? null : text(input.sheet, 200);
    const businessKeyField = text(input.businessKeyField, 120);
    const fieldMappings = normalizeFieldMappings(input.fieldMappings);
    const requestedState = ledgerDefinitionStates.includes(input.state) ? input.state : "draft";
    if (!name || !format || !path || (input.sheet != null && input.sheet !== "" && !sheet)
      || (format === "csv" && sheet) || !businessKeyField || !SAFE_FIELD_RE.test(businessKeyField)
      || SENSITIVE_FIELD_RE.test(businessKeyField) || !fieldMappings || requestedState !== "draft") {
      return { status: 400, body: { error: "invalid_ledger_definition" } };
    }
    const idempotencyKey = `ledger-definition:v1:${hashKey([
      actorTeam(actor), context.sourceId, path, sheet ?? "", businessKeyField,
    ])}`;
    const replay = state.ledgerDefinitions.find((row) =>
      visible(row, actor) && row.idempotencyKey === idempotencyKey);
    if (replay) return { status: 200, body: { ledgerDefinition: replay, replayed: true } };
    const timestamp = now();
    const ledgerDefinition = {
      id: nextId("ldg"),
      schemaVersion: businessRoutineSchemaVersion,
      ownerTeamId: actorTeam(actor),
      projectId: context.projectId,
      sourceId: context.sourceId,
      name,
      state: requestedState,
      format,
      relativePath: path,
      sheet,
      businessKeyField,
      fieldMappings,
      idempotencyKey,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      state.ledgerDefinitions.push(ledgerDefinition);
      event("ledger_definition_created", "Ledger definition created.", ledgerDefinition, actor, {
        ledgerDefinitionId: ledgerDefinition.id,
        format,
      });
    });
    return { status: 201, body: { ledgerDefinition, replayed: false } };
  }

  function createRoutineRun(input = {}, actor = null) {
    const definition = state.routineDefinitions.find((row) =>
      row.id === input.routineDefinitionId && visible(row, actor));
    const businessCase = state.businessCases.find((row) =>
      row.id === input.businessCaseId && visible(row, actor));
    if (!definition || !businessCase || definition.projectId !== businessCase.projectId
      || definition.sourceId !== businessCase.sourceId) {
      return { status: 404, body: { error: "routine_run_context_not_found" } };
    }
    if (input.routineVersion !== definition.version) {
      return { status: 409, body: { error: "routine_definition_not_published_or_version_mismatch" } };
    }
    const keys = routineIdempotencyKeys({
      ownerTeamId: actorTeam(actor),
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessKey: businessCase.businessKey,
    });
    const replay = state.routineRuns.find((row) =>
      visible(row, actor) && row.issueIdempotencyKey === keys.issue);
    if (replay) return { status: 200, body: { routineRun: replay, replayed: true } };
    if (!sourceFor(definition.sourceId, actor, { active: true })) {
      return { status: 409, body: { error: "routine_run_source_revoked" } };
    }
    if (definition.state !== "published") {
      return { status: 409, body: { error: "routine_definition_not_published_or_version_mismatch" } };
    }
    if (!["confirmed", "active"].includes(businessCase.state)) {
      return { status: 409, body: { error: "routine_business_case_not_confirmed" } };
    }
    const binding = normalizeLocalIssueRoutineBinding({
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessCaseId: businessCase.id,
      businessKey: businessCase.businessKey,
      triggerArtifactIds: input.triggerArtifactIds,
    });
    if (!binding.ok) return { status: 400, body: { error: binding.error } };
    const triggerArtifacts = binding.value.triggerArtifactIds.map((artifactId) =>
      artifactFor(artifactId, actor));
    if (triggerArtifacts.some((artifact) =>
      !artifact || artifact.projectId !== definition.projectId || artifact.sourceId !== definition.sourceId
      || artifact.availability === "missing" || artifact.exclusion)) {
      return { status: 404, body: { error: "routine_run_trigger_artifact_not_found" } };
    }
    const workItemId = input.workItemId == null ? null : text(input.workItemId);
    if (input.workItemId != null && !workItemId) {
      return { status: 400, body: { error: "invalid_routine_run_work_item" } };
    }
    if (workItemId) {
      const workItem = state.workItems?.find((row) =>
        row.id === workItemId
        && row.ownerTeamId === actorTeam(actor)
        && row.projectId === definition.projectId);
      if (!workItem
        || workItem.routineDefinitionId !== definition.id
        || workItem.routineVersion !== definition.version
        || workItem.businessCaseId !== businessCase.id
        || workItem.businessKey !== businessCase.businessKey) {
        return { status: 409, body: { error: "routine_run_work_item_binding_mismatch" } };
      }
    }
    const timestamp = now();
    const routineRun = {
      id: nextId("rtr"),
      schemaVersion: businessRoutineSchemaVersion,
      ownerTeamId: actorTeam(actor),
      projectId: definition.projectId,
      sourceId: definition.sourceId,
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessCaseId: businessCase.id,
      businessKey: businessCase.businessKey,
      triggerArtifactIds: binding.value.triggerArtifactIds,
      workItemId,
      status: "planned",
      issueIdempotencyKey: keys.issue,
      outputPublicationIdempotencyKey: keys.outputPublication,
      stepRuns: definition.steps.map((step) => ({
        stepKey: step.key,
        kind: step.kind,
        state: "pending",
        idempotencyKey: routineIdempotencyKeys({
          ownerTeamId: actorTeam(actor),
          routineDefinitionId: definition.id,
          routineVersion: definition.version,
          businessKey: businessCase.businessKey,
          stepKey: step.key,
        }).step,
        startedAt: null,
        completedAt: null,
        errorCode: null,
      })),
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      state.routineRuns.push(routineRun);
      event("routine_run_created", "Business routine run created.", routineRun, actor, {
        routineRunId: routineRun.id,
        routineDefinitionId: definition.id,
        routineVersion: definition.version,
        businessCaseId: businessCase.id,
      });
    });
    return { status: 201, body: { routineRun, binding: binding.value, replayed: false } };
  }

  function transitionRoutineStep({
    routineRunId,
    stepKey,
    expectedRevision,
    action,
    errorCode = null,
  } = {}, actor = null) {
    const run = state.routineRuns.find((row) => row.id === routineRunId && visible(row, actor));
    if (!run) return { status: 404, body: { error: "routine_run_not_found" } };
    if (expectedRevision !== run.revision) {
      return { status: 409, body: { error: "routine_run_revision_conflict", currentRevision: run.revision } };
    }
    const stepRun = run.stepRuns.find((row) => row.stepKey === stepKey);
    const definition = state.routineDefinitions.find((row) =>
      row.id === run.routineDefinitionId && row.version === run.routineVersion && visible(row, actor));
    const step = definition?.steps.find((row) => row.key === stepKey);
    if (!stepRun || !step) return { status: 404, body: { error: "routine_step_not_found" } };
    const nextState = STEP_TRANSITIONS[stepRun.state]?.[action] ?? null;
    if (!nextState) {
      return { status: 409, body: { error: "invalid_routine_step_transition", currentState: stepRun.state } };
    }
    if (action === "await_approval" && step.kind !== "human_approval") {
      return { status: 409, body: { error: "routine_step_does_not_require_approval" } };
    }
    if (action === "succeed" && step.kind === "human_approval") {
      return { status: 409, body: { error: "human_approval_step_cannot_bypass_approval" } };
    }
    if (action === "start") {
      const unmet = step.dependsOn.filter((dependency) => {
        const dependencyRun = run.stepRuns.find((row) => row.stepKey === dependency);
        return !["succeeded", "skipped"].includes(dependencyRun?.state);
      });
      if (unmet.length) return { status: 409, body: { error: "routine_step_dependencies_incomplete", unmet } };
      if (!sourceFor(run.sourceId, actor, { active: true })) {
        return { status: 409, body: { error: "routine_run_source_revoked" } };
      }
    }
    if (action === "skip" && step.required) {
      return { status: 409, body: { error: "required_routine_step_cannot_skip" } };
    }
    const timestamp = now();
    runTx(() => {
      stepRun.state = nextState;
      if (nextState === "running" && !stepRun.startedAt) stepRun.startedAt = timestamp;
      if (["succeeded", "skipped", "failed", "cancelled"].includes(nextState)) stepRun.completedAt = timestamp;
      stepRun.errorCode = nextState === "failed" ? text(errorCode, 200) ?? "routine_step_failed" : null;
      const states = run.stepRuns.map((row) => row.state);
      if (states.every((state) => ["succeeded", "skipped"].includes(state))) run.status = "succeeded";
      else if (states.some((state) => state === "awaiting_approval")) run.status = "awaiting_approval";
      else if (states.some((state) => state === "failed")) run.status = "failed";
      else if (states.every((state) => state === "cancelled")) run.status = "cancelled";
      else if (states.some((state) => state === "running")) run.status = "running";
      else run.status = "planned";
      run.revision += 1;
      run.updatedAt = timestamp;
      run.updatedBy = actorUser(actor);
      event("routine_step_transitioned", "Business routine step transitioned.", run, actor, {
        routineRunId: run.id,
        stepKey,
        action,
        state: nextState,
        revision: run.revision,
      });
    });
    return { status: 200, body: { routineRun: run, stepRun } };
  }

  return {
    recordDocumentClassification,
    createBusinessEntity,
    createBusinessCase,
    createRoutineDefinition,
    transitionRoutineDefinition,
    createLedgerDefinition,
    createRoutineRun,
    transitionRoutineStep,
  };
}
