/*
 * #967 — the SQLite adapter runs the SAME Store contract as the in-memory one,
 * plus SQLite-specific checks (durable file round-trip, JSON→SQLite import,
 * migration version gate). `node:sqlite` is experimental, so the whole suite
 * SKIPS when the runtime doesn't provide it (e.g. a Node without flag-free
 * node:sqlite) — CI stays green; the adapter is exercised wherever it's available.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runStoreContract } from "./store-contract-suite.mjs";

// Probe node:sqlite once; skip everything if it isn't loadable here.
let DatabaseSync;
let createSqliteStore;
let openSqliteStore;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
  ({ createSqliteStore, openSqliteStore } = await import("../src/runtime/store/sqlite-store.mjs"));
} catch {
  DatabaseSync = null;
}
const skip = DatabaseSync ? false : "node:sqlite unavailable in this runtime";

// The full shared contract, against a FRESH in-memory SQLite DB per test (the
// factory is synchronous once DatabaseSync is in hand).
if (DatabaseSync) {
  runStoreContract("sqlite", () => ({ store: createSqliteStore({ DatabaseSync, path: ":memory:" }) }));
}

test("sqlite: data survives a close + reopen of the same file (durability)", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sqlite-store-"));
  const path = join(dir, "store.sqlite");
  try {
    let store = await openSqliteStore({ path });
    store.transaction((tx) => tx.insert("invocations", { id: "inv_1", status: "queued" }));
    store.close();

    store = await openSqliteStore({ path });
    assert.equal(store.get("invocations", "inv_1").status, "queued", "the row survived a reopen");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite: importSnapshot loads whitelisted collections idempotently", { skip }, () => {
  const store = createSqliteStore({ DatabaseSync, path: ":memory:" });
  const snapshot = {
    invocations: [{ id: "inv_1" }, { id: "inv_2" }],
    ledgerEntries: [{ id: "led_1", amountUsd: 5 }],
    ignoredNoId: [{ noId: true }], // rows without an id are skipped
  };
  const first = store.importSnapshot(snapshot);
  assert.equal(first.imported, 3, "3 id-bearing rows imported");
  assert.equal(store.query("invocations").length, 2);
  assert.equal(store.get("ledgerEntries", "led_1").amountUsd, 5);
  store.importSnapshot(snapshot); // idempotent upsert
  assert.equal(store.query("invocations").length, 2, "re-import did not duplicate");
  store.close();
});

// #971: cross-restart tenant isolation on the DURABLE adapter — two teams' rows
// round-trip a close+reopen with the owner column (#969's teamId) intact, so the
// read-model's team scoping holds on the durable backing, not just in memory.
test("sqlite: two-team data round-trips a close+reopen with the owner column intact", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sqlite-store-tenant-"));
  const path = join(dir, "store.sqlite");
  try {
    let store = await openSqliteStore({ path });
    store.importSnapshot({
      projects: [{ id: "proj_a", ownerTeamId: "team_a" }, { id: "proj_b", ownerTeamId: "team_b" }],
      ledgerEntries: [
        { id: "led_a1", teamId: "team_a", projectId: "proj_a", amountUsd: 3 },
        { id: "led_a2", teamId: "team_a", projectId: "proj_a", amountUsd: 4 },
        { id: "led_b1", teamId: "team_b", projectId: "proj_b", amountUsd: 9 },
      ],
    });
    store.close();

    store = await openSqliteStore({ path });
    assert.equal(store.query("ledgerEntries").length, 3, "all rows survived the reopen");
    const teamA = store.query("ledgerEntries", (r) => r.teamId === "team_a");
    const teamB = store.query("ledgerEntries", (r) => r.teamId === "team_b");
    assert.deepEqual(teamA.map((r) => r.id).sort(), ["led_a1", "led_a2"], "team A's rows are intact + isolated");
    assert.deepEqual(teamB.map((r) => r.id), ["led_b1"], "team B's row is intact + isolated");
    assert.equal(teamA.some((r) => r.teamId === "team_b"), false, "no team B row bleeds into team A's slice");
    assert.equal(store.get("ledgerEntries", "led_b1").teamId, "team_b", "the owner column survived the reopen");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite: a store schema newer than the binary refuses to open", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "sqlite-store-ver-"));
  const path = join(dir, "store.sqlite");
  try {
    const store = createSqliteStore({ DatabaseSync, path });
    store.close();
    // Bump the on-disk schema version beyond this binary, then reopen.
    const raw = new DatabaseSync(path);
    raw.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run("999");
    raw.close();
    assert.throws(() => createSqliteStore({ DatabaseSync, path }), /newer than this binary/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
