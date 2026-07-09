import { test } from "node:test";
import assert from "node:assert/strict";
import { createInvocationCompareRuntime } from "../src/services/invocations/compare.mjs";

const AGENTS = [{ id: "agt_a" }, { id: "agt_b" }];

function harness({ withWorktree = true, failFor = null } = {}) {
  const state = { compareRuns: [] };
  let n = 0;
  const created = { worktrees: [], invocations: [], started: [] };
  const rt = createInvocationCompareRuntime({
    state,
    now: () => "2026-07-09T00:00:00.000Z",
    nextId: (p) => `${p}_${++n}`,
    createInvocation: (task, agent, options) => { const i = { id: `inv_${++n}`, task, agentId: agent.id, options }; created.invocations.push(i); return i; },
    startInvocationIfAllowed: (i) => created.started.push(i.id),
    updateCompareRun: () => {},
    createWorktree: withWorktree
      ? (({ projectId, agentId }) => { if (agentId === failFor) throw new Error("disk full"); const w = { id: `wtr_${++n}`, projectId, agentId }; created.worktrees.push(w); return { worktree: w }; })
      : undefined,
  });
  return { rt, state, created };
}

test("createCompareRun with a projectId isolates each agent in its own worktree (P4.2)", () => {
  const { rt, created } = harness();
  const cr = rt.createCompareRun("implement X", AGENTS, { projectId: "prj_1", actor: { userId: "u" } });
  assert.equal(created.worktrees.length, 2, "one worktree per agent");
  assert.equal(cr.isolated, true);
  assert.equal(cr.children.length, 2);
  assert.ok(cr.children.every((c) => c.worktreeId), "each child has its own worktree");
  assert.equal(created.started.length, 2, "both agents started");
  for (const i of created.invocations) {
    assert.equal(i.options.metadata.compareRunId, cr.id);
    assert.ok(i.options.metadata.worktreeId, "worktreeId threaded into invocation metadata");
    assert.equal(i.options.metadata.projectId, "prj_1");
  }
});

test("createCompareRun WITHOUT a projectId stays shared context (read-only/answer compare)", () => {
  const { rt, created } = harness();
  const cr = rt.createCompareRun("answer this", AGENTS, { actor: { userId: "u" } });
  assert.equal(created.worktrees.length, 0, "no worktrees when no project");
  assert.equal(cr.isolated, false);
  assert.ok(cr.children.every((c) => c.worktreeId === null));
  assert.ok(created.invocations.every((i) => !i.options.metadata.worktreeId));
});

test("createCompareRun degrades gracefully if a worktree fails for one agent", () => {
  const { rt, created } = harness({ failFor: "agt_b" });
  const cr = rt.createCompareRun("x", AGENTS, { projectId: "prj_1" });
  assert.equal(cr.children.length, 2, "both agents still run");
  assert.equal(created.worktrees.length, 1, "only agt_a got a worktree");
  assert.equal(cr.children.filter((c) => c.worktreeId).length, 1, "one isolated, one fell back to shared");
});

function promoteHarness() {
  const state = { compareRuns: [] };
  let n = 0;
  const prCalls = [];
  // Phase 5 review gate: map worktreeId -> verdict; a test approves a worktree by
  // setting reviews[worktreeId] = "approved" before promoting.
  const reviews = {};
  const rt = createInvocationCompareRuntime({
    state,
    now: () => "2026-07-09T00:00:00.000Z",
    nextId: (p) => `${p}_${++n}`,
    createInvocation: (task, agent, options) => ({ id: `inv_${++n}`, agentId: agent.id, options, worktreeId: options.metadata?.worktreeId ?? null }),
    startInvocationIfAllowed: () => {},
    updateCompareRun: () => {},
    createWorktree: ({ agentId }) => ({ worktree: { id: `wtr_${agentId}` } }),
    createWorktreePr: async (worktreeId) => { prCalls.push(worktreeId); return { number: 42, url: `https://github.com/o/r/pull/42` }; },
    latestWorktreeReview: (worktreeId) => (reviews[worktreeId] ? { verdict: reviews[worktreeId] } : null),
    findInvocation: (id) => state.compareRuns.flatMap((c) => c.childInvocationIds).includes(id) ? { id, worktreeId: null } : null,
  });
  return { rt, state, prCalls, reviews };
}

test("setCompareRunPreferred sets the winner; rejects a non-child invocation", () => {
  const { rt } = promoteHarness();
  const cr = rt.createCompareRun("x", AGENTS, { projectId: "prj_1" });
  const winner = cr.childInvocationIds[1];
  const updated = rt.setCompareRunPreferred(cr.id, winner, { actor: { userId: "u" } });
  assert.equal(updated.preferredInvocationId, winner);
  assert.equal(updated.preferredBy, "u");
  assert.throws(() => rt.setCompareRunPreferred(cr.id, "inv_bogus"), /not part of this compare run/);
});

test("promoteCompareRun opens a PR for the preferred agent's worktree (idempotent)", async () => {
  const { rt, prCalls, reviews } = promoteHarness();
  const cr = rt.createCompareRun("x", AGENTS, { projectId: "prj_1" });
  await assert.rejects(() => rt.promoteCompareRun(cr.id), /Set a preferred agent/);
  rt.setCompareRunPreferred(cr.id, cr.childInvocationIds[0]);
  reviews["wtr_agt_a"] = "approved"; // Phase 5: the winner's worktree must be approved
  const promoted = await rt.promoteCompareRun(cr.id, { actor: { userId: "u" } });
  assert.equal(promoted.status, "promoted");
  assert.equal(promoted.promotion.prNumber, 42);
  assert.equal(prCalls.length, 1, "one PR opened for the winner's worktree");
  // idempotent: a second promote does not open another PR
  await rt.promoteCompareRun(cr.id);
  assert.equal(prCalls.length, 1, "promote is idempotent");
});

test("promoteCompareRun is gated on the preferred worktree being approved (Phase 5)", async () => {
  const { rt, prCalls, reviews } = promoteHarness();
  const cr = rt.createCompareRun("x", AGENTS, { projectId: "prj_1" });
  rt.setCompareRunPreferred(cr.id, cr.childInvocationIds[0]); // preferred = agt_a → wtr_agt_a
  // no review yet → blocked
  await assert.rejects(() => rt.promoteCompareRun(cr.id), /has not been reviewed yet/);
  // changes requested → still blocked
  reviews["wtr_agt_a"] = "changes_requested";
  await assert.rejects(() => rt.promoteCompareRun(cr.id), /changes requested/);
  assert.equal(prCalls.length, 0, "no PR opened while blocked");
  // approved → promotes
  reviews["wtr_agt_a"] = "approved";
  const promoted = await rt.promoteCompareRun(cr.id, { actor: { userId: "u" } });
  assert.equal(promoted.status, "promoted");
  assert.equal(prCalls.length, 1);
});

test("promoteCompareRun refuses a shared (no-worktree) compare", async () => {
  const { rt } = promoteHarness();
  const cr = rt.createCompareRun("answer this", AGENTS, {}); // no projectId -> shared, no worktrees
  rt.setCompareRunPreferred(cr.id, cr.childInvocationIds[0]);
  await assert.rejects(() => rt.promoteCompareRun(cr.id), /no worktree to promote/);
});
