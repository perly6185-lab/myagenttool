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
  createInvocationThrows = false,
  // Commit result (or a throwing function). Default: something was committed.
  commit = { committed: true, hasCommits: true },
  // Verification result (or a throwing function). Default: unverified pass-through.
  verify = { passed: true, verified: false, summary: "No verification command configured." },
  // Injected decision agent (slice 1). Default undefined -> heuristic floor.
  decideIssuePath = undefined,
  // Injected issue-body fetch (slice 2). Default undefined -> title-only prompts.
  fetchIssueBody = undefined,
  // Injected child-issue spawner (slice 4). Default undefined -> no spawning.
  spawnChildIssue = undefined,
} = {}) {
  const calls = { createInvocation: [], startInvocationIfAllowed: [], commit: [], publish: [], pr: [], verify: [], status: [], report: [] };
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
      if (createInvocationThrows) throw new Error("dispatch exploded");
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
    commitWorktreeChanges: async (worktreeId, opts) => {
      calls.commit.push({ worktreeId, opts });
      return typeof commit === "function" ? commit() : commit;
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
    postIssueReport: async (ctx) => {
      calls.report.push(ctx);
    },
    decideIssuePath,
    fetchIssueBody,
    spawnChildIssue,
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

test("startAutoRun materializes the worktree and starts an issue-seeded invocation", async () => {
  const { svc, calls } = makeAutoRun();
  const link = { type: "issue", number: 12, title: "Add the widget", url: "https://github.com/o/r/issues/12", state: "open" };

  const { autoRun, worktree, invocation } = await svc.startAutoRun({
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
  assert.match(created.task, /^GitHub Issue #12: Add the widget\./);
  assert.match(created.task, /Implement the change/, "develop role instructions seeded");
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

test("startAutoRun reflects the local-approval gate instead of bypassing it", async () => {
  const { svc } = makeAutoRun({ invocationStatus: "waiting_for_local_approval" });
  const { autoRun } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 3, title: "Risky", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-3-risky",
  });
  assert.equal(autoRun.status, "awaiting_approval");
});

test("startAutoRun surfaces a rejected invocation as a failed auto-run", async () => {
  const { svc } = makeAutoRun({ invocationStatus: "rejected" });
  const { autoRun } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "pr", number: 8, title: "Nope", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-8-nope",
  });
  assert.equal(autoRun.status, "failed");
});

test("advanceAutoRunForInvocation publishes and opens a PR when the run succeeds", async () => {
  const { svc, calls } = makeAutoRun();
  const { autoRun, invocation } = await svc.startAutoRun({
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
  const { autoRun, invocation } = await svc.startAutoRun({
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
  const { autoRun, invocation } = await svc.startAutoRun({
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
  const { autoRun, invocation } = await svc.startAutoRun({
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

test("reaction commits the agent's changes before publishing (F1)", async () => {
  const { svc, calls } = makeAutoRun();
  const { invocation, autoRun } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 60, title: "Commit me", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-60-commit-me",
  });
  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });
  assert.equal(calls.commit.length, 1, "changes were committed");
  assert.equal(calls.commit[0].worktreeId, autoRun.worktreeId);
  assert.match(calls.commit[0].opts.message, /#60/, "commit message references the issue");
  assert.equal(calls.publish.length, 1, "then published");
  assert.equal(autoRun.status, "pr_open");
});

test("reaction blocks (no PR) when the agent produced no changes (F1)", async () => {
  const { svc, calls } = makeAutoRun({ commit: { committed: false, hasCommits: false } });
  const { invocation, autoRun } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 61, title: "Did nothing", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-61-nothing",
  });
  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });
  assert.equal(autoRun.status, "blocked");
  assert.match(autoRun.error, /no changes/i);
  assert.equal(calls.publish.length, 0, "an empty run never publishes");
  assert.equal(calls.pr.length, 0);
});

test("startAutoRun records a heuristic decision (path + legacy intent) from the title", async () => {
  const { svc } = makeAutoRun();
  const { autoRun } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 70, title: "Investigate why dispatch stalls", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-70-investigate",
  });
  assert.equal(autoRun.decision.path, "design");
  assert.equal(autoRun.decision.decidedBy, "heuristic");
  assert.ok(autoRun.decision.rationale, "the decision carries a rationale");
  assert.equal(autoRun.intent, "investigation", "legacy intent derived from the path");
});

test("an injected decision agent routes the run and is recorded as evidence", async () => {
  const { svc, calls } = makeAutoRun({
    commit: { committed: false, hasCommits: false },
    decideIssuePath: async () => ({
      path: "design",
      spawnChildIssues: false,
      confidence: 0.9,
      rationale: "Solution space is open; needs a design first.",
    }),
  });
  const { autoRun, invocation } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 74, title: "Add the cache", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-74-agent-decided",
  });
  // Title says "change", but the agent's decision wins.
  assert.equal(autoRun.decision.path, "design");
  assert.equal(autoRun.decision.decidedBy, "agent");
  assert.equal(autoRun.decision.confidence, 0.9);

  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded", result: "Design findings." });
  assert.equal(autoRun.status, "report_posted", "no-diff routed by the agent's path, not the title");
  assert.equal(calls.report.length, 1);
});

test("a low-confidence heavy decision degrades to clarify (questions surface in the report)", async () => {
  const { svc } = makeAutoRun({
    commit: { committed: false, hasCommits: false },
    decideIssuePath: async () => ({
      path: "prototype",
      spawnChildIssues: true,
      confidence: 0.2,
      rationale: "Maybe a spike?",
      clarifyingQuestions: ["Which queue backend is in scope?"],
    }),
  });
  const { autoRun, invocation } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 75, title: "Do the thing", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-75-low-confidence",
  });
  assert.equal(autoRun.decision.path, "clarify", "heavy path below the confidence gate degrades");
  assert.equal(autoRun.decision.spawnChildIssues, false);

  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });
  assert.equal(autoRun.status, "needs_input");
  assert.match(autoRun.report, /Which queue backend is in scope\?/);
});

