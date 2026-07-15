/*
 * #1002 (Phase B, slice 1) — the SQLite adapter's whole-state mirror primitives:
 * replaceSnapshot (faithful mirror where DELETES propagate) + readSnapshot (read
 * back for boot hydration). `node:sqlite` is experimental, so the suite SKIPS when
 * the runtime doesn't provide it (CI stays green).
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

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

test("replaceSnapshot mirrors a state view into SQLite and readSnapshot reads it back", { skip }, () => {
  const store = createSqliteStore({ DatabaseSync, path: ":memory:" });
  try {
    const state = {
      projects: [{ id: "prj_1", name: "A" }, { id: "prj_2", name: "B" }],
      agents: [{ id: "agt_1", type: "cli" }],
    };
    const res = store.replaceSnapshot(state);
    assert.equal(res.written, 3);
    assert.equal(res.skipped, 0);

    const back = store.readSnapshot(["projects", "agents"]);
    assert.equal(back.projects.length, 2);
    assert.equal(back.agents.length, 1);
    assert.deepEqual(new Set(back.projects.map((p) => p.id)), new Set(["prj_1", "prj_2"]));
    assert.equal(store.get("agents", "agt_1").type, "cli");
  } finally {
    store.close();
  }
});

test("replaceSnapshot propagates DELETES — a removed record is gone, not resurrected", { skip }, () => {
  const store = createSqliteStore({ DatabaseSync, path: ":memory:" });
  try {
    store.replaceSnapshot({ projects: [{ id: "prj_1" }, { id: "prj_2" }, { id: "prj_3" }] });
    assert.equal(store.query("projects").length, 3);

    // Second mirror after prj_2 was removed from the in-memory view.
    const res = store.replaceSnapshot({ projects: [{ id: "prj_1" }, { id: "prj_3" }] });
    assert.equal(res.written, 2);
    assert.equal(store.get("projects", "prj_2"), null, "the removed record is gone from SQLite");
    assert.deepEqual(new Set(store.query("projects").map((p) => p.id)), new Set(["prj_1", "prj_3"]));
  } finally {
    store.close();
  }
});

test("replaceSnapshot counts id-less rows in `skipped` instead of silently storing them", { skip }, () => {
  const store = createSqliteStore({ DatabaseSync, path: ":memory:" });
  try {
    const res = store.replaceSnapshot({
      widgets: [{ id: "w_1" }, { name: "no-id" }, { id: "w_2" }],
    });
    assert.equal(res.written, 2);
    assert.equal(res.skipped, 1);
    assert.deepEqual(res.skippedCollections, ["widgets"]);
    assert.equal(store.query("widgets").length, 2);
  } finally {
    store.close();
  }
});

test("replaceSnapshot survives a close + reopen of the same file (durable mirror)", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sqlite-mirror-"));
  const path = join(dir, "store.sqlite");
  try {
    let store = await openSqliteStore({ path });
    store.replaceSnapshot({ invocations: [{ id: "inv_1", status: "queued" }] });
    store.close();

    store = await openSqliteStore({ path });
    const back = store.readSnapshot(["invocations"]);
    assert.equal(back.invocations.length, 1);
    assert.equal(back.invocations[0].status, "queued");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
