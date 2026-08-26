import { actorCanAccessProject, LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const MANAGED_REASONS = new Set([
  "business_record_changed",
  "business_record_unavailable",
  "business_record_available_requires_confirmation",
  "business_record_refreshed_and_confirmed",
]);

function actorTeam(actor) {
  return actor?.teamId ?? LOCAL_TEAM_ID;
}

function visibleItem(state, workItemId, actor) {
  return (state.workItems ?? []).find((item) => item.id === String(workItemId)
    && item.ownerTeamId === actorTeam(actor)
    && actorCanAccessProject(state, actor, item.projectId)) ?? null;
}

function sameRevision(left, right) {
  if (left == null || right == null) return left == null && right == null;
  return String(left) === String(right);
}

function managedReasons(reasons, next) {
  return [...new Set([
    ...(Array.isArray(reasons) ? reasons : []).filter((reason) => !MANAGED_REASONS.has(reason)),
    next,
  ])].slice(-20);
}

function bindingGate(item) {
  const recordBacked = (item.recordBindings ?? []).filter((binding) => binding.record);
  const blocked = recordBacked.filter((binding) => binding.resolution?.state !== "resolved");
  return {
    blocked: blocked.length > 0,
    executionBlocked: blocked.some((binding) => binding.direction === "input"),
    postingBlocked: blocked.length > 0,
    blockingBindings: blocked.map((binding) => ({
      bindingId: binding.id,
      direction: binding.direction,
      role: binding.role,
      state: binding.resolution?.state ?? "unavailable",
    })),
  };
}

export function createTaskRecordFreshnessService({
  state,
  now,
  nextId,
  appendEvent = () => {},
  persistStateSoon,
  store,
  readBusinessLedgerRecord,
  getWorkItem,
  invalidateLedgerPostingPlan = () => false,
} = {}) {
  const runTx = makeRunTx({ store, persistStateSoon });

  function bindingLedgerDefinition(item, binding) {
    return (state.ledgerDefinitions ?? []).find((definition) =>
      definition.id === binding.ledgerDefinitionId
      && definition.ownerTeamId === item.ownerTeamId
      && definition.projectId === item.projectId) ?? null;
  }

  async function inspectBinding(item, binding, actor) {
    if (!binding.record || !binding.snapshot) return null;
    if (["stale", "needs_confirmation"].includes(binding.resolution?.state)) return null;
    if (!bindingLedgerDefinition(item, binding)) {
      return {
        binding,
        state: "unavailable",
        reason: "business_record_unavailable",
        error: "ledger_definition_out_of_scope",
      };
    }
    let result;
    try {
      result = await readBusinessLedgerRecord({
        ledgerDefinitionId: binding.ledgerDefinitionId,
        recordId: binding.record.recordId,
      }, actor);
    } catch {
      result = { status: 503, body: { error: "ledger_record_read_failed" } };
    }
    if (result?.status !== 200 || !result.body?.record) {
      return {
        binding,
        state: "unavailable",
        reason: "business_record_unavailable",
        error: result?.body?.error ?? "ledger_record_read_failed",
      };
    }
    const current = result.body.record;
    const changed = current.ledgerDefinitionId !== binding.ledgerDefinitionId
      || current.recordId !== binding.record.recordId
      || current.fingerprint !== binding.snapshot.fingerprint
      || !sameRevision(current.revision, binding.snapshot.revision);
    if (changed) {
      return { binding, state: "stale", reason: "business_record_changed", current };
    }
    if (binding.resolution?.state === "unavailable") {
      return {
        binding,
        state: "needs_confirmation",
        reason: "business_record_available_requires_confirmation",
        current,
      };
    }
    return null;
  }

  async function reconcileWorkItemRecordBindings({ workItemId } = {}, actor = null, attempt = 0) {
    const item = visibleItem(state, workItemId, actor);
    if (!item) return { status: 404, body: { error: "work_item_not_found" } };
    const inspectedRevision = item.revision;
    const inspections = (await Promise.all((item.recordBindings ?? []).map((binding) => inspectBinding(item, binding, actor))))
      .filter(Boolean);
    if (item.revision !== inspectedRevision) {
      if (attempt < 2) return reconcileWorkItemRecordBindings({ workItemId }, actor, attempt + 1);
      return {
        status: 409,
        body: { error: "work_item_record_freshness_conflict", currentRevision: item.revision },
      };
    }
    const updates = inspections.filter((inspection) =>
      inspection.binding.resolution?.state !== inspection.state
      || !(inspection.binding.resolution?.reasons ?? []).includes(inspection.reason));
    if (updates.length) {
      const timestamp = now();
      const byId = new Map(updates.map((update) => [update.binding.id, update]));
      runTx(() => {
        item.recordBindings = (item.recordBindings ?? []).map((binding) => {
          const update = byId.get(binding.id);
          if (!update) return binding;
          return {
            ...binding,
            resolution: {
              ...binding.resolution,
              state: update.state,
              reasons: managedReasons(binding.resolution?.reasons, update.reason),
            },
          };
        });
        item.revision += 1;
        item.updatedAt = timestamp;
        item.lastModifiedBy = "system_record_freshness";
        (state.workItemActivities ??= []).unshift({
          id: nextId("wia"),
          workItemId: item.id,
          ownerTeamId: item.ownerTeamId,
          projectId: item.projectId,
          action: "record_bindings_freshness_changed",
          actorId: "system_record_freshness",
          createdAt: timestamp,
          details: {
            bindings: updates.map((update) => ({
              bindingId: update.binding.id,
              from: update.binding.resolution?.state ?? null,
              to: update.state,
              reason: update.reason,
              error: update.error ?? null,
            })),
          },
        });
        appendEvent({
          invocationId: null,
          type: "work_item_record_bindings_freshness_changed",
          level: updates.some((update) => update.state === "unavailable") ? "warn" : "info",
          message: `Business record freshness changed for work item ${item.id}.`,
          data: {
            workItemId: item.id,
            revision: item.revision,
            bindings: updates.map((update) => ({ bindingId: update.binding.id, state: update.state, reason: update.reason })),
          },
        });
      });
      invalidateLedgerPostingPlan(item, actor, "record_binding_freshness_changed");
    }
    return {
      status: 200,
      body: {
        changed: updates.length > 0,
        currentRevision: item.revision,
        ...bindingGate(item),
      },
    };
  }

  async function refreshWorkItemRecordBinding({ workItemId, bindingId, expectedRevision } = {}, actor = null) {
    const item = visibleItem(state, workItemId, actor);
    if (!item) return { status: 404, body: { error: "work_item_not_found" } };
    if (!Number.isInteger(expectedRevision)) return { status: 400, body: { error: "expected_revision_required" } };
    if (item.revision !== expectedRevision) {
      return { status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    if ((item.executionBindings ?? []).length) {
      return { status: 409, body: { error: "work_item_record_bindings_immutable" } };
    }
    const binding = (item.recordBindings ?? []).find((candidate) => candidate.id === String(bindingId));
    if (!binding?.record || !binding.snapshot) {
      return { status: 404, body: { error: "work_item_record_binding_not_found" } };
    }
    if (!bindingLedgerDefinition(item, binding)) {
      return {
        status: 409,
        body: { error: "work_item_record_binding_unavailable", reason: "ledger_definition_out_of_scope" },
      };
    }
    let result;
    try {
      result = await readBusinessLedgerRecord({
        ledgerDefinitionId: binding.ledgerDefinitionId,
        recordId: binding.record.recordId,
      }, actor);
    } catch {
      result = { status: 503, body: { error: "ledger_record_read_failed" } };
    }
    if (result?.status !== 200 || !result.body?.record) {
      return {
        status: 409,
        body: { error: "work_item_record_binding_unavailable", reason: result?.body?.error ?? "ledger_record_read_failed" },
      };
    }
    if (item.revision !== expectedRevision) {
      return { status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    if ((item.executionBindings ?? []).length) {
      return { status: 409, body: { error: "work_item_record_bindings_immutable" } };
    }
    const currentBinding = (item.recordBindings ?? []).find((candidate) => candidate.id === String(bindingId));
    if (!currentBinding?.record || !currentBinding.snapshot) {
      return { status: 404, body: { error: "work_item_record_binding_not_found" } };
    }
    const current = result.body.record;
    if (current.ledgerDefinitionId !== currentBinding.ledgerDefinitionId
      || current.recordId !== currentBinding.record.recordId) {
      return { status: 409, body: { error: "work_item_record_binding_identity_changed" } };
    }
    const alreadyCurrent = currentBinding.resolution?.state === "resolved"
      && current.fingerprint === currentBinding.snapshot.fingerprint
      && sameRevision(current.revision, currentBinding.snapshot.revision);
    if (alreadyCurrent) {
      return { status: 200, body: { workItem: getWorkItem({ workItemId: item.id }, actor).body.workItem, replayed: true } };
    }
    const timestamp = now();
    let refreshedBinding;
    runTx(() => {
      item.recordBindings = (item.recordBindings ?? []).map((candidate) => {
        if (candidate.id !== currentBinding.id) return candidate;
        refreshedBinding = {
          ...candidate,
          record: current,
          snapshot: {
            revision: current.revision,
            fingerprint: current.fingerprint,
            capturedAt: current.observedAt,
            evidenceRefs: candidate.snapshot?.evidenceRefs ?? [],
          },
          resolution: {
            ...candidate.resolution,
            state: "resolved",
            reasons: managedReasons(candidate.resolution?.reasons, "business_record_refreshed_and_confirmed"),
          },
        };
        return refreshedBinding;
      });
      item.revision += 1;
      item.updatedAt = timestamp;
      item.lastModifiedBy = actor?.userId ?? "usr_local";
      (state.workItemActivities ??= []).unshift({
        id: nextId("wia"),
        workItemId: item.id,
        ownerTeamId: item.ownerTeamId,
        projectId: item.projectId,
        action: "record_binding_refreshed",
        actorId: actor?.userId ?? "usr_local",
        createdAt: timestamp,
        details: {
          bindingId: currentBinding.id,
          recordId: current.recordId,
          previousRevision: currentBinding.snapshot.revision,
          currentRevision: current.revision,
        },
      });
      appendEvent({
        invocationId: null,
        type: "work_item_record_binding_refreshed",
        level: "info",
        message: `Business record ${currentBinding.id} refreshed for work item ${item.id}.`,
        data: { workItemId: item.id, bindingId: currentBinding.id, revision: item.revision },
      });
    });
    invalidateLedgerPostingPlan(item, actor, "record_binding_refreshed");
    return {
      status: 200,
      body: {
        workItem: getWorkItem({ workItemId: item.id }, actor).body.workItem,
        binding: refreshedBinding,
        replayed: false,
      },
    };
  }

  return {
    reconcileWorkItemRecordBindings,
    refreshWorkItemRecordBinding,
  };
}