test("the issue body reaches both the decider and the role prompt", async () => {
  const seenByDecider = [];
  const { svc, calls } = makeAutoRun({
    fetchIssueBody: async ({ issueNumber, repoPath }) => {
      assert.equal(issueNumber, 80);
      assert.ok(repoPath, "fetch gets the source repo path");
      return "## Acceptance\n- [ ] cache hits served";
    },
    decideIssuePath: async ({ link, issueBody }) => {
      seenByDecider.push({ link, issueBody });
      return { path: "develop", confidence: 0.9, rationale: "clear change" };
    },
  });
  const { autoRun } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 80, title: "Add caching", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-80-body",
  });
  assert.match(seenByDecider[0].issueBody, /cache hits served/, "decider sees the body");
  assert.match(calls.createInvocation[0].task, /cache hits served/, "prompt carries the body");
  assert.equal(autoRun.decision.path, "develop");
});

test("a failing body fetch degrades to a title-only prompt (run proceeds)", async () => {
  const { svc, calls } = makeAutoRun({
    fetchIssueBody: async () => {
      throw new Error("gh offline");
    },
  });
  const { autoRun } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 81, title: "Fix the crash", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-81-nobody",
  });
  assert.equal(autoRun.status, "running");
  assert.match(calls.createInvocation[0].task, /^GitHub Issue #81: Fix the crash\./);
  assert.ok(!calls.createInvocation[0].task.includes("description:"), "no body block");
});

test("a design-decided run gets the design role prompt (no implementation)", async () => {
  const { svc, calls } = makeAutoRun({
    decideIssuePath: async () => ({ path: "design", confidence: 0.9, rationale: "open solution space" }),
  });
  await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 82, title: "Rework the queue", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-82-design",
  });
  assert.match(calls.createInvocation[0].task, /Do NOT implement/, "design role instructions");
});

