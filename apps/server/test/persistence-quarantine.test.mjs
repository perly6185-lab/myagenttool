import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";

// A snapshot the server refuses to load (corrupt JSON, unknown schema) must be
// moved aside, NOT left in place — the next debounced save would overwrite the
// only copy of the old data.

const now = () => new Date().toISOString();

function runtimeFor(dir, over = {}) {
  const state = { projects: [], currentProjectId: null, worktrees: [] };
  const defaultProject = { id: "prj_default", path: dir, name: "default" };
  return {
    state,
    runtime: createPersistenceRuntime({
      state,
      enabled: true,
      stateStorePath: join(dir, "state.json"),
      schemaVersion: 7,
      now,
      defaultProject,
      sameProjectPath: (a, b) => a === b,
      ...over,
    }),
  };
}

test("a corrupt snapshot is quarantined with a forensic copy, then saves start fresh", () => {
  const dir = mkdtempSync(join(tmpdir(), "persist-quarantine-"));
  const storePath = join(dir, "state.json");
  writeFileSync(storePath, "{ this is not json");

  const { runtime } = runtimeFor(dir);
  runtime.restorePersistentState();

  assert.equal(existsSync(storePath), false, "the unreadable snapshot no longer sits where a save would clobber it");
  const quarantined = readdirSync(dir).filter((name) => name.startsWith("state.json.corrupt-"));
  assert.equal(quarantined.length, 1, "forensic copy preserved");
  assert.equal(readFileSync(join(dir, quarantined[0]), "utf8"), "{ this is not json", "byte-for-byte the original");

  // A subsequent save writes a fresh snapshot without touching the quarantined copy.
  runtime.savePersistentState();
  assert.ok(existsSync(storePath));
  assert.equal(readdirSync(dir).filter((name) => name.startsWith("state.json.corrupt-")).length, 1);
});

test("a schema-mismatched snapshot is quarantined with the version in the name", () => {
  const dir = mkdtempSync(join(tmpdir(), "persist-schema-"));
  const storePath = join(dir, "state.json");
  writeFileSync(storePath, JSON.stringify({ schemaVersion: 99, projects: [] }));

  const { runtime } = runtimeFor(dir);
  runtime.restorePersistentState();

  assert.equal(existsSync(storePath), false);
  const quarantined = readdirSync(dir).filter((name) => name.startsWith("state.json.schema-99-"));
  assert.equal(quarantined.length, 1, "schema mismatch preserved with the offending version");
});

test("a loadable snapshot restores normally and is not quarantined", () => {
  const dir = mkdtempSync(join(tmpdir(), "persist-ok-"));
  const storePath = join(dir, "state.json");
  writeFileSync(storePath, JSON.stringify({ schemaVersion: 7, projects: [], currentProjectId: null, users: [{ id: "usr_1" }] }));

  const { state, runtime } = runtimeFor(dir);
  runtime.restorePersistentState();

  assert.ok(existsSync(storePath), "healthy snapshot stays in place");
  assert.deepEqual(state.users, [{ id: "usr_1" }]);
  assert.equal(readdirSync(dir).filter((name) => name.includes("corrupt") || name.includes("schema")).length, 0);
});
