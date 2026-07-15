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

const now = () => "2026-07-15T00:00:00.000Z";

function harness({ wireStore }) {
  const root = join(tmpdir(), `myagenttool-autorun-durability-${Date.now()}-${Math.round(Math.random() * 1e9)}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
  state.autoRuns = [
    { id: "aur_demo", status: "running", invocationId: null, worktreeId: null, updatedAt: now(), createdAt: now(), link: null },
    { id: "aur_gate", status: "awaiting_approval", invocationId: "inv_gate", worktreeId: null, updatedAt: now(), createdAt: now(), link: null },
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
