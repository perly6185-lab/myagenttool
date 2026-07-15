/*
 * #1001 (Phase A #5c) — the application + application-install services' durable
 * writes commit through the Store. Crash model: persistStateNow commits,
 * persistStateSoon is a no-op. Representative coverage (an application lifecycle
 * transition); the sweep across applications.mjs + application-installs.mjs is
 * the value.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createInMemoryStore } from "../src/runtime/store/in-memory-store.mjs";
import { createApplicationService } from "../src/services/applications.mjs";

const now = () => "2026-07-15T00:00:00.000Z";

function harness({ wireStore }) {
  const root = join(tmpdir(), `myagenttool-app-durability-${Date.now()}-${Math.round(Math.random() * 1e9)}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
  state.applications = [{
    id: "app_demo",
    name: "Demo Application",
    status: "registered",
    lifecycle: { state: "registered", lastOperation: "register", lastOperationAt: now() },
    source: { type: "local", path: projectPath },
    updatedAt: now(),
  }];
  const persistence = createPersistenceRuntime({ state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject, sameProjectPath: () => false });
  const service = createApplicationService({
    state,
    now,
    nextId: (prefix) => `${prefix}_1`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => ({ id: "prj_x", path: projectPath }),
    cloneProject: async () => ({ id: "prj_x", path: projectPath }),
    defaultProjectPath: projectPath,
    validateApprovalToken: () => ({ approved: true }),
    store: wireStore ? createInMemoryStore({ state, commit: () => persistence.persistStateNow() }) : undefined,
  });
  const reload = () => {
    const fresh = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({ state: fresh.state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject: fresh.defaultProject, sameProjectPath: () => false }).restorePersistentState();
    return fresh.state;
  };
  return { service, reload, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("#1001 an application lifecycle transition survives a crash via the Store", () => {
  const { service, reload, cleanup } = harness({ wireStore: true });
  try {
    service.transitionApplication("app_demo", "online");
    const app = (reload().applications ?? []).find((a) => a.id === "app_demo");
    assert(app, "the application is durable");
    assert.equal(app.status, "active");
  } finally {
    cleanup();
  }
});

test("#1001 the durability test bites — without the Store the eaten debounce loses the transition", () => {
  const { service, reload, cleanup } = harness({ wireStore: false });
  try {
    service.transitionApplication("app_demo", "online");
    const app = (reload().applications ?? []).find((a) => a.id === "app_demo");
    // No snapshot was ever written (persistStateSoon is a no-op, no Store), so the
    // reload sees the freshly-seeded default state without our transition.
    assert(!app || app.status !== "active", "without the Store the transition is not durable");
  } finally {
    cleanup();
  }
});
