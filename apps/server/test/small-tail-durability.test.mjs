/*
 * #1001 (Phase A #5e) — the remaining small-service durable writes commit through
 * the Store (approval-grants, agent-skills, tools, claude-apply-imports,
 * codex-exec-imports). Crash model: persistStateNow commits, persistStateSoon is a
 * no-op. Representative coverage (an agent skill create); the sweep is the value.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createInMemoryStore } from "../src/runtime/store/in-memory-store.mjs";
import { createAgentSkillService } from "../src/services/agent-skills.mjs";

const now = () => "2026-07-15T00:00:00.000Z";

function harness({ wireStore }) {
  const root = join(tmpdir(), `myagenttool-small-tail-durability-${Date.now()}-${Math.round(Math.random() * 1e9)}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now });
  const persistence = createPersistenceRuntime({ state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject, sameProjectPath: () => false });
  const svc = createAgentSkillService({
    state,
    now,
    nextId: (p) => `${p}_1`,
    persistStateSoon: () => {},
    store: wireStore ? createInMemoryStore({ state, commit: () => persistence.persistStateNow() }) : undefined,
  });
  const reload = () => {
    const fresh = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({ state: fresh.state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject: fresh.defaultProject, sameProjectPath: () => false }).restorePersistentState();
    return fresh.state;
  };
  return { svc, reload, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("#1001 an agent skill create survives a crash via the Store", () => {
  const { svc, reload, cleanup } = harness({ wireStore: true });
  try {
    const skill = svc.createAgentSkill({ name: "Demo Skill" });
    const found = (reload().agentSkills ?? []).find((s) => s.id === skill.id);
    assert(found, "the agent skill is durable");
    assert.equal(found.name, "Demo Skill");
  } finally {
    cleanup();
  }
});

test("#1001 the durability test bites — without the Store the eaten debounce loses the skill", () => {
  const { svc, reload, cleanup } = harness({ wireStore: false });
  try {
    const skill = svc.createAgentSkill({ name: "Demo Skill" });
    const found = (reload().agentSkills ?? []).find((s) => s.id === skill.id);
    assert(!found, "without the Store the skill create is not durable");
  } finally {
    cleanup();
  }
});
