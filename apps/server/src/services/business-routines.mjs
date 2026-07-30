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
import { assetResourceClass, resolveAssetCapabilities } from "./asset-capabilities.mjs";

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
  "ledgerUpsertPreviews",
  "ledgerMutationAudits",
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
const READ_ONLY_STEP_KINDS = new Set(["extract", "retrieve"]);

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
  if (invalidCondition) return "routine_step_condition_required";
  const conditionalKeys = new Set(steps.filter((step) => step.kind === "condition").map((step) => step.key));
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of steps) {
      if (!conditionalKeys.has(step.key)
        && step.dependsOn.some((dependency) => conditionalKeys.has(dependency))) {
        conditionalKeys.add(step.key);
        changed = true;
      }
    }
  }
  return steps.some((step) =>
    step.kind !== "condition" && conditionalKeys.has(step.key) && step.required)
    ? "routine_conditional_descendant_must_be_optional"
    : null;
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
  const targets = new Set();
  for (const [key, target] of entries) {
    const normalizedTarget = text(target, 200);
    if (!SAFE_FIELD_RE.test(key) || SENSITIVE_FIELD_RE.test(key) || !normalizedTarget
      || /[\0\r\n]/.test(normalizedTarget) || targets.has(normalizedTarget)) return null;
    mappings[key] = normalizedTarget;
    targets.add(normalizedTarget);
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
  sourceFingerprints = [],
} = {}) {
  const base = [
    businessRoutineSchemaVersion,
    ownerTeamId,
    routineDefinitionId,
    routineVersion,
    businessKey,
  ];
  if (sourceFingerprints.length) base.push([...new Set(sourceFingerprints)].sort());
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
  for (const run of state.routineRuns) {
    run.actionReceipts ??= [];
    run.waitingReason ??= null;
    run.cancellationRequestedAt ??= null;
    run.sourceFingerprints ??= (run.triggerArtifactIds ?? [])
      .map((artifactId) => {
        const businessCase = state.businessCases.find((row) => row.id === run.businessCaseId);
        return businessCase?.artifactFingerprints?.[artifactId]
          ?? artifactById.get(artifactId)?.fingerprint
          ?? null;
      })
      .filter(Boolean)
      .sort();
    for (const stepRun of run.stepRuns ??= []) {
      stepRun.attempts ??= stepRun.startedAt ? 1 : 0;
      stepRun.outputRefs ??= [];
      stepRun.approval ??= null;
      stepRun.conditionOutcome ??= null;
      if (stepRun.state === "running") {
        stepRun.state = "failed";
        stepRun.errorCode = "routine_step_interrupted";
        stepRun.completedAt ??= run.updatedAt ?? run.createdAt ?? null;
        run.status = "failed";
        run.waitingReason = "routine_step_interrupted";
      }
    }
  }
  for (const definition of state.ledgerDefinitions) {
    definition.documentType ??= definition.businessKeyField?.startsWith("quotation")
      ? "quotation_ledger"
      : definition.businessKeyField?.startsWith("order")
        ? "order_ledger"
        : "inquiry_ledger";
    definition.headerRow ??= 1;
    definition.table ??= null;
    definition.fallbackBusinessKeyFields ??= [];
    definition.requiredFields ??= [definition.businessKeyField].filter(Boolean);
    definition.formattingPolicy ??= {
      preserveStylesAndFormulas: true,
      csvDelimiter: ",",
    };
    definition.writePolicy ??= {
      approval: "always",
      allowInsert: true,
      allowUpdate: true,
    };
  }
  return state;
}

