import assert from "node:assert/strict";
import { test } from "node:test";

import { createTaskRecordFreshnessService } from "../src/services/task-record-freshness.mjs";

const actor = { userId: "usr_a", teamId: "team_a", role: "operator" };

function record(revision, fingerprintCharacter) {
  return {
    ledgerDefinitionId: "ldg_customers",
    recordId: "blr_customer_1",
    recordType: "customer",
    businessKey: "CUS-001",
    title: "Acme",
    revision,
    fingerprint: `sha256:${fingerprintCharacter.repeat(64)}`,
    observedAt: `2026-08-26T00:0${revision === "rev_1" ? "0" : "1"}:00.000Z`,
  };
}

function harness({ readResult } = {}) {
  let sequence = 0;
  let currentReadResult = readResult ?? { status: 200, body: { record: record("rev_2", "b") } };
  const events = [];
  const invalidations = [];
  const reads = [];
  const state = {
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }],
    ledgerDefinitions: [{ id: "ldg_customers", ownerTeamId: "team_a", projectId: "prj_a", state: "active" }],
    workItemActivities: [],
    workItems: [{
      id: "lwi_1",
      ownerTeamId: "team_a",
      projectId: "prj_a",
      revision: 1,
      updatedAt: "2026-08-26T00:00:00.000Z",
      executionBindings: [],
      recordBindings: [{
        id: "binding_customer",
        slotKey: "customer",
        direction: "input",
        role: "required",
        ledgerDefinitionId: "ldg_customers",
        record: record("rev_1", "a"),
        snapshot: {
          revision: "rev_1",
          fingerprint: `sha256:${"a".repeat(64)}`,
          capturedAt: "2026-08-26T00:00:00.000Z",
          evidenceRefs: [{ artifactId: "artifact_customer", field: "name" }],
        },
        resolution: { source: "explicit_user", confidence: 1, state: "resolved", reasons: ["selected"] },
      }],
    }],
  };
  const service = createTaskRecordFreshnessService({
    state,
    now: () => "2026-08-26T00:02:00.000Z",
    nextId: (prefix) => `${prefix}_${++sequence}`,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
    readBusinessLedgerRecord: async (input) => {
      reads.push(input);
      return typeof currentReadResult === "function" ? currentReadResult(input) : currentReadResult;
    },
    getWorkItem: ({ workItemId }) => ({ status: 200, body: { workItem: state.workItems.find((item) => item.id === workItemId) } }),
    invalidateLedgerPostingPlan: (item, requestActor, reason) => {
      invalidations.push({ item, requestActor, reason });
      return true;
    },
  });
  return {
    state,
    service,
    reads,
    events,
    invalidations,
    setReadResult: (next) => { currentReadResult = next; },
  };
}

test("reconciles a changed business record once and blocks execution and posting", async () => {
  const { state, service, reads, events, invalidations } = harness();
  const first = await service.reconcileWorkItemRecordBindings({ workItemId: "lwi_1" }, actor);
  assert.equal(first.status, 200);
  assert.equal(first.body.changed, true);
  assert.equal(first.body.executionBlocked, true);
  assert.equal(first.body.postingBlocked, true);
  assert.deepEqual(first.body.blockingBindings, [{
    bindingId: "binding_customer", direction: "input", role: "required", state: "stale",
  }]);
  assert.equal(state.workItems[0].revision, 2);
  assert.equal(state.workItems[0].recordBindings[0].resolution.state, "stale");
  assert.deepEqual(state.workItems[0].recordBindings[0].resolution.reasons, ["selected", "business_record_changed"]);
  assert.equal(state.workItemActivities[0].action, "record_bindings_freshness_changed");
  assert.equal(events[0].type, "work_item_record_bindings_freshness_changed");
  assert.equal(invalidations.length, 1);

  const replay = await service.reconcileWorkItemRecordBindings({ workItemId: "lwi_1" }, actor);
  assert.equal(replay.body.changed, false);
  assert.equal(state.workItems[0].revision, 2);
  assert.equal(reads.length, 1, "stale records remain fail-closed until the user confirms a refresh");
  assert.equal(invalidations.length, 1);
});

