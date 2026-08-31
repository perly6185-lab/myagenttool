/*
 * #967 — the SQLite adapter runs the SAME Store contract as the in-memory one,
 * plus SQLite-specific checks (durable file round-trip, JSON→SQLite import,
 * migration version gate). `node:sqlite` is experimental, so the whole suite
 * SKIPS when the runtime doesn't provide it (e.g. a Node without flag-free
 * node:sqlite) — CI stays green; the adapter is exercised wherever it's available.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("sqlite: corrupt bytes fail the startup integrity check without replacing the file", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "sqlite-store-corrupt-"));
  const path = join(dir, "store.sqlite");
  const corruptBytes = Buffer.from("not-a-sqlite-database\0partial-write");
  try {
    writeFileSync(path, corruptBytes);
    assert.throws(
      () => createSqliteStore({ DatabaseSync, path }),
      (error) => error?.code === "sqlite_integrity_failed" && /integrity check/.test(error.message),
    );
    assert.deepEqual(readFileSync(path), corruptBytes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite: an existing empty file is partial state, not a new database", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "sqlite-store-empty-"));
  const path = join(dir, "store.sqlite");
  try {
    writeFileSync(path, Buffer.alloc(0));
    assert.throws(
      () => createSqliteStore({ DatabaseSync, path }),
      (error) => error?.code === "sqlite_integrity_failed" && /exists but is empty/.test(error.message),
    );
    assert.equal(readFileSync(path).byteLength, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite: a stamped-current but incomplete schema is rejected", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "sqlite-store-partial-schema-"));
  const path = join(dir, "store.sqlite");
  try {
    const raw = new DatabaseSync(path);
    raw.exec("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT)");
    raw.prepare("INSERT INTO meta(key,value) VALUES('schema_version','3')").run();
    raw.close();
    assert.throws(
      () => createSqliteStore({ DatabaseSync, path }),
      (error) => error?.code === "sqlite_integrity_failed" && /schema integrity check failed/.test(error.message),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite: ADR 0019 — a history row SURVIVES replaceSnapshot (never mirrored)", { skip }, () => {
  const store = createSqliteStore({ DatabaseSync, path: ":memory:" });
  try {
    // Append two evicted rows to history, and put ONE of them in the mirrored
    // records too (as if it were still live).
    store.appendHistory("spans", [
      { id: "spn_old", traceId: "trc_1", invocationId: "inv_1", startedAt: "t0" },
      { id: "spn_older", traceId: "trc_1", invocationId: "inv_1", startedAt: "t-1" },
    ]);
    store.replaceSnapshot({ spans: [{ id: "spn_live", traceId: "trc_1" }] });
    // replaceSnapshot wiped+rewrote `records` (only spn_live remains there)...
    assert.deepEqual(store.query("spans").map((s) => s.id), ["spn_live"], "records mirror reflects only live state");
    // ...but the history table is untouched — the evicted rows are still queryable.
    const history = store.queryHistory("spans", { invocationId: "inv_1" });
    assert.deepEqual(history.rows.map((s) => s.id).sort(), ["spn_old", "spn_older"], "history survives the mirror replace");
  } finally {
    store.close();
  }
});

test("sqlite: a v1 store migrates through v3 (history and execution-action indexes) on open", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "sqlite-store-mig-"));
  const path = join(dir, "store.sqlite");
  try {
    // Build a v1-shaped store by hand: records table + schema_version = 1, no history.
    const raw = new DatabaseSync(path);
    raw.exec("PRAGMA journal_mode = WAL;");
    raw.exec("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT)");
    raw.exec("CREATE TABLE records(collection TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(collection, id))");
    raw.prepare("INSERT INTO meta(key,value) VALUES('schema_version','1')").run();
    const legacyInvocation = { id: "inv_before_upgrade", status: "queued", projectId: "proj_legacy" };
    raw.prepare("INSERT INTO records(collection,id,json) VALUES(?,?,?)")
      .run("invocations", legacyInvocation.id, JSON.stringify(legacyInvocation));
    raw.close();
    // Opening runs every forward migration; history and the v3 business-key
    // constraint are both immediately usable.
    const store = createSqliteStore({ DatabaseSync, path });
    assert.equal(store.schemaVersion, 3);
    assert.deepEqual(store.get("invocations", legacyInvocation.id), legacyInvocation, "pre-upgrade state survives forward migration");
    store.appendHistory("refusals", [{ id: "r1", invocationId: "inv_1", at: "t" }]);
    assert.deepEqual(store.queryHistory("refusals", { invocationId: "inv_1" }).rows.map((r) => r.id), ["r1"]);
    store.transaction((tx) => tx.insert("executionActionIdempotencyRecords", {
      id: "eai_1", autoRunId: "aur_1", idempotencyKey: "retry-once",
    }));
    assert.throws(() => store.transaction((tx) => tx.insert("executionActionIdempotencyRecords", {
      id: "eai_corrupt_duplicate", autoRunId: "aur_1", idempotencyKey: "retry-once",
    })), /UNIQUE constraint failed/);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite: execution-action business key is unique per Auto-run and indexed independently of record id", { skip }, () => {
  const store = createSqliteStore({ DatabaseSync, path: ":memory:" });
  try {
    store.transaction((tx) => {
      tx.insert("executionActionIdempotencyRecords", { id: "eai_a", autoRunId: "aur_a", idempotencyKey: "same-key" });
      tx.insert("executionActionIdempotencyRecords", { id: "eai_b", autoRunId: "aur_b", idempotencyKey: "same-key" });
    });
    assert.throws(() => store.transaction((tx) => tx.insert("executionActionIdempotencyRecords", {
      id: "eai_other_id", autoRunId: "aur_a", idempotencyKey: "same-key",
    })), /UNIQUE constraint failed/);
    assert.equal(store.query("executionActionIdempotencyRecords").length, 2);
  } finally {
    store.close();
  }
});

test("sqlite: application migration metadata survives reopen and cannot replace schema_version", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "sqlite-store-meta-"));
  const path = join(dir, "store.sqlite");
  try {
    let store = createSqliteStore({ DatabaseSync, path });
    assert.equal(store.getMetadata("application_migration.example.v1"), null);
    store.setMetadata("application_migration.example.v1", '{"status":"complete"}');
    assert.throws(() => store.setMetadata("schema_version", "1"), /managed by SQLite migrations/);
    store.close();

    store = createSqliteStore({ DatabaseSync, path });
    assert.equal(store.getMetadata("application_migration.example.v1"), '{"status":"complete"}');
    assert.equal(store.schemaVersion, 3);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
