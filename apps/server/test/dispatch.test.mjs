/*
 * Unit tests for the dispatch scheduler's concurrency rules (added in #183):
 * the device concurrency cap, per-directory serialization (no two runs in the
 * same worktree), and that off-device (platform/http) runs don't consume a
 * bridge slot. A regression here either starves CLI dispatch or lets two agents
 * write the same working tree.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createInvocationDispatchRuntime } from "../src/services/invocations/dispatch.mjs";

const cliAgent = {
  id: "agt_cli",
  adapter: { type: "cli" },
  location: { type: "local_device" },
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

function runtimeWith(invocations, maxConcurrency = 1) {
  const state = { invocations, device: { id: "dev", maxConcurrency } };
  return createInvocationDispatchRuntime({
    state,
    now: () => "2026-07-01T00:00:00.000Z",
    appendEvent: () => {},
    dispatchLeaseMs: 30_000,
    findAgent: (id) => agents[id] ?? null,
    completeInvocation: () => {},
  });
}

const queued = (id, worktreePath, agentId = "agt_cli") => ({
  id,
  agentId,
  status: "queued",
  delivery: { state: "queued" },
  input: { metadata: { worktreePath } },
});
const running = (id, worktreePath, agentId = "agt_cli") => ({
  id,
  agentId,
  status: "running",
  delivery: { state: "running" },
  input: { metadata: { worktreePath } },
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
