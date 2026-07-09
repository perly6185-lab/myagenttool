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