export function createBusinessRoutineService({
  state,
  now = () => new Date().toISOString(),
  nextId = (prefix) => `${prefix}_${Date.now().toString(36)}`,
  appendEvent = () => {},
  persistStateSoon = () => {},
  createWorkItem = null,
  recordWorkItemVerification = null,
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

  const workItemFor = (workItemId, actor) =>
    state.workItems?.find((row) =>
      row.id === workItemId
      && row.ownerTeamId === actorTeam(actor)
      && actorCanAccessProject(state, actor, row.projectId)) ?? null;

  function publicRoutineWorkItem(workItem) {
    const { createIdempotencyKey: _createIdempotencyKey, ...publicWorkItem } = workItem;
    return publicWorkItem;
  }

  function normalizeRoutineOutputRefs(values) {
    if (!Array.isArray(values) || values.length > 50) return null;
    const rows = [];
    for (const value of values) {
      if (!value || typeof value !== "object") return null;
      const kind = ["artifact", "file", "note"].includes(value.kind) ? value.kind : null;
      const artifactId = value.artifactId == null ? null : text(value.artifactId);
      const path = value.relativePath == null ? null : relativePath(value.relativePath);
      const summary = text(value.summary, 500);
      if (!kind || !summary
        || (kind === "artifact" && !artifactId)
        || (kind === "file" && !path)
        || (kind === "note" && (artifactId || path))) {
        return null;
      }
      rows.push({ kind, artifactId, relativePath: path, summary });
    }
    return rows;
  }

  function syncRoutineCompletion(context, actor) {
    if (context.run.status !== "succeeded"
      || typeof recordWorkItemVerification !== "function"
      || context.workItem.verificationRecords?.some((record) =>
        record.evidence?.some((entry) => entry.kind === "run" && entry.ref === context.run.id))) {
      return;
    }
    const result = recordWorkItemVerification({
      workItemId: context.workItem.id,
      expectedRevision: context.workItem.revision,
      kind: "manual",
      status: "passed",
      summary: `Routine ${context.definition.name} v${context.definition.version} completed.`,
      acceptanceResults: (context.workItem.acceptanceCriteria ?? []).map((criterion) => {
        const step = context.definition.steps.find((candidate) =>
          candidate.required && candidate.label === criterion);
        const stepRun = step
          ? context.run.stepRuns.find((candidate) => candidate.stepKey === step.key)
          : null;
        return {
          criterion,
          status: stepRun?.state === "succeeded" ? "passed" : "not_tested",
          note: stepRun?.state === "succeeded"
            ? "The required routine step completed."
            : "The required routine step did not complete.",
        };
      }),
      evidence: [
        {
          kind: "run",
          ref: context.run.id,
          summary: "Completed business routine run.",
        },
        ...context.run.stepRuns.flatMap((stepRun) =>
          (stepRun.outputRefs ?? [])
            .filter((output) => output.kind === "artifact" && output.artifactId)
            .map((output) => ({
              kind: "artifact",
              ref: output.artifactId,
              summary: output.summary,
            }))),
      ].slice(0, 100),
    }, actor);
    if (!result?.ok) {
      event("routine_completion_gate_sync_failed",
        "Routine completed but its Issue completion evidence could not be synchronized.",
        context.run, actor, {
          routineRunId: context.run.id,
          workItemId: context.workItem.id,
          error: result?.body?.error ?? "work_item_verification_failed",
        });
    }
  }

  function recomputeRoutineRunStatus(run) {
    const states = run.stepRuns.map((row) => row.state);
    if (run.cancellationRequestedAt) run.status = "cancelled";
    else if (states.every((value) => ["succeeded", "skipped"].includes(value))) run.status = "succeeded";
    else if (states.some((value) => value === "failed")) run.status = "failed";
    else if (states.some((value) => value === "awaiting_approval")) run.status = "awaiting_approval";
    else if (states.some((value) => value === "awaiting_condition")) run.status = "awaiting_condition";
    else if (states.some((value) => value === "running")) run.status = "running";
    else run.status = "planned";
  }

  function receiptFor(run, idempotencyKey) {
    const key = text(idempotencyKey, 200);
    return key ? run.actionReceipts.find((row) => row.key === key) ?? null : null;
  }

  function recordReceipt(run, idempotencyKey, action, stepKey = null) {
    const key = text(idempotencyKey, 200);
    if (!key) return;
    run.actionReceipts.push({ key, action, stepKey, revision: run.revision });
    if (run.actionReceipts.length > 100) run.actionReceipts.splice(0, run.actionReceipts.length - 100);
  }

  function routineDeviceLimit(run) {
    const workItem = workItemFor(run.workItemId, { teamId: run.ownerTeamId });
    const device = state.devices?.find((row) => row.id === workItem?.terminalId);
    const configured = Number(device?.maxConcurrency);
    return Number.isInteger(configured) ? Math.max(1, Math.min(8, configured)) : 1;
  }

  function activeRoutineStepsOnDevice(run) {
    const workItem = workItemFor(run.workItemId, { teamId: run.ownerTeamId });
    if (!workItem?.terminalId) {
      return run.stepRuns.filter((row) => row.state === "running").length;
    }
    return state.routineRuns
      .filter((candidate) => {
        const candidateItem = workItemFor(candidate.workItemId, { teamId: run.ownerTeamId });
        return candidate.ownerTeamId === run.ownerTeamId && candidateItem?.terminalId === workItem.terminalId;
      })
      .flatMap((candidate) => candidate.stepRuns)
      .filter((row) => row.state === "running")
      .length;
  }

  function scheduleRoutineRun(run, definition, timestamp) {
    if (run.cancellationRequestedAt || run.stepRuns.some((row) => row.state === "failed")) {
      recomputeRoutineRunStatus(run);
      return [];
    }
    const runByKey = new Map(run.stepRuns.map((stepRun) => [stepRun.stepKey, stepRun]));
    const eligible = definition.steps.filter((step) => {
      const stepRun = runByKey.get(step.key);
      return stepRun?.state === "pending" && step.dependsOn.every((dependency) =>
        ["succeeded", "skipped"].includes(runByKey.get(dependency)?.state));
    });
    const started = [];
    for (const step of eligible) {
      const stepRun = runByKey.get(step.key);
      if (step.kind === "human_approval") {
        stepRun.state = "awaiting_approval";
        started.push(step.key);
        break;
      }
      if (step.kind === "condition") {
        stepRun.state = "awaiting_condition";
        started.push(step.key);
        break;
      }
    }
    if (started.length) {
      run.waitingReason = null;
      recomputeRoutineRunStatus(run);
      return started;
    }
    const active = activeRoutineStepsOnDevice(run);
    let available = Math.max(0, routineDeviceLimit(run) - active);
    if (!available) {
      run.waitingReason = "device_capacity";
      recomputeRoutineRunStatus(run);
      return [];
    }
    const readOnly = eligible.filter((step) => READ_ONLY_STEP_KINDS.has(step.kind));
    const selected = readOnly.length ? readOnly.slice(0, available) : eligible.slice(0, 1);
    for (const step of selected) {
      const stepRun = runByKey.get(step.key);
      stepRun.state = "running";
      stepRun.startedAt ??= timestamp;
      stepRun.completedAt = null;
      stepRun.errorCode = null;
      stepRun.attempts += 1;
      started.push(step.key);
      available -= 1;
      if (!available) break;
    }
    run.waitingReason = started.length ? null : run.waitingReason;
    recomputeRoutineRunStatus(run);
    return started;
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
    const documentType = ["inquiry_ledger", "quotation_ledger", "order_ledger"].includes(input.documentType)
      ? input.documentType
      : input.businessKeyField === "quotation_number"
        ? "quotation_ledger"
        : input.businessKeyField === "order_number"
          ? "order_ledger"
          : input.businessKeyField === "inquiry_number"
            ? "inquiry_ledger"
            : null;
    const format = ["csv", "xlsx"].includes(input.format) ? input.format : null;
    const path = relativePath(input.relativePath);
    const sheet = input.sheet == null || input.sheet === "" ? null : text(input.sheet, 200);
    const table = input.table == null || input.table === "" ? null : text(input.table, 200);
    const businessKeyField = text(input.businessKeyField, 120);
    const fieldMappings = normalizeFieldMappings(input.fieldMappings);
    const headerRow = Number.isInteger(input.headerRow) && input.headerRow >= 1 && input.headerRow <= 100
      ? input.headerRow
      : 1;
    const fallbackBusinessKeyFields = input.fallbackBusinessKeyFields == null
      ? []
      : stringList(input.fallbackBusinessKeyFields, { maxItems: 5, maxLength: 120 });
    const requiredFields = input.requiredFields == null
      ? [businessKeyField].filter(Boolean)
      : stringList(input.requiredFields, { maxItems: 100, maxLength: 120 });
    const csvDelimiter = [",", ";", "\t"].includes(input.formattingPolicy?.csvDelimiter)
      ? input.formattingPolicy.csvDelimiter
      : ",";
    const approvalPolicy = ["always", "updates_only"].includes(input.writePolicy?.approval)
      ? input.writePolicy.approval
      : "always";
    const allowInsert = input.writePolicy?.allowInsert !== false;
    const allowUpdate = input.writePolicy?.allowUpdate !== false;
    const requestedState = ledgerDefinitionStates.includes(input.state) ? input.state : "draft";
    if (!name || !documentType || !format || !path || (input.sheet != null && input.sheet !== "" && !sheet)
      || (input.table != null && input.table !== "" && !table)
      || (format === "csv" && (sheet || table)) || (format === "xlsx" && !sheet)
      || !businessKeyField || !SAFE_FIELD_RE.test(businessKeyField)
      || SENSITIVE_FIELD_RE.test(businessKeyField) || !fieldMappings || requestedState !== "draft"
      || !fallbackBusinessKeyFields || !requiredFields?.length
      || [...requiredFields, ...fallbackBusinessKeyFields].some((field) =>
        !SAFE_FIELD_RE.test(field) || SENSITIVE_FIELD_RE.test(field))
      || !requiredFields.includes(businessKeyField)
      || requiredFields.some((field) => !Object.hasOwn(fieldMappings, field))
      || !Object.hasOwn(fieldMappings, businessKeyField)
      || (!allowInsert && !allowUpdate)
      || !path.toLowerCase().endsWith(`.${format}`)) {
      return { status: 400, body: { error: "invalid_ledger_definition" } };
    }
    const idempotencyKey = `ledger-definition:v1:${hashKey([
      actorTeam(actor), context.sourceId, path, sheet ?? "", businessKeyField,
      table ?? "",
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
      documentType,
      format,
      relativePath: path,
      sheet,
      table,
      headerRow,
      businessKeyField,
      fallbackBusinessKeyFields,
      fieldMappings,
      requiredFields,
      formattingPolicy: {
        preserveStylesAndFormulas: true,
        csvDelimiter,
      },
      writePolicy: {
        approval: approvalPolicy,
        allowInsert,
        allowUpdate,
      },
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
    if (triggerArtifacts.some((artifact) =>
      businessCase.artifactFingerprints?.[artifact.id] !== artifact.fingerprint)) {
      return { status: 409, body: { error: "routine_run_trigger_evidence_changed" } };
    }
    const keys = routineIdempotencyKeys({
      ownerTeamId: actorTeam(actor),
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessKey: businessCase.businessKey,
      sourceFingerprints: triggerArtifacts.map((artifact) => artifact.fingerprint),
    });
    const legacyKeys = routineIdempotencyKeys({
      ownerTeamId: actorTeam(actor),
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessKey: businessCase.businessKey,
    });
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
    const replay = state.routineRuns.find((row) =>
      visible(row, actor) && [keys.issue, legacyKeys.issue].includes(row.issueIdempotencyKey));
    if (replay) {
      if (workItemId && replay.workItemId && replay.workItemId !== workItemId) {
        return { status: 409, body: { error: "routine_run_already_bound_to_another_work_item" } };
      }
      if (workItemId && !replay.workItemId) {
        runTx(() => {
          replay.workItemId = workItemId;
          replay.revision += 1;
          replay.updatedAt = now();
          replay.updatedBy = actorUser(actor);
        });
      }
      return { status: 200, body: { routineRun: replay, replayed: true } };
    }
    if (!sourceFor(definition.sourceId, actor, { active: true })) {
      return { status: 409, body: { error: "routine_run_source_revoked" } };
    }
    if (definition.state !== "published") {
      return { status: 409, body: { error: "routine_definition_not_published_or_version_mismatch" } };
    }
    if (!["confirmed", "active"].includes(businessCase.state)) {
      return { status: 409, body: { error: "routine_business_case_not_confirmed" } };
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
      sourceFingerprints: triggerArtifacts.map((artifact) => artifact.fingerprint).sort(),
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
          sourceFingerprints: triggerArtifacts.map((artifact) => artifact.fingerprint),
        }).step,
        startedAt: null,
        completedAt: null,
        errorCode: null,
        attempts: 0,
        outputRefs: [],
        approval: null,
        conditionOutcome: null,
      })),
      actionReceipts: [],
      waitingReason: null,
      cancellationRequestedAt: null,
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

  function routineExecutionContext(workItemId, actor) {
    const workItem = workItemFor(workItemId, actor);
    if (!workItem?.routineDefinitionId) return { error: "routine_work_item_not_found", status: 404 };
    const definition = state.routineDefinitions.find((row) =>
      row.id === workItem.routineDefinitionId
      && row.version === workItem.routineVersion
      && visible(row, actor));
    const run = state.routineRuns.find((row) =>
      row.workItemId === workItem.id
      && row.routineDefinitionId === workItem.routineDefinitionId
      && row.routineVersion === workItem.routineVersion
      && visible(row, actor));
    if (!definition || !run) return { error: "routine_work_item_execution_not_found", status: 404 };
    return { workItem, definition, run };
  }

  function routineExecutionView(context) {
    const runByKey = new Map(context.run.stepRuns.map((row) => [row.stepKey, row]));
    const availableOrderTriggers = state.businessDocumentClassifications
      .filter((classification) =>
        classification.ownerTeamId === context.run.ownerTeamId
        && classification.projectId === context.run.projectId
        && classification.sourceId === context.run.sourceId
        && classification.documentType === "order"
        && ["confirmed", "corrected"].includes(classification.confirmationState))
      .map((classification) => {
        const artifact = state.workflowArtifacts.find((row) =>
          row.id === classification.artifactId
          && row.ownerTeamId === context.run.ownerTeamId
          && row.fingerprint === classification.artifactFingerprint
          && row.availability !== "missing"
          && !row.exclusion);
        return artifact ? {
          artifactId: artifact.id,
          label: artifact.relativePath ?? artifact.name ?? artifact.id,
        } : null;
      })
      .filter(Boolean)
      .slice(0, 20);
    return {
      workItemId: context.workItem.id,
      definition: {
        id: context.definition.id,
        name: context.definition.name,
        version: context.definition.version,
      },
      run: {
        id: context.run.id,
        status: context.run.status,
        revision: context.run.revision,
        waitingReason: context.run.waitingReason,
        cancellationRequestedAt: context.run.cancellationRequestedAt,
      },
      availableOrderTriggers,
      steps: context.definition.steps.map((step) => ({
        key: step.key,
        label: step.label,
        kind: step.kind,
        required: step.required,
        dependsOn: step.dependsOn,
        configuration: step.configuration,
        run: runByKey.get(step.key),
      })),
    };
  }

  function getRoutineWorkItemExecution({ workItemId } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    return { status: 200, body: { execution: routineExecutionView(context) } };
  }

  function materializeRoutineIssue({
    routineDefinitionId,
    businessCaseId,
    triggerArtifactIds,
  } = {}, actor = null) {
    if (typeof createWorkItem !== "function") {
      return { status: 503, body: { error: "routine_issue_materializer_unavailable" } };
    }
    const definition = state.routineDefinitions.find((row) =>
      row.id === routineDefinitionId && visible(row, actor));
    const businessCase = state.businessCases.find((row) =>
      row.id === businessCaseId && visible(row, actor));
    if (!definition || !businessCase
      || definition.projectId !== businessCase.projectId
      || definition.sourceId !== businessCase.sourceId) {
      return { status: 404, body: { error: "routine_issue_context_not_found" } };
    }
    const binding = normalizeLocalIssueRoutineBinding({
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessCaseId: businessCase.id,
      businessKey: businessCase.businessKey,
      triggerArtifactIds,
    });
    if (!binding.ok) return { status: 400, body: { error: binding.error } };
    const expectedKeys = routineIdempotencyKeys({
      ownerTeamId: actorTeam(actor),
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessKey: businessCase.businessKey,
      sourceFingerprints: binding.value.triggerArtifactIds
        .map((artifactId) => businessCase.artifactFingerprints?.[artifactId])
        .filter(Boolean),
    });
    const expectedFingerprints = binding.value.triggerArtifactIds
      .map((artifactId) => businessCase.artifactFingerprints?.[artifactId])
      .filter(Boolean)
      .sort();
    const legacyKeys = routineIdempotencyKeys({
      ownerTeamId: actorTeam(actor),
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessKey: businessCase.businessKey,
    });
    const existingRun = state.routineRuns.find((row) =>
      visible(row, actor)
      && row.sourceId === definition.sourceId
      && row.businessKey === businessCase.businessKey
      && (
        JSON.stringify(row.sourceFingerprints ?? []) === JSON.stringify(expectedFingerprints)
        || [expectedKeys.issue, legacyKeys.issue].includes(row.issueIdempotencyKey)
      ));
    const existingWorkItem = existingRun?.workItemId
      ? workItemFor(existingRun.workItemId, actor)
      : null;
    if (existingWorkItem && !existingWorkItem.parentId) {
      const existingDefinition = state.routineDefinitions.find((row) =>
        row.id === existingRun.routineDefinitionId
        && row.version === existingRun.routineVersion
        && visible(row, actor));
      if (!existingDefinition) {
        return { status: 409, body: { error: "routine_issue_pinned_definition_missing" } };
      }
      return {
        status: 200,
        body: {
          workItem: publicRoutineWorkItem(existingWorkItem),
          execution: routineExecutionView({
            workItem: existingWorkItem,
            definition: existingDefinition,
            run: existingRun,
          }),
          replayed: true,
        },
      };
    }
    if (definition.state !== "published") {
      return { status: 409, body: { error: "routine_definition_not_available_for_new_issues" } };
    }
    const triggers = binding.value.triggerArtifactIds.map((artifactId) => artifactFor(artifactId, actor));
    if (triggers.some((artifact) =>
      !artifact
      || artifact.projectId !== definition.projectId
      || artifact.sourceId !== definition.sourceId
      || artifact.availability === "missing"
      || artifact.exclusion
      || businessCase.artifactFingerprints?.[artifact.id] !== artifact.fingerprint)) {
      return {
        status: 409,
        body: {
          error: "routine_issue_trigger_evidence_not_current",
          recovery: "Re-analyze and reconfirm the inquiry before creating its task.",
        },
      };
    }
    const idempotencyKey = expectedKeys.issue;
    const source = sourceFor(definition.sourceId, actor, { active: true });
    const terminalId = state.devices?.[0]?.id ?? null;
    const inputAssets = terminalId ? triggers.map((artifact) => {
      const path = [source?.relativePath, artifact.relativePath].filter(Boolean).join("/");
      const capabilities = resolveAssetCapabilities(path);
      return {
        id: artifact.id,
        path,
        family: capabilities.family,
        terminalId,
        size: artifact.size ?? null,
        resourceClass: assetResourceClass(artifact.size),
        hash: artifact.fingerprint,
        version: artifact.fingerprint.slice(0, 16),
        worktreeId: null,
        capabilities: capabilities.capabilities,
        readiness: { state: "ready", reason: "available_on_owning_terminal" },
      };
    }) : [];
    const created = createWorkItem({
      projectId: definition.projectId,
      title: `Process inquiry — ${businessCase.businessKey}`,
      body: `${definition.description}\n\nThis task is pinned to ${definition.name} v${definition.version}.`,
      type: "task",
      status: "ready",
      priority: "p1",
      labels: ["routine-work", "commercial-inquiry"],
      acceptanceCriteria: definition.steps.filter((step) => step.required).map((step) => step.label),
      idempotencyKey,
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessCaseId: businessCase.id,
      businessKey: businessCase.businessKey,
      triggerArtifactIds: binding.value.triggerArtifactIds,
      inputAssets,
      requiredCapabilities: inputAssets.length ? ["inspect"] : [],
    }, actor);
    if (!created?.ok) return { status: created?.status ?? 500, body: created?.body ?? { error: "routine_issue_create_failed" } };
    const runResult = createRoutineRun({
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessCaseId: businessCase.id,
      triggerArtifactIds: binding.value.triggerArtifactIds,
      workItemId: created.body.workItem.id,
    }, actor);
    if (runResult.status >= 400) return runResult;
    const context = {
      workItem: created.body.workItem,
      definition,
      run: runResult.body.routineRun,
    };
    return {
      status: created.status === 201 || runResult.status === 201 ? 201 : 200,
      body: {
        workItem: publicRoutineWorkItem(created.body.workItem),
        execution: routineExecutionView(context),
        replayed: created.body.replayed === true && runResult.body.replayed === true,
      },
    };
  }

  function validateRoutineAction(context, expectedRevision, idempotencyKey, action, stepKey = null) {
    const replay = receiptFor(context.run, idempotencyKey);
    if (replay) {
      if (replay.action !== action || replay.stepKey !== stepKey) {
        return { status: 409, body: { error: "routine_action_idempotency_conflict" } };
      }
      return {
        status: 200,
        body: { execution: routineExecutionView(context), replayed: true },
      };
    }
    if (!text(idempotencyKey, 200)) {
      return { status: 400, body: { error: "routine_action_idempotency_key_required" } };
    }
    if (expectedRevision !== context.run.revision) {
      return {
        status: 409,
        body: {
          error: "routine_run_revision_conflict",
          currentRevision: context.run.revision,
          recovery: "Refresh the task before trying the action again.",
        },
      };
    }
    return null;
  }

  function startRoutineWorkItem({
    workItemId,
    expectedRevision,
    idempotencyKey,
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const blocked = validateRoutineAction(context, expectedRevision, idempotencyKey, "start");
    if (blocked) return blocked;
    if (["succeeded", "cancelled"].includes(context.run.status)) {
      return { status: 409, body: { error: "routine_run_not_startable", currentState: context.run.status } };
    }
    if (context.run.stepRuns.some((row) => row.state === "failed")) {
      return {
        status: 409,
        body: { error: "routine_run_requires_step_retry", recovery: "Retry the failed step to continue." },
      };
    }
    if (!sourceFor(context.run.sourceId, actor, { active: true })) {
      return { status: 409, body: { error: "routine_run_source_revoked" } };
    }
    let startedStepKeys = [];
    runTx(() => {
      const timestamp = now();
      startedStepKeys = scheduleRoutineRun(context.run, context.definition, timestamp);
      context.run.revision += 1;
      context.run.updatedAt = timestamp;
      context.run.updatedBy = actorUser(actor);
      recordReceipt(context.run, idempotencyKey, "start");
      event("routine_run_started", "Routine work started.", context.run, actor, {
        routineRunId: context.run.id,
        workItemId: context.workItem.id,
        startedStepKeys,
        waitingReason: context.run.waitingReason,
      });
    });
    return {
      status: 200,
      body: { execution: routineExecutionView(context), startedStepKeys, replayed: false },
    };
  }

  function completeRoutineStep({
    workItemId,
    stepKey,
    expectedRevision,
    idempotencyKey,
    succeeded = true,
    errorCode = null,
    outputRefs = [],
    ledgerMutationId = null,
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const blocked = validateRoutineAction(context, expectedRevision, idempotencyKey, "complete", stepKey);
    if (blocked) return blocked;
    const step = context.definition.steps.find((row) => row.key === stepKey);
    const stepRun = context.run.stepRuns.find((row) => row.stepKey === stepKey);
    if (!step || !stepRun) return { status: 404, body: { error: "routine_step_not_found" } };
    if (step.kind === "ledger_upsert") {
      const mutation = state.ledgerMutationAudits.find((row) =>
        row.id === ledgerMutationId
        && row.ownerTeamId === context.run.ownerTeamId
        && row.routineRunId === context.run.id
        && row.routineStepKey === step.key);
      if (!mutation) {
        return { status: 409, body: { error: "ledger_step_requires_previewed_mutation" } };
      }
    }
    if (stepRun.state !== "running" || ["human_approval", "condition"].includes(step.kind)) {
      return { status: 409, body: { error: "routine_step_not_completable", currentState: stepRun.state } };
    }
    const normalizedOutputs = normalizeRoutineOutputRefs(outputRefs);
    if (!normalizedOutputs) return { status: 400, body: { error: "invalid_routine_step_outputs" } };
    if (normalizedOutputs.some((row) => {
      if (!row.artifactId) return false;
      const artifact = artifactFor(row.artifactId, actor);
      return !artifact
        || artifact.projectId !== context.run.projectId
        || artifact.sourceId !== context.run.sourceId
        || artifact.availability === "missing"
        || artifact.exclusion;
    })) {
      return { status: 404, body: { error: "routine_step_output_artifact_not_found" } };
    }
    let startedStepKeys = [];
    runTx(() => {
      const timestamp = now();
      stepRun.state = succeeded === true ? "succeeded" : "failed";
      stepRun.completedAt = timestamp;
      stepRun.errorCode = succeeded === true ? null : text(errorCode, 200) ?? "routine_step_failed";
      stepRun.outputRefs = normalizedOutputs;
      if (succeeded === true) startedStepKeys = scheduleRoutineRun(context.run, context.definition, timestamp);
      else recomputeRoutineRunStatus(context.run);
      context.run.revision += 1;
      context.run.updatedAt = timestamp;
      context.run.updatedBy = actorUser(actor);
      recordReceipt(context.run, idempotencyKey, "complete", stepKey);
      event(succeeded === true ? "routine_step_completed" : "routine_step_failed",
        succeeded === true ? "Routine step completed." : "Routine step failed.",
        context.run, actor, {
          routineRunId: context.run.id,
          workItemId: context.workItem.id,
          stepKey,
          outputCount: normalizedOutputs.length,
          errorCode: stepRun.errorCode,
          startedStepKeys,
      });
    });
    syncRoutineCompletion(context, actor);
    return {
      status: 200,
      body: { execution: routineExecutionView(context), startedStepKeys, replayed: false },
    };
  }

  function retryRoutineStep({
    workItemId,
    stepKey,
    expectedRevision,
    idempotencyKey,
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const blocked = validateRoutineAction(context, expectedRevision, idempotencyKey, "retry", stepKey);
    if (blocked) return blocked;
    const stepRun = context.run.stepRuns.find((row) => row.stepKey === stepKey);
    if (!stepRun) return { status: 404, body: { error: "routine_step_not_found" } };
    if (stepRun.state !== "failed") {
      return { status: 409, body: { error: "routine_step_not_retryable", currentState: stepRun.state } };
    }
    let startedStepKeys = [];
    runTx(() => {
      const timestamp = now();
      stepRun.state = "pending";
      stepRun.completedAt = null;
      stepRun.errorCode = null;
      context.run.waitingReason = null;
      startedStepKeys = scheduleRoutineRun(context.run, context.definition, timestamp);
      context.run.revision += 1;
      context.run.updatedAt = timestamp;
      context.run.updatedBy = actorUser(actor);
      recordReceipt(context.run, idempotencyKey, "retry", stepKey);
      event("routine_step_retried", "Routine step retried.", context.run, actor, {
        routineRunId: context.run.id,
        workItemId: context.workItem.id,
        stepKey,
        attempt: stepRun.attempts,
      });
    });
    return { status: 200, body: { execution: routineExecutionView(context), startedStepKeys, replayed: false } };
  }

  function decideRoutineApproval({
    workItemId,
    stepKey,
    expectedRevision,
    idempotencyKey,
    approved,
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const blocked = validateRoutineAction(context, expectedRevision, idempotencyKey, "approval", stepKey);
    if (blocked) return blocked;
    const step = context.definition.steps.find((row) => row.key === stepKey);
    const stepRun = context.run.stepRuns.find((row) => row.stepKey === stepKey);
    if (!step || !stepRun) return { status: 404, body: { error: "routine_step_not_found" } };
    if (step.kind !== "human_approval" || stepRun.state !== "awaiting_approval" || typeof approved !== "boolean") {
      return { status: 409, body: { error: "routine_approval_not_decidable", currentState: stepRun.state } };
    }
    let startedStepKeys = [];
    runTx(() => {
      const timestamp = now();
      stepRun.state = approved ? "succeeded" : "failed";
      stepRun.completedAt = timestamp;
      stepRun.errorCode = approved ? null : "routine_approval_rejected";
      stepRun.approval = {
        state: approved ? "approved" : "rejected",
        decidedAt: timestamp,
        decidedBy: actorUser(actor),
      };
      if (approved) startedStepKeys = scheduleRoutineRun(context.run, context.definition, timestamp);
      else recomputeRoutineRunStatus(context.run);
      context.run.revision += 1;
      context.run.updatedAt = timestamp;
      context.run.updatedBy = actorUser(actor);
      recordReceipt(context.run, idempotencyKey, "approval", stepKey);
      event(approved ? "routine_step_approved" : "routine_step_rejected",
        approved ? "Routine step approved." : "Routine step rejected.",
        context.run, actor, {
          routineRunId: context.run.id,
          workItemId: context.workItem.id,
          stepKey,
          startedStepKeys,
      });
    });
    syncRoutineCompletion(context, actor);
    return { status: 200, body: { execution: routineExecutionView(context), startedStepKeys, replayed: false } };
  }

  function descendantsOf(definition, rootKey) {
    const descendants = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      for (const step of definition.steps) {
        if (!descendants.has(step.key)
          && step.dependsOn.some((key) => key === rootKey || descendants.has(key))) {
          descendants.add(step.key);
          changed = true;
        }
      }
    }
    return descendants;
  }

  function decideRoutineCondition({
    workItemId,
    stepKey,
    expectedRevision,
    idempotencyKey,
    outcome,
    triggerArtifactIds = [],
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const blocked = validateRoutineAction(context, expectedRevision, idempotencyKey, "condition", stepKey);
    if (blocked) return blocked;
    const step = context.definition.steps.find((row) => row.key === stepKey);
    const stepRun = context.run.stepRuns.find((row) => row.stepKey === stepKey);
    if (!step || !stepRun) return { status: 404, body: { error: "routine_step_not_found" } };
    if (step.kind !== "condition" || stepRun.state !== "awaiting_condition" || typeof outcome !== "boolean") {
      return { status: 409, body: { error: "routine_condition_not_decidable", currentState: stepRun.state } };
    }
    const isOrderCondition = /order/i.test(`${step.key} ${step.label} ${step.configuration?.condition ?? ""}`);
    let orderArtifacts = [];
    let childWorkItem = null;
    if (outcome && isOrderCondition) {
      const ids = stringList(triggerArtifactIds, { maxItems: 20 });
      orderArtifacts = ids?.map((artifactId) => artifactFor(artifactId, actor)) ?? [];
      const valid = ids?.length && orderArtifacts.length === ids.length && orderArtifacts.every((artifact) => {
        const classification = state.businessDocumentClassifications.find((row) =>
          row.artifactId === artifact.id
          && visible(row, actor)
          && row.projectId === context.run.projectId
          && row.sourceId === context.run.sourceId
          && row.documentType === "order"
          && ["confirmed", "corrected"].includes(row.confirmationState)
          && row.artifactFingerprint === artifact.fingerprint);
        return artifact.availability !== "missing" && !artifact.exclusion && Boolean(classification);
      });
      if (!valid) {
        return {
          status: 409,
          body: {
            error: "confirmed_order_trigger_required",
            recovery: "Confirm a current order document before continuing.",
          },
        };
      }
      const businessCase = state.businessCases.find((row) =>
        row.id === context.run.businessCaseId && visible(row, actor));
      const timestamp = now();
      runTx(() => {
        for (const artifact of orderArtifacts) {
          if (!businessCase.artifactBindings.some((binding) => binding.artifactId === artifact.id)) {
            businessCase.artifactBindings.push({
              artifactId: artifact.id,
              documentType: "order",
              roles: ["trigger", "input"],
            });
          }
          businessCase.artifactFingerprints[artifact.id] = artifact.fingerprint;
        }
        businessCase.state = "active";
        businessCase.revision += 1;
        businessCase.updatedAt = timestamp;
        businessCase.updatedBy = actorUser(actor);
      });
      if (typeof createWorkItem !== "function") {
        return { status: 503, body: { error: "routine_issue_materializer_unavailable" } };
      }
      const orderKey = `business-routine:order-issue:v1:${hashKey([
        actorTeam(actor),
        context.workItem.id,
        context.run.businessCaseId,
        ...orderArtifacts.map((artifact) => artifact.fingerprint).sort(),
      ])}`;
      const created = createWorkItem({
        projectId: context.run.projectId,
        title: `Order Processing — ${context.run.businessKey}`,
        body: `Follow-up from ${context.workItem.localRef}. Process the confirmed order for ${context.run.businessKey}.`,
        type: "task",
        status: "ready",
        priority: "p1",
        labels: ["routine-work", "order-processing"],
        acceptanceCriteria: ["Register the confirmed order"],
        parentId: context.workItem.id,
        idempotencyKey: orderKey,
        routineDefinitionId: context.run.routineDefinitionId,
        routineVersion: context.run.routineVersion,
        businessCaseId: context.run.businessCaseId,
        businessKey: context.run.businessKey,
        triggerArtifactIds: orderArtifacts.map((artifact) => artifact.id),
      }, actor, { allowPinnedRoutineChild: true });
      if (!created?.ok) return { status: created?.status ?? 500, body: created?.body ?? { error: "order_issue_create_failed" } };
      childWorkItem = created.body.workItem;
    }
    let startedStepKeys = [];
    runTx(() => {
      const timestamp = now();
      stepRun.state = "succeeded";
      stepRun.conditionOutcome = outcome;
      stepRun.completedAt = timestamp;
      stepRun.errorCode = null;
      if (!outcome) {
        const descendants = descendantsOf(context.definition, stepKey);
        for (const candidate of context.run.stepRuns) {
          if (descendants.has(candidate.stepKey) && candidate.state === "pending") {
            candidate.state = "skipped";
            candidate.completedAt = timestamp;
          }
        }
      }
      startedStepKeys = scheduleRoutineRun(context.run, context.definition, timestamp);
      context.run.revision += 1;
      context.run.updatedAt = timestamp;
      context.run.updatedBy = actorUser(actor);
      recordReceipt(context.run, idempotencyKey, "condition", stepKey);
      event("routine_condition_decided", "Routine condition decided.", context.run, actor, {
        routineRunId: context.run.id,
        workItemId: context.workItem.id,
        stepKey,
        outcome,
        orderArtifactIds: orderArtifacts.map((artifact) => artifact.id),
        childWorkItemId: childWorkItem?.id ?? null,
      });
    });
    syncRoutineCompletion(context, actor);
    return {
      status: 200,
      body: {
        execution: routineExecutionView(context),
        childWorkItem: childWorkItem ? publicRoutineWorkItem(childWorkItem) : null,
        startedStepKeys,
        replayed: false,
      },
    };
  }

  function cancelRoutineWorkItem({
    workItemId,
    expectedRevision,
    idempotencyKey,
  } = {}, actor = null) {
    const context = routineExecutionContext(workItemId, actor);
    if (context.error) return { status: context.status, body: { error: context.error } };
    const blocked = validateRoutineAction(context, expectedRevision, idempotencyKey, "cancel");
    if (blocked) return blocked;
    if (["succeeded", "cancelled"].includes(context.run.status)) {
      return { status: 409, body: { error: "routine_run_not_cancellable", currentState: context.run.status } };
    }
    runTx(() => {
      const timestamp = now();
      context.run.cancellationRequestedAt = timestamp;
      for (const stepRun of context.run.stepRuns) {
        if (["pending", "running", "awaiting_approval", "awaiting_condition"].includes(stepRun.state)) {
          stepRun.state = "cancelled";
          stepRun.completedAt = timestamp;
          stepRun.errorCode = null;
        }
      }
      recomputeRoutineRunStatus(context.run);
      context.run.revision += 1;
      context.run.updatedAt = timestamp;
      context.run.updatedBy = actorUser(actor);
      recordReceipt(context.run, idempotencyKey, "cancel");
      event("routine_run_cancelled", "Routine work cancelled.", context.run, actor, {
        routineRunId: context.run.id,
        workItemId: context.workItem.id,
      });
    });
    return { status: 200, body: { execution: routineExecutionView(context), replayed: false } };
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
    if (action === "succeed" && step.kind === "human_approval") {
      return { status: 409, body: { error: "human_approval_step_cannot_bypass_approval" } };
    }
    if (action === "succeed" && step.kind === "condition") {
      return { status: 409, body: { error: "condition_step_cannot_bypass_decision" } };
    }
    const nextState = STEP_TRANSITIONS[stepRun.state]?.[action] ?? null;
    if (!nextState) {
      return { status: 409, body: { error: "invalid_routine_step_transition", currentState: stepRun.state } };
    }
    if (action === "await_approval" && step.kind !== "human_approval") {
      return { status: 409, body: { error: "routine_step_does_not_require_approval" } };
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
      recomputeRoutineRunStatus(run);
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

  function validateRoutineLedgerStep({
    routineRunId,
    stepKey,
    ledgerDefinitionId,
    businessKey,
    expectedRunRevision = null,
  } = {}, actor = null) {
    const run = state.routineRuns.find((row) => row.id === routineRunId && visible(row, actor));
    const definition = run
      ? state.routineDefinitions.find((row) =>
        row.id === run.routineDefinitionId
        && row.version === run.routineVersion
        && visible(row, actor))
      : null;
    const step = definition?.steps.find((row) => row.key === stepKey);
    const stepRun = run?.stepRuns.find((row) => row.stepKey === stepKey);
    if (!run || !definition || !step || !stepRun) {
      return { ok: false, status: 404, error: "routine_ledger_step_not_found" };
    }
    if (expectedRunRevision != null && expectedRunRevision !== run.revision) {
      return { ok: false, status: 409, error: "routine_ledger_step_changed_since_preview" };
    }
    if (step.kind !== "ledger_upsert" || stepRun.state !== "running") {
      return { ok: false, status: 409, error: "routine_ledger_step_not_writable" };
    }
    if (step.configuration?.ledgerDefinitionId
      && step.configuration.ledgerDefinitionId !== ledgerDefinitionId) {
      return { ok: false, status: 409, error: "routine_ledger_definition_mismatch" };
    }
    return {
      ok: true,
      routineRunRevision: run.revision,
      routineVersion: run.routineVersion,
      businessCaseId: run.businessCaseId,
      businessKey: run.businessKey,
      triggerArtifactIds: [...run.triggerArtifactIds],
    };
  }

  function completeRoutineLedgerStep({
    routineRunId,
    stepKey,
    ledgerDefinitionId,
    mutation,
    expectedRunRevision,
  } = {}, actor = null) {
    const checked = validateRoutineLedgerStep({
      routineRunId,
      stepKey,
      ledgerDefinitionId,
      businessKey: mutation?.businessKey,
      expectedRunRevision,
    }, actor);
    if (!checked.ok) {
      const run = state.routineRuns.find((row) => row.id === routineRunId && visible(row, actor));
      const stepRun = run?.stepRuns.find((row) => row.stepKey === stepKey);
      if (stepRun?.outputRefs?.some((output) =>
        output.kind === "note" && output.summary === `Ledger mutation ${mutation?.id} committed.`)) {
        return { ok: true, replayed: true };
      }
      return checked;
    }
    const run = state.routineRuns.find((row) => row.id === routineRunId && visible(row, actor));
    const ledgerDefinition = state.ledgerDefinitions.find((row) =>
      row.id === ledgerDefinitionId && visible(row, actor));
    const completed = completeRoutineStep({
      workItemId: run.workItemId,
      stepKey,
      expectedRevision: run.revision,
      idempotencyKey: `ledger-mutation:${mutation.id}`,
      succeeded: true,
      ledgerMutationId: mutation.id,
      outputRefs: [
        {
          kind: "file",
          relativePath: ledgerDefinition.relativePath,
          summary: `${mutation.action === "no_op" ? "Verified" : "Updated"} ${ledgerDefinition.name}.`,
        },
        {
          kind: "note",
          summary: `Ledger mutation ${mutation.id} committed.`,
        },
      ],
    }, actor);
    return completed.status < 400
      ? { ok: true, execution: completed.body.execution, replayed: completed.body.replayed }
      : { ok: false, status: completed.status, error: completed.body.error };
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
    materializeRoutineIssue,
    createRoutineRun,
    getRoutineWorkItemExecution,
    startRoutineWorkItem,
    completeRoutineStep,
    retryRoutineStep,
    decideRoutineApproval,
    decideRoutineCondition,
    cancelRoutineWorkItem,
    transitionRoutineStep,
    validateRoutineLedgerStep,
    completeRoutineLedgerStep,
  };
}
