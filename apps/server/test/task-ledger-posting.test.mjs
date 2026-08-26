import assert from "node:assert/strict";
import { test } from "node:test";

import { createTaskLedgerPostingService } from "../src/services/task-ledger-posting.mjs";

const actor = { userId: "usr_a", teamId: "team_a", role: "operator" };

function harness({ previewStatus = 201, validateApprovalToken } = {}) {
  let sequence = 0;
  const state = {
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }],
    workItems: [{
      id: "lwi_1",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      revision: 3,
      executionBindings: [],
      recordBindings: [{
        id: "binding_primary",
        direction: "output",
        role: "primary_ledger",
        ledgerDefinitionId: "ldg_orders",
        record: null,
        snapshot: {
          revision: "rev_1",
          fingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          capturedAt: "2026-08-26T00:00:00.000Z",
          evidenceRefs: [{ artifactId: "artifact_order", field: "total" }],
        },
      }],
    }],
    ledgerDefinitions: [{
      id: "ldg_orders",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      state: "active",
    }],
    taskLedgerPostingPlans: [],
    ledgerUpsertPreviews: [],
    ledgerBatchUpsertPreviews: [],
  };
  const calls = [];
  const service = createTaskLedgerPostingService({
    state,
    now: () => "2026-08-26T00:01:00.000Z",
    nextId: (prefix) => `${prefix}_${++sequence}`,
    appendEvent: (event) => calls.push({ type: event.type }),
    persistStateSoon: () => {},
    previewLedgerUpsert: async (operation) => {
      calls.push({ type: "preview", operation });
      return {
        status: previewStatus,
        body: {
          preview: {
            id: "lup_1",
            action: operation.fields.order_number === "new" ? "insert" : "update",
            approvalRequired: true,
            changedCells: [],
          },
        },
      };
    },
    previewLedgerBatchUpsert: async () => ({ status: 500, body: { error: "unexpected_batch" } }),
    commitLedgerUpsertPreview: async () => {
      calls.push({ type: "commit" });
      return { status: 200, body: { mutation: { id: "lma_1" }, preview: { id: "lup_1", action: "insert" } } };
    },
    commitLedgerBatchUpsertPreview: async () => ({ status: 500, body: { error: "unexpected_batch" } }),
    validateApprovalToken: validateApprovalToken ?? ((token) => token
      ? ({ approved: true, mode: "grant", grantId: "apg_1" })
      : ({ approved: false, reason: "grant_required" })),
  });
  return { state, service, calls };
}

function plan(overrides = {}) {
  return {
    primary: {
      ledgerDefinitionId: "ldg_orders",
      recordId: null,
      action: "create",
      fields: { order_number: "new", total: 12 },
      sourceEvidence: [{ artifactId: "artifact_order", field: "total" }],
      approvalRequired: true,
    },
    related: [],
    ...overrides,
  };
}

test("prepares a task-scoped local ledger preview and persists the plan", async () => {
  const { state, service, calls } = harness();
  const result = await service.prepareLedgerPostingPlan({
    workItemId: "lwi_1",
    expectedRevision: 3,
    ...plan(),
  }, actor);
  assert.equal(result.status, 201);
  assert.equal(result.body.plan.status, "proposed");
  assert.equal(result.body.plan.previewId, "lup_1");
  assert.equal(state.workItems[0].ledgerPostingPlanId, result.body.plan.id);
  assert.equal(state.taskLedgerPostingPlans.length, 1);
  assert.equal(calls.filter((call) => call.type === "preview").length, 1);
});

test("requires an issued grant and commits the exact prepared plan", async () => {
  const { service, calls } = harness({ validateApprovalToken: (token, request) => {
    if (!token) return { approved: false, reason: "grant_required" };
    assert.equal(token, "issued-token");
    assert.deepEqual(request, {
      action: "ledger_posting_plan_commit",
      targetId: "tpp_1",
      actor,
      allowLegacy: false,
    });
    return { approved: true, mode: "grant", grantId: "apg_1" };
  } });
  const prepared = await service.prepareLedgerPostingPlan({
    workItemId: "lwi_1",
    expectedRevision: 3,
    ...plan(),
  }, actor);
  const denied = await service.commitLedgerPostingPlan({
    workItemId: "lwi_1",
    planId: prepared.body.plan.id,
    expectedRevision: 3,
  }, actor);
  assert.equal(denied.status, 409);
  const committed = await service.commitLedgerPostingPlan({
    workItemId: "lwi_1",
    planId: prepared.body.plan.id,
    expectedRevision: 3,
    approvalToken: "issued-token",
  }, actor);
  assert.equal(committed.status, 200);
  assert.equal(committed.body.plan.status, "committed");
  assert.equal(calls.filter((call) => call.type === "commit").length, 1);
});

test("rejects evidence that is not in the task snapshot", async () => {
  const { service } = harness();
  const result = await service.prepareLedgerPostingPlan({
    workItemId: "lwi_1",
    expectedRevision: 3,
    ...plan({ primary: { ...plan().primary, sourceEvidence: [{ artifactId: "other_artifact", field: "total" }] } }),
  }, actor);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "task_ledger_posting_evidence_out_of_scope");
});
