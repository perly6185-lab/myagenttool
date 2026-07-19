/*
 * loop-worktree-cleanup --merged batch reclaim: the safety-critical decision is
 * partitionWorktreesForReclaim — it must reclaim clean, finished worktrees and
 * ALWAYS preserve dirty ones (uncommitted work) and anything that fails
 * validation (missing / already reclaimed / outside the boundary).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { partitionWorktreesForReclaim } from "../src/loop/worktree.mjs";

function record(id, overrides = {}) {
  return { parentRunId: id, childRunId: `${id}-c`, worktreePath: `/wt/${id}`, ...overrides };
}
// Stub the disk/ctx-backed validator: a record is valid unless flagged invalid.
const validate = (r) => (r.invalid ? r.invalid : null);

test("clean, valid worktrees are reclaimed", () => {
  const { reclaim, reconcile, skip } = partitionWorktreesForReclaim(
    [record("a", { exists: true }), record("b", { exists: true })],
    () => false,
    validate,
  );
  assert.equal(reclaim.length, 2);
  assert.equal(reconcile.length, 0);
  assert.equal(skip.length, 0);
});

test("already-gone worktrees are reconciled (marked done), not reclaimed or skipped", () => {
  const { reclaim, reconcile, skip } = partitionWorktreesForReclaim(
    [record("gone", { exists: false })],
    () => false,
    validate,
  );
  assert.equal(reclaim.length, 0);
  assert.deepEqual(reconcile.map((r) => r.parentRunId), ["gone"]);
  assert.equal(skip.length, 0);
});

test("already-reclaimed worktrees are skipped", () => {
  const { reclaim, reconcile, skip } = partitionWorktreesForReclaim(
    [record("done", { cleanupStatus: "completed" })],
    () => false,
    validate,
  );
  assert.equal(reclaim.length + reconcile.length, 0);
  assert.match(skip[0].reason, /already reclaimed/i);
});

test("dirty worktrees are always preserved", () => {
  const isDirty = (path) => path.endsWith("/dirty");
  const { reclaim, skip } = partitionWorktreesForReclaim(
    [record("clean", { exists: true }), record("dirty", { exists: true })],
    isDirty,
    validate,
  );
  assert.deepEqual(reclaim.map((r) => r.parentRunId), ["clean"]);
  assert.equal(skip.length, 1);
  assert.match(skip[0].reason, /uncommitted work preserved/i);
});

test("validation-failing (existing) worktrees are skipped, not reclaimed", () => {
  const recs = [record("outside", { exists: true, invalid: "Isolated worktree path is outside .myagenttool/worktrees." })];
  const { reclaim, reconcile, skip } = partitionWorktreesForReclaim(recs, () => false, validate);
  assert.equal(reclaim.length + reconcile.length, 0);
  assert.match(skip[0].reason, /outside/i);
});

test("a status-inspection failure preserves the worktree (never reclaims on doubt)", () => {
  const { reclaim, skip } = partitionWorktreesForReclaim(
    [record("x", { exists: true })],
    () => {
      throw new Error("git failed");
    },
    validate,
  );
  assert.equal(reclaim.length, 0);
  assert.match(skip[0].reason, /unable to inspect/i);
});
