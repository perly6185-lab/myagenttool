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
function makeAutoRun({
  agent = fakeAgent(),
  invocationStatus = "queued",
  publishThrows = false,
  // Verification result (or a throwing function). Default: unverified pass-through.
  verify = { passed: true, verified: false, summary: "No verification command configured." },
} = {}) {
  const calls = { createInvocation: [], startInvocationIfAllowed: [], publish: [], pr: [], verify: [], status: [] };
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
    publishWorktreeBranch: async (worktreeId) => {
      calls.publish.push(worktreeId);
      if (publishThrows) throw new Error("no origin remote");
      return { ok: true };
    },
    createWorktreePr: async (worktreeId, payload) => {
      calls.pr.push({ worktreeId, payload });
      return { ok: true, number: 77, url: "https://github.com/o/r/pull/77", state: "OPEN" };
    },
    verifyWorktree: async (ctx) => {
      calls.verify.push(ctx);
      return typeof verify === "function" ? verify(ctx) : verify;
    },
    writeIssueStatus: async (ctx) => {
      calls.status.push(ctx);
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

test("advanceAutoRunForInvocation publishes and opens a PR when the run succeeds", async () => {
  const { svc, calls } = makeAutoRun();
  const { autoRun, invocation } = svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 20, title: "Ship it", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-20-ship-it",
  });

  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });

  assert.deepEqual(calls.publish, [autoRun.worktreeId], "published the worktree branch");
  assert.equal(calls.pr.length, 1, "opened one PR");
  assert.equal(calls.pr[0].worktreeId, autoRun.worktreeId);
  assert.equal(autoRun.status, "pr_open");
  assert.equal(autoRun.prNumber, 77);
  assert.equal(autoRun.prUrl, "https://github.com/o/r/pull/77");
});

test("advanceAutoRunForInvocation marks the auto-run failed when the run fails", async () => {
  const { svc, calls } = makeAutoRun();
  const { autoRun, invocation } = svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 21, title: "Broken", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-21-broken",
  });

  await svc.advanceAutoRunForInvocation({ ...invocation, status: "failed" });

  assert.equal(autoRun.status, "failed");
  assert.equal(calls.publish.length, 0, "a failed run never publishes");
  assert.equal(calls.pr.length, 0);
});

test("advanceAutoRunForInvocation fails the auto-run (never throws) when publish errors", async () => {
  const { svc, calls } = makeAutoRun({ publishThrows: true });
  const { autoRun, invocation } = svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 22, title: "No remote", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-22-no-remote",
  });

  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });

  assert.equal(autoRun.status, "failed");
  assert.match(autoRun.error, /no origin remote/);
  assert.equal(calls.pr.length, 0, "a failed publish never opens a PR");
});

test("advanceAutoRunForInvocation is idempotent once the PR is open", async () => {
  const { svc, calls } = makeAutoRun();
  const { autoRun, invocation } = svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 23, title: "Once", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-23-once",
  });

  const succeeded = { ...invocation, status: "succeeded" };
  await svc.advanceAutoRunForInvocation(succeeded);
  await svc.advanceAutoRunForInvocation(succeeded);

  assert.equal(autoRun.status, "pr_open");
  assert.equal(calls.pr.length, 1, "a second completion never re-opens the PR");
});

test("verification gate: a passing check opens the PR with verification evidence", async () => {
  const { svc, calls } = makeAutoRun({ verify: { passed: true, verified: true, summary: "`pnpm -s typecheck` passed." } });
  const { autoRun, invocation } = svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 30, title: "Verified", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-30-verified",
  });

  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });

  assert.equal(calls.verify.length, 1, "the gate ran");
  assert.equal(autoRun.status, "pr_open");
  assert.equal(autoRun.verification.passed, true);
  assert.equal(calls.pr.length, 1);
  assert.match(calls.pr[0].payload.body, /## Verification/);
  assert.match(calls.pr[0].payload.body, /passed/);
});

test("verification gate: a failing check blocks the PR", async () => {
  const { svc, calls } = makeAutoRun({ verify: { passed: false, verified: true, summary: "`pnpm -s test` failed (exit 1)." } });
  const { autoRun, invocation } = svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 31, title: "Broken tests", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-31-broken",
  });

  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });

  assert.equal(autoRun.status, "blocked");
  assert.match(autoRun.error, /failed/);
  assert.equal(calls.publish.length, 0, "a blocked run never publishes");
  assert.equal(calls.pr.length, 0, "a blocked run never opens a PR");
});

test("verification gate: an unconfigured gate opens the PR but labels it unverified", async () => {
  const { svc, calls } = makeAutoRun(); // default: verified:false pass-through
  const { autoRun, invocation } = svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 32, title: "No gate", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-32-no-gate",
  });

  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });

  assert.equal(autoRun.status, "pr_open", "unverified still opens a PR (Phase 1 behavior preserved)");
  assert.equal(autoRun.verification.verified, false);
  assert.match(calls.pr[0].payload.body, /not run/);
});

test("verification gate: a throwing verifier blocks the PR (never fabricates a pass)", async () => {
  const { svc, calls } = makeAutoRun({
    verify: () => {
      throw new Error("verifier crashed");
    },
  });
  const { autoRun, invocation } = svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 33, title: "Crash", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-33-crash",
  });

  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });

  assert.equal(autoRun.status, "blocked");
  assert.match(autoRun.error, /verifier crashed/);
  assert.equal(calls.pr.length, 0);
});

test("status writeback: in-progress on start, review when the PR opens (issue links only)", async () => {
  const { svc, calls } = makeAutoRun();
  const { autoRun, invocation, worktree } = svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 40, title: "Track me", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-40-track-me",
  });

  // Started → in-progress.
  assert.equal(calls.status.length, 1);
  assert.deepEqual(
    { to: calls.status[0].to, issueNumber: calls.status[0].issueNumber, repoPath: calls.status[0].repoPath },
    { to: "in-progress", issueNumber: 40, repoPath: worktree.repoPath },
  );

  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });

  // PR opened → review.
  assert.equal(autoRun.status, "pr_open");
  assert.equal(calls.status.length, 2);
  assert.equal(calls.status[1].to, "review");
});

test("status writeback: never fires for a PR-linked auto-run", async () => {
  const { svc, calls } = makeAutoRun();
  const { invocation } = svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "pr", number: 41, title: "A PR", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-41-a-pr",
  });
  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });
  assert.equal(calls.status.length, 0, "PR-linked runs don't move an issue's status");
});

test("status writeback: a rejected start does not mark the issue in-progress", () => {
  const { svc, calls } = makeAutoRun({ invocationStatus: "rejected" });
  svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 44, title: "Rejected", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-44-rejected",
  });
  assert.equal(calls.status.length, 0);
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
