/*
 * worktreeDiff against a real temporary git worktree: the porcelain file list,
 * the tracked diff against the merge-base, the untracked-as-addition path
 * (`git diff --no-index`, whose patch arrives on a *non-zero* exit's stdout),
 * and the output-size cap. Hermetic: a real repo + worktree under mkdtemp, no
 * server boot. A regression here silently hands the console an empty or
 * unbounded diff — the review surface a human gates a promotion on.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, beforeEach, test } from "node:test";

import { createProjectService } from "../src/services/projects.mjs";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

let repoDir;
let svc;
let worktree;

before(() => {
  repoDir = mkdtempSync(join(tmpdir(), "wt-diff-"));
  execFileSync("git", ["init", "-b", "main", repoDir], { encoding: "utf8" });
  git(repoDir, "config", "user.email", "t@example.com");
  git(repoDir, "config", "user.name", "T");
  writeFileSync(join(repoDir, "README.md"), "hello\n");
  git(repoDir, "add", ".");
  git(repoDir, "commit", "-m", "init");

  let counter = 0;
  const state = { projects: [], worktrees: [], projectTargets: [], currentProjectId: null };
  svc = createProjectService({
    state,
    now: () => new Date().toISOString(),
    nextId: (p) => `${p}_${++counter}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
  });
  const source = svc.addProject({ name: "Repo", path: repoDir, ownerTeamId: "team_a" });
  ({ worktree } = svc.createWorktree({ projectId: source.id, name: "diff", branchName: "myagent/diff" }));
});

// Each scenario starts from a pristine worktree so file-list assertions are exact.
beforeEach(() => {
  git(worktree.path, "checkout", "--", ".");
  execFileSync("git", ["-C", worktree.path, "clean", "-fdx"], { encoding: "utf8" });
});

test("clean worktree: no files, empty diff, base falls back to HEAD", () => {
  const result = svc.worktreeDiff(worktree);
  assert.deepEqual(result.files, []);
  assert.equal(result.diff, "");
  assert.equal(result.truncated, false);
  // No upstream and no registered project target => the documented HEAD fallback.
  assert.equal(result.base, "HEAD");
});

test("tracked modification: listed in files and rendered in the unified diff", () => {
  writeFileSync(join(worktree.path, "README.md"), "hello\nworld\n");

  const result = svc.worktreeDiff(worktree);

  const readme = result.files.find((f) => f.path === "README.md");
  assert.ok(readme, "modified tracked file appears in the porcelain list");
  assert.equal(readme.untracked, false);
  assert.equal(readme.work, "M", "unstaged modification carries the working-tree status letter");
  assert.match(result.diff, /README\.md/);
  assert.match(result.diff, /^\+world$/m, "the added line is in the patch");
});

test("untracked file: marked untracked and added via the --no-index path", () => {
  writeFileSync(join(worktree.path, "new.txt"), "fresh content\n");

  const result = svc.worktreeDiff(worktree);

  const added = result.files.find((f) => f.path === "new.txt");
  assert.ok(added, "untracked file appears in the porcelain list");
  assert.equal(added.untracked, true);
  // This only shows up if the --no-index non-zero exit's stdout is read back.
  assert.match(result.diff, /new\.txt/);
  assert.match(result.diff, /^\+fresh content$/m);
});

test("oversized diff: capped at the byte limit and flagged truncated", () => {
  const MAX_DIFF_BYTES = 1024 * 1024;
  // ~1.3 MiB of plain text (kept ASCII + newlines so git treats it as text, not
  // binary) so the untracked patch pushes the diff past the cap.
  const big = (`${"a".repeat(63)}\n`).repeat(Math.ceil((MAX_DIFF_BYTES * 1.3) / 64));
  writeFileSync(join(worktree.path, "big.txt"), big);

  const result = svc.worktreeDiff(worktree);

  assert.equal(result.truncated, true);
  assert.ok(result.diff.length <= MAX_DIFF_BYTES, "diff is sliced to the byte cap");
});

test("teardown", () => {
  rmSync(repoDir, { recursive: true, force: true });
});
