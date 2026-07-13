/*
 * Refusal model (#758) Tier-2: loop promotion refusals (tools/ai, per-run
 * events.jsonl) surfaced for the console refusal lens. The mapping is pure and
 * unit-tested; the endpoint is exercised against a live server (empty is a valid,
 * graceful result when there is no loop activity).
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { mapLoopRefusalEvent } from "../src/read-models/loop-refusals.mjs";

test("maps a loop promotion refusal to the taxonomy (human/gate_rejected), tagged source:loop", () => {
  const row = mapLoopRefusalEvent(
    { id: "e1", type: "loop_worktree_promotion_refused", createdAt: "2026-07-13T01:00:00.000Z", message: "Promotion refused", data: { worktreePath: "/w", approval: "grant_1" }, runId: "run_7" },
    { runId: "run_7", updatedAt: "2026-07-13T02:00:00.000Z" },
  );
  assert.equal(row.category, "human");
  assert.equal(row.code, "gate_rejected");
  assert.equal(row.source, "loop");
  assert.equal(row.runId, "run_7");
  assert.equal(row.subject.kind, "worktree_action");
  assert.equal(row.decidedBy.id, "grant_1");
  assert.deepEqual(row.evidence, { worktreePath: "/w", approval: "grant_1" });
  assert.equal(row.at, "2026-07-13T01:00:00.000Z", "the event time wins over the run's updatedAt");
});

test("maps the merge-prep blocked event to policy/action_not_permitted", () => {
  const row = mapLoopRefusalEvent({ type: "loop_worktree_promotion_pr_merge_prep_blocked", runId: "run_9" }, {});
  assert.equal(row.category, "policy");
  assert.equal(row.code, "action_not_permitted");
});

test("a non-refusal loop event maps to null (not surfaced)", () => {
  assert.equal(mapLoopRefusalEvent({ type: "loop_state_changed", runId: "r" }, {}), null);
  assert.equal(mapLoopRefusalEvent({ type: "loop_worktree_promotion_succeeded", runId: "r" }, {}), null);
  assert.equal(mapLoopRefusalEvent({ type: "loop_run_created", runId: "r" }, {}), null);
});

test("an unknown *_refused type not in the catalog maps to null (taxonomy-gated)", () => {
  assert.equal(mapLoopRefusalEvent({ type: "some_made_up_refused", runId: "r" }, {}), null);
});

// --- endpoint: graceful empty when there is no loop activity ---

let server;
let base;

before(async () => {
  const { createServerState } = await import("../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../src/runtime/http-server.mjs");
  const projectDir = mkdtempSync(join(tmpdir(), "loop-refusals-"));
  const created = createServerState({ defaultProjectPath: projectDir, now: () => "2026-07-13T00:00:00.000Z" });
  const { httpDependencies: deps } = createServerRuntimeServices({
    namespace: "test", protocolVersion: "0.0.0", state: created.state,
    defaultProject: created.defaultProject, defaultProjectPath: projectDir,
    persistenceEnabled: false, stateStorePath: "/tmp/unused.json", stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000, now: () => "2026-07-13T00:00:00.000Z",
  });
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...deps });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test("GET /api/loop-refusals returns a well-formed, bounded read model", async () => {
  const res = await fetch(`${base}/api/loop-refusals`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.refusals), "refusals is an array");
  assert.equal(typeof body.scannedRuns, "number");
  assert.equal(typeof body.truncatedRuns, "boolean");
  // Every returned row is a loop-sourced refusal with a valid taxonomy category.
  for (const row of body.refusals) {
    assert.equal(row.source, "loop");
    assert.ok(["not_granted", "policy", "state", "human"].includes(row.category));
  }
});
