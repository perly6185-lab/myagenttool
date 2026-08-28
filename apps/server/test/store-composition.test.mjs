import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createServerState } from "../src/runtime/state-factory.mjs";
import {
  createRuntimeStoreBoundary,
  runtimeStoreBoundaryCollections,
} from "../src/runtime/store-composition.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";

const NOW = "2026-08-28T00:00:00.000Z";
const DEFAULT_PROJECT_PATH = fileURLToPath(new URL("..", import.meta.url));

function createBoundary(options = {}) {
  const { defaultProject, state } = createServerState({
    defaultProjectPath: DEFAULT_PROJECT_PATH,
    now: () => NOW,
  });
  const boundary = createRuntimeStoreBoundary({
    state,
    persistenceEnabled: false,
    stateStorePath: "/tmp/myagenttool-store-boundary/state.json",
    stateSchemaVersion: 1,
    now: () => NOW,
    defaultProject,
    sameProjectPath,
    ...options,
  });
  return { state, boundary };
}

test("runtime store boundary preserves the in-memory/test path without durable history", () => {
  const { state, boundary } = createBoundary();

  assert.equal(boundary.backing, "memory");
  assert.equal(boundary.restored, undefined);
  assert.equal(boundary.historyAppend, null);
  assert.equal(boundary.queryDurableRecords, null);
  assert.equal(boundary.compactDurableStoreForErasure, null);
  assert.equal(boundary.historyQuery, null);
  assert.equal(boundary.historyDelete, null);
  assert.equal(boundary.historyRedact, null);

  boundary.store.transaction((tx) => {
    tx.insert("invocations", { id: "inv_boundary", status: "queued" });
  });
  assert.equal(state.invocations.some((row) => row.id === "inv_boundary"), true);
});

test("runtime store boundary preserves the JSON fallback path", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "store-boundary-json-"));
  const stateStorePath = join(stateDir, "state.json");
  try {
    const { boundary } = createBoundary({ persistenceEnabled: true, stateStorePath });
    assert.equal(boundary.backing, "json");

    boundary.store.transaction((tx) => {
      tx.insert("invocations", { id: "inv_json_boundary", status: "queued" });
    });
    const snapshot = JSON.parse(readFileSync(stateStorePath, "utf8"));
    assert.equal(snapshot.invocations.some((row) => row.id === "inv_json_boundary"), true);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("runtime store boundary owns every collection needed to retire the JSON backing", () => {
  assert.equal(runtimeStoreBoundaryCollections.arrays.includes("projects"), true);
  assert.equal(runtimeStoreBoundaryCollections.arrays.includes("devices"), true);
  assert.deepEqual(runtimeStoreBoundaryCollections.scalars, ["currentProjectId", "idCounter"]);
  assert.equal(Object.isFrozen(runtimeStoreBoundaryCollections), true);
  assert.equal(Object.isFrozen(runtimeStoreBoundaryCollections.arrays), true);
  assert.equal(Object.isFrozen(runtimeStoreBoundaryCollections.objects), true);
  assert.equal(Object.isFrozen(runtimeStoreBoundaryCollections.scalars), true);
});

test("service composer depends on the store boundary instead of persistence implementations", () => {
  const source = readFileSync(
    new URL("../src/runtime/service-composer.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /from "\.\/store-composition\.mjs"/);
  assert.doesNotMatch(source, /from "\.\/persistence\.mjs"/);
  assert.doesNotMatch(source, /from "\.\/store\/in-memory-store\.mjs"/);
  assert.doesNotMatch(source, /from "\.\/store\/sqlite-backing\.mjs"/);
  assert.doesNotMatch(source, /sqliteStore\.(?:query|compactForErasure)/);
  assert.doesNotMatch(source, /sqliteStore\?\.(?:query|compactForErasure)/);
});

let DatabaseSync;
let createSqliteStore;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
  ({ createSqliteStore } = await import("../src/runtime/store/sqlite-store.mjs"));
} catch {
  DatabaseSync = null;
}
const sqliteSkip = DatabaseSync ? false : "node:sqlite unavailable in this runtime";

test("runtime store boundary seeds SQLite and mirrors later store commits", { skip: sqliteSkip }, () => {
  const sqliteStore = createSqliteStore({ DatabaseSync, path: ":memory:" });
  const stateDir = mkdtempSync(join(tmpdir(), "store-boundary-"));
  try {
    const { boundary } = createBoundary({
      sqliteStore,
      persistenceEnabled: true,
      stateStorePath: join(stateDir, "state.json"),
    });
    assert.equal(boundary.backing, "sqlite");
    assert.equal(sqliteStore.query("projects").length, 1, "fresh defaults seeded SQLite");
    assert.equal(typeof boundary.historyAppend, "function");
    assert.equal(typeof boundary.queryDurableRecords, "function");
    assert.equal(typeof boundary.compactDurableStoreForErasure, "function");

    boundary.store.transaction((tx) => {
      tx.insert("invocations", {
        id: "inv_sqlite_boundary",
        ownerTeamId: "team_local",
        projectId: "prj_myagenttool",
        status: "queued",
      });
    });
    assert.equal(
      sqliteStore.get("invocations", "inv_sqlite_boundary")?.status,
      "queued",
      "the same commit reached the durable backing",
    );
  } finally {
    sqliteStore.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("a populated SQLite backing never reimports a stale JSON snapshot", { skip: sqliteSkip }, () => {
  const stateDir = mkdtempSync(join(tmpdir(), "store-migration-once-"));
  const stateStorePath = join(stateDir, "state.json");
  const sqliteStore = createSqliteStore({ DatabaseSync, path: ":memory:" });
  try {
    const { boundary: jsonBoundary } = createBoundary({
      persistenceEnabled: true,
      stateStorePath,
    });
    jsonBoundary.store.transaction((tx) => {
      tx.insert("invocations", { id: "inv_stale_json", status: "queued" });
    });
    sqliteStore.transaction((tx) => {
      tx.insert("invocations", { id: "inv_sqlite_authoritative", status: "running" });
    });

    const { state, boundary } = createBoundary({
      sqliteStore,
      persistenceEnabled: true,
      stateStorePath,
    });
    assert.equal(boundary.backing, "sqlite");
    assert.equal(state.invocations.some((row) => row.id === "inv_sqlite_authoritative"), true);
    assert.equal(state.invocations.some((row) => row.id === "inv_stale_json"), false);
  } finally {
    sqliteStore.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});
