import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";

test("P4.13 durable state snapshots are private to the local user", () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-p4-13-security-"));
  try {
    const projectPath = join(root, "project");
    const stateStorePath = join(root, "state", "snapshot.json");
    mkdirSync(projectPath, { recursive: true });
    const now = () => "2026-08-17T00:00:00.000Z";
    const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
    const persistence = createPersistenceRuntime({
      state,
      enabled: true,
      stateStorePath,
      schemaVersion: 1,
      now,
      defaultProject,
      sameProjectPath: () => false,
    });
    persistence.persistStateNow();
    // chmod is best-effort on Windows (files report 0o666 regardless of the
    // requested mode), so the privacy assertion only holds on POSIX.
    if (process.platform !== "win32") {
      assert.equal(statSync(stateStorePath).mode & 0o777, 0o600);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
