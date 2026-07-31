/*
 * Unit tests for the dispatch scheduler's concurrency rules (added in #183):
 * the device concurrency cap, per-directory serialization (no two runs in the
 * same worktree), and that off-device (platform/http) runs don't consume a
 * bridge slot. A regression here either starves CLI dispatch or lets two agents
 * write the same working tree.
 *
 * #817: these fixtures used to put the metadata on `input`, mirroring the bug in
 * invocationDirKey — so the suite was green while per-worktree serialization was
 * dead in production for every invocation ever created. The fixtures now carry
 * the shape `invocations/creation.mjs` ACTUALLY writes (`options.metadata`), which
 * is what makes the guard testable at all. Do not "simplify" them back.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createInvocationDispatchRuntime } from "../src/services/invocations/dispatch.mjs";

const cliAgent = {
  id: "agt_cli",
  adapter: { type: "cli" },
  location: { type: "local_device", deviceId: "dev" },
  status: "available",
  lifecycle: { state: "enabled" },
  health: { status: "healthy" },
};
const platformAgent = {
  id: "agt_platform",
  adapter: { type: "platform" },
  location: { type: "platform" },
  status: "available",
  lifecycle: { state: "enabled" },
  health: { status: "healthy" },
};
const agents = { agt_cli: cliAgent, agt_platform: platformAgent };

function runtimeWith(invocations, maxConcurrency = 1, options = {}) {
  const state = { invocations, device: { id: "dev", maxConcurrency } };
  return createInvocationDispatchRuntime({
    state,
    now: () => "2026-07-01T00:00:00.000Z",
    appendEvent: () => {},
    dispatchLeaseMs: 30_000,
    findAgent: (id) => agents[id] ?? null,
    completeInvocation: () => {},
    ...options,
  });
}

const queued = (id, worktreePath, agentId = "agt_cli") => ({
  id,
  agentId,
  status: "queued",
  delivery: { state: "queued" },
  options: { metadata: { worktreePath } },
});
const running = (id, worktreePath, agentId = "agt_cli") => ({
  id,
  agentId,
  status: "running",
  delivery: { state: "running" },
  options: { metadata: { worktreePath } },
});

test("device cap: a full cap yields nothing; freeing it dispatches the queued run", () => {
  const busy = runtimeWith([running("inv_run", "/w1"), queued("inv_q", "/w2")], 1);
  assert.equal(busy.nextDispatchableInvocation(), undefined, "cap 1 with 1 running → nothing");

  const free = runtimeWith([queued("inv_q", "/w2")], 1);
  assert.equal(free.nextDispatchableInvocation()?.id, "inv_q");
});

test("per-cwd serialization: a queued run whose worktree is busy is skipped for a free one", () => {
  const rt = runtimeWith(
    [running("inv_run", "/w1"), queued("inv_same", "/w1"), queued("inv_other", "/w2")],
    2, // cap allows a second run
  );
  assert.equal(rt.nextDispatchableInvocation()?.id, "inv_other", "skips the busy worktree, picks the free one");
});

test("a post-execution worktree reaction lease blocks its continuation until cleanup finishes", () => {
  const blocked = queued("inv_continuation", "/w1");
  blocked.options.metadata.worktreeId = "wtr_1";
  const free = queued("inv_other", "/w2");
  free.options.metadata.worktreeId = "wtr_2";
  const rt = runtimeWith([blocked, free], 2, {
    isWorktreeReactionBusy: (invocation) => invocation.options?.metadata?.worktreeId === "wtr_1",
  });
  assert.equal(rt.nextDispatchableInvocation()?.id, "inv_other");
  assert.equal(rt.isInvocationDispatchable(blocked), false);
});

test("off-device runs don't consume a bridge slot", () => {
  // A running platform (off-device) agent must not count toward the cap.
  const rt = runtimeWith([running("inv_platform", "/w1", "agt_platform"), queued("inv_cli", "/w2")], 1);
  assert.equal(rt.nextDispatchableInvocation()?.id, "inv_cli");
});

test("a disabled or unhealthy agent's queued run is not dispatchable", () => {
  const disabled = { ...cliAgent, id: "agt_off", status: "disabled" };
  agents.agt_off = disabled;
  const rt = runtimeWith([queued("inv_off", "/w1", "agt_off")], 1);
  assert.equal(rt.nextDispatchableInvocation(), undefined);
  delete agents.agt_off;
});

test("claim invariant: a dispatched run is not re-claimable (atomic claim, no double-dispatch)", () => {
  // Two free worktrees, cap 2. Claiming must hand out each run exactly once —
  // the WS2 dispatch-claim property. It holds because nextDispatchable +
  // markDispatched run synchronously in the /api/bridge/next handler, so no
  // second poll can interleave and re-claim the same run.
  const inv = (id, w) => ({ id, agentId: "agt_cli", status: "queued", delivery: { state: "queued", dispatchAttempts: 0 }, options: { metadata: { worktreePath: w } } });
  const rt = runtimeWith([inv("inv_a", "/w1"), inv("inv_b", "/w2")], 2);

  const first = rt.nextDispatchableInvocation();
  assert.equal(first.id, "inv_a");
  rt.markDispatched(first);
  assert.equal(first.status, "dispatching", "claim moved it out of the queue");

  const second = rt.nextDispatchableInvocation();
  assert.equal(second.id, "inv_b", "the next claim never re-hands the already-dispatched run");
  rt.markDispatched(second);

  assert.equal(rt.nextDispatchableInvocation(), undefined, "both claimed → nothing left, no double-dispatch");
});

/*
 * #817 regression. The bug was invisible because the guard read
 * `invocation.input.metadata` while `creation.mjs` writes `options.metadata` —
 * so EVERY dir key was "__default__", every queued run collided with any single
 * in-flight run, and one stuck run wedged the device's dispatch forever.
 *
 * These two build their invocations exactly as creation.mjs does. Against the old
 * `input?.metadata` reader the first one FAILS (the queued run in a different
 * repository is refused dispatch) — which is the whole point of pinning the real
 * shape rather than the shape the code happened to read.
 */

