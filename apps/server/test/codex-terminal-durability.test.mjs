/*
 * #1001 (Phase A) — codex + terminal durable writes commit through the Store's
 * unit of work. Crash model: persistStateNow commits, persistStateSoon (fallback
 * debounce) is a no-op — a record on disk after the call proves the store fired.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createInMemoryStore } from "../src/runtime/store/in-memory-store.mjs";
import { createCodexService } from "../src/services/codex.mjs";
import { createTerminalService } from "../src/services/terminal.mjs";

const now = () => "2026-07-14T00:00:00.000Z";

function withTmp(fn) {
  const root = join(tmpdir(), `myagenttool-codex-terminal-durability-${Date.now()}-${Math.floor(process.hrtime()[1] % 1e6)}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  try { return fn({ projectPath, stateStorePath }); } finally { rmSync(root, { recursive: true, force: true }); }
}

function harness(projectPath, stateStorePath) {
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
  let n = 0;
  const nextId = (p) => `${p}_${++n}`;
  const persistence = createPersistenceRuntime({ state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject, sameProjectPath: () => false });
  const store = createInMemoryStore({ state, commit: () => persistence.persistStateNow() });
  const common = { state, now, nextId, appendEvent: () => {}, persistStateSoon: () => {}, store, uniqueStrings: (a) => [...new Set(a)] };
  const codex = createCodexService({ ...common, currentProject: () => state.projects[0], findInvocation: () => null, worktreeForProject: () => null });
  const terminal = createTerminalService({ ...common, summarizeText: (t) => String(t), codexSessionForInvocation: () => null });
  const reload = () => {
    const fresh = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({ state: fresh.state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject: fresh.defaultProject, sameProjectPath: () => false }).restorePersistentState();
    return fresh.state;
  };
  return { state, codex, terminal, reload };
}

test("#1001 a codex evidence record survives a crash via the Store", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const rt = harness(projectPath, stateStorePath);
    const evidence = rt.codex.createCodexEvidenceRecord({
      id: "evt_1", invocationId: "inv_1", type: "agent_output",
      message: "did a thing",
      data: { source: "codex_jsonl", eventType: "item", fileChangeSummary: "edited a.js" },
    });
    assert(evidence, "evidence created");

    const restored = rt.reload();
    assert(restored.codexEvidenceRecords.some((e) => e.id === evidence.id), "the codex evidence is durable");
  });
});

test("#1001 an SSH target survives a crash via the Store", () => {
  withTmp(({ projectPath, stateStorePath }) => {
    const rt = harness(projectPath, stateStorePath);
    const target = rt.terminal.createSshTarget({ host: "example.test", user: "deploy", port: 22, workspaceRoot: "/srv/app" });

    const restored = rt.reload();
    assert(restored.sshTargets.some((t) => t.id === target.id), "the SSH target is durable");
    assert.equal(restored.sshTargets.find((t) => t.id === target.id).host, "example.test");
  });
});
