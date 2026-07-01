// Regression smoke for dispatch concurrency safety (#183): the device cap,
// bridge-only counting, per-cwd serialization, and stuck-cancel reclaim.
import assert from "node:assert/strict";
import { createInvocationDispatchRuntime } from "../../apps/server/src/services/invocations/dispatch.mjs";

let passed = 0;
const ok = (msg) => { passed += 1; console.log(`  ok - ${msg}`); };

const AGENTS = {
  bridge: { id: "bridge", adapter: { type: "cli" }, location: { type: "local_device" }, health: { status: "ok" } },
  remote: { id: "remote", adapter: { type: "http" }, location: { type: "remote_http" }, health: { status: "ok" } },
};
const findAgent = (id) => AGENTS[id] ?? null;

function inv(id, status, agentId, dir, deliveryState = "queued", extra = {}) {
  return { id, status, agentId, input: { metadata: { worktreePath: dir } }, delivery: { state: deliveryState }, ...extra };
}
function runtime(state, completeInvocation) {
  return createInvocationDispatchRuntime({
    state, now: () => new Date().toISOString(), appendEvent: () => {},
    dispatchLeaseMs: 30_000, findAgent, completeInvocation,
  });
}

// A. Cap.
{
  const state = { device: { maxConcurrency: 2 }, invocations: [
    inv("a", "running", "bridge", "/x"), inv("b", "running", "bridge", "/y"), inv("q", "queued", "bridge", "/z"),
  ]};
  assert.equal(runtime(state).nextDispatchableInvocation(), undefined, "cap reached => none");
  state.device.maxConcurrency = 3;
  assert.equal(runtime(state).nextDispatchableInvocation()?.id, "q", "under cap => dispatch");
  ok("concurrency cap enforced");
}

// B. Bridge-only counting.
{
  const state = { device: { maxConcurrency: 1 }, invocations: [
    inv("r", "running", "remote", "/x"), inv("q", "queued", "bridge", "/y"),
  ]};
  assert.equal(runtime(state).nextDispatchableInvocation()?.id, "q", "remote run doesn't consume the bridge slot");
  ok("only bridge runs count toward the cap");
}

// C. Per-cwd serialization.
{
  const state = { device: { maxConcurrency: 5 }, invocations: [
    inv("a", "running", "bridge", "/x"), inv("qx", "queued", "bridge", "/x"), inv("qy", "queued", "bridge", "/y"),
  ]};
  assert.equal(runtime(state).nextDispatchableInvocation()?.id, "qy", "busy cwd skipped, free cwd dispatched");
  ok("per-cwd serialization");
}

// D. Stuck-cancel reclaim (with grace).
{
  const old = new Date(Date.now() - 5 * 60_000).toISOString();
  const state = { device: { maxConcurrency: 1 }, invocations: [
    inv("stuck", "cancelling", "bridge", "/x", "acknowledged", { cancellation: { requestedAt: old } }),
    inv("q", "queued", "bridge", "/y"),
  ]};
  const completed = [];
  const rt = runtime(state, (invocation, patch) => { invocation.status = patch.status; completed.push(invocation.id); });
  const next = rt.nextDispatchableInvocation();
  assert.deepEqual(completed, ["stuck"], "stuck cancelling reclaimed");
  assert.equal(next?.id, "q", "freed slot lets queued run dispatch");

  const fresh = { device: { maxConcurrency: 1 }, invocations: [
    inv("recent", "cancelling", "bridge", "/x", "acknowledged", { cancellation: { requestedAt: new Date().toISOString() } }),
    inv("q2", "queued", "bridge", "/y"),
  ]};
  assert.equal(runtime(fresh, (i, p) => { i.status = p.status; }).nextDispatchableInvocation(), undefined,
    "recent cancel still holds its slot");
  ok("stuck-cancel reclaim respects the grace window");
}

console.log(`\ndispatch-concurrency-smoke: ${passed} checks passed`);
