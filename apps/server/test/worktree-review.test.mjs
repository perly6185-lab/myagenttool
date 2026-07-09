import { test } from "node:test";
import assert from "node:assert/strict";
import { createProjectService } from "../src/services/projects.mjs";

function svc() {
  const state = {
    projects: [],
    worktrees: [{ id: "wt_1", projectId: "prj_1", workspaceProjectId: "prj_1", branchName: "feature/x" }],
    worktreeReviews: [],
    projectTargets: [],
  };
  const events = [];
  let n = 0;
  const s = createProjectService({
    state,
    now: () => "2026-07-09T00:00:00.000Z",
    nextId: (p) => `${p}_${++n}`,
    appendEvent: (e) => events.push(e),
    persistStateSoon: () => {},
  });
  return { s, state, events };
}

test("submitWorktreeReview records a verdict; latestWorktreeReview returns it", () => {
  const { s, state, events } = svc();
  const r = s.submitWorktreeReview({ worktreeId: "wt_1", verdict: "approved", summary: "LGTM", actor: { userId: "u" } });
  assert.equal(r.verdict, "approved");
  assert.equal(r.worktreeId, "wt_1");
  assert.equal(r.projectId, "prj_1");
  assert.equal(r.reviewedBy, "u");
  assert.equal(r.summary, "LGTM");
  assert.equal(state.worktreeReviews.length, 1);
  assert.equal(s.latestWorktreeReview("wt_1").verdict, "approved");
  assert.equal(events.at(-1).type, "worktree_reviewed");
});

test("verdict must be approved | changes_requested", () => {
  const { s } = svc();
  assert.throws(() => s.submitWorktreeReview({ worktreeId: "wt_1", verdict: "lgtm" }), /must be 'approved' or 'changes_requested'/);
});

test("unknown worktree throws", () => {
  const { s } = svc();
  assert.throws(() => s.submitWorktreeReview({ worktreeId: "nope", verdict: "approved" }), /Worktree not found/);
});

test("comments are cleaned: empties dropped, non-objects dropped, null path kept", () => {
  const { s } = svc();
  const r = s.submitWorktreeReview({
    worktreeId: "wt_1",
    verdict: "changes_requested",
    comments: [
      { path: "src/a.ts", body: "fix this" },
      { path: null, body: "   " }, // empty body → dropped
      { body: "general note" }, // no path → null path kept
      "not-an-object", // dropped
    ],
  });
  assert.equal(r.comments.length, 2);
  assert.deepEqual(r.comments[0], { path: "src/a.ts", body: "fix this" });
  assert.equal(r.comments[1].path, null);
  assert.equal(r.comments[1].body, "general note");
});

test("latest-wins: the newest review is the one that gates", () => {
  const { s } = svc();
  s.submitWorktreeReview({ worktreeId: "wt_1", verdict: "changes_requested" });
  s.submitWorktreeReview({ worktreeId: "wt_1", verdict: "approved" });
  assert.equal(s.latestWorktreeReview("wt_1").verdict, "approved");
  assert.equal(s.latestWorktreeReview("wt_absent"), null);
});