test("refreshes and confirms a stale binding from the server-side ledger read", async () => {
  const { state, service, invalidations } = harness();
  await service.reconcileWorkItemRecordBindings({ workItemId: "lwi_1" }, actor);

  const refreshed = await service.refreshWorkItemRecordBinding({
    workItemId: "lwi_1",
    bindingId: "binding_customer",
    expectedRevision: 2,
  }, actor);
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.replayed, false);
  assert.equal(refreshed.body.workItem.revision, 3);
  assert.equal(refreshed.body.binding.resolution.state, "resolved");
  assert.equal(refreshed.body.binding.record.revision, "rev_2");
  assert.equal(refreshed.body.binding.snapshot.revision, "rev_2");
  assert.deepEqual(refreshed.body.binding.snapshot.evidenceRefs, [{ artifactId: "artifact_customer", field: "name" }]);
  assert.ok(refreshed.body.binding.resolution.reasons.includes("business_record_refreshed_and_confirmed"));
  assert.equal(state.workItemActivities[0].action, "record_binding_refreshed");
  assert.equal(invalidations.length, 2);

  const replay = await service.refreshWorkItemRecordBinding({
    workItemId: "lwi_1",
    bindingId: "binding_customer",
    expectedRevision: 3,
  }, actor);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(state.workItems[0].revision, 3);
  assert.equal(invalidations.length, 2);
});

test("marks missing records unavailable and refuses to confirm them", async () => {
  const { state, service } = harness({ readResult: { status: 404, body: { error: "business_ledger_record_not_found" } } });
  const reconciled = await service.reconcileWorkItemRecordBindings({ workItemId: "lwi_1" }, actor);
  assert.equal(reconciled.body.executionBlocked, true);
  assert.equal(state.workItems[0].recordBindings[0].resolution.state, "unavailable");

  const refresh = await service.refreshWorkItemRecordBinding({
    workItemId: "lwi_1",
    bindingId: "binding_customer",
    expectedRevision: 2,
  }, actor);
  assert.equal(refresh.status, 409);
  assert.equal(refresh.body.error, "work_item_record_binding_unavailable");
  assert.equal(state.workItems[0].revision, 2);
});

test("keeps freshness and refresh operations project scoped", async () => {
  const { service } = harness();
  const foreign = { userId: "usr_b", teamId: "team_b", role: "operator" };
  assert.equal((await service.reconcileWorkItemRecordBindings({ workItemId: "lwi_1" }, foreign)).status, 404);
  assert.equal((await service.refreshWorkItemRecordBinding({
    workItemId: "lwi_1", bindingId: "binding_customer", expectedRevision: 1,
  }, foreign)).status, 404);
});

test("fails closed when a binding points outside the task project", async () => {
  const { state, service, reads } = harness();
  state.ledgerDefinitions[0].projectId = "prj_other";
  const result = await service.reconcileWorkItemRecordBindings({ workItemId: "lwi_1" }, actor);
  assert.equal(result.status, 200);
  assert.equal(result.body.executionBlocked, true);
  assert.equal(state.workItems[0].recordBindings[0].resolution.state, "unavailable");
  assert.equal(state.workItemActivities[0].details.bindings[0].error, "ledger_definition_out_of_scope");
  assert.equal(reads.length, 0);
});

test("does not let an asynchronous ledger read overwrite a concurrent task revision", async () => {
  let finishRead;
  const pendingRead = new Promise((resolve) => { finishRead = resolve; });
  const { state, service, invalidations } = harness({ readResult: pendingRead });
  const refreshing = service.refreshWorkItemRecordBinding({
    workItemId: "lwi_1",
    bindingId: "binding_customer",
    expectedRevision: 1,
  }, actor);
  await Promise.resolve();
  state.workItems[0].revision = 2;
  state.workItems[0].updatedAt = "2026-08-26T00:01:30.000Z";
  finishRead({ status: 200, body: { record: record("rev_2", "b") } });

  const result = await refreshing;
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "work_item_revision_conflict");
  assert.equal(state.workItems[0].recordBindings[0].snapshot.revision, "rev_1");
  assert.equal(invalidations.length, 0);
});

