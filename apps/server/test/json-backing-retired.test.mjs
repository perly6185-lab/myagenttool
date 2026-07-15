/*
 * #1042 — with the JSON backing retired (jsonBacking:false, the SQLite path), a
 * per-commit flush writes ONLY the durable backing (afterFlush), NOT the JSON
 * snapshot; JSON is written only by the explicit export. The memory path
 * (jsonBacking:true) still writes JSON per commit.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";

const now = () => "2026-07-15T00:00:00.000Z";

function setup(jsonBacking) {
  const dir = mkdtempSync(join(tmpdir(), "json-retired-"));
  const projectPath = join(dir, "proj");
  const stateStorePath = join(dir, "state", "local.json");
  mkdirSync(projectPath, { recursive: true });
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
  let flushes = 0;
  const p = createPersistenceRuntime({
    state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject, sameProjectPath,
    jsonBacking, afterFlush: () => { flushes += 1; },
  });
  return { dir, stateStorePath, p, flushes: () => flushes };
}

test("jsonBacking:false — persistStateNow mirrors (afterFlush) but writes NO JSON; export writes JSON", () => {
  const { dir, stateStorePath, p, flushes } = setup(false);
  try {
    p.persistStateNow();
    assert.equal(flushes(), 1, "afterFlush (the SQLite mirror) still fires");
    assert.equal(existsSync(stateStorePath), false, "no JSON snapshot written per-commit");

    p.exportJsonSnapshot();
    assert.equal(existsSync(stateStorePath), true, "explicit export writes the JSON rollback artifact");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("jsonBacking:true (memory path) — persistStateNow writes JSON per commit, unchanged", () => {
  const { dir, stateStorePath, p, flushes } = setup(true);
  try {
    p.persistStateNow();
    assert.equal(existsSync(stateStorePath), true, "JSON is the backing on the memory path");
    assert.equal(flushes(), 1, "afterFlush still fires (a no-op mirror on the memory path)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
