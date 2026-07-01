// Regression smoke for worktreeDiff (#184 + review fix #191): builds a real
// temp git repo with a tracked change + an untracked file and asserts the diff
// surfaces both (the untracked-file path exercises --untracked-files=all).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProjectService } from "../../apps/server/src/services/projects.mjs";

let passed = 0;
const ok = (msg) => { passed += 1; console.log(`  ok - ${msg}`); };

const repo = join(tmpdir(), `worktree-diff-smoke-${process.pid}`);
rmSync(repo, { recursive: true, force: true });
mkdirSync(repo, { recursive: true });
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
git("init", "-q");
git("config", "user.email", "t@t.co");
git("config", "user.name", "t");
writeFileSync(join(repo, "tracked.txt"), "one\n");
git("add", "-A");
git("commit", "-qm", "init");
// A tracked change + a new untracked file (in a fresh untracked dir).
writeFileSync(join(repo, "tracked.txt"), "one\ntwo\n");
mkdirSync(join(repo, "newdir"), { recursive: true });
writeFileSync(join(repo, "newdir", "fresh.txt"), "brand new\n");

const state = {
  projects: [{ id: "prj", name: "r", path: repo }],
  projectTargets: [{ id: "t", projectId: "prj", state: "ready", rootPath: repo, defaultBranch: "main" }],
  worktrees: [{ id: "wt", projectId: "prj", targetId: "t", path: repo, branch: "main" }],
};
const svc = createProjectService({
  state, now: () => new Date().toISOString(), nextId: (p) => `${p}_1`, appendEvent: () => {}, persistStateSoon: () => {},
});

const diff = svc.worktreeDiff(state.worktrees[0]);
assert.ok(Array.isArray(diff.files), "returns a files array");
assert.ok(diff.files.some((f) => f.path === "tracked.txt"), "lists the tracked change");
assert.ok(diff.files.some((f) => f.path === "newdir/fresh.txt" && f.untracked),
  "untracked file inside a new dir is listed individually (--untracked-files=all)");
assert.ok(diff.diff.includes("two"), "patch includes the tracked addition");
assert.ok(diff.diff.includes("brand new"), "patch includes the untracked file's content");
assert.equal(diff.truncated, false);
ok("worktreeDiff: tracked change + untracked-in-new-dir surfaced in the patch");

rmSync(repo, { recursive: true, force: true });
console.log(`\nworktree-diff-smoke: ${passed} checks passed`);
