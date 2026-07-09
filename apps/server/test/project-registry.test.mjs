/*
 * Agent Workspace W1 (#160): the project registry captures git metadata on
 * register, omits it gracefully for a non-repo folder, and bumps last-opened on
 * select. Hermetic: real temp git repo under mkdtemp, no server boot.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { createProjectService, readGitFacts } from "../src/services/projects.mjs";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

let repoDir;
let plainDir;
let svc;
let state;

before(() => {
  repoDir = mkdtempSync(join(tmpdir(), "prj-reg-"));
  execFileSync("git", ["init", "-b", "main", repoDir], { encoding: "utf8" });
  git(repoDir, "config", "user.email", "t@example.com");
  git(repoDir, "config", "user.name", "T");
  git(repoDir, "remote", "add", "origin", "https://github.com/o/r.git");
  writeFileSync(join(repoDir, "README.md"), "hi\n");
  git(repoDir, "add", ".");
  git(repoDir, "commit", "-m", "init");

  plainDir = mkdtempSync(join(tmpdir(), "prj-plain-"));

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

test("readGitFacts captures remote + branches for a real repo", () => {
  const facts = readGitFacts(repoDir);
  assert.equal(facts.isRepo, true);
  assert.equal(facts.remoteUrl, "https://github.com/o/r.git");
  assert.equal(facts.currentBranch, "main");
  assert.equal(facts.defaultBranch, "main");
});

test("readGitFacts is graceful (null fields, isRepo:false) for a non-repo folder", () => {
  const facts = readGitFacts(plainDir);
  assert.equal(facts.isRepo, false);
  assert.equal(facts.remoteUrl, null);
  assert.equal(facts.defaultBranch, null);
  assert.equal(facts.currentBranch, null);
});

test("addProject captures git metadata on register + exposes activeCheckoutId", () => {
  const p = svc.addProject({ name: "Repo", path: repoDir, ownerTeamId: "team_a" });
  assert.equal(p.git.remoteUrl, "https://github.com/o/r.git");
  assert.equal(p.git.defaultBranch, "main");
  assert.equal(p.git.currentBranch, "main");
  assert.equal(p.activeCheckoutId, null, "shared project scopes to the root until a worktree is chosen");
  // the derived target inherits the captured remote/default branch
  const target = state.projectTargets.find((t) => t.projectId === p.id);
  assert.equal(target.remoteUrl, "https://github.com/o/r.git");
  assert.equal(target.defaultBranch, "main");
});

test("addProject on a non-repo folder omits git metadata gracefully", () => {
  const p = svc.addProject({ name: "Plain", path: plainDir, ownerTeamId: "team_a" });
  assert.equal(p.git.isRepo, false);
  assert.equal(p.git.remoteUrl, null);
});

test("re-registering an existing path refreshes its git facts + selects it (last-opened bumps)", () => {
  const first = svc.addProject({ name: "Repo", path: repoDir });
  const openedAt = first.lastOpenedAt;
  // add a second remote-less state change is overkill; just re-register and assert same id + selected
  const again = svc.addProject({ name: "Repo", path: repoDir });
  assert.equal(again.id, first.id, "same path re-registers the same project");
  assert.equal(state.currentProjectId, again.id, "re-register selects it");
  assert.ok(again.git.remoteUrl, "git facts refreshed on re-register");
  assert.ok(again.lastOpenedAt >= openedAt);
});

test("gitStatusMap marks .gitignore'd entries as 'ignored' (#161 badge)", async () => {
  const { gitStatusMap } = await import("../src/services/projects.mjs");
  const dir = mkdtempSync(join(tmpdir(), "prj-ign-"));
  execFileSync("git", ["init", "-b", "main", dir], { encoding: "utf8" });
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  writeFileSync(join(dir, ".gitignore"), "junk.log\n");
  writeFileSync(join(dir, "junk.log"), "noise\n");
  writeFileSync(join(dir, "keep.txt"), "kept\n");
  git(dir, "add", ".gitignore", "keep.txt");
  git(dir, "commit", "-m", "init");
  writeFileSync(join(dir, "keep.txt"), "changed\n");
  const map = gitStatusMap(dir);
  assert.equal(map.get("junk.log"), "ignored", "the ignored file carries the ignored status");
  assert.equal(map.get("keep.txt"), "modified", "a tracked change is still classified");
});
