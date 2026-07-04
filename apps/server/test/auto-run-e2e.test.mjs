/*
 * End-to-end auto-run orchestration with the REAL project service (real git
 * worktree + real push to a local bare origin) and the REAL verification and
 * status-writeback runners. Only the bridge (agent execution) and gh are faked,
 * since those need external infra. Proves the whole chain wires together:
 *   startAutoRun -> (agent edits) -> completion -> verify -> publish -> open PR
 *   -> status writeback, with the issue branch really landing on origin.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { createProjectService } from "../src/services/projects.mjs";
import { createAutoRunService } from "../src/services/auto-run.mjs";
import { runWorktreeVerification } from "../src/services/worktree-verify.mjs";
import { runIssueStatusTransition } from "../src/services/issue-status.mjs";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}
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
let savedGhEnv;

const agent = { id: "agt_1", name: "Coder", status: "active", location: { type: "local_device", deviceId: "dev" }, adapter: { type: "cli" } };

before(() => {
  root = mkdtempSync(join(tmpdir(), "auto-e2e-"));
  repoDir = join(root, "repo");
  bareDir = join(root, "origin.git");
  ghCapturePath = join(root, "gh-capture.json");

  execFileSync("git", ["init", "-b", "main", repoDir], { encoding: "utf8" });
  git(repoDir, "config", "user.email", "t@example.com");
  git(repoDir, "config", "user.name", "T");
  writeFileSync(join(repoDir, "README.md"), "hello\n");
  git(repoDir, "add", ".");
  git(repoDir, "commit", "-m", "init");
  execFileSync("git", ["init", "--bare", "-b", "main", bareDir], { encoding: "utf8" });
  git(repoDir, "remote", "add", "origin", bareDir);
  git(repoDir, "push", "-u", "origin", "main");

  const fakeGh = join(root, "fake-gh.mjs");
  writeFileSync(
    fakeGh,
    [
      "import { appendFileSync } from 'node:fs';",
      "appendFileSync(process.env.GH_CAPTURE, JSON.stringify(process.argv.slice(2)) + '\\n');",
      "process.stdout.write(JSON.stringify({ number: 50, url: 'https://github.com/o/r/pull/50', state: 'OPEN' }));",
      "",
    ].join("\n"),
  );
  savedGhEnv = process.env.MYAGENTTOOL_GH_COMMAND_JSON;
  process.env.MYAGENTTOOL_GH_COMMAND_JSON = JSON.stringify(["node", fakeGh]);
  process.env.GH_CAPTURE = ghCapturePath;
});

after(() => {
  if (savedGhEnv === undefined) delete process.env.MYAGENTTOOL_GH_COMMAND_JSON;
  else process.env.MYAGENTTOOL_GH_COMMAND_JSON = savedGhEnv;
  delete process.env.GH_CAPTURE;
});

let state;
let projectSvc;
let sourceId;
let statusCalls;
let autoRunSvc;

beforeEach(() => {
  let counter = 0;
  state = { projects: [], worktrees: [], autoRuns: [], projectTargets: [], device: { unlinkState: "linked" }, currentProjectId: null };
  projectSvc = createProjectService({
    state,
    now: () => new Date().toISOString(),
    nextId: (p) => `${p}_${++counter}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
  });
  sourceId = projectSvc.addProject({ name: "Repo", path: repoDir, ownerTeamId: "team_a" }).id;
  state.currentProjectId = sourceId;

  statusCalls = [];
  autoRunSvc = createAutoRunService({
    state,
    now: () => new Date().toISOString(),
    nextId: (p) => `${p}_${++counter}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    createWorktree: projectSvc.createWorktree,
    findAgent: (id) => (id === agent.id ? agent : null),
    defaultAgent: () => agent,
    // Fake bridge: the agent run is represented by an invocation record.
    createInvocation: (task, ag, opts) => ({ id: "inv_e2e", status: "queued", input: { task }, worktreeId: opts?.metadata?.worktreeId ?? null }),
    startInvocationIfAllowed: () => {},
    // REAL commit (the fix: the agent's uncommitted edits are committed here) +
    // REAL publish/PR (real git push to the bare origin + fake gh pr create).
    commitWorktreeChanges: projectSvc.commitWorktreeChanges,
    publishWorktreeBranch: projectSvc.publishWorktreeBranch,
    createWorktreePr: projectSvc.createWorktreePr,
    // REAL verification runner with a trivially-passing command.
    verifyWorktree: async ({ worktree }) => runWorktreeVerification({ cwd: worktree.path, command: ["node", "-e", "process.exit(0)"] }),
    // REAL status transition, capturing gh args instead of hitting GitHub.
    writeIssueStatus: async ({ issueNumber, repoPath, to }) =>
      runIssueStatusTransition({ cwd: repoPath, issueNumber, to, gh: async (args, cwd) => statusCalls.push({ args, cwd }) }),
  });
});

test("full chain: issue -> worktree -> agent edit -> verify -> push -> PR -> status", async () => {
  const link = { type: "issue", number: 50, title: "E2E widget", url: null, state: "open" };
  const { autoRun, worktree, invocation } = autoRunSvc.startAutoRun({
    projectId: sourceId,
    link,
    name: "issue-50-e2e-widget",
    actor: { userId: "usr_x" },
  });

  // The agent edits the worktree but LEAVES IT UNCOMMITTED (the common case).
  // The fix's commit step must pick these up so they reach the PR.
  writeFileSync(join(worktree.worktreePath, "widget.txt"), "built\n");

  // The bridge reports the run succeeded → reaction commits, verifies, publishes, PRs.
  await autoRunSvc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });
  // Let the fire-and-forget status writebacks settle.
  await new Promise((resolve) => setTimeout(resolve, 20));

  // The auto-run reached pr_open with the faked PR number.
  assert.equal(autoRun.status, "pr_open");
  assert.equal(autoRun.prNumber, 50);
  assert.equal(autoRun.verification.verified, true);
  assert.equal(autoRun.verification.passed, true);

  // The issue branch really landed on the bare origin.
  assert.ok(originBranches(repoDir).includes("issue-50-e2e-widget"), "branch pushed to origin");
  // The agent's (uncommitted) edit was committed by the fix and is in the branch.
  const tracked = git(worktree.worktreePath, "ls-tree", "-r", "--name-only", "HEAD").split("\n");
  assert.ok(tracked.includes("widget.txt"), "the agent's edit was committed into the branch");

  // gh pr create was invoked for the issue branch.
  const captured = readFileSync(ghCapturePath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const prCreate = captured.find((argv) => argv[0] === "pr" && argv[1] === "create");
  assert.ok(prCreate, "gh pr create ran");
  assert.equal(prCreate[prCreate.indexOf("--head") + 1], "issue-50-e2e-widget");
  assert.match(prCreate[prCreate.indexOf("--body") + 1], /## Verification/);

  // Status advanced ready -> in-progress (on start) -> review (on PR).
  const transitions = statusCalls.map((c) => c.args.join(" "));
  assert.equal(transitions.length, 2, "two status transitions");
  assert.match(transitions[0], /issue edit 50 .*status\/in-progress/);
  assert.match(transitions[1], /issue edit 50 .*status\/review/);
});
