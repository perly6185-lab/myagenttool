/*
 * Phase 1 auto-run orchestrator: turning a linked issue into a worktree AND a
 * started, issue-seeded agent invocation. Uses the real project service (real
 * git worktree) with fake invocation deps so the test stays hermetic while
 * still exercising the true worktree creation + prompt seeding + record wiring.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, beforeEach, test } from "node:test";

import { createProjectService } from "../src/services/projects.mjs";
import { createAutoRunService } from "../src/services/auto-run.mjs";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

let repoDir;
let state;
let projectSvc;
let sourceProjectId;

function fakeAgent(overrides = {}) {
  return {
    id: "agt_1",
    name: "Coder",
    status: "active",
    location: { type: "local_device", deviceId: "dev_1" },
    adapter: { type: "cli" },
    ...overrides,
  };
}

// Build an auto-run service over the real project service, capturing what it
// hands the invocation layer. `invocationStatus` controls the gate outcome.
function makeAutoRun({ agent = fakeAgent(), invocationStatus = "queued" } = {}) {
  const calls = { createInvocation: [], startInvocationIfAllowed: [] };
  let counter = 0;
  const svc = createAutoRunService({
    state,
    now: () => new Date().toISOString(),
    nextId: (p) => `${p}_${++counter}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    createWorktree: projectSvc.createWorktree,
    findAgent: (id) => (agent && agent.id === id ? agent : null),
    defaultAgent: () => agent,
    createInvocation: (task, ag, options) => {
      calls.createInvocation.push({ task, agent: ag, options });
      return {
        id: "inv_fake_1",
        status: invocationStatus,
        input: { task },
        worktreeId: options?.metadata?.worktreeId ?? null,
      };
    },
    startInvocationIfAllowed: (inv, ag) => {
      calls.startInvocationIfAllowed.push({ inv, ag });
    },
  });
  return { svc, calls };
}

before(() => {
  repoDir = mkdtempSync(join(tmpdir(), "auto-run-"));
  execFileSync("git", ["init", "-b", "main", repoDir], { encoding: "utf8" });
  git(repoDir, "config", "user.email", "t@example.com");
  git(repoDir, "config", "user.name", "T");
  writeFileSync(join(repoDir, "README.md"), "hello\n");
  git(repoDir, "add", ".");
  git(repoDir, "commit", "-m", "init");
});

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
  const source = projectSvc.addProject({ name: "Repo", path: repoDir, ownerTeamId: "team_a" });
  sourceProjectId = source.id;
  state.currentProjectId = source.id;
});

test("startAutoRun materializes the worktree and starts an issue-seeded invocation", () => {
  const { svc, calls } = makeAutoRun();
  const link = { type: "issue", number: 12, title: "Add the widget", url: "https://github.com/o/r/issues/12", state: "open" };

  const { autoRun, worktree, invocation } = svc.startAutoRun({
    projectId: sourceProjectId,
    link,
    agentId: "agt_1",
    name: "issue-12-add-the-widget",
    actor: { userId: "usr_x" },
  });

  // Real worktree on the issue branch, carrying the link.
  assert.equal(worktree.branchName, "issue-12-add-the-widget");
  assert.equal(worktree.link.number, 12);
  assert.equal(state.worktrees.length, 1);

  // The invocation was created with the issue-derived prompt, targeting the worktree.
  assert.equal(calls.createInvocation.length, 1);
  const created = calls.createInvocation[0];
  assert.match(created.task, /^Make progress on GitHub Issue #12: Add the widget\./);
  assert.equal(created.options.metadata.worktreeId, worktree.id);
  assert.equal(created.agent.id, "agt_1");
  assert.equal(invocation.input.task, created.task, "invocation carries the seeded prompt");
  assert.equal(calls.startInvocationIfAllowed.length, 1, "the run is actually kicked off");

  // The auto-run record links worktree + invocation and is in the repo project.
  assert.equal(state.autoRuns.length, 1);
  assert.equal(autoRun.status, "running");
  assert.equal(autoRun.worktreeId, worktree.id);
  assert.equal(autoRun.invocationId, "inv_fake_1");
  assert.equal(autoRun.projectId, sourceProjectId);
  assert.equal(autoRun.link.number, 12);
});

test("startAutoRun reflects the local-approval gate instead of bypassing it", () => {
  const { svc } = makeAutoRun({ invocationStatus: "waiting_for_local_approval" });
  const { autoRun } = svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 3, title: "Risky", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-3-risky",
  });
  assert.equal(autoRun.status, "awaiting_approval");
});

test("startAutoRun surfaces a rejected invocation as a failed auto-run", () => {
  const { svc } = makeAutoRun({ invocationStatus: "rejected" });
  const { autoRun } = svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "pr", number: 8, title: "Nope", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-8-nope",
  });
  assert.equal(autoRun.status, "failed");
});

test("startAutoRun validates the link and the device link state", () => {
  const { svc } = makeAutoRun();
  assert.throws(() => svc.startAutoRun({ projectId: sourceProjectId, link: null, agentId: "agt_1" }), /issue or PR link/i);

  state.device.unlinkState = "unlinked";
  const unlinked = makeAutoRun();
  assert.throws(
    () => unlinked.svc.startAutoRun({
      projectId: sourceProjectId,
      link: { type: "issue", number: 1, title: "x", url: null, state: "open" },
      agentId: "agt_1",
    }),
    /unlinked/i,
  );
});
