import { createHash } from "node:crypto";

import {
  normalizeLedgerPostingPlan,
} from "@myagenttool/protocol/task-resources";

import { actorCanAccessProject, LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const APPROVAL_ACTION = "ledger_posting_plan_commit";
const SUPPORTED_ACTIONS = new Set(["create", "update"]);
const ACTIVE_PLAN_STATUSES = new Set(["proposed", "approved"]);
const REPLACEABLE_PLAN_STATUSES = new Set(["cancelled", "invalidated"]);

function actorTeam(actor) {
  return actor?.teamId ?? LOCAL_TEAM_ID;
}

function actorUser(actor) {
  return actor?.userId ?? "usr_local";
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function publicPlan(row) {
  if (!row) return null;
  return {
    ...row.plan,
    id: row.id,
    revision: row.revision,
    status: row.status,
    previewId: row.previewId,
    batchPreviewId: row.batchPreviewId,
    previewIds: [...(row.previewIds ?? [])],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    invalidatedAt: row.invalidatedAt ?? null,
    invalidatedReason: row.invalidatedReason ?? null,
  };
}

function visible(row, actor, state) {
  return row?.ownerTeamId === actorTeam(actor)
    && actorCanAccessProject(state, actor, row.projectId);
}

function evidenceKey(ref) {
  return `${ref.artifactId}:${ref.field ?? ""}`;
}

export function createTaskLedgerPostingService({
  state,
  now,
  nextId,
  appendEvent = () => {},
  persistStateSoon,
  store,
  previewLedgerUpsert,
  previewLedgerBatchUpsert,
  commitLedgerUpsertPreview,
  commitLedgerBatchUpsertPreview,
  validateApprovalToken,
  reconcileRecordBindings,
} = {}) {
  const runTx = makeRunTx({ store, persistStateSoon });

  function workItemFor(workItemId, actor) {
    return (state.workItems ?? []).find((item) => item.id === String(workItemId)
      && item.ownerTeamId === actorTeam(actor)
      && actorCanAccessProject(state, actor, item.projectId)) ?? null;
  }

  function planFor(planId, actor) {
    return (state.taskLedgerPostingPlans ?? []).find((row) => row.id === String(planId)
      && visible(row, actor, state)) ?? null;
  }

  function outputBindings(item, role) {
    return (item.recordBindings ?? []).filter((binding) =>
      binding.direction === "output" && binding.role === role);
  }

  function bindingForOperation(bindings, operation, used) {
    return bindings.find((binding) => {
      if (used.has(binding.id) || binding.ledgerDefinitionId !== operation.ledgerDefinitionId) return false;
      if (operation.recordId != null) return binding.record?.recordId === operation.recordId;
      return binding.record == null;
    }) ?? null;
  }

  function validateTaskOperation(operation, bindings, used) {
    if (!SUPPORTED_ACTIONS.has(operation.action)) {
      return { status: 409, body: { error: "task_ledger_posting_action_not_supported", action: operation.action } };
    }
    const binding = bindingForOperation(bindings, operation, used);
    if (!binding) {
      return { status: 409, body: { error: "task_ledger_posting_binding_mismatch" } };
    }
    if (operation.action === "create" && binding.record != null) {
      return { status: 409, body: { error: "task_ledger_posting_create_requires_unresolved_output" } };
    }
    if (operation.action === "update" && (!binding.record || binding.record.recordId !== operation.recordId)) {
      return { status: 409, body: { error: "task_ledger_posting_update_requires_bound_record" } };
    }
    if (!binding.snapshot?.evidenceRefs?.length) {
      return { status: 409, body: { error: "task_ledger_posting_evidence_snapshot_required" } };
    }
    const allowedEvidence = new Set(binding.snapshot.evidenceRefs.map(evidenceKey));
    if (operation.sourceEvidence.some((ref) => !allowedEvidence.has(evidenceKey(ref)))) {
      return { status: 409, body: { error: "task_ledger_posting_evidence_out_of_scope" } };
    }
    used.add(binding.id);
    return { binding };
  }

  function operationForLedger(operation, binding) {
    return {
      ledgerDefinitionId: operation.ledgerDefinitionId,
      businessKey: operation.action === "update" ? binding.record.businessKey : null,
      fields: operation.fields,
      sourceEvidence: operation.sourceEvidence,
    };
  }

  function previewResult(row) {
    return {
      preview: row.previewSnapshot ?? null,
      batchPreview: row.batchPreviewSnapshot ?? null,
    };
  }

  function resultBody(row, extra = {}) {
    const current = previewResult(row);
    return {
      plan: publicPlan(row),
      preview: current.preview,
      batchPreview: current.batchPreview,
      ...extra,
    };
  }

  function invalidatePlan(row, item, reason = "work_item_revision_changed") {
    if (!row || !item || !ACTIVE_PLAN_STATUSES.has(row.status) || row.resultRevision === item.revision) return false;
    const timestamp = now();
    runTx(() => {
      row.status = "invalidated";
      row.plan.state = "invalidated";
      row.revision += 1;
      row.updatedAt = timestamp;
      row.invalidatedAt = timestamp;
      row.invalidatedReason = reason;
      appendEvent({
        invocationId: null,
        type: "task_ledger_posting_plan_invalidated",
        level: "warn",
        message: `Ledger posting plan ${row.id} was invalidated after work item ${item.id} changed.`,
        data: {
          planId: row.id,
          workItemId: item.id,
          plannedRevision: row.resultRevision,
          currentRevision: item.revision,
          reason,
        },
      });
    });
    return true;
  }

  function reconcilePlan(row, item, reason) {
    invalidatePlan(row, item, reason);
    return row;
  }

  function invalidateStaleLedgerPostingPlanForWorkItem(item, _actor = null, reason = "work_item_revision_changed") {
    if (!item) return false;
    const row = item.ledgerPostingPlanId
      ? (state.taskLedgerPostingPlans ?? []).find((candidate) => candidate.id === item.ledgerPostingPlanId
        && candidate.ownerTeamId === item.ownerTeamId && candidate.projectId === item.projectId) ?? null
      : null;
    return invalidatePlan(row, item, reason);
  }

  async function prepareLedgerPostingPlan({ workItemId, expectedRevision, plan: inputPlan = null, ...legacyPlan } = {}, actor = null) {
    const freshness = await reconcileRecordBindings?.({ workItemId }, actor);
    if (freshness && freshness.status !== 200) return freshness;
    if (freshness?.body?.postingBlocked) {
      return {
        status: 409,
        body: {
          error: "task_ledger_posting_record_bindings_stale",
          currentRevision: freshness.body.currentRevision,
          blockingBindings: freshness.body.blockingBindings,
        },
      };
    }
    const item = workItemFor(workItemId, actor);
    if (!item) return { status: 404, body: { error: "work_item_not_found" } };
    if (item.revision !== expectedRevision) {
      return { status: 409, body: { error: "task_ledger_posting_work_item_revision_conflict", currentRevision: item.revision } };
    }
    if ((item.executionBindings ?? []).length) {
      return { status: 409, body: { error: "task_ledger_posting_execution_started" } };
    }

    const candidate = inputPlan && typeof inputPlan === "object" ? inputPlan : legacyPlan;
    const normalized = normalizeLedgerPostingPlan({
      ...candidate,
      workItemId: item.id,
      resultRevision: item.revision,
      state: "proposed",
    });
    if (!normalized.ok) return { status: 400, body: { error: normalized.error } };
    const operations = [normalized.value.primary, ...normalized.value.related].filter(Boolean);
    if (!operations.length) return { status: 400, body: { error: "task_ledger_posting_operations_required" } };

    const inputDigest = digest(normalized.value);
    const existing = item.ledgerPostingPlanId ? planFor(item.ledgerPostingPlanId, actor) : null;
    reconcilePlan(existing, item, "work_item_revision_changed_before_prepare");
    if (existing && existing.inputDigest === inputDigest && !REPLACEABLE_PLAN_STATUSES.has(existing.status)
      && existing.status !== "partially_committed") {
      return { status: 200, body: resultBody(existing, { replayed: true }) };
    }
    if (existing && !REPLACEABLE_PLAN_STATUSES.has(existing.status) && existing.status !== "committed") {
      return { status: 409, body: { error: "task_ledger_posting_plan_exists", planId: existing.id } };
    }

    const primaryBindings = outputBindings(item, "primary_ledger");
    const relatedBindings = outputBindings(item, "related_ledger");
    const used = new Set();
    const bindings = [];
    if (normalized.value.primary) {
      const checked = validateTaskOperation(normalized.value.primary, primaryBindings, used);
      if (checked.status) return checked;
      bindings.push(checked.binding);
    }
    for (const operation of normalized.value.related) {
      const checked = validateTaskOperation(operation, relatedBindings, used);
      if (checked.status) return checked;
      bindings.push(checked.binding);
    }

    const ledgerOperations = operations.map((operation, index) =>
      operationForLedger(operation, bindings[index]));
    const missingDefinition = ledgerOperations.find((operation) =>
      !(state.ledgerDefinitions ?? []).some((definition) => definition.id === operation.ledgerDefinitionId
        && definition.projectId === item.projectId && definition.ownerTeamId === actorTeam(actor)));
    if (missingDefinition) return { status: 404, body: { error: "ledger_definition_not_found" } };

    let ledgerResponse;
    if (ledgerOperations.length === 1) {
      ledgerResponse = await previewLedgerUpsert(ledgerOperations[0], actor);
    } else {
      ledgerResponse = await previewLedgerBatchUpsert({
        operations: ledgerOperations,
        idempotencyKey: `task-posting:${item.id}:${item.revision}`,
      }, actor);
    }
    if (![200, 201, 202].includes(ledgerResponse.status)) return ledgerResponse;

    const preview = ledgerResponse.body?.preview ?? null;
    const batchPreview = ledgerResponse.body?.batchPreview ?? null;
    const timestamp = now();
    const row = {
      id: nextId("tpp"),
      schemaVersion: 2,
      ownerTeamId: item.ownerTeamId,
      projectId: item.projectId,
      workItemId: item.id,
      resultRevision: item.revision,
      plan: normalized.value,
      inputDigest,
      previewId: preview?.id ?? null,
      batchPreviewId: batchPreview?.id ?? null,
      previewIds: preview ? [preview.id] : (batchPreview?.children ?? []).map((child) => child.id),
      previewSnapshot: preview,
      batchPreviewSnapshot: batchPreview,
      expectedLedgerActions: operations.map((operation) => operation.action === "create" ? "insert" : ["update", "no_op"]),
      status: "proposed",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorUser(actor),
    };
    runTx(() => {
      (state.taskLedgerPostingPlans ??= []).unshift(row);
      item.ledgerPostingPlanId = row.id;
      item.updatedAt = timestamp;
      appendEvent({
        invocationId: null,
        type: "task_ledger_posting_plan_created",
        level: "info",
        message: `Ledger posting plan ${row.id} prepared for work item ${item.id}.`,
        data: { planId: row.id, workItemId: item.id, previewId: row.previewId, batchPreviewId: row.batchPreviewId },
      });
    });
    return { status: ledgerResponse.status === 202 ? 202 : 201, body: resultBody(row, { replayed: false }) };
  }

  async function commitLedgerPostingPlan({ planId, workItemId, expectedRevision, approvalToken } = {}, actor = null) {
    const row = planFor(planId, actor);
    if (!row || (workItemId && row.workItemId !== String(workItemId))) {
      return { status: 404, body: { error: "task_ledger_posting_plan_not_found" } };
    }
    if (row.status === "committed") return { status: 200, body: resultBody(row, { replayed: true }) };
    const freshness = await reconcileRecordBindings?.({ workItemId: row.workItemId }, actor);
    if (freshness && freshness.status !== 200) return freshness;
    if (freshness?.body?.postingBlocked) {
      return {
        status: 409,
        body: {
          error: "task_ledger_posting_record_bindings_stale",
          currentRevision: freshness.body.currentRevision,
          blockingBindings: freshness.body.blockingBindings,
        },
      };
    }
    const item = workItemFor(row.workItemId, actor);
    if (!item) return { status: 404, body: { error: "work_item_not_found" } };
    if (item.revision !== expectedRevision || row.resultRevision !== item.revision) {
      invalidatePlan(row, item, "work_item_revision_changed_before_commit");
      return { status: 409, body: { error: "task_ledger_posting_plan_stale", currentRevision: item.revision } };
    }
    if (!["proposed", "approved"].includes(row.status)) {
      return { status: 409, body: { error: "task_ledger_posting_plan_not_committable", currentState: row.status } };
    }
    const previewActions = row.batchPreviewId
      ? (row.batchPreviewSnapshot?.children ?? []).map((child) => child.action)
      : [row.previewSnapshot?.action];
    if (previewActions.some((action, index) => !row.expectedLedgerActions?.[index]?.includes(action))) {
      return { status: 409, body: { error: "task_ledger_posting_preview_action_changed" } };
    }
    const approval = validateApprovalToken?.(approvalToken, {
      action: APPROVAL_ACTION,
      targetId: row.id,
      actor,
      allowLegacy: false,
    });
    if (!approval?.approved) {
      return { status: 409, body: { error: "task_ledger_posting_approval_required", reason: approval?.reason ?? "grant_required" } };
    }

    const ledgerResponse = row.batchPreviewId
      ? await commitLedgerBatchUpsertPreview({
        batchPreviewId: row.batchPreviewId,
        expectedRevision: (state.ledgerBatchUpsertPreviews ?? []).find((batch) => batch.id === row.batchPreviewId)?.revision,
        approved: true,
      }, actor)
      : await commitLedgerUpsertPreview({
        previewId: row.previewId,
        expectedRevision: (state.ledgerUpsertPreviews ?? []).find((preview) => preview.id === row.previewId)?.revision,
        approved: true,
      }, actor);
    const committed = ledgerResponse.status === 200;
    const batchState = ledgerResponse.body?.batchPreview?.state;
    const partial = batchState === "partial" || ledgerResponse.body?.error === "ledger_batch_commit_partial";
    runTx(() => {
      row.status = committed ? "committed" : partial ? "partially_committed" : row.status;
      if (committed) row.plan.state = "committed";
      else if (partial) row.plan.state = "partially_committed";
      row.revision += 1;
      row.updatedAt = now();
      row.approvalGrantId = approval.grantId ?? null;
      appendEvent({
        invocationId: null,
        type: committed ? "task_ledger_posting_plan_committed" : "task_ledger_posting_plan_commit_failed",
        level: committed ? "info" : "warn",
        message: committed ? `Ledger posting plan ${row.id} committed.` : `Ledger posting plan ${row.id} was not committed.`,
        data: { planId: row.id, workItemId: row.workItemId, approvalGrantId: row.approvalGrantId, error: ledgerResponse.body?.error ?? null },
      });
    });
    return {
      status: ledgerResponse.status,
      body: { ...ledgerResponse.body, plan: publicPlan(row) },
    };
  }

  function getLedgerPostingPlan({ planId, workItemId } = {}, actor = null) {
    const item = workItemId ? workItemFor(workItemId, actor) : null;
    const row = planId
      ? planFor(planId, actor)
      : item?.ledgerPostingPlanId
        ? planFor(item.ledgerPostingPlanId, actor)
        : (state.taskLedgerPostingPlans ?? []).find((candidate) =>
          candidate.workItemId === String(workItemId) && visible(candidate, actor, state));
    if (!row) return { status: 404, body: { error: "task_ledger_posting_plan_not_found" } };
    const owningItem = item ?? workItemFor(row.workItemId, actor);
    if (owningItem) reconcilePlan(row, owningItem, "work_item_revision_changed_before_read");
    return { status: 200, body: resultBody(row) };
  }

  return {
    prepareLedgerPostingPlan,
    commitLedgerPostingPlan,
    getLedgerPostingPlan,
    invalidateStaleLedgerPostingPlanForWorkItem,
  };
}

export { APPROVAL_ACTION as TASK_LEDGER_POSTING_APPROVAL_ACTION };
