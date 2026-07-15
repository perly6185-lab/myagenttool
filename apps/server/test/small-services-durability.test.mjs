/*
 * #1001 (Phase A #5) — the small import/telemetry services' durable writes commit
 * through the Store. Crash model: persistStateNow commits, persistStateSoon is a
 * no-op. Representative coverage (application-stats); the sweep itself is the value.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createInMemoryStore } from "../src/runtime/store/in-memory-store.mjs";
import { createApplicationStatsRuntime } from "../src/services/application-stats.mjs";

const now = () => "2026-07-14T00:00:00.000Z";

test("#1001 an application daily stat survives a crash via the Store", () => {
  const root = join(tmpdir(), `myagenttool-small-svc-durability-${Date.now()}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  try {
    const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
    const persistence = createPersistenceRuntime({ state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject, sameProjectPath: () => false });
    const store = createInMemoryStore({ state, commit: () => persistence.persistStateNow() });
    const stats = createApplicationStatsRuntime({ state, now, persistStateSoon: () => {}, store });

    stats.recordApplicationExecutionStat({ status: "succeeded", options: { metadata: { applicationId: "app_1" } } });

    const fresh = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({ state: fresh.state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject: fresh.defaultProject, sameProjectPath: () => false }).restorePersistentState();

    const row = (fresh.state.applicationDailyStats ?? []).find((r) => r.applicationId === "app_1");
    assert(row, "the application daily stat is durable via the Store");
    assert.equal(row.succeeded, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