test("sweeps visible tasks and atomically refreshes multiple stale records", async () => {
  const { state, service, reads } = harness();
  state.workItems.push({
    ...structuredClone(state.workItems[0]),
    id: "lwi_2",
    revision: 1,
  });
  const swept = await service.reconcileVisibleWorkItemRecordBindings({ force: true }, actor);
  assert.equal(swept.status, 200);
  assert.equal(swept.body.checked, 2);
  assert.equal(swept.body.changed, 2);
  assert.equal(state.workItems.every((item) => item.recordBindings[0].resolution.state === "stale"), true);

  const refreshed = await service.refreshWorkItemRecordBindingsBatch({
    items: state.workItems.map((item) => ({
      id: item.id,
      expectedRevision: 2,
      bindingIds: ["binding_customer"],
    })),
  }, actor);
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.count, 2);
  assert.equal(refreshed.body.refreshedCount, 2);
  assert.equal(state.workItems.every((item) => item.revision === 3), true);
  assert.equal(state.workItems.every((item) => item.recordBindings[0].resolution.state === "resolved"), true);
  assert.equal(state.workItemActivities.filter((activity) => activity.action === "record_binding_refreshed").length, 2);

  const cached = await service.reconcileVisibleWorkItemRecordBindings({}, actor);
  assert.equal(cached.body.checked, 2, "refresh revisions invalidate the previous sweep cache");
  const cachedAgain = await service.reconcileVisibleWorkItemRecordBindings({}, actor);
  assert.equal(cachedAgain.body.checked, 0);
  assert.equal(cachedAgain.body.skipped, 2);
  assert.equal(reads.length, 6);
});

test("bounded sweeps rotate past recently checked tasks", async () => {
  const { state, service, reads } = harness();
  for (let index = 2; index <= 101; index += 1) {
    state.workItems.push({
      ...structuredClone(state.workItems[0]),
      id: `lwi_${index}`,
    });
  }

  const first = await service.reconcileVisibleWorkItemRecordBindings({ force: true, limit: 100 }, actor);
  assert.equal(first.body.checked, 100);
  assert.equal(first.body.changed, 100);
  assert.equal(state.workItems[100].recordBindings[0].resolution.state, "resolved");

  const second = await service.reconcileVisibleWorkItemRecordBindings({ limit: 100 }, actor);
  assert.equal(second.body.checked, 1);
  assert.equal(second.body.skipped, 99);
  assert.equal(second.body.changed, 1);
  assert.equal(state.workItems[100].recordBindings[0].resolution.state, "stale");
  assert.equal(reads.length, 101);
});

test("batch refresh fails without partial updates when one record is unavailable", async () => {
  const { state, service, setReadResult } = harness();
  state.workItems[0].recordBindings[0].resolution.state = "stale";
  state.workItems.push({
    ...structuredClone(state.workItems[0]),
    id: "lwi_2",
  });
  state.workItems[1].recordBindings[0].record.recordId = "blr_missing";
  setReadResult((input) => input.recordId === "blr_missing"
    ? { status: 404, body: { error: "business_ledger_record_not_found" } }
    : { status: 200, body: { record: record("rev_2", "b") } });

  const result = await service.refreshWorkItemRecordBindingsBatch({
    items: state.workItems.map((item) => ({
      id: item.id,
      expectedRevision: 1,
      bindingIds: ["binding_customer"],
    })),
  }, actor);
  assert.equal(result.status, 409);
  assert.equal(result.body.workItemId, "lwi_2");
  assert.equal(state.workItems.every((item) => item.revision === 1), true);
  assert.equal(state.workItems.every((item) => item.recordBindings[0].resolution.state === "stale"), true);
});
