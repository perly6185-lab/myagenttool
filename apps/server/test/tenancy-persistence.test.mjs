/*
 * #891 — Persisted multi-tenant isolation across restart.
 *
 * The existing tenancy suite (tenancy.test.mjs, m3-tenancy.test.mjs,
 * control-plane-tenancy.test.mjs, codex-tenancy.test.mjs) proves the guards and
 * read-model scoping with persistence DISABLED — pure in-memory state. The
 * persistence suite (persistence.test.mjs) proves records survive a restart, but
 * only for a single owner/team. Neither proves the combination the P1 closeout
 * (docs/engineering/P1_DURABLE_STATE_CLOSEOUT.md, "Next Recommended Slice")
 * explicitly leaves open: that a snapshot written by a multi-tenant deployment,
 * saved to disk and RESTORED into a fresh runtime, still hides foreign-team
 * records through every public read model, economics rollup, and access guard.
 *
 * These tests seed two teams end to end (users/tokens/projects/invocations/
 * approvals/ledger/budgets/auto-runs/worktrees/applications), round-trip the
 * snapshot through disk, and assert isolation holds AFTER restore — never before.
 *
 * Run: node --test test/tenancy-persistence.test.mjs (from apps/server).
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildEvidenceCenterRecords } from "../src/read-models/evidence-center.mjs";
import { buildPublicState } from "../src/read-models/state.mjs";
import { LOCAL_TEAM_ID, denyForeignProject } from "../src/runtime/auth.mjs";
import {
  createPersistenceRuntime,
  detectOwnershipInconsistencies,
  persistedArrayKeys,
  persistedObjectKeys,
} from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createM3Service } from "../src/services/m3.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";

const TEAM_A = "team_a";
const TEAM_B = "team_b";

function now() {
  return "2026-07-14T00:00:00.000Z";
}

function m3ServiceFor(state) {
  let id = 0;
  return createM3Service({
    state,
    now,
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent: () => {},
    findAgent: (agentId) => state.agents.find((agent) => agent.id === agentId) ?? null,
  });
}

/** A public-state snapshot scoped to `actor` (null = unscoped/local dev). */
function publicStateFor(state, { defaultProjectPath, actor }) {
  const currentProject = () => state.projects.find((item) => item.id === state.currentProjectId) ?? state.projects[0] ?? null;
  const m3 = m3ServiceFor(state);
  const findInvocation = (invocationId) => state.invocations.find((item) => item.id === invocationId) ?? null;
  const codexSessionForInvocation = (invocationId) => state.codexSessions.find((session) => session.invocationId === invocationId) ?? null;
  const repoPathForEvidence = () => null;
  return buildPublicState({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProjectPath,
    currentProject,
    defaultAgent: () => state.agents[0] ?? null,
    loopRoutineReadModel: () => [],
    codexApprovalQueue: () => [],
    evidenceCenterRecords: () => buildEvidenceCenterRecords({ state, findInvocation, codexSessionForInvocation, repoPathForEvidence }),
    ledgerSummary: (includeEntry) => m3.ledgerSummary(includeEntry),
    budgetStatuses: () => m3.budgetStatuses(),
    teamBudgetStatuses: () => m3.teamBudgetStatuses(),
    actor,
  });
}

/**
 * Two teams seeded end to end into a fresh runtime state, each with a project on
 * a real on-disk path (restore filters projects whose path is missing), an
 * invocation, a spend-bearing ledger entry, a project budget, an auto-run, a
 * worktree, and an application. Returns the runtime handle plus the ids so the
 * test can assert on them.
 */
