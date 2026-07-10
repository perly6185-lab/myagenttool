/*
 * Worktree lifecycle tests against a real temporary git repository: create a
 * worktree (real `git worktree add` + registry + derived project record),
 * validation failures, and non-destructive removal (registry cleaned, files
 * kept). Hermetic: everything lives under a mkdtemp dir; no server boot.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";

import { createProjectService } from "../src/services/projects.mjs";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

let repoDir;
let state;
let svc;

before(() => {
  repoDir = mkdtempSync(join(tmpdir(), "wt-life-"));
  execFileSync("git", ["init", "-b", "main", repoDir], { encoding: "utf8" });
  git(repoDir, "config", "user.email", "t@example.com");
  git(repoDir, "config", "user.name", "T");
  writeFileSync(join(repoDir, "README.md"), "hello\n");
  git(repoDir, "add", ".");
  git(repoDir, "commit", "-m", "init");

  let counter = 0;
  state = { projects: [], worktrees: [], worktreeReviews: [], projectTargets: [], currentProjectId: null };
  svc = createProjectService({
    state,
    now: () => new Date().toISOString(),
    nextId: (p) => `${p}_${++counter}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
  });
});

test("createWorktree: real git worktree + registry + derived project inheriting the team", () => {
  const source = svc.addProject({ name: "Repo", path: repoDir, ownerTeamId: "team_a" });
  state.currentProjectId = source.id;

  const { worktree, project: derivedProject } = svc.createWorktree({ projectId: source.id, name: "feature one", branchName: "myagent/feature-one" });

  assert.equal(worktree.branchName, "myagent/feature-one");
  assert.ok(existsSync(worktree.worktreePath), "the worktree directory really exists");
  assert.ok(existsSync(join(worktree.worktreePath, "README.md")), "checked out from the source repo");
  const branches = git(repoDir, "branch", "--list", "myagent/feature-one");
  assert.ok(branches.includes("myagent/feature-one"), "the branch was created in the repo");

  assert.equal(state.worktrees.length, 1, "registered in the worktree registry");
  assert.equal(worktree.workspaceProjectId, derivedProject.id);
  assert.equal(derivedProject.source, "worktree");
  assert.equal(derivedProject.ownerTeamId, "team_a", "tenancy is inherited from the source project");
});

test("projectBranches: returns { name, remote } objects (BranchRef) with the current branch first", () => {
  const source = state.projects.find((p) => p.source !== "worktree");
  const { branches, current } = svc.projectBranches(source);

  assert.equal(current, "main");
  assert.ok(branches.length >= 2, "lists main plus the worktree branch created above");
  // Contract the console's branch picker relies on: bare strings would make
  // b.name undefined and crash its `b.name.toLowerCase()` filter.
  for (const b of branches) {
    assert.equal(typeof b.name, "string");
    assert.equal(typeof b.remote, "boolean");
  }
  assert.equal(branches[0].name, "main", "current branch is surfaced first");
  const names = branches.map((b) => b.name);
  assert.ok(names.includes("myagent/feature-one"), "includes the branch created by createWorktree");
});

test("createWorktree: an existing target path and an invalid branch are rejected", () => {
  const source = state.projects.find((p) => p.source !== "worktree");
  assert.throws(
    () => svc.createWorktree({ projectId: source.id, branchName: "x/dup", path: state.worktrees[0].worktreePath }),
    /already exists/,
  );
  assert.throws(() => svc.createWorktree({ projectId: source.id, branchName: "../evil" }), /invalid/i);
});

test("removeWorktree: registry + derived project cleaned, files kept (non-destructive)", () => {
  const worktree = state.worktrees[0];
  const derivedId = worktree.workspaceProjectId;
  state.currentProjectId = derivedId;

  const removed = svc.removeWorktree(worktree.id);

  assert.equal(removed.id, worktree.id);
  assert.equal(state.worktrees.length, 0, "registry entry gone");
  assert.ok(!state.projects.some((p) => p.id === derivedId), "derived project gone");
  assert.equal(state.currentProjectId, worktree.sourceProjectId, "selection falls back to the source project");
  assert.ok(existsSync(removed.worktreePath), "teardown is non-destructive — files stay on disk");
  assert.equal(svc.removeWorktree("wtr_nope"), null, "unknown id is a null no-op");
});

test("removeWorktree purges the removed worktree's dangling reviews, keeps others", () => {
  const source = state.projects.find((p) => p.source !== "worktree");
  const { worktree } = svc.createWorktree({ projectId: source.id, name: "to review", branchName: "myagent/to-review" });
  svc.submitWorktreeReview({ worktreeId: worktree.id, verdict: "approved" });
  state.worktreeReviews.unshift({ id: "wrv_other", worktreeId: "wt_other", verdict: "approved" });
  assert.ok(state.worktreeReviews.some((r) => r.worktreeId === worktree.id), "review recorded");

  svc.removeWorktree(worktree.id);

  assert.ok(!state.worktreeReviews.some((r) => r.worktreeId === worktree.id), "the removed worktree's review is purged");
  assert.ok(state.worktreeReviews.some((r) => r.worktreeId === "wt_other"), "unrelated reviews survive");
});

test("destroyWorktree: destructive teardown removes the git worktree AND its branch, then the name is reusable", () => {
  const source = state.projects.find((p) => p.source !== "worktree");
  const { worktree } = svc.createWorktree({ projectId: source.id, name: "to destroy", branchName: "myagent/to-destroy" });
  assert.ok(existsSync(worktree.worktreePath), "worktree dir exists before teardown");
  assert.ok(git(repoDir, "branch", "--list", "myagent/to-destroy").includes("myagent/to-destroy"), "branch exists before teardown");

  const removed = svc.destroyWorktree(worktree.id);

  assert.equal(removed.id, worktree.id, "returns the removed record (registry cleanup delegated to removeWorktree)");
  assert.equal(git(repoDir, "branch", "--list", "myagent/to-destroy"), "", "the branch is DELETED — unlike removeWorktree, which keeps it");
  assert.ok(!existsSync(worktree.worktreePath), "the worktree directory is gone (destructive on disk)");
  assert.ok(!state.worktrees.some((w) => w.id === worktree.id), "registry entry gone");

  // The whole point of the fix: the same branch name can be created again — a
  // denied run no longer orphans `issue-N` and blocks the re-run.
  const { worktree: recreated } = svc.createWorktree({ projectId: source.id, name: "reused", branchName: "myagent/to-destroy" });
  assert.equal(recreated.branchName, "myagent/to-destroy", "re-creating the branch now succeeds after teardown");
  svc.destroyWorktree(recreated.id); // tidy

  assert.equal(svc.destroyWorktree("wtr_nope"), null, "unknown id is a null no-op (best-effort, never throws)");
});

test("destroyWorktree never force-drops committed work: the branch and its commits survive", () => {
  const source = state.projects.find((p) => p.source !== "worktree");
  const { worktree } = svc.createWorktree({ projectId: source.id, name: "has work", branchName: "myagent/has-work" });
  // A denied RETRY can reuse a worktree a prior APPROVED run already committed to.
  writeFileSync(join(worktree.worktreePath, "feature.txt"), "real work\n");
  git(worktree.worktreePath, "add", ".");
  git(worktree.worktreePath, "commit", "-m", "agent work");
  const sha = git(worktree.worktreePath, "rev-parse", "HEAD");

  svc.destroyWorktree(worktree.id);

  assert.ok(git(repoDir, "branch", "--list", "myagent/has-work").includes("myagent/has-work"), "the branch carrying commits survives (git branch -d refuses it, not -D)");
  assert.equal(git(repoDir, "cat-file", "-t", sha), "commit", "the committed work is still reachable — no data loss on denial");
  git(repoDir, "branch", "-D", "myagent/has-work"); // tidy for later tests
});

test("destroyWorktree preserves a worktree with uncommitted changes (git refuses removal)", () => {
  const source = state.projects.find((p) => p.source !== "worktree");
  const { worktree } = svc.createWorktree({ projectId: source.id, name: "dirty", branchName: "myagent/dirty" });
  writeFileSync(join(worktree.worktreePath, "README.md"), "uncommitted edit\n"); // dirty the checkout

  const result = svc.destroyWorktree(worktree.id);

  assert.equal(result, null, "a dirty worktree is not torn down");
  assert.ok(existsSync(worktree.worktreePath), "the worktree dir (with un-pushed work) is kept");
  assert.ok(state.worktrees.some((w) => w.id === worktree.id), "the registry row is kept, not orphaned");
  execFileSync("git", ["-C", repoDir, "worktree", "remove", "--force", worktree.worktreePath]); // tidy
  svc.removeWorktree(worktree.id);
});

test("submitWorktreeReview binds the verdict to the worktree's current HEAD commit", () => {
  const source = state.projects.find((p) => p.source !== "worktree");
  const { worktree } = svc.createWorktree({ projectId: source.id, name: "sha bind", branchName: "myagent/sha-bind" });
  const head = git(worktree.worktreePath, "rev-parse", "HEAD");
  const review = svc.submitWorktreeReview({ worktreeId: worktree.id, verdict: "approved" });
  assert.equal(review.reviewedCommit, head, "review captures the real worktree HEAD so a later commit invalidates it");
});
