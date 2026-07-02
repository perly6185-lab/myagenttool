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
  state = { projects: [], worktrees: [], projectTargets: [], currentProjectId: null };
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
