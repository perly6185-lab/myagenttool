/*
 * Real publish/PR for console worktrees, replacing the old skipped:true stub.
 * Hermetic: a mkdtemp source repo pushes to a local bare "origin"; gh is a
 * stand-in node script injected via MYAGENTTOOL_GH_COMMAND_JSON that records
 * its argv and prints the JSON `gh pr create --json` would. No network.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { createProjectService } from "../src/services/projects.mjs";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

// Read the branches on origin via the working repo (avoids touching the bare
// dir directly, which trips safe.bareRepository=explicit on some machines).
function originBranches(workingRepo) {
  return git(workingRepo, "ls-remote", "--heads", "origin")
    .split("\n")
    .map((line) => line.split(/\s+/)[1]?.replace(/^refs\/heads\//, ""))
    .filter(Boolean);
}

let root;
let repoDir;
let bareDir;
let ghCapturePath;
let state;
let svc;
let savedGhEnv;

before(() => {
  root = mkdtempSync(join(tmpdir(), "wt-pub-"));
  repoDir = join(root, "repo");
  bareDir = join(root, "origin.git");
  ghCapturePath = join(root, "gh-capture.json");

  // Source repo with an initial commit + a bare origin it can really push to.
  execFileSync("git", ["init", "-b", "main", repoDir], { encoding: "utf8" });
  git(repoDir, "config", "user.email", "t@example.com");
  git(repoDir, "config", "user.name", "T");
  writeFileSync(join(repoDir, "README.md"), "hello\n");
  git(repoDir, "add", ".");
  git(repoDir, "commit", "-m", "init");
  execFileSync("git", ["init", "--bare", "-b", "main", bareDir], { encoding: "utf8" });
  git(repoDir, "remote", "add", "origin", bareDir);
  git(repoDir, "push", "-u", "origin", "main");

  // Stand-in gh: append argv to a capture file, print the create JSON.
  const fakeGh = join(root, "fake-gh.mjs");
  writeFileSync(
    fakeGh,
    [
      "import { appendFileSync } from 'node:fs';",
      "const argv = process.argv.slice(2);",
      "appendFileSync(process.env.GH_CAPTURE, JSON.stringify(argv) + '\\n');",
      "process.stdout.write('https://github.com/o/r/pull/42\\n'); // real gh prints the PR URL",
      "",
    ].join("\n"),
  );
  savedGhEnv = process.env.MYAGENTTOOL_GH_COMMAND_JSON;
  process.env.MYAGENTTOOL_GH_COMMAND_JSON = JSON.stringify(["node", fakeGh]);
  process.env.GH_CAPTURE = ghCapturePath;

  let counter = 0;
  state = { projects: [], worktrees: [], projectTargets: [], currentProjectId: null };
  svc = createProjectService({
    state,
    now: () => new Date().toISOString(),
    nextId: (p) => `${p}_${++counter}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
  });

  const source = svc.addProject({ name: "Repo", path: repoDir, ownerTeamId: "team_a" });
  state.currentProjectId = source.id;
});

after(() => {
  if (savedGhEnv === undefined) delete process.env.MYAGENTTOOL_GH_COMMAND_JSON;
  else process.env.MYAGENTTOOL_GH_COMMAND_JSON = savedGhEnv;
  delete process.env.GH_CAPTURE;
});

test("publishWorktreeBranch pushes the branch to origin and records upstream", async () => {
  const { worktree } = svc.createWorktree({
    projectId: state.currentProjectId,
    name: "feature-x",
    branchName: "issue-7-feature-x",
  });
  // A real change so the branch is meaningfully ahead of main.
  writeFileSync(join(worktree.worktreePath, "feature.txt"), "work\n");
  git(worktree.worktreePath, "add", ".");
  git(worktree.worktreePath, "commit", "-m", "feature work");

  const result = await svc.publishWorktreeBranch(worktree.id);

  assert.equal(result.ok, true);
  assert.equal(result.published, true);
  assert.equal(result.upstream, "origin/issue-7-feature-x");
  // The branch really exists on the bare origin now.
  assert.ok(originBranches(repoDir).includes("issue-7-feature-x"), "branch landed on origin");
  assert.equal(state.worktrees.find((w) => w.id === worktree.id).published, true);
});

test("createWorktreePr publishes if needed, calls gh with base/head, and closes the linked issue", async () => {
  const { worktree } = svc.createWorktree({
    projectId: state.currentProjectId,
    name: "feature-y",
    branchName: "issue-9-feature-y",
    link: { type: "issue", number: 9, title: "Add feature Y", url: "https://github.com/o/r/issues/9", state: "open" },
  });
  writeFileSync(join(worktree.worktreePath, "y.txt"), "y\n");
  git(worktree.worktreePath, "add", ".");
  git(worktree.worktreePath, "commit", "-m", "y work");

  const result = await svc.createWorktreePr(worktree.id, {});

  assert.equal(result.ok, true);
  assert.equal(result.number, 42);
  assert.equal(result.url, "https://github.com/o/r/pull/42");
  assert.equal(result.state, "OPEN");

  // gh was invoked as `pr create --base main --head issue-9-feature-y ...`,
  // and the body carries the "Closes #9" line derived from the issue link.
  const captured = readFileSync(ghCapturePath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const createCall = captured.find((argv) => argv[0] === "pr" && argv[1] === "create");
  assert.ok(createCall, "gh pr create was invoked");
  assert.ok(!createCall.includes("--json"), "real gh pr create has no --json flag (field-pilot finding)");
  const baseIdx = createCall.indexOf("--base");
  assert.equal(createCall[baseIdx + 1], "main");
  const headIdx = createCall.indexOf("--head");
  assert.equal(createCall[headIdx + 1], "issue-9-feature-y");
  const titleIdx = createCall.indexOf("--title");
  assert.equal(createCall[titleIdx + 1], "Add feature Y", "title defaults from the linked issue");
  const bodyIdx = createCall.indexOf("--body");
  assert.match(createCall[bodyIdx + 1], /Closes #9/);
  // The branch was auto-published to origin as part of the PR flow.
  assert.ok(originBranches(repoDir).includes("issue-9-feature-y"), "PR flow published the head branch");
});

test("createWorktreePr is idempotent — an 'already exists' PR is treated as success", async () => {
  const { worktree } = svc.createWorktree({
    projectId: state.currentProjectId,
    name: "feature-dup",
    branchName: "issue-3-feature-dup",
    link: { type: "issue", number: 3, title: "Dup", url: "https://github.com/o/r/issues/3", state: "open" },
  });
  writeFileSync(join(worktree.worktreePath, "d.txt"), "d\n");
  git(worktree.worktreePath, "add", ".");
  git(worktree.worktreePath, "commit", "-m", "d");

  // A gh whose `pr create` fails with the "already exists" URL (a re-published
  // run, or a retry). createWorktreePr should parse the URL and succeed, not fail.
  const conflictGh = join(root, "fake-gh-conflict.mjs");
  writeFileSync(
    conflictGh,
    [
      "const argv = process.argv.slice(2);",
      "if (argv[0] === 'pr' && argv[1] === 'create') {",
      "  process.stderr.write('a pull request for branch \"x\" into branch \"main\" already exists:\\nhttps://github.com/o/r/pull/77\\n');",
      "  process.exit(1);",
      "}",
      "process.stdout.write('https://github.com/o/r/pull/1\\n');",
      "",
    ].join("\n"),
  );
  const saved = process.env.MYAGENTTOOL_GH_COMMAND_JSON;
  process.env.MYAGENTTOOL_GH_COMMAND_JSON = JSON.stringify(["node", conflictGh]);
  try {
    const result = await svc.createWorktreePr(worktree.id, {});
    assert.equal(result.ok, true, "an already-existing PR is not a failure");
    assert.equal(result.number, 77, "the existing PR number is parsed from the error");
    assert.equal(result.url, "https://github.com/o/r/pull/77");
  } finally {
    process.env.MYAGENTTOOL_GH_COMMAND_JSON = saved;
  }
});

test("publishWorktreeBranch surfaces an error instead of silently skipping when there is no origin", async () => {
  // A separate repo with no 'origin' remote.
  const noRemoteRepo = join(root, "no-remote");
  execFileSync("git", ["init", "-b", "main", noRemoteRepo], { encoding: "utf8" });
  git(noRemoteRepo, "config", "user.email", "t@example.com");
  git(noRemoteRepo, "config", "user.name", "T");
  writeFileSync(join(noRemoteRepo, "a.txt"), "a\n");
  git(noRemoteRepo, "add", ".");
  git(noRemoteRepo, "commit", "-m", "init");
  const src = svc.addProject({ name: "NoRemote", path: noRemoteRepo, ownerTeamId: "team_a" });
  const { worktree } = svc.createWorktree({ projectId: src.id, name: "nr", branchName: "nr/branch" });

  await assert.rejects(() => svc.publishWorktreeBranch(worktree.id), /origin/i);
});

test("commitWorktreeChanges commits a dirty worktree, is a no-op on a clean one", async () => {
  const { worktree } = svc.createWorktree({ projectId: state.currentProjectId, name: "commit-me", branchName: "issue-11-commit-me" });

  // Dirty tree → committed, and the branch is now ahead of its base.
  writeFileSync(join(worktree.worktreePath, "new.txt"), "content\n");
  const first = await svc.commitWorktreeChanges(worktree.id, { message: "Auto-run: thing (#11)" });
  assert.equal(first.committed, true);
  assert.equal(first.hasCommits, true);
  const tracked = git(worktree.worktreePath, "ls-tree", "-r", "--name-only", "HEAD").split("\n");
  assert.ok(tracked.includes("new.txt"), "the change is in the commit");
  assert.equal(git(worktree.worktreePath, "log", "-1", "--pretty=%s"), "Auto-run: thing (#11)");

  // Clean tree → nothing committed, but the branch still has the earlier commit.
  const second = await svc.commitWorktreeChanges(worktree.id, { message: "noop" });
  assert.equal(second.committed, false);
  assert.equal(second.hasCommits, true);
});
