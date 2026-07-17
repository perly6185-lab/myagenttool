/*
 * #969 — the ledger carries an explicit owning teamId (stamped at write time),
 * and the read-model scopes by it as a NARROW-ONLY addition to the project gate:
 * it can only hide rows, never broaden visibility. This closes the leak where a
 * ledger row with no projectId (projectVisible(null) === true) was visible to
 * every scoped team, and it survives a restart.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildEvidenceCenterRecords } from "../src/read-models/evidence-center.mjs";
import { buildPublicState } from "../src/read-models/state.mjs";
import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createM3Service } from "../src/services/m3.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";

const now = () => "2026-07-14T00:00:00.000Z";
const TEAM_A = "team_a";
const TEAM_B = "team_b";

function m3For(state) {
  let id = 0;
  return createM3Service({ state, now, nextId: (p) => `${p}_${++id}`, appendEvent: () => {}, findAgent: () => null });
}

function publicFor(state, actor) {
  const m3 = m3For(state);
  const findInvocation = (id) => state.invocations.find((i) => i.id === id) ?? null;
  return buildPublicState({
    namespace: "t", protocolVersion: "0", state, defaultProjectPath: "/x",
    currentProject: () => state.projects[0] ?? null,
    defaultAgent: () => state.agents[0] ?? null,
    loopRoutineReadModel: () => [], codexApprovalQueue: () => [],
    evidenceCenterRecords: () => buildEvidenceCenterRecords({ state, findInvocation, codexSessionForInvocation: () => null, repoPathForEvidence: () => null }),
    ledgerSummary: (f) => m3.ledgerSummary(f), budgetStatuses: () => m3.budgetStatuses(), teamBudgetStatuses: () => m3.teamBudgetStatuses(),
    actor,
  });
}

const PROJECT_DIR = mkdtempSync(join(tmpdir(), "ledger-tenancy-"));

function twoTeamState() {
  const { state } = createServerState({ defaultProjectPath: PROJECT_DIR, now });
  state.users = [{ id: "usr_a", teamId: TEAM_A }, { id: "usr_b", teamId: TEAM_B }];
  state.teams = [{ id: TEAM_A }, { id: TEAM_B }];
  state.projects = [
    { id: "proj_a", name: "A", path: PROJECT_DIR, ownerTeamId: TEAM_A },
    { id: "proj_b", name: "B", path: PROJECT_DIR, ownerTeamId: TEAM_B },
  ];
  state.currentProjectId = "proj_a";
  state.ledgerEntries = [];
  return state;
}

test("#969 recordInvocationLedgerEntry stamps the owning team from the row's project", () => {
  const state = twoTeamState();
  const m3 = m3For(state);
  const entry = m3.recordInvocationLedgerEntry({
    invocation: { id: "inv_a", agentId: "agt", requestedBy: "usr_a", projectId: "proj_a", input: { metadata: { projectId: "proj_a" } } },
    cost: { amountUsd: 3, currency: "USD", model: "demo", billable: true },
    agent: null,
  });
  assert.equal(entry.teamId, TEAM_A, "the ledger row is stamped with its project's team");
});

test("#969 a null-projectId ledger row is scoped by its stamped team (leak closed), never broadened", () => {
  const state = twoTeamState();
  // A ledger row with NO projectId but stamped teamId=A — pre-#969 this was
  // visible to every scoped team via projectVisible(null) === true.
  state.ledgerEntries.push({ id: "led_orphan", projectId: null, teamId: TEAM_A, amountUsd: 9, status: "finalized" });

  const seenBy = (actor) => publicFor(state, actor).ledgerEntries.map((e) => e.id);
  assert(seenBy({ teamId: TEAM_A }).includes("led_orphan"), "the owning team A sees it");
  assert(!seenBy({ teamId: TEAM_B }).includes("led_orphan"), "team B must NOT see a foreign null-projectId row (leak closed)");
  assert(seenBy(null).includes("led_orphan"), "unscoped/local-dev still sees everything (unchanged)");
});

test("#969 a normal project-scoped ledger row keeps its existing visibility", () => {
  const state = twoTeamState();
  state.ledgerEntries.push({ id: "led_a", projectId: "proj_a", teamId: TEAM_A, amountUsd: 5, status: "finalized" });
  const seenBy = (actor) => publicFor(state, actor).ledgerEntries.map((e) => e.id);
  assert(seenBy({ teamId: TEAM_A }).includes("led_a"), "team A sees its own project's row");
  assert(!seenBy({ teamId: TEAM_B }).includes("led_a"), "team B does not (unchanged)");
});

test("#969 an inconsistent stamp (project A, teamId B) is hidden from BOTH — conservative", () => {
  const state = twoTeamState();
  state.ledgerEntries.push({ id: "led_bad", projectId: "proj_a", teamId: TEAM_B, amountUsd: 5, status: "finalized" });
  const seenBy = (actor) => publicFor(state, actor).ledgerEntries.map((e) => e.id);
  assert(!seenBy({ teamId: TEAM_A }).includes("led_bad"), "project-owner A does not see a row stamped for B");
  assert(!seenBy({ teamId: TEAM_B }).includes("led_bad"), "team B does not see it (project isn't theirs)");
  assert(seenBy(null).includes("led_bad"), "unscoped still sees it (for reconciliation)");
});

test("#969 the stamped teamId survives a restart and still scopes", () => {
  const root = join(tmpdir(), `myagenttool-ledger-tenancy-${Date.now()}`);
  const projectPath = join(root, "p");
  const stateStorePath = join(root, "s", "snap.json");
  mkdirSync(projectPath, { recursive: true });
  try {
    const first = createServerState({ defaultProjectPath: projectPath, now });
    first.state.teams = [{ id: TEAM_A }, { id: TEAM_B }];
    first.state.projects = [{ id: "proj_a", name: "A", path: projectPath, ownerTeamId: TEAM_A }];
    first.state.currentProjectId = "proj_a";
    first.state.ledgerEntries = [{ id: "led_orphan", projectId: null, teamId: TEAM_A, amountUsd: 9, status: "finalized" }];
    createPersistenceRuntime({ state: first.state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject: first.defaultProject, sameProjectPath }).savePersistentState();

    const second = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({ state: second.state, enabled: true, stateStorePath, schemaVersion: 1, now, defaultProject: second.defaultProject, sameProjectPath }).restorePersistentState();

    const restored = second.state.ledgerEntries.find((e) => e.id === "led_orphan");
    assert.equal(restored?.teamId, TEAM_A, "the stamp survived restart");
    const seenByB = publicFor(second.state, { teamId: TEAM_B }).ledgerEntries.map((e) => e.id);
    assert(!seenByB.includes("led_orphan"), "still hidden from team B after restart");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
