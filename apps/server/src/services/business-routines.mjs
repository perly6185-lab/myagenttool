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
  "businessDocumentAnalysisJobs",
  "businessEntities",
  "businessCaseCandidates",
  "businessCases",
  "routineDiscoveryCandidates",
  "routineDefinitions",
  "routineRuns",
  "ledgerDefinitions",
];

const DEFINITION_TRANSITIONS = {
  candidate: { review: "draft" },
  draft: { publish: "published" },
  published: { disable: "disabled", supersede: "superseded" },
  disabled: { supersede: "superseded" },
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

function routineStepConfigurationError(steps) {
  const invalidCondition = steps.find((step) =>
    step.kind === "condition" && !text(step.configuration?.condition, 1_000));
  return invalidCondition ? "routine_step_condition_required" : null;
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
  const artifactById = new Map((state.workflowArtifacts ?? []).map((artifact) => [artifact.id, artifact]));
  for (const classification of state.businessDocumentClassifications) {
    const artifactFingerprint = classification.artifactFingerprint
      ?? artifactById.get(classification.artifactId)?.fingerprint
      ?? null;
    classification.fieldProposals ??= [];
    classification.riskSignals ??= [];
    classification.extractorVersion ??= 1;
    classification.analysisState ??= "deterministic";
    classification.degradedReason ??= null;
    classification.artifactFingerprint = artifactFingerprint;
    classification.analysisKey ??= artifactFingerprint;
  }
  for (const businessCase of state.businessCases) {
    businessCase.artifactFingerprints ??= Object.fromEntries(
      (businessCase.artifactBindings ?? []).map((binding) => [
        binding.artifactId,
        artifactById.get(binding.artifactId)?.fingerprint ?? "",
      ]),
    );
  }
  for (const definition of state.routineDefinitions) {
    definition.description ??= "";
    definition.discoveryCandidateId ??= null;
    if (!Array.isArray(definition.historicalCaseIds)) definition.historicalCaseIds = [];
    if (!definition.evidenceFingerprints
      || typeof definition.evidenceFingerprints !== "object"
      || Array.isArray(definition.evidenceFingerprints)) {
      definition.evidenceFingerprints = Object.fromEntries(
        [...new Set((definition.evidenceRefs ?? []).map((ref) => ref.artifactId))].map((artifactId) => [
          artifactId,
          artifactById.get(artifactId)?.fingerprint ?? "",
        ]),
      );
    }
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
    if (artifact.availability === "missing" || artifact.exclusion) {
      return { status: 409, body: { error: "business_document_artifact_unavailable" } };
    }
    if (artifact.fingerprint !== normalized.value.artifactFingerprint) {
      return { status: 409, body: { error: "business_document_artifact_changed" } };
    }
    const allEvidence = [
      ...normalized.value.evidenceRefs,
      ...normalized.value.fieldProposals.flatMap((field) => field.evidenceRefs),
    ];
    if (!evidenceBelongsTo(allEvidence, context, actor)) {
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
          confirmationState: existing.confirmationState,
          fieldCount: existing.fieldProposals.length,
          riskSignalCount: existing.riskSignals.length,
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
        confirmationState: classification.confirmationState,
        fieldCount: classification.fieldProposals.length,
        riskSignalCount: classification.riskSignals.length,
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
    if (replay) {
      if (input.expectedRevision == null) {
        return { status: 200, body: { entity: replay, replayed: true } };
      }
      if (input.expectedRevision !== replay.revision) {
        return {
          status: 409,
          body: { error: "business_entity_revision_conflict", currentRevision: replay.revision },
        };
      }
      const timestamp = now();
      runTx(() => {
        Object.assign(replay, {
          fields,
          evidenceRefs,
          confidence: score,
          revision: replay.revision + 1,
          updatedAt: timestamp,
          updatedBy: actorUser(actor),
        });
        event("business_entity_updated", "Business entity updated.", replay, actor, {
          businessEntityId: replay.id,
          entityType,
          revision: replay.revision,
        });
      });
      return { status: 200, body: { entity: replay, replayed: false, updated: true } };
    }
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
      artifactFingerprints: Object.fromEntries(artifactBindings.map((binding) => [
        binding.artifactId,
        artifactFor(binding.artifactId, actor)?.fingerprint ?? "",
      ])),
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
    const description = input.description == null ? "" : String(input.description).trim().slice(0, 1_000);
    const discoveryCandidateId = input.discoveryCandidateId == null ? null : text(input.discoveryCandidateId);
    const historicalCaseIds = stringList(input.historicalCaseIds ?? []);
    const triggerDocumentTypes = stringList(input.triggerDocumentTypes ?? [], { maxItems: 20, maxLength: 50 });
    const steps = normalizeRoutineSteps(input.steps);
    const evidenceRefs = normalizeRoutineEvidenceRefs(input.evidenceRefs ?? []);
    const score = confidence(input.confidence ?? 1);
    const requestedState = ["candidate", "draft"].includes(input.state) ? input.state : "candidate";
    const configurationError = steps.ok ? routineStepConfigurationError(steps.value) : null;
    if (!name || !historicalCaseIds || !triggerDocumentTypes?.length
      || triggerDocumentTypes.some((type) => !businessDocumentTypes.includes(type))
      || !steps.ok || configurationError || !evidenceRefs || score == null) {
      return {
        status: 400,
        body: {
          error: steps.error ?? configurationError ?? "invalid_routine_definition",
          recovery: configurationError ? "Describe when the conditional step should run." : undefined,
        },
      };
    }
    if (!evidenceBelongsTo(evidenceRefs, context, actor)
      || steps.value.some((step) => !evidenceBelongsTo(step.evidenceRefs, context, actor))) {
      return { status: 404, body: { error: "routine_definition_evidence_not_found" } };
    }
    const idempotencyKey = `routine-definition:v1:${hashKey([
      actorTeam(actor),
      context.sourceId,
      name,
      discoveryCandidateId ?? "",
      historicalCaseIds.slice().sort(),
      evidenceRefs.map((ref) => ref.artifactId).sort(),
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
      description,
      version: 1,
      state: requestedState,
      discoveryCandidateId,
      historicalCaseIds,
      triggerDocumentTypes,
      steps: steps.value,
      evidenceRefs,
      evidenceFingerprints: Object.fromEntries(
        [...new Set([
          ...evidenceRefs.map((ref) => ref.artifactId),
          ...steps.value.flatMap((step) => step.evidenceRefs.map((ref) => ref.artifactId)),
        ])].map((artifactId) => [artifactId, artifactFor(artifactId, actor)?.fingerprint ?? ""]),
      ),
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
    confirmed = false,
  } = {}, actor = null) {
    const definition = state.routineDefinitions.find((row) =>
      row.id === routineDefinitionId && visible(row, actor));
    if (!definition) return { status: 404, body: { error: "routine_definition_not_found" } };
    if (expectedRevision !== definition.revision) {
      return {
        status: 409,
        body: {
          error: "routine_definition_revision_conflict",
          currentRevision: definition.revision,
          recovery: "Refresh the work type and reapply the intended change.",
        },
      };
    }
    if (!sourceFor(definition.sourceId, actor, { active: action !== "disable" && action !== "supersede" })) {
      return { status: 409, body: { error: "routine_definition_source_revoked" } };
    }
    if (action === "publish") {
      return publishRoutineDefinition({
        routineDefinitionId,
        expectedRevision,
        confirmed,
      }, actor);
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

  function routineDefinitionHealth(definition, actor) {
    const source = sourceFor(definition.sourceId, actor, { active: true });
    if (!source) {
      return { state: "blocked", issues: ["Source access was revoked."], recovery: "Restore source access." };
    }
    const issues = [];
    if (definition.discoveryCandidateId) {
      const candidate = state.routineDiscoveryCandidates.find((row) =>
        row.id === definition.discoveryCandidateId
        && visible(row, actor)
        && row.projectId === definition.projectId
        && row.sourceId === definition.sourceId);
      if (!candidate || candidate.state !== "candidate") {
        issues.push("The discovered work pattern is no longer current.");
      }
    }
    for (const [artifactId, fingerprint] of Object.entries(definition.evidenceFingerprints ?? {})) {
      const artifact = artifactFor(artifactId, actor);
      if (!artifact || artifact.availability === "missing" || artifact.exclusion) {
        issues.push("Historical evidence is missing or excluded.");
      } else if (artifact.fingerprint !== fingerprint) {
        issues.push("Historical evidence changed after this draft was created.");
      }
    }
    if (definition.discoveryCandidateId || definition.historicalCaseIds.length) {
      const historicalCases = definition.historicalCaseIds.map((caseId) =>
        state.businessCases.find((row) =>
          row.id === caseId
          && visible(row, actor)
          && row.projectId === definition.projectId
          && row.sourceId === definition.sourceId));
      const healthyCaseCount = historicalCases.filter((businessCase) =>
        businessCase
        && ["confirmed", "active", "completed"].includes(businessCase.state)
        && Array.isArray(businessCase.artifactBindings)
        && businessCase.artifactBindings.every((binding) => {
          const artifact = artifactFor(binding.artifactId, actor);
          return artifact
            && artifact.projectId === definition.projectId
            && artifact.sourceId === definition.sourceId
            && artifact.availability !== "missing"
            && !artifact.exclusion
            && businessCase.artifactFingerprints?.[artifact.id] === artifact.fingerprint;
        })).length;
      if (historicalCases.some((businessCase) => !businessCase)) {
        issues.push("A historical business case is no longer available.");
      }
      if (healthyCaseCount !== historicalCases.filter(Boolean).length) {
        issues.push("A historical business case is no longer confirmed or its evidence changed.");
      }
      if (healthyCaseCount < 3) {
        issues.push("At least three healthy confirmed historical cases are required.");
      }
    }
    const configurationError = routineStepConfigurationError(definition.steps);
    if (configurationError) {
      issues.push("A conditional step is missing its business condition.");
    }
    return issues.length
      ? { state: "blocked", issues: [...new Set(issues)], recovery: "Review changed evidence and create a fresh draft." }
      : { state: "valid", issues: [], recovery: null };
  }

  function listRoutineDefinitions({ sourceId = null } = {}, actor = null) {
    if (sourceId && !sourceFor(sourceId, actor)) {
      return { status: 404, body: { error: "workflow_source_not_found" } };
    }
    const routineDefinitions = state.routineDefinitions
      .filter((row) => visible(row, actor) && (!sourceId || row.sourceId === sourceId))
      .map((row) => ({ ...row, evidenceHealth: routineDefinitionHealth(row, actor) }));
    return { status: 200, body: { routineDefinitions, count: routineDefinitions.length } };
  }

  function createRoutineDraftFromDiscovery({ discoveryCandidateId } = {}, actor = null) {
    const candidate = state.routineDiscoveryCandidates.find((row) =>
      row.id === discoveryCandidateId && visible(row, actor));
    if (!candidate) return { status: 404, body: { error: "routine_discovery_candidate_not_found" } };
    if (candidate.state !== "candidate") {
      return { status: 409, body: { error: "routine_discovery_candidate_not_current" } };
    }
    if (candidate.confirmedCaseIds.length < 3) {
      return {
        status: 409,
        body: {
          error: "insufficient_confirmed_business_cases",
          recovery: "Confirm at least three comparable business cases, then discover again.",
        },
      };
    }
    const cases = candidate.confirmedCaseIds.map((caseId) =>
      state.businessCases.find((row) => row.id === caseId && visible(row, actor)));
    const evidenceChanged = cases.some((businessCase) =>
      !businessCase
      || !["confirmed", "active", "completed"].includes(businessCase.state)
      || businessCase.artifactBindings.some((binding) => {
        const artifact = artifactFor(binding.artifactId, actor);
        return !artifact
          || artifact.availability === "missing"
          || artifact.exclusion
          || businessCase.artifactFingerprints?.[artifact.id] !== artifact.fingerprint;
      }));
    if (evidenceChanged) {
      return {
        status: 409,
        body: {
          error: "routine_discovery_evidence_changed",
          recovery: "Re-analyze changed files and confirm the affected business cases.",
        },
      };
    }
    return createRoutineDefinition({
      projectId: candidate.projectId,
      sourceId: candidate.sourceId,
      name: "Commercial inquiry and quotation",
      description: "Register an inquiry, retrieve references, prepare and approve a quotation, then hand off a confirmed order.",
      state: "draft",
      discoveryCandidateId: candidate.id,
      historicalCaseIds: candidate.confirmedCaseIds,
      triggerDocumentTypes: candidate.triggerDocumentTypes,
      steps: candidate.steps.map((step) => ({
        key: step.key,
        kind: step.kind,
        label: step.label,
        required: step.required,
        dependsOn: step.dependsOn,
        evidenceRefs: step.evidenceRefs,
        configuration: {
          ...step.configuration,
          requirement: step.requirement,
          coverage: step.coverage,
          ...(step.kind === "condition" && !text(step.configuration?.condition, 1_000)
            ? { condition: step.label }
            : {}),
        },
      })),
      evidenceRefs: candidate.evidenceRefs,
      confidence: candidate.confidence,
    }, actor);
  }

  function updateRoutineDefinition({
    routineDefinitionId,
    expectedRevision,
    name,
    description,
    triggerDocumentTypes,
    steps,
  } = {}, actor = null) {
    const definition = state.routineDefinitions.find((row) =>
      row.id === routineDefinitionId && visible(row, actor));
    if (!definition) return { status: 404, body: { error: "routine_definition_not_found" } };
    if (expectedRevision !== definition.revision) {
      return {
        status: 409,
        body: {
          error: "routine_definition_revision_conflict",
          currentRevision: definition.revision,
          recovery: "Refresh the work type and reapply the intended change.",
        },
      };
    }
    if (!["candidate", "draft"].includes(definition.state)) {
      return { status: 409, body: { error: "published_routine_definition_is_immutable" } };
    }
    const nextName = name == null ? definition.name : text(name, 200);
    const nextDescription = description == null
      ? definition.description
      : text(description, 1_000);
    const nextTriggers = triggerDocumentTypes == null
      ? definition.triggerDocumentTypes
      : stringList(triggerDocumentTypes, { maxItems: 20, maxLength: 50 });
    const nextSteps = steps == null ? { ok: true, value: definition.steps } : normalizeRoutineSteps(steps);
    const configurationError = nextSteps.ok ? routineStepConfigurationError(nextSteps.value) : null;
    if (!nextName || !nextDescription || !nextTriggers?.length
      || nextTriggers.some((type) => !businessDocumentTypes.includes(type))
      || !nextSteps.ok
      || configurationError
      || nextSteps.value.some((step) => !evidenceBelongsTo(step.evidenceRefs, definition, actor))) {
      return {
        status: 400,
        body: {
          error: nextSteps.error ?? configurationError ?? "invalid_routine_definition_update",
          recovery: configurationError
            ? "Describe when the conditional step should run."
            : "Review the trigger, step order, conditions, and evidence.",
        },
      };
    }
    runTx(() => {
      Object.assign(definition, {
        name: nextName,
        description: nextDescription,
        triggerDocumentTypes: nextTriggers,
        steps: nextSteps.value,
        evidenceFingerprints: Object.fromEntries(
          [...new Set([
            ...definition.evidenceRefs.map((ref) => ref.artifactId),
            ...nextSteps.value.flatMap((step) => step.evidenceRefs.map((ref) => ref.artifactId)),
          ])].map((artifactId) => [artifactId, artifactFor(artifactId, actor)?.fingerprint ?? ""]),
        ),
        revision: definition.revision + 1,
        updatedAt: now(),
        updatedBy: actorUser(actor),
      });
      event("routine_definition_updated", "Business routine draft updated.", definition, actor, {
        routineDefinitionId: definition.id,
        version: definition.version,
        stepCount: definition.steps.length,
      });
    });
    return { status: 200, body: { routineDefinition: definition } };
  }

  function createRoutineDefinitionVersion({
    routineDefinitionId,
    expectedRevision,
  } = {}, actor = null) {
    const base = state.routineDefinitions.find((row) =>
      row.id === routineDefinitionId && visible(row, actor));
    if (!base) return { status: 404, body: { error: "routine_definition_not_found" } };
    if (expectedRevision !== base.revision) {
      return {
        status: 409,
        body: {
          error: "routine_definition_revision_conflict",
          currentRevision: base.revision,
          recovery: "Refresh the work type before creating a new version.",
        },
      };
    }
    if (!["published", "disabled"].includes(base.state)) {
      return { status: 409, body: { error: "routine_definition_version_requires_published_base" } };
    }
    const existingDraft = state.routineDefinitions.find((row) =>
      visible(row, actor) && row.familyId === base.familyId && row.state === "draft");
    if (existingDraft) return { status: 200, body: { routineDefinition: existingDraft, replayed: true } };
    const timestamp = now();
    const id = nextId("rtd");
    const version = Math.max(...state.routineDefinitions
      .filter((row) => visible(row, actor) && row.familyId === base.familyId)
      .map((row) => row.version)) + 1;
    const draft = {
      ...base,
      id,
      familyId: base.familyId,
      version,
      state: "draft",
      supersedesId: base.id,
      supersededById: null,
      idempotencyKey: `routine-definition-version:v1:${hashKey([base.familyId, version])}`,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      state.routineDefinitions.push(draft);
      event("routine_definition_version_created", "New business routine draft created.", draft, actor, {
        routineDefinitionId: draft.id,
        familyId: draft.familyId,
        version,
        supersedesId: base.id,
      });
    });
    return { status: 201, body: { routineDefinition: draft, replayed: false } };
  }

  function publishRoutineDefinition({
    routineDefinitionId,
    expectedRevision,
    confirmed = false,
  } = {}, actor = null) {
    const definition = state.routineDefinitions.find((row) =>
      row.id === routineDefinitionId && visible(row, actor));
    if (!definition) return { status: 404, body: { error: "routine_definition_not_found" } };
    if (expectedRevision !== definition.revision) {
      return {
        status: 409,
        body: {
          error: "routine_definition_revision_conflict",
          currentRevision: definition.revision,
          recovery: "Refresh the work type before enabling it.",
        },
      };
    }
    if (definition.state !== "draft") {
      return { status: 409, body: { error: "routine_definition_not_publishable" } };
    }
    if (confirmed !== true) {
      return { status: 400, body: { error: "routine_definition_publication_confirmation_required" } };
    }
    const health = routineDefinitionHealth(definition, actor);
    if (health.state !== "valid") {
      return { status: 409, body: { error: "routine_definition_evidence_not_valid", evidenceHealth: health } };
    }
    const previous = definition.supersedesId
      ? state.routineDefinitions.find((row) => row.id === definition.supersedesId && visible(row, actor))
      : null;
    if (definition.supersedesId && (!previous
      || previous.familyId !== definition.familyId
      || previous.version >= definition.version
      || !["published", "disabled"].includes(previous.state))) {
      return { status: 409, body: { error: "routine_definition_replacement_not_current" } };
    }
    const otherPublished = state.routineDefinitions.find((row) =>
      visible(row, actor)
      && row.familyId === definition.familyId
      && row.id !== definition.id
      && row.state === "published"
      && row.id !== previous?.id);
    if (otherPublished) {
      return { status: 409, body: { error: "routine_definition_family_already_published" } };
    }
    runTx(() => {
      definition.state = "published";
      definition.revision += 1;
      definition.updatedAt = now();
      definition.updatedBy = actorUser(actor);
      if (previous) {
        previous.state = "superseded";
        previous.supersededById = definition.id;
        previous.revision += 1;
        previous.updatedAt = definition.updatedAt;
        previous.updatedBy = actorUser(actor);
      }
      event("routine_definition_published", "Business routine version published.", definition, actor, {
        routineDefinitionId: definition.id,
        familyId: definition.familyId,
        version: definition.version,
        supersedesId: previous?.id ?? null,
      });
    });
    return { status: 200, body: { routineDefinition: definition, superseded: previous } };
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
    createRoutineDraftFromDiscovery,
    listRoutineDefinitions,
    updateRoutineDefinition,
    createRoutineDefinitionVersion,
    publishRoutineDefinition,
    transitionRoutineDefinition,
    createLedgerDefinition,
    createRoutineRun,
    transitionRoutineStep,
  };
}