test("a design run spawns a pending-decision child issue and parks (slice 4)", async () => {
  const spawnCalls = [];
  const { svc, calls } = makeAutoRun({
    commit: { committed: false, hasCommits: false },
    decideIssuePath: async () => ({ path: "design", confidence: 0.9, rationale: "open space" }),
    spawnChildIssue: async (ctx) => {
      spawnCalls.push(ctx);
      return { number: 90, url: "https://github.com/o/r/issues/90" };
    },
  });
  const { autoRun, invocation } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 89, title: "Rework the queue", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-89-design-spawn",
  });

  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded", result: "Design: use Redis." });

  assert.equal(autoRun.status, "report_posted", "parent parks as report_posted");
  assert.deepEqual(autoRun.childIssues, [{ number: 90, url: "https://github.com/o/r/issues/90" }]);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].parentLink.number, 89);
  assert.match(spawnCalls[0].design, /use Redis/);
  assert.ok(spawnCalls[0].repoPath, "spawner gets the repo path");
  assert.equal(calls.pr.length, 0, "no PR from a design run");
});

test("depth-1: a run on a spawned child issue never spawns grandchildren", async () => {
  const spawnCalls = [];
  const { svc } = makeAutoRun({
    commit: { committed: false, hasCommits: false },
    decideIssuePath: async () => ({ path: "design", confidence: 0.9, rationale: "r" }),
    // The issue body identifies this issue as a spawned child.
    fetchIssueBody: async () => "Design...\n<!-- myagent:autorun:child-of:#89 -->\n## Project Fields\nMilestone: M3",
    spawnChildIssue: async (ctx) => {
      spawnCalls.push(ctx);
      return { number: 91, url: null };
    },
  });
  const { autoRun, invocation } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 90, title: "Implement: Rework the queue", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-90-child",
  });
  assert.equal(autoRun.isChildIssue, true);

  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });

  assert.equal(spawnCalls.length, 0, "a child issue never spawns");
  assert.equal(autoRun.status, "report_posted");
});

test("one child per parent issue: a second design run does not respawn", async () => {
  let spawned = 0;
  const opts = {
    commit: { committed: false, hasCommits: false },
    decideIssuePath: async () => ({ path: "design", confidence: 0.9, rationale: "r" }),
    spawnChildIssue: async () => {
      spawned += 1;
      return { number: 92, url: null };
    },
  };
  const { svc } = makeAutoRun(opts);
  const link = { type: "issue", number: 93, title: "Rework storage", url: null, state: "open" };
  const first = await svc.startAutoRun({ projectId: sourceProjectId, link, agentId: "agt_1", name: "issue-93-a" });
  await svc.advanceAutoRunForInvocation({ ...first.invocation, status: "succeeded" });
  assert.equal(spawned, 1);

  const second = await svc.startAutoRun({ projectId: sourceProjectId, link, agentId: "agt_1", name: "issue-93-b" });
  await svc.advanceAutoRunForInvocation({ ...second.invocation, status: "succeeded" });
  assert.equal(spawned, 1, "dedup: the parent already has a child");
});

test("a failing spawner still parks the run as report_posted (best-effort)", async () => {
  const { svc } = makeAutoRun({
    commit: { committed: false, hasCommits: false },
    decideIssuePath: async () => ({ path: "design", confidence: 0.9, rationale: "r" }),
    spawnChildIssue: async () => {
      throw new Error("gh not authenticated");
    },
  });
  const { autoRun, invocation } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 94, title: "Rework auth", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-94-spawnfail",
  });
  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });
  assert.equal(autoRun.status, "report_posted");
  assert.match(autoRun.spawnError, /gh not authenticated/);
  assert.equal(autoRun.childIssues, undefined);
});

test("a broken decision agent falls back to the heuristic (run never fails)", async () => {
  const { svc } = makeAutoRun({
    decideIssuePath: async () => {
      throw new Error("decider exploded");
    },
  });
  const { autoRun } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 76, title: "Fix the crash", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-76-fallback",
  });
  assert.equal(autoRun.decision.decidedBy, "heuristic");
  assert.equal(autoRun.decision.path, "develop");
  assert.equal(autoRun.status, "running");
});

test("no-diff investigation posts a report and succeeds (not blocked)", async () => {
  const { svc, calls } = makeAutoRun({ commit: { committed: false, hasCommits: false } });
  const { autoRun, invocation } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 71, title: "Research queue backends", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-71-research",
  });
  assert.equal(autoRun.intent, "investigation");

  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded", result: { summary: "Findings: Redis fits; Postgres is simpler." } });

  assert.equal(autoRun.status, "report_posted", "investigation with findings is a success, not a dead-end");
  assert.match(autoRun.report, /Findings: Redis fits/);
  assert.equal(calls.report.length, 1, "the findings were posted back to the issue");
  assert.equal(calls.report[0].issueNumber, 71);
  assert.equal(calls.publish.length, 0, "no PR for an investigation with no diff");
});

