// Regression smoke for identity + tenancy (#184 + review fix #192):
// actor resolution, denyForeignProject, and buildPublicState team-scoping —
// including the collections and the dangling-project fallback hardened in #192.
import assert from "node:assert/strict";
import { buildPublicState } from "../../apps/server/src/read-models/state.mjs";
import { denyForeignProject, resolveActor } from "../../apps/server/src/runtime/auth.mjs";

let passed = 0;
const ok = (msg) => { passed += 1; console.log(`  ok - ${msg}`); };

const users = [
  { id: "usr_local", name: "Local", teamId: "team_local" },
  { id: "usr_b", name: "Bee", teamId: "team_b" },
];

// resolveActor: honors control-plane's token record (ISO expiresAt + revokedAt).
{
  const state = { users, tokens: [
    { token: "tok_live", userId: "usr_b", expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: null },
    { token: "tok_dead", userId: "usr_b", expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: new Date().toISOString() },
    { token: "tok_exp", userId: "usr_b", expiresAt: new Date(Date.now() - 1000).toISOString(), revokedAt: null },
  ]};
  const actor = resolveActor(state, { headers: { authorization: "Bearer tok_live" } });
  assert.equal(actor.userId, "usr_b");
  assert.equal(actor.teamId, "team_b");
  assert.equal(actor.authenticated, true);
  assert.equal(resolveActor(state, { headers: {} }).authenticated, false, "no token => fallback, not authenticated");
  assert.equal(resolveActor(state, { headers: { authorization: "Bearer tok_dead" } }).authenticated, false, "revoked");
  assert.equal(resolveActor(state, { headers: { authorization: "Bearer tok_exp" } }).authenticated, false, "expired");
  ok("resolveActor: token format compat (ISO/revoked/expired)");
}

// denyForeignProject.
{
  const state = { projects: [{ id: "prj_a", ownerTeamId: null }, { id: "prj_b", ownerTeamId: "team_b" }] };
  let code = null;
  const sendJson = (_res, status) => { code = status; };
  const actor = { userId: "usr_b", teamId: "team_b" };
  assert.equal(denyForeignProject({ res: {}, sendJson, state, actor, projectId: "prj_a" }), true, "foreign project denied");
  assert.equal(code, 403);
  code = null;
  assert.equal(denyForeignProject({ res: {}, sendJson, state, actor, projectId: "prj_b" }), false, "own project allowed");
  assert.equal(code, null);
  assert.equal(denyForeignProject({ res: {}, sendJson, state, actor, projectId: null }), false, "missing projectId no-ops");
  ok("denyForeignProject enforces ownership");
}

// buildPublicState team-scoping.
{
  const state = {
    device: {}, users, teams: [], agents: [],
    projects: [{ id: "prj_a", ownerTeamId: null }, { id: "prj_b", ownerTeamId: "team_b" }],
    invocations: [{ id: "inv_a", projectId: "prj_a" }, { id: "inv_b", projectId: "prj_b" }, { id: "inv_g", projectId: null }],
    events: [{ id: "e_a", invocationId: "inv_a" }, { id: "e_b", invocationId: "inv_b" }, { id: "e_g" }],
    compareRuns: [{ id: "cmp_a", childInvocationIds: ["inv_a"] }, { id: "cmp_b", childInvocationIds: ["inv_b"] }],
    codexSessions: [{ id: "cs_a", invocationId: "inv_a" }, { id: "cs_b", invocationId: "inv_b" }],
    quotaDecisionRecords: [{ id: "q_b", invocationId: "inv_b" }, { id: "q_g", invocationId: null }],
    ledgerEntries: [{ id: "l_a", projectId: "prj_a" }, { id: "l_b", projectId: "prj_b" }],
    worktrees: [{ id: "wt_ghost", projectId: "prj_ghost" }], // dangling project
    traces: [], spans: [], auditSummaries: [], budgets: [], automations: [],
    approvalRequests: [], policyDecisionRecords: [], troubleshootingReports: [], aiUsageRecords: [],
    codexWorkspaces: [], codexEvidenceRecords: [], codexChangeReviews: [], codexHookEvents: [],
    codexApprovalBrokerRequests: [], codexImportedEvidenceRecords: [],
  };
  const deps = (actor) => ({
    namespace: "t", protocolVersion: 1, state, defaultProjectPath: "/",
    currentProject: () => null, defaultAgent: () => null, loopRoutineReadModel: () => ({}),
    codexApprovalQueue: () => [], evidenceCenterRecords: () => [], ledgerSummary: () => null,
    budgetStatuses: () => [], actor,
  });

  const b = buildPublicState(deps({ teamId: "team_b" }));
  assert.deepEqual(b.projects.map((p) => p.id), ["prj_b"], "projects scoped");
  assert.deepEqual(b.invocations.map((i) => i.id).sort(), ["inv_b", "inv_g"], "invocations: own + global");
  assert.deepEqual(b.events.map((e) => e.id).sort(), ["e_b", "e_g"]);
  assert.deepEqual(b.compareRuns.map((c) => c.id), ["cmp_b"], "compareRuns scoped by child invocation");
  assert.deepEqual(b.codexSessions.map((c) => c.id), ["cs_b"], "codexSessions scoped");
  assert.deepEqual(b.quotaDecisionRecords.map((q) => q.id).sort(), ["q_b", "q_g"]);
  assert.deepEqual(b.ledgerEntries.map((l) => l.id), ["l_b"]);
  assert.deepEqual(b.worktrees.map((w) => w.id), [], "dangling-project row hidden (fallback fix)");

  const un = buildPublicState(deps(null));
  assert.equal(un.projects.length, 2, "no actor => pass-through");
  assert.equal(un.worktrees.length, 1, "no actor sees dangling-project row");
  ok("buildPublicState: team-scoping + dangling-project hidden + pass-through");
}

console.log(`\ntenancy-smoke: ${passed} checks passed`);