// The shape creation.mjs produces: task on `input`, paths on `options.metadata`.
const realInvocation = (id, status, projectPath) => ({
  id,
  agentId: "agt_cli",
  status,
  delivery: { state: status === "queued" ? "queued" : "running", dispatchAttempts: 0 },
  input: { task: "do a thing" },
  options: { metadata: { projectPath, projectId: "prj_1" } },
});

test("#817: a stuck in-flight run does NOT wedge dispatch for a run in another repository", () => {
  const rt = runtimeWith(
    [
      realInvocation("inv_stuck", "running", "C:/tmp/some-other-repo"),
      realInvocation("inv_queued", "queued", "D:/repos/myagenttool"),
    ],
    3,
  );
  assert.equal(
    rt.nextDispatchableInvocation()?.id,
    "inv_queued",
    "different repositories must not collide — a wedged device is the bug",
  );
});

test("fairness: a flooding project at the front of the queue doesn't starve an idle one", () => {
  // Two projects; project A already has a run in flight, project B has none. Both
  // A's and B's queued runs are dispatchable (different worktrees, cap allows a
  // second). Array-order would pick A's (it's first); fair dispatch picks B's,
  // because A's tenant is already loaded — so a burst can't monopolize the device.
  const projects = [{ id: "prjA", ownerTeamId: "team_a" }, { id: "prjB", ownerTeamId: "team_b" }];
  const inv = (id, status, projectId, worktreePath, createdAt) => ({
    id, agentId: "agt_cli", status, createdAt,
    delivery: { state: status === "queued" ? "queued" : "running", dispatchAttempts: 0 },
    options: { metadata: { projectId, worktreePath } },
  });
  const state = {
    device: { id: "dev", maxConcurrency: 3 },
    projects,
    invocations: [
      inv("run_A", "running", "prjA", "/wtA0", "2026-07-01T00:00:00.000Z"),
      inv("q_A", "queued", "prjA", "/wtA1", "2026-07-01T00:00:01.000Z"), // earlier in array
      inv("q_B", "queued", "prjB", "/wtB1", "2026-07-01T00:00:02.000Z"), // later, idle tenant
    ],
  };
  const rt = createInvocationDispatchRuntime({
    state, now: () => "2026-07-01T00:01:00.000Z", appendEvent: () => {}, dispatchLeaseMs: 30_000,
    findAgent: (id) => agents[id] ?? null, completeInvocation: () => {},
  });
  assert.equal(rt.nextDispatchableInvocation()?.id, "q_B", "the idle tenant is served ahead of the already-running one");
});

test("isInvocationDispatchable: order-independent per-invocation gate (cap, dir, eligibility)", () => {
  const rt = runtimeWith(
    [running("run", "/w1"), queued("q_free", "/w2"), queued("q_busy", "/w1"), queued("q_off", "/w3", "agt_off")],
    3,
  );
  agents.agt_off = { ...cliAgent, id: "agt_off", status: "disabled" };
  assert.equal(rt.isInvocationDispatchable(queued("q_free", "/w2")), true, "free worktree, healthy agent → dispatchable");
  assert.equal(rt.isInvocationDispatchable(queued("q_busy", "/w1")), false, "worktree busy with the running job → not dispatchable");
  assert.equal(rt.isInvocationDispatchable(queued("q_off", "/w3", "agt_off")), false, "disabled agent → not dispatchable");
  delete agents.agt_off;

  const capped = runtimeWith([running("r1", "/w1"), running("r2", "/w2"), queued("q", "/w3")], 2);
  assert.equal(capped.isInvocationDispatchable(queued("q", "/w3")), false, "device at capacity → not dispatchable even on a free worktree");
  assert.equal(capped.isInvocationDispatchable(null), false, "null → false, never throws");
});

test("#817: the per-directory guard still holds on the real metadata shape", () => {
  const rt = runtimeWith(
    [
      realInvocation("inv_running", "running", "D:/repos/myagenttool"),
      realInvocation("inv_same_dir", "queued", "D:/repos/myagenttool"),
      realInvocation("inv_other_dir", "queued", "D:/repos/other"),
    ],
    3,
  );
  assert.equal(
    rt.nextDispatchableInvocation()?.id,
    "inv_other_dir",
    "two runs must still never share a working tree",
  );
});
