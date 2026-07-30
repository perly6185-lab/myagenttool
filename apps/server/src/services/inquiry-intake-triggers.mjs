import { createHash } from "node:crypto";

import { actorCanAccessProject, LOCAL_TEAM_ID, LOCAL_USER_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const ACCEPTABLE_OBSERVATION_STATES = new Set(["ready", "needs_review"]);
const SAFE_IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function hashPayload(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function actorTeam(actor) {
  return actor?.teamId ?? LOCAL_TEAM_ID;
}

function actorUser(actor) {
  return actor?.userId ?? LOCAL_USER_ID;
}

function receiptView(receipt) {
  if (!receipt) return null;
  return {
    id: receipt.id,
    projectId: receipt.projectId,
    sourceId: receipt.sourceId,
    observationId: receipt.observationId,
    artifactId: receipt.artifactId,
    businessKey: receipt.businessKey,
    routineDefinitionId: receipt.routineDefinitionId,
    routineVersion: receipt.routineVersion,
    businessCaseId: receipt.businessCaseId,
    workItemId: receipt.workItemId,
    workItemLocalRef: receipt.workItemLocalRef,
    routineRunId: receipt.routineRunId,
    state: receipt.state,
    triggeredAt: receipt.triggeredAt,
    revision: receipt.revision,
  };
}

function classificationView(classification) {
  return {
    id: classification.id,
    artifactId: classification.artifactId,
    documentType: classification.documentType,
    confidence: classification.confidence,
    confirmationState: classification.confirmationState,
    analysisState: classification.analysisState,
    riskSignals: classification.riskSignals,
    fieldProposals: classification.fieldProposals,
    revision: classification.revision,
  };
}

function routineView(definition) {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    version: definition.version,
    triggerDocumentTypes: definition.triggerDocumentTypes,
  };
}

export function createInquiryIntakeTriggerService({
  state,
  now = () => new Date().toISOString(),
  nextId = (prefix) => `${prefix}_${Date.now().toString(36)}`,
  appendEvent = () => {},
  persistStateSoon = () => {},
  analyzeArtifact,
  confirmClassification,
  createBusinessCase,
  listRoutineDefinitions,
  materializeRoutineIssue,
  verifyEvidence = null,
  store,
} = {}) {
  state.workflowIntakeReceipts ??= [];
  const runTx = makeRunTx({ store, persistStateSoon });
  const visible = (row, actor) =>
    row?.ownerTeamId === actorTeam(actor)
    && actorCanAccessProject(state, actor, row.projectId);
  const observationFor = (observationId, actor) =>
    state.workflowIntakeObservations?.find((row) => row.id === observationId && visible(row, actor)) ?? null;
  const sourceFor = (sourceId, actor) =>
    state.workflowSources?.find((row) => row.id === sourceId && visible(row, actor)) ?? null;
  const artifactFor = (artifactId, actor) =>
    state.workflowArtifacts?.find((row) => row.id === artifactId && visible(row, actor)) ?? null;

  function updateObservation(observation, patch, actor) {
    const timestamp = now();
    runTx(() => {
      Object.assign(observation, patch, {
        revision: Number(observation.revision ?? 0) + 1,
        updatedAt: timestamp,
        updatedBy: actorUser(actor),
      });
    });
  }

  function replayReceipt(observation, routineDefinitionId, actor) {
    if (!observation.contentIdentity) return null;
    const receipt = state.workflowIntakeReceipts.find((row) =>
      visible(row, actor)
      && row.sourceId === observation.sourceId
      && row.contentIdentity === observation.contentIdentity
      && (!routineDefinitionId || row.routineDefinitionId === routineDefinitionId)
      && row.state === "triggered");
    if (!receipt) return null;
    if (observation.state !== "triggered" || observation.receiptId !== receipt.id) {
      updateObservation(observation, {
        state: "triggered",
        reason: null,
        receiptId: receipt.id,
        triggeredAt: receipt.triggeredAt,
      }, actor);
    }
    return receipt;
  }

  function contextFor(observationId, actor) {
    const observation = observationFor(observationId, actor);
    if (!observation) {
      return { error: { status: 404, body: { error: "workflow_intake_observation_not_found" } } };
    }
    const source = sourceFor(observation.sourceId, actor);
    const artifact = artifactFor(observation.canonicalArtifactId ?? observation.artifactId, actor);
    if (!source || !artifact
      || artifact.sourceId !== source.id
      || artifact.projectId !== source.projectId) {
      return { error: { status: 409, body: { error: "workflow_intake_evidence_not_current" } } };
    }
    if (source.state !== "active") {
      return { error: { status: 409, body: { error: "workflow_source_revoked" } } };
    }
    if (source.readMode !== "supported_text") {
      if (observation.state !== "needs_review"
        || observation.reason !== "workflow_intake_text_access_required") {
        updateObservation(observation, {
          state: "needs_review",
          reason: "workflow_intake_text_access_required",
        }, actor);
      }
      return {
        error: {
          status: 409,
          body: {
            error: "workflow_intake_text_access_required",
            recovery: "Authorize supported text access before reviewing this inquiry.",
          },
        },
      };
    }
    if (artifact.availability !== "available" || artifact.exclusion) {
      return { error: { status: 409, body: { error: "workflow_intake_evidence_not_current" } } };
    }
    if (typeof verifyEvidence === "function") {
      const verification = verifyEvidence({ observationId: observation.id }, actor);
      if (verification.status !== 200) return { error: verification };
    }
    return { observation, source, artifact };
  }

  async function inspect({ observationId } = {}, actor = null) {
    const initial = observationFor(observationId, actor);
    if (!initial) {
      return { status: 404, body: { error: "workflow_intake_observation_not_found" } };
    }
    const priorReceipt = replayReceipt(initial, null, actor);
    if (priorReceipt) {
      return {
        status: 200,
        body: { state: "triggered", receipt: receiptView(priorReceipt), replayed: true },
      };
    }
    if (initial.state === "duplicate") {
      return {
        status: 409,
        body: {
          error: "workflow_intake_duplicate",
          canonicalArtifactId: initial.canonicalArtifactId,
        },
      };
    }
    if (!ACCEPTABLE_OBSERVATION_STATES.has(initial.state)) {
      return {
        status: 409,
        body: { error: "workflow_intake_observation_not_ready", state: initial.state },
      };
    }
    const context = contextFor(observationId, actor);
    if (context.error) return context.error;
    const analysis = await analyzeArtifact({ artifactId: context.artifact.id }, actor);
    if (![200, 201].includes(analysis.status)) return analysis;
    const definitions = listRoutineDefinitions({ sourceId: context.source.id }, actor);
    if (definitions.status !== 200) return definitions;
    const routines = definitions.body.routineDefinitions
      .filter((definition) =>
        definition.state === "published"
        && definition.triggerDocumentTypes?.includes("inquiry")
        && definition.evidenceHealth?.state !== "blocked")
      .map(routineView);
    if (!routines.length) {
      return {
        status: 409,
        body: {
          error: "workflow_intake_routine_not_available",
          recovery: "Publish an inquiry routine before accepting new inquiries.",
        },
      };
    }
    return {
      status: 200,
      body: {
        state: "needs_confirmation",
        observation: {
          id: context.observation.id,
          sourceId: context.observation.sourceId,
          artifactId: context.artifact.id,
          relativePath: context.observation.relativePath,
          revision: context.observation.revision,
        },
        classification: classificationView(analysis.body.classification),
        routines,
      },
    };
  }

  async function accept({
    observationId,
    expectedRevision,
    idempotencyKey,
    routineDefinitionId,
    confirmed,
    fieldCorrections = {},
    excludedFieldKeys = [],
  } = {}, actor = null) {
    if (confirmed !== true) {
      return { status: 400, body: { error: "workflow_intake_confirmation_required" } };
    }
    if (!SAFE_IDEMPOTENCY_KEY_RE.test(String(idempotencyKey ?? ""))
      || !routineDefinitionId
      || !fieldCorrections
      || typeof fieldCorrections !== "object"
      || Array.isArray(fieldCorrections)
      || !Array.isArray(excludedFieldKeys)) {
      return { status: 400, body: { error: "invalid_workflow_intake_acceptance" } };
    }
    const requestKey = `${actorTeam(actor)}:${idempotencyKey}`;
    const requestHash = hashPayload({
      observationId,
      routineDefinitionId,
      confirmed,
      fieldCorrections,
      excludedFieldKeys,
    });
    const requestReplay = state.workflowIntakeReceipts.find((row) =>
      visible(row, actor) && row.requestKey === requestKey);
    if (requestReplay) {
      if (requestReplay.requestHash !== requestHash) {
        return { status: 409, body: { error: "workflow_intake_idempotency_conflict" } };
      }
      const replayObservation = observationFor(observationId, actor);
      if (replayObservation) replayReceipt(replayObservation, routineDefinitionId, actor);
      return {
        status: 200,
        body: { state: "triggered", receipt: receiptView(requestReplay), replayed: true },
      };
    }

    const initial = observationFor(observationId, actor);
    if (!initial) {
      return { status: 404, body: { error: "workflow_intake_observation_not_found" } };
    }
    const contentReplay = replayReceipt(initial, routineDefinitionId, actor);
    if (contentReplay) {
      return {
        status: 200,
        body: { state: "triggered", receipt: receiptView(contentReplay), replayed: true },
      };
    }
    if (initial.revision !== expectedRevision) {
      return {
        status: 409,
        body: {
          error: "workflow_intake_observation_revision_conflict",
          currentRevision: initial.revision,
        },
      };
    }
    if (!ACCEPTABLE_OBSERVATION_STATES.has(initial.state)
      || initial.reason === "workflow_intake_business_identity_conflict") {
      return {
        status: 409,
        body: { error: "workflow_intake_observation_not_ready", state: initial.state },
      };
    }
    const context = contextFor(observationId, actor);
    if (context.error) return context.error;
    const definitions = listRoutineDefinitions({ sourceId: context.source.id }, actor);
    if (definitions.status !== 200) return definitions;
    const definition = definitions.body.routineDefinitions.find((row) =>
      row.id === routineDefinitionId
      && row.state === "published"
      && row.triggerDocumentTypes?.includes("inquiry")
      && row.evidenceHealth?.state !== "blocked");
    if (!definition) {
      return { status: 409, body: { error: "workflow_intake_routine_not_available" } };
    }

    const analysis = await analyzeArtifact({ artifactId: context.artifact.id }, actor);
    if (![200, 201].includes(analysis.status)) return analysis;
    if (typeof verifyEvidence === "function") {
      const currentEvidence = verifyEvidence({ observationId: context.observation.id }, actor);
      if (currentEvidence.status !== 200) return currentEvidence;
    }
    const confirmedClassification = confirmClassification({
      classificationId: analysis.body.classification.id,
      expectedRevision: analysis.body.classification.revision,
      documentType: "inquiry",
      fieldCorrections,
      excludedFieldKeys,
    }, actor);
    if (confirmedClassification.status !== 200) return confirmedClassification;
    const { classification, entity } = confirmedClassification.body;
    if (!entity || entity.entityType !== "inquiry" || !entity.businessKey) {
      return {
        status: 422,
        body: {
          error: "workflow_intake_business_identity_required",
          recovery: "Confirm an inquiry number before creating the task.",
          classification: classificationView(classification),
        },
      };
    }

    const existingCase = state.businessCases.find((row) =>
      visible(row, actor)
      && row.sourceId === context.source.id
      && row.businessKey === entity.businessKey);
    const existingTrigger = existingCase?.artifactBindings?.find((binding) =>
      binding.roles?.includes("trigger"));
    if (existingCase && (
      !existingTrigger
      || existingCase.artifactFingerprints?.[existingTrigger.artifactId] !== context.artifact.fingerprint
    )) {
      updateObservation(context.observation, {
        state: "needs_review",
        reason: "workflow_intake_business_identity_conflict",
        conflictingBusinessCaseId: existingCase.id,
      }, actor);
      return {
        status: 409,
        body: {
          error: "workflow_intake_business_identity_conflict",
          businessKey: entity.businessKey,
        },
      };
    }

    const evidenceRefs = classification.fieldProposals.flatMap((field) => field.evidenceRefs ?? []);
    const businessCaseResult = existingCase
      ? { status: 200, body: { businessCase: existingCase, replayed: true } }
      : createBusinessCase({
        projectId: context.source.projectId,
        sourceId: context.source.id,
        businessKey: entity.businessKey,
        state: "confirmed",
        entityIds: [entity.id],
        artifactBindings: [{
          artifactId: context.artifact.id,
          documentType: "inquiry",
          roles: ["trigger", "input"],
        }],
        evidenceRefs: evidenceRefs.length
          ? evidenceRefs
          : [{ artifactId: context.artifact.id, kind: "business_key", field: "inquiry_number" }],
        confidence: classification.confidence,
      }, actor);
    if (![200, 201].includes(businessCaseResult.status)) return businessCaseResult;
    const businessCase = businessCaseResult.body.businessCase;
    const materialized = materializeRoutineIssue({
      businessCaseId: businessCase.id,
      routineDefinitionId: definition.id,
      triggerArtifactIds: [context.artifact.id],
    }, actor);
    if (![200, 201].includes(materialized.status)) return materialized;

    const existingAfterRecovery = state.workflowIntakeReceipts.find((row) =>
      visible(row, actor)
      && row.sourceId === context.source.id
      && row.contentIdentity === context.observation.contentIdentity
      && row.routineDefinitionId === definition.id
      && row.routineVersion === definition.version);
    if (existingAfterRecovery) {
      replayReceipt(context.observation, definition.id, actor);
      return {
        status: 200,
        body: { state: "triggered", receipt: receiptView(existingAfterRecovery), replayed: true },
      };
    }
    const timestamp = now();
    const receipt = {
      id: nextId("wir"),
      ownerTeamId: context.observation.ownerTeamId,
      projectId: context.observation.projectId,
      sourceId: context.observation.sourceId,
      observationId: context.observation.id,
      artifactId: context.artifact.id,
      contentIdentity: context.observation.contentIdentity,
      businessKey: entity.businessKey,
      routineDefinitionId: definition.id,
      routineVersion: definition.version,
      businessCaseId: businessCase.id,
      workItemId: materialized.body.workItem.id,
      workItemLocalRef: materialized.body.workItem.localRef,
      routineRunId: materialized.body.execution.run.id,
      requestKey,
      requestHash,
      state: "triggered",
      triggeredAt: timestamp,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
    };
    runTx(() => {
      state.workflowIntakeReceipts.push(receipt);
      Object.assign(context.observation, {
        state: "triggered",
        reason: null,
        receiptId: receipt.id,
        triggeredAt: timestamp,
        revision: Number(context.observation.revision ?? 0) + 1,
        updatedAt: timestamp,
        updatedBy: actorUser(actor),
      });
      appendEvent({
        invocationId: null,
        type: "workflow_inquiry_intake_triggered",
        level: "info",
        message: "Confirmed inquiry materialized as a local routine task.",
        data: {
          projectId: receipt.projectId,
          sourceId: receipt.sourceId,
          observationId: receipt.observationId,
          businessCaseId: receipt.businessCaseId,
          workItemId: receipt.workItemId,
          routineDefinitionId: receipt.routineDefinitionId,
          routineVersion: receipt.routineVersion,
          actorTeamId: actorTeam(actor),
          actorId: actorUser(actor),
        },
      });
    });
    return {
      status: 201,
      body: { state: "triggered", receipt: receiptView(receipt), replayed: false },
    };
  }

  return { inspect, accept };
}
