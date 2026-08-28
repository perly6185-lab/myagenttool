/*
 * #1001 (Phase A #5d-1) — the auto-run operator-action + sweep writes commit
 * through the Store. Crash model: persistStateNow commits, persistStateSoon is a
 * no-op. Representative coverage (cancelAutoRun); the sweep across the operator
 * actions (cancel/retry/merge/deploy/design/decompose/clarify) + reapers is the
 * value. The async reaction hot path (startAutoRun/advance/sync) is #5d-2.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createInMemoryStore } from "../src/runtime/store/in-memory-store.mjs";
import { createAutoRunService } from "../src/services/auto-run.mjs";
import { EXECUTION_ACTION_IDEMPOTENCY_MIGRATION_KEY } from "../src/services/work-item-execution-action.mjs";

const now = () => "2026-07-15T00:00:00.000Z";

function harness({ wireStore }) {
  const root = join(tmpdir(), `myagenttool-autorun-durability-${Date.now()}-${Math.round(Math.random() * 1e9)}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
  state.autoRuns = [
    { id: "aur_demo", status: "running", invocationId: null, worktreeId: null, updatedAt: now(), createdAt: now(), link: null },
    {
      id: "aur_gate", status: "awaiting_approval", invocationId: "inv_gate", worktreeId: null,
      updatedAt: now(), createdAt: now(), link: null,
      executionActionReceipts: [{
        schemaVersion: 1,
        id: "ear_gate",
        kind: "retry_execution",
        status: "accepted",
        messageCode: "request_accepted",
        impact: "none",
        nextOwner: "ai",
        requestedAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
        sourceTargetId: "inv_gate",
        targetId: null,
        idempotencyKey: "durable-gate-key",
        requestDigest: "durable-gate-digest",
      }],
      executionActionIdempotencyLedger: [{
        schemaVersion: 1,
        idempotencyKey: "durable-gate-key",
        kind: "retry_execution",
        requestDigest: "durable-gate-digest",
        receiptId: "ear_gate",
        requestedAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
        receipt: {
          schemaVersion: 1,
          id: "ear_gate",
          kind: "retry_execution",
          status: "accepted",
          messageCode: "request_accepted",
          impact: "none",
          nextOwner: "ai",
          requestedAt: "2026-07-14T00:00:00.000Z",
          updatedAt: "2026-07-14T00:00:00.000Z",
          sourceTargetId: "inv_gate",
          targetId: null,
          idempotencyKey: "durable-gate-key",
          requestDigest: "durable-gate-digest",
        },
      }],
    },
  ];
  const persistence = createPersistenceRuntime({ state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject, sameProjectPath: () => false });
  const svc = createAutoRunService({
    state,
    now,
    nextId: (p) => `${p}_1`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    store: wireStore ? createInMemoryStore({ state, commit: () => persistence.persistStateNow() }) : undefined,
  });
  const reload = () => {
    const fresh = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({ state: fresh.state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject: fresh.defaultProject, sameProjectPath: () => false }).restorePersistentState();
    return fresh.state;
  };
  return { svc, reload, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("#1001 an auto-run cancellation survives a crash via the Store", () => {
  const { svc, reload, cleanup } = harness({ wireStore: true });
  try {
    svc.cancelAutoRun("aur_demo", {});
    const run = (reload().autoRuns ?? []).find((r) => r.id === "aur_demo");
    assert(run, "the auto-run is durable");
    assert.equal(run.status, "cancelled");
  } finally {
    cleanup();
  }
});

test("#1001 (5d-2 hot path) a granted-approval sync survives a crash via the Store", () => {
  const { svc, reload, cleanup } = harness({ wireStore: true });
  try {
    svc.syncAutoRunOnApproval({ id: "inv_gate" });
    const run = (reload().autoRuns ?? []).find((r) => r.id === "aur_gate");
    assert(run, "the auto-run is durable");
    assert.equal(run.status, "running");
  } finally {
    cleanup();
  }
});

test("an execution-action reconciliation and its safe-retry evidence survive restart", () => {
  const { svc, reload, cleanup } = harness({ wireStore: true });
  try {
    const result = svc.reconcileExecutionAction("aur_gate");
    assert.equal(result.actionReceipt.status, "safe_to_retry");

    const restarted = reload();
    const run = (restarted.autoRuns ?? []).find((candidate) => candidate.id === "aur_gate");
    const ledger = (restarted.executionActionIdempotencyRecords ?? [])
      .find((candidate) => candidate.autoRunId === "aur_gate" && candidate.idempotencyKey === "durable-gate-key");
    assert.equal(run.executionActionReceipts[0].status, "safe_to_retry");
    assert.equal(run.executionActionReceipts[0].messageCode, "safe_to_retry");
    assert.equal(run.executionActionReceipts[0].impact, "none");
    assert.equal(run.executionActionIdempotencyLedger, undefined);
    assert.equal(ledger.receipt.status, "safe_to_retry");
    assert.equal(ledger.receipt.messageCode, "safe_to_retry");
  } finally {
    cleanup();
  }
});

test("execution-action data migration writes one durable completion marker after state commit", () => {
  const state = {
    autoRuns: [{
      id: "aur_legacy",
      status: "failed",
      executionActionIdempotencyLedger: [{
        idempotencyKey: "legacy-key",
        kind: "retry_execution",
        requestDigest: "legacy-digest",
        updatedAt: now(),
        receipt: { id: "ear_legacy", status: "succeeded", completedAt: now() },
      }],
    }],
    executionActionIdempotencyRecords: [],
  };
  const metadata = new Map();
  const create = () => createAutoRunService({
    state,
    now,
    nextId: (prefix) => `${prefix}_1`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    getDurableMetadata: (key) => metadata.get(key) ?? null,
    setDurableMetadata: (key, value) => metadata.set(key, value),
  });

  create();
  assert.equal(state.autoRuns[0].executionActionIdempotencyLedger, undefined);
  assert.equal(state.executionActionIdempotencyRecords.length, 1);
  const marker = JSON.parse(metadata.get(EXECUTION_ACTION_IDEMPOTENCY_MIGRATION_KEY));
  assert.equal(marker.status, "complete");
  assert.equal(marker.migratedRecords, 1);
  assert.equal(marker.legacyRuns, 1);

  metadata.set(EXECUTION_ACTION_IDEMPOTENCY_MIGRATION_KEY, JSON.stringify({ ...marker, sentinel: true }));
  create();
  assert.equal(JSON.parse(metadata.get(EXECUTION_ACTION_IDEMPOTENCY_MIGRATION_KEY)).sentinel, true, "a complete marker is not rewritten on every boot");
});

test("#1001 the durability test bites — without the Store the eaten debounce loses the cancellation", () => {
  const { svc, reload, cleanup } = harness({ wireStore: false });
  try {
    svc.cancelAutoRun("aur_demo", {});
    const run = (reload().autoRuns ?? []).find((r) => r.id === "aur_demo");
    assert(!run || run.status !== "cancelled", "without the Store the cancellation is not durable");
  } finally {
    cleanup();
  }
});
