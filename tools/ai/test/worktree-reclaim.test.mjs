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
  const { reclaim, skip } = partitionWorktreesForReclaim([record("a"), record("b")], () => false, validate);
  assert.equal(reclaim.length, 2);
  assert.equal(skip.length, 0);
});

test("dirty worktrees are always preserved", () => {
  const isDirty = (path) => path.endsWith("/dirty");
  const { reclaim, skip } = partitionWorktreesForReclaim([record("clean"), record("dirty")], isDirty, validate);
  assert.deepEqual(reclaim.map((r) => r.parentRunId), ["clean"]);
  assert.equal(skip.length, 1);
  assert.match(skip[0].reason, /uncommitted work preserved/i);
});

test("validation-failing worktrees are skipped, not reclaimed", () => {
  const recs = [
    record("done", { invalid: "Worktree cleanup already completed." }),
    record("gone", { invalid: "Isolated worktree path does not exist." }),
  ];
  const { reclaim, skip } = partitionWorktreesForReclaim(recs, () => false, validate);
  assert.equal(reclaim.length, 0);
  assert.equal(skip.length, 2);
  assert.match(skip[0].reason, /already completed/i);
});

test("a status-inspection failure preserves the worktree (never reclaims on doubt)", () => {
  const { reclaim, skip } = partitionWorktreesForReclaim(
    [record("x")],
    () => {
      throw new Error("git failed");
    },
    validate,
  );
  assert.equal(reclaim.length, 0);
  assert.match(skip[0].reason, /unable to inspect/i);
});
