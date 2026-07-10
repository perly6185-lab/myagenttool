/*
 * Decision-agent pipeline CASE test — the full chain as one continuous story,
 * driving the REAL production services (guards the ISSUE_DECISION_AGENT_PLAN
 * end to end):
 *
 *   [A] an ambiguous issue ("Rework the queue backend") whose title reads as a
 *       change is routed to DESIGN by the decision command (real subprocess) —
 *       correcting the title heuristic; the design run produces findings, no
 *       diff, and spawns a governed pending-decision child issue.
 *   [B] a human approves (labels the child) → the child re-enters as DEVELOP
 *       with the design in its prompt; the agent's uncommitted edit is
 *       committed, verified, pushed to a real bare origin, and a PR opens.
 *   [C] the PR merges → disposition refresh + routing evaluation score the
 *       routing as fully aligned.
 *
 * Real: git repo/worktrees/commits/push, the decision command subprocess, role
 * prompts, the child-issue body, the verification runner, the evaluation.
 * Faked: the bridge agent's edits (files written directly) and gh network
 * calls (stub script / in-memory issue store).
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { createProjectService } from "../src/services/projects.mjs";
import { createAutoRunService } from "../src/services/auto-run.mjs";
import { runDeciderCommand } from "../src/services/decision-command.mjs";
import { runWorktreeVerification } from "../src/services/worktree-verify.mjs";
import { childIssueBody, childIssueTitle } from "../src/services/auto-run-spawn.mjs";
import { summarizeAutoRuns } from "../src/services/auto-run-metrics.mjs";
import { refreshPrDispositions } from "../src/services/auto-run-eval.mjs";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

let root;
let repo;
let savedGhEnv;
let deciderCommand;

// Shared scenario state (the tests tell one continuous story, in order).
let state;
let projectSvc;
let autoRunSvc;
let project;
const events = [];
const prompts = [];
const reports = [];
const statusWrites = [];
const issueStore = new Map();
let caseA; // { autoRun, worktree, invocation } for the ambiguous parent issue
let caseB; // ... for the approved child issue

before(() => {
  root = mkdtempSync(join(tmpdir(), "decision-case-"));
  repo = join(root, "repo");
  const bare = join(root, "origin.git");
  execFileSync("git", ["init", "-b", "main", repo], { encoding: "utf8" });
  git(repo, "config", "user.email", "case@example.com");
  git(repo, "config", "user.name", "Case");
  writeFileSync(join(repo, "queue.mjs"), "export const backend = 'memory'; // slow, single-node\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "init");
  execFileSync("git", ["init", "--bare", "-b", "main", bare], { encoding: "utf8" });
  git(repo, "remote", "add", "origin", bare);
  git(repo, "push", "-u", "origin", "main");

  // Stub gh at the network edge (publish/PR flow still runs the real code).
  const fakeGh = join(root, "fake-gh.mjs");
  writeFileSync(fakeGh, "process.stdout.write('https://github.com/o/r/pull/500\\n');\n");
  savedGhEnv = process.env.MYAGENTTOOL_GH_COMMAND_JSON;
  process.env.MYAGENTTOOL_GH_COMMAND_JSON = JSON.stringify(["node", fakeGh]);

  // The decision agent as it would be deployed: a one-shot command reading the
  // issue context on stdin and printing the contract (prose-wrapped, as LLM
  // CLIs do). Rule-based here; the interface is identical for a real LLM CLI.
  const decider = join(root, "decider.mjs");
  writeFileSync(
    decider,
    [
      'let raw = ""; process.stdin.on("data", (c) => (raw += c));',
      'process.stdin.on("end", () => {',
      "  const { link, issueBody } = JSON.parse(raw);",
      '  const text = (link.title + " " + (issueBody ?? "")).toLowerCase();',
      "  let d;",
      '  if (text.includes("implement:")) {',
      '    d = { path: "develop", spawnChildIssues: false, confidence: 0.95, rationale: "Design attached; scoped change." };',
      '  } else if (text.includes("rework") || text.includes("backend")) {',
      '    d = { path: "design", spawnChildIssues: true, confidence: 0.85, rationale: "Open solution space; needs a design decision." };',
      "  } else {",
      '    d = { path: "develop", spawnChildIssues: false, confidence: 0.8, rationale: "Concrete scoped change." };',
      "  }",
      '  process.stdout.write("Sure! Here is my decision:\\n" + JSON.stringify(d));',
      "});",
      "",
    ].join("\n"),
  );
  deciderCommand = ["node", decider];

  let counter = 0;
  state = { projects: [], worktrees: [], autoRuns: [], projectTargets: [], device: { unlinkState: "linked" }, currentProjectId: null };
  const deps = {
    state,
    now: () => new Date().toISOString(),
    nextId: (p) => `${p}_${++counter}`,
    appendEvent: (e) => events.push(e),
    persistStateSoon: () => {},
  };
  projectSvc = createProjectService(deps);
  project = projectSvc.addProject({ name: "QueueSvc", path: repo, ownerTeamId: "team_a" });
  state.currentProjectId = project.id;

  const agent = { id: "agt_1", name: "Coder", status: "active", location: { type: "local_device", deviceId: "dev" }, adapter: { type: "cli" } };
  autoRunSvc = createAutoRunService({
    ...deps,
    createWorktree: projectSvc.createWorktree,
    findAgent: () => agent,
    defaultAgent: () => agent,
    createInvocation: (task) => {
      prompts.push(task);
      return { id: `inv_${prompts.length}`, status: "queued", input: { task } };
    },
    startInvocationIfAllowed: () => {},
    commitWorktreeChanges: projectSvc.commitWorktreeChanges, // REAL
    publishWorktreeBranch: projectSvc.publishWorktreeBranch, // REAL push
    createWorktreePr: projectSvc.createWorktreePr, // REAL flow, stub gh at the edge
    verifyWorktree: async ({ worktree }) =>
      runWorktreeVerification({
        cwd: worktree.path,
        // A real check against the worktree's code: the queue module must load
        // and export a backend.
        command: [
          "node",
          "--input-type=module",
          "-e",
          "const { backend } = await import(process.cwd() + '/queue.mjs'); process.exit(backend ? 0 : 1);",
        ],
      }),
    decideIssuePath: async ({ link, issueBody }) => runDeciderCommand({ command: deciderCommand, input: { link, issueBody } }),
    fetchIssueBody: async ({ issueNumber }) => issueStore.get(issueNumber) ?? null,
    writeIssueStatus: async ({ issueNumber, to }) => {
      statusWrites.push(`#${issueNumber} -> status/${to}`);
    },
    postIssueReport: async ({ issueNumber, body }) => {
      reports.push({ issueNumber, body });
    },
    spawnChildIssue: async ({ parentLink, design }) => {
      const number = 101;
      issueStore.set(
        number,
        childIssueBody({
          parentLink,
          design,
          projectFieldsBlock: "## Project Fields\n\nMilestone: M3\nStatus: ready\nArea: server",
        }),
      );
      return { number, url: `https://github.com/o/r/issues/${number}` };
    },
  });
});

after(() => {
  if (savedGhEnv === undefined) delete process.env.MYAGENTTOOL_GH_COMMAND_JSON;
  else process.env.MYAGENTTOOL_GH_COMMAND_JSON = savedGhEnv;
});

test("[A] an ambiguous issue is routed to design by the decision command, against its title", async () => {
  issueStore.set(100, "The in-memory queue falls over past one node. We need something durable.\n\n## Project Fields\n\nMilestone: M3\nStatus: ready\nArea: server");
  caseA = await autoRunSvc.startAutoRun({
    projectId: project.id,
    link: { type: "issue", number: 100, title: "Rework the queue backend for scale", url: null, state: "open" },
    name: "issue-100-rework-queue",
  });

  // The real subprocess decided design (the title heuristic would say develop).
  assert.equal(caseA.autoRun.decision.path, "design");
  assert.equal(caseA.autoRun.decision.via, "agent");
  assert.equal(caseA.autoRun.decision.confidence, 0.85);
  assert.equal(typeof caseA.autoRun.decision.latencyMs, "number");

  // The design role prompt forbids implementation and carries the issue body.
  const prompt = prompts.at(-1);
  assert.match(prompt, /^GitHub Issue #100: Rework the queue backend for scale\./);
  assert.match(prompt, /Do NOT implement/);
  assert.match(prompt, /falls over past one node/);
});

test("[A] the design run parks as report_posted and spawns a governed pending-decision child", async () => {
  await autoRunSvc.advanceAutoRunForInvocation({
    ...caseA.invocation,
    status: "succeeded",
    result: {
      summary:
        "Design: adopt Redis Streams.\nOptions: (1) Redis Streams — durable, cheap ops; (2) Kafka — overkill here.\n" +
        "Recommendation: Redis Streams.\nAcceptance: queue survives restart; consumer lag < 1s.",
    },
  });

  assert.equal(caseA.autoRun.status, "report_posted", "a no-diff design run is a success, not blocked");
  assert.deepEqual(caseA.autoRun.childIssues, [{ number: 101, url: "https://github.com/o/r/issues/101" }]);
  assert.ok(reports.some((r) => r.issueNumber === 100), "the design was posted back to the parent issue");

  const child = issueStore.get(101);
  assert.match(child, /A human must review this design/, "the human gate is explicit");
  assert.match(child, /child-of:#100/, "depth-1 marker present");
  assert.match(child, /Status: backlog/, "inherited fields with status forced back to backlog");
  assert.match(child, /Redis Streams/, "the design travels in the child body");
});

test("[B] the approved child re-enters as develop, with the design reaching the agent", async () => {
  // ★ The human decision: review the design, label the child `auto`. Re-entry
  // is exactly what the auto-trigger would do — startAutoRun on the child.
  caseB = await autoRunSvc.startAutoRun({
    projectId: project.id,
    link: { type: "issue", number: 101, title: childIssueTitle({ number: 100, title: "Rework the queue backend for scale" }), url: null, state: "open" },
    name: "issue-101-implement",
  });

  assert.equal(caseB.autoRun.decision.path, "develop");
  assert.equal(caseB.autoRun.isChildIssue, true, "depth-1: the child can never spawn grandchildren");
  assert.match(prompts.at(-1), /Redis Streams/, "the design reaches the implementation prompt");
  assert.match(prompts.at(-1), /implement the change/, "develop role instructions");
});

test("[B] the develop run commits, verifies, pushes to origin, and opens the PR", async () => {
  // The agent edits the worktree and leaves it UNCOMMITTED (the common case).
  writeFileSync(join(caseB.worktree.worktreePath, "queue.mjs"), "export const backend = 'redis-streams'; // durable, survives restart\n");

  await autoRunSvc.advanceAutoRunForInvocation({ ...caseB.invocation, status: "succeeded", result: { summary: "Swapped backend to Redis Streams." } });

  assert.equal(caseB.autoRun.status, "pr_open");
  assert.equal(caseB.autoRun.prNumber, 500);
  assert.equal(caseB.autoRun.verification.verified, true);
  assert.equal(caseB.autoRun.verification.passed, true, "the real verification command ran against the worktree");

  const originBranches = git(repo, "ls-remote", "--heads", "origin");
  assert.match(originBranches, /refs\/heads\/issue-101-implement/, "the branch really landed on origin");
  assert.match(git(caseB.worktree.worktreePath, "show", "HEAD:queue.mjs"), /redis-streams/, "the agent's edit was committed");

  assert.deepEqual(statusWrites, [
    "#100 -> status/in-progress",
    "#100 -> status/review", // design delivered → the parent moves to review (pilot #7)
    "#101 -> status/in-progress",
    "#101 -> status/review",
  ]);
});

test("[C] disposition refresh + routing evaluation score the chain fully aligned", async () => {
  await refreshPrDispositions({ state, fetchPrState: async () => "MERGED" });
  assert.equal(caseB.autoRun.prState, "MERGED");

  const summary = summarizeAutoRuns(state.autoRuns);
  assert.deepEqual(summary.decisions.byPath, { develop: 1, design: 1, prototype: 0, clarify: 0 });
  assert.equal(summary.decisions.byVia.agent, 2, "both decisions came from the real decider subprocess");
  assert.equal(summary.routing.alignmentRate, 1, "design→report and develop→PR: fully aligned routing");
  assert.equal(summary.routing.byPath.develop.prMerged, 1);

  const eventTypes = events.map((e) => e.type);
  for (const expected of ["auto_run_decided", "auto_run_started", "auto_run_child_spawned", "auto_run_status_changed"]) {
    assert.ok(eventTypes.includes(expected), `audit trail includes ${expected}`);
  }
});