function seedTwoTeams({ projectPathA, projectPathB }) {
  const runtime = createServerState({ defaultProjectPath: projectPathA, now });
  const { state } = runtime;

  state.users.push({ id: "usr_a", teamId: TEAM_A }, { id: "usr_b", teamId: TEAM_B });
  state.teams.push({ id: TEAM_A, name: "Team A" }, { id: TEAM_B, name: "Team B" });
  state.tokens.push(
    { token: "tok_a", userId: "usr_a", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    { token: "tok_b", userId: "usr_b", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  );

  // Project A replaces the seeded default (same path) so currentProject is A's.
  const projA = { id: "proj_a", name: "Alpha", path: projectPathA, ownerTeamId: TEAM_A, source: "registered" };
  const projB = { id: "proj_b", name: "Bravo", path: projectPathB, ownerTeamId: TEAM_B, source: "registered" };
  state.projects = [projA, projB];
  state.currentProjectId = projA.id;

  const m3 = m3ServiceFor(state);
  for (const [team, proj, user, spend] of [
    [TEAM_A, projA, "usr_a", 3.5],
    [TEAM_B, projB, "usr_b", 7.25],
  ]) {
    const invId = `inv_${team}`;
    state.invocations.push({
      id: invId,
      agentId: "agt_demo_cli",
      requestedBy: user,
      projectId: proj.id,
      status: "completed",
      input: { metadata: { projectId: proj.id } },
    });
    m3.upsertBudget({ projectId: proj.id, limitUsd: 100, policy: "block" });
    m3.recordInvocationLedgerEntry({
      invocation: { id: invId, agentId: "agt_demo_cli", requestedBy: user, projectId: proj.id, input: { metadata: { projectId: proj.id } } },
      cost: { amountUsd: spend, currency: "USD", model: "demo", billable: true },
      agent: state.agents.find((agent) => agent.id === "agt_demo_cli"),
    });
    state.autoRuns.push({
      id: `aur_${team}`,
      projectId: proj.id,
      worktreeId: `wt_${team}`,
      invocationId: invId,
      status: "pr_open",
      link: { type: "issue", number: 1, title: `${team} work`, url: "https://example.test/1" },
    });
    state.worktrees.push({ id: `wt_${team}`, sourceProjectId: proj.id, projectId: proj.id, branchName: `b-${team}` });
    state.applications.push({ id: `app_${team}`, projectId: proj.id, ownerTeamId: team, name: `${team} app` });
  }
  state.workItemReportDeliveries.push(
    {
      id: "wrdl_team_a",
      workItemId: "lwi_team_a",
      reportDraftId: "wrd_team_a",
      projectId: projA.id,
      ownerTeamId: TEAM_A,
      content: "team-a-private-confirmed-report",
      status: "preview",
    },
    {
      id: "wrdl_team_b",
      workItemId: "lwi_team_b",
      reportDraftId: "wrd_team_b",
      projectId: projB.id,
      ownerTeamId: TEAM_B,
      content: "team-b-private-confirmed-report",
      status: "delivered",
    },
  );

  return { runtime, state, projA, projB };
}

function saveRuntime(runtime, stateStorePath) {
  createPersistenceRuntime({
    state: runtime.state,
    enabled: true,
    stateStorePath,
    schemaVersion: 1,
    now,
    defaultProject: runtime.defaultProject,
    sameProjectPath,
  }).savePersistentState();
}

function restoreRuntime(projectPathA, stateStorePath) {
  const runtime = createServerState({ defaultProjectPath: projectPathA, now });
  const report = createPersistenceRuntime({
    state: runtime.state,
    enabled: true,
    stateStorePath,
    schemaVersion: 1,
    now,
    defaultProject: runtime.defaultProject,
    sameProjectPath,
  }).restorePersistentState();
  runtime.report = report;
  return runtime;
}

// Alias used where a test reads the restore report explicitly.
const restoreRuntimeWithReport = restoreRuntime;

/** Collect every string appearing anywhere in a snapshot, for leak scanning. */
function allStrings(value, acc = []) {
  if (typeof value === "string") acc.push(value);
  else if (Array.isArray(value)) for (const item of value) allStrings(item, acc);
  else if (value && typeof value === "object") for (const v of Object.values(value)) allStrings(v, acc);
  return acc;
}

test("#891 two-team isolation survives a save→restore round trip", () => {
  const root = join(tmpdir(), `myagenttool-tenancy-persistence-${Date.now()}`);
  const projectPathA = join(root, "alpha");
  const projectPathB = join(root, "bravo");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPathA, { recursive: true });
  mkdirSync(projectPathB, { recursive: true });

  try {
    const seeded = seedTwoTeams({ projectPathA, projectPathB });
    saveRuntime(seeded.runtime, stateStorePath);

    // Fresh runtime, restored purely from the on-disk snapshot.
    const restored = restoreRuntime(projectPathA, stateStorePath);
    const { state } = restored;

    // Both projects survived (real paths on disk).
    assert(state.projects.some((p) => p.id === "proj_a"), "proj_a restores");
    assert(state.projects.some((p) => p.id === "proj_b"), "proj_b restores");
    assert.deepEqual(
      state.workItemReportDeliveries.map((row) => row.id).sort(),
      ["wrdl_team_a", "wrdl_team_b"],
      "report delivery previews and receipts restore durably",
    );

    const actorA = { teamId: TEAM_A };
    const actorB = { teamId: TEAM_B };
    const viewA = publicStateFor(state, { defaultProjectPath: projectPathA, actor: actorA });
    const viewB = publicStateFor(state, { defaultProjectPath: projectPathB, actor: actorB });
    assert.equal(viewA.workItemReportDeliveries, undefined, "raw report content and delivery targets are not published in /api/state");
    assert.equal(viewB.workItemReportDeliveries, undefined, "raw report delivery rows stay behind owner-scoped routes");

    // Projects, invocations, auto-runs, worktrees, ledger, budgets — each scoped.
    const onlyOwn = (view, own, foreign, key, idOf) => {
      const ids = (view[key] ?? []).map(idOf);
      assert(ids.includes(own), `${key}: owner sees own after restore (${own})`);
      assert(!ids.includes(foreign), `${key}: owner must NOT see foreign after restore (${foreign})`);
    };
    onlyOwn(viewA, "proj_a", "proj_b", "projects", (r) => r.id);
    onlyOwn(viewB, "proj_b", "proj_a", "projects", (r) => r.id);
    onlyOwn(viewA, "inv_team_a", "inv_team_b", "invocations", (r) => r.id);
    onlyOwn(viewB, "inv_team_b", "inv_team_a", "invocations", (r) => r.id);
    // Auto-runs are not a top-level public-state key (they surface via
    // pendingDecisions and the scoped /api/auto-runs route → denyForeignAutoRun);
    // their isolation rides the worktree/project scoping below + the guard check.
    onlyOwn(viewA, "wt_team_a", "wt_team_b", "worktrees", (r) => r.id);
    onlyOwn(viewA, "app_team_a", "app_team_b", "applications", (r) => r.id);

    // Economics: budgets + per-project statuses are scoped.
    assert.deepEqual(
      viewA.budgets.map((b) => b.projectId).sort(),
      ["proj_a"],
      "team A sees only its own budget after restore",
    );
    assert.deepEqual(
      viewA.budgetStatuses.map((b) => b.projectId).sort(),
      ["proj_a"],
      "team A sees only its own budget status after restore",
    );

    // Economics ROLLUP (ledgerSummary): the aggregate the viewer sees must count
    // only its own spend, and must not enumerate foreign projects by name/id.
    assert.equal(viewA.ledgerSummary.totalCostUsd, 3.5, "team A rollup counts only team A spend");
    assert.equal(viewB.ledgerSummary.totalCostUsd, 7.25, "team B rollup counts only team B spend");
    const rollupProjectsA = (viewA.ledgerSummary.byProject ?? []).map((r) => r.projectId);
    assert(!rollupProjectsA.includes("proj_b"), "team A rollup must NOT enumerate foreign project proj_b");

    // Guard layer: a foreign actor is still denied on the restored project.
    const denials = [];
    const denied = denyForeignProject({
      res: {},
      sendJson: (res, status, body) => denials.push({ status, body }),
      state,
      actor: actorB,
      projectId: "proj_a",
    });
    assert.equal(denied, true, "team B is denied on team A's restored project");
    assert.equal(denials[0]?.status, 404, "denial hides existence with a 404");

    // Blanket leak scan: no foreign-team identifier appears anywhere in A's snapshot.
    const leaked = allStrings(viewA).filter((s) => /proj_b|inv_team_b|aur_team_b|wt_team_b|app_team_b|Bravo|team-b-private-confirmed-report/.test(s));
    assert.deepEqual(leaked, [], `no team B identifier may appear in team A's snapshot; leaked: ${leaked.join(", ")}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#891 tenant-scoped budget counters stay independent after restart", () => {
  const root = join(tmpdir(), `myagenttool-tenancy-budget-${Date.now()}`);
  const projectPathA = join(root, "alpha");
  const projectPathB = join(root, "bravo");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPathA, { recursive: true });
  mkdirSync(projectPathB, { recursive: true });

  try {
    const seeded = seedTwoTeams({ projectPathA, projectPathB });
    saveRuntime(seeded.runtime, stateStorePath);
    const restored = restoreRuntime(projectPathA, stateStorePath);
    const m3 = m3ServiceFor(restored.state);

    // Each project's spend is counted against its own budget only — no bleed.
    const a = m3.budgetStatusFor("proj_a");
    const b = m3.budgetStatusFor("proj_b");
    assert.equal(a.spentUsd, 3.5, "proj_a budget counts only proj_a spend after restore");
    assert.equal(b.spentUsd, 7.25, "proj_b budget counts only proj_b spend after restore");
    assert.equal(a.over, false);
    assert.equal(b.over, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#891 detectOwnershipInconsistencies flags a stamp/project team mismatch, spares consistent rows", () => {
  const state = {
    projects: [
      { id: "proj_a", ownerTeamId: TEAM_A },
      { id: "proj_b", ownerTeamId: TEAM_B },
      { id: "proj_unowned" },
    ],
    applications: [
      { id: "app_ok", projectId: "proj_a", ownerTeamId: TEAM_A }, // consistent
      { id: "app_bad", projectId: "proj_a", ownerTeamId: TEAM_B }, // stamp says B, project is A
      { id: "app_nostamp", projectId: "proj_a" }, // no stamp → nothing to cross-check
      { id: "app_orphan", projectId: "proj_gone", ownerTeamId: TEAM_B }, // dangling → fail-closed, not flagged
      { id: "app_local_ok", projectId: "proj_unowned", ownerTeamId: LOCAL_TEAM_ID }, // teamOf default matches
    ],
    applicationResults: [
      { id: "res_bad", projectId: "proj_b", ownerTeamId: TEAM_A }, // stamp A, project B
    ],
  };
  const diagnostics = detectOwnershipInconsistencies(state);
  const flagged = diagnostics.map((d) => `${d.collection}#${d.id}`).sort();
  assert.deepEqual(flagged, ["applicationResults#res_bad", "applications#app_bad"]);
  const bad = diagnostics.find((d) => d.id === "app_bad");
  assert.equal(bad.stampedTeam, TEAM_B);
  assert.equal(bad.projectTeam, TEAM_A);
});

test("#891 detectOwnershipInconsistencies is empty for a consistent snapshot + respects its cap", () => {
  assert.deepEqual(detectOwnershipInconsistencies({ projects: [], applications: [] }), []);
  assert.deepEqual(detectOwnershipInconsistencies(null), []);
  const state = {
    projects: [{ id: "proj_a", ownerTeamId: TEAM_A }],
    applications: Array.from({ length: 5 }, (_, i) => ({ id: `bad_${i}`, projectId: "proj_a", ownerTeamId: TEAM_B })),
  };
  assert.equal(detectOwnershipInconsistencies(state, { limit: 3 }).length, 3, "diagnostics are bounded by the cap");
});

// The security-relevant guarantee: an ownership-inconsistent restored record is
// surfaced as a diagnostic AND its visibility is NOT broadened — the falsely
// stamped team must not see it; it stays attributed to its project's team.
test("#891 a mismatched-owner record is flagged on restore and never broadens visibility", () => {
  const root = join(tmpdir(), `myagenttool-tenancy-quarantine-${Date.now()}`);
  const projectPathA = join(root, "alpha");
  const projectPathB = join(root, "bravo");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPathA, { recursive: true });
  mkdirSync(projectPathB, { recursive: true });

  try {
    const seeded = seedTwoTeams({ projectPathA, projectPathB });
    // Poison one of team A's applications with team B's owner stamp.
    const poisoned = seeded.state.applications.find((app) => app.id === "app_team_a");
    poisoned.ownerTeamId = TEAM_B;
    saveRuntime(seeded.runtime, stateStorePath);

    const restored = restoreRuntimeWithReport(projectPathA, stateStorePath);
    // Restore reported the inconsistency (the auditable diagnostic).
    const flagged = restored.report.ownershipInconsistencies.map((d) => d.id);
    assert(flagged.includes("app_team_a"), "restore reports the poisoned application");

    // Visibility unchanged: it is scoped by its PROJECT (team A), and the falsely
    // stamped team B must NOT see it.
    const viewA = publicStateFor(restored.state, { defaultProjectPath: projectPathA, actor: { teamId: TEAM_A } });
    const viewB = publicStateFor(restored.state, { defaultProjectPath: projectPathB, actor: { teamId: TEAM_B } });
    assert(viewA.applications.some((app) => app.id === "app_team_a"), "project-owning team A still sees it");
    assert(!viewB.applications.some((app) => app.id === "app_team_a"), "falsely stamped team B must NOT see it");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Snapshot keys written by savePersistentState OUTSIDE the two whitelists.
// Keep in lockstep with persistence.mjs:savePersistentState.
const EXPLICIT_SNAPSHOT_KEYS = ["projects", "currentProjectId", "worktrees", "devices", "device", "idCounter"];

// Deliberately NON-durable, in-memory-only runtime state. Anything added here
// must be justified: it is state that is meaningless to restore (recomputed at
// boot, or a live handle). Empty today — the whole state is durable. A new key
// landing in `uncovered` below forces a human to classify it rather than let it
// silently fall out of the snapshot (the failure mode #891 guards against).
const TRANSIENT_STATE_KEYS = [];

// #891 drift guard: every collection the state factory creates must be either
// durable (in a whitelist / explicit) or explicitly transient. A new owner-scoped
// collection added without a whitelist entry would restore empty — for a
// tenancy-scoped surface that is an isolation/consistency bug, not just data loss.
test("#891 every state key is classified durable or explicitly transient (whitelist completeness)", () => {
  const root = join(tmpdir(), `myagenttool-whitelist-${Date.now()}`);
  const projectPath = join(root, "project");
  mkdirSync(projectPath, { recursive: true });
  try {
    const { state } = createServerState({ defaultProjectPath: projectPath, now });
    const covered = new Set([
      ...persistedArrayKeys,
      ...persistedObjectKeys,
      ...EXPLICIT_SNAPSHOT_KEYS,
      ...TRANSIENT_STATE_KEYS,
    ]);
    const uncovered = Object.keys(state).filter((key) => !covered.has(key));
    assert.deepEqual(
      uncovered,
      [],
      `state key(s) neither persisted nor classified transient — add to persistedArrayKeys/` +
        `persistedObjectKeys (durable) or TRANSIENT_STATE_KEYS (justified): ${uncovered.join(", ")}`,
    );

    // And the reverse: no whitelist entry names a key the factory never creates
    // (a stale entry that would mask a rename). `device`/`devices` restore via
    // their own path, so they are explicit, not in the array/object lists.
    const stateKeys = new Set(Object.keys(state));
    const stale = [...persistedArrayKeys, ...persistedObjectKeys].filter((key) => !stateKeys.has(key));
    assert.deepEqual(stale, [], `whitelist names key(s) absent from state (stale/renamed): ${stale.join(", ")}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A sanity anchor: with NO actor (single-team local dev), everything is visible.
// This pins that the scoping added for tenancy never regresses the default path.
test("#891 unscoped (local dev) view still sees all teams after restore", () => {
  const root = join(tmpdir(), `myagenttool-tenancy-unscoped-${Date.now()}`);
  const projectPathA = join(root, "alpha");
  const projectPathB = join(root, "bravo");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPathA, { recursive: true });
  mkdirSync(projectPathB, { recursive: true });

  try {
    const seeded = seedTwoTeams({ projectPathA, projectPathB });
    saveRuntime(seeded.runtime, stateStorePath);
    const restored = restoreRuntime(projectPathA, stateStorePath);
    const view = publicStateFor(restored.state, { defaultProjectPath: projectPathA, actor: null });
    assert.equal(view.projects.length, 2, "unscoped view sees both projects");
    assert.equal(view.ledgerSummary.totalCostUsd, 10.75, "unscoped rollup is the platform total");
    assert.equal(view.invocations.length, 2, "unscoped view sees both invocations");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