test("no-diff question routes to needs_input (hands uncertainty back to a human)", async () => {
  const { svc, calls } = makeAutoRun({ commit: { committed: false, hasCommits: false } });
  const { autoRun, invocation } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 72, title: "Should we drop the loop engine?", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-72-question",
  });
  assert.equal(autoRun.intent, "question");

  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded", result: "Two viable paths; needs a product call." });

  assert.equal(autoRun.status, "needs_input");
  assert.match(autoRun.report, /Two viable paths/);
  assert.equal(calls.pr.length, 0);
});

test("no-diff change is still blocked (a change that produced nothing)", async () => {
  const { svc } = makeAutoRun({ commit: { committed: false, hasCommits: false } });
  const { autoRun, invocation } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 73, title: "Add a cache to the ledger", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-73-change",
  });
  assert.equal(autoRun.intent, "change");
  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });
  assert.equal(autoRun.status, "blocked");
});

test("reaction fails when the commit itself errors (F1)", async () => {
  const { svc, calls } = makeAutoRun({ commit: () => { throw new Error("no git identity"); } });
  const { invocation, autoRun } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 62, title: "Bad commit", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-62-bad",
  });
  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });
  assert.equal(autoRun.status, "failed");
  assert.match(autoRun.error, /Commit failed/);
  assert.equal(calls.publish.length, 0);
});

test("startAutoRun records the auto-run even if the invocation fails to start (F2)", async () => {
  const { svc } = makeAutoRun({ createInvocationThrows: true });
  await assert.rejects(
    () => svc.startAutoRun({
      projectId: sourceProjectId,
      link: { type: "issue", number: 63, title: "Dispatch dies", url: null, state: "open" },
      agentId: "agt_1",
      name: "issue-63-dispatch",
    }),
    /dispatch exploded/,
  );
  // The dedup record exists (status failed), so auto-trigger won't re-pick #63.
  assert.equal(state.autoRuns.length, 1);
  assert.equal(state.autoRuns[0].link.number, 63);
  assert.equal(state.autoRuns[0].status, "failed");
});

test("verification gate: a passing check opens the PR with verification evidence", async () => {
  const { svc, calls } = makeAutoRun({ verify: { passed: true, verified: true, summary: "`pnpm -s typecheck` passed." } });
  const { autoRun, invocation } = await svc.startAutoRun({
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
  const { autoRun, invocation } = await svc.startAutoRun({
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
  const { autoRun, invocation } = await svc.startAutoRun({
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
  const { autoRun, invocation } = await svc.startAutoRun({
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
  const { autoRun, invocation, worktree } = await svc.startAutoRun({
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
  const { invocation } = await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "pr", number: 41, title: "A PR", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-41-a-pr",
  });
  await svc.advanceAutoRunForInvocation({ ...invocation, status: "succeeded" });
  assert.equal(calls.status.length, 0, "PR-linked runs don't move an issue's status");
});

test("status writeback: a rejected start does not mark the issue in-progress", async () => {
  const { svc, calls } = makeAutoRun({ invocationStatus: "rejected" });
  await svc.startAutoRun({
    projectId: sourceProjectId,
    link: { type: "issue", number: 44, title: "Rejected", url: null, state: "open" },
    agentId: "agt_1",
    name: "issue-44-rejected",
  });
  assert.equal(calls.status.length, 0);
});

test("startAutoRun validates the link and the device link state", async () => {
  const { svc } = makeAutoRun();
  await assert.rejects(() => svc.startAutoRun({ projectId: sourceProjectId, link: null, agentId: "agt_1" }), /issue or PR link/i);

  state.device.unlinkState = "unlinked";
  const unlinked = makeAutoRun();
  await assert.rejects(
    () => unlinked.svc.startAutoRun({
      projectId: sourceProjectId,
      link: { type: "issue", number: 1, title: "x", url: null, state: "open" },
      agentId: "agt_1",
    }),
    /unlinked/i,
  );
});
