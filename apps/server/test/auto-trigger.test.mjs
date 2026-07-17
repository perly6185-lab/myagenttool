/*
 * Phase 3 auto-trigger: selecting which labeled issues to auto-run (dedup +
 * per-project concurrency), and the scan runtime that calls startAutoRun. Pure
 * selector + injected fakes — no gh, no server.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createAutoTriggerRuntime,
  issueRequirements,
  parseWorkerProfiles,
  planDispatch,
  resolveAutoTriggerConfig,
  scoreWorkers,
  selectAutoTriggerCandidates,
} from "../src/services/auto-trigger.mjs";

test("resolveAutoTriggerConfig is off by default and reads the env opt-in", () => {
  // #1165 dispatch defaults ride along: standalone role = today's behavior.
  const dispatchDefaults = { dispatchRole: "standalone", serverId: null, dispatchWorkers: [], dispatchWorkerCap: 2, dispatchAssignTtlMinutes: 120, dispatchTtlEnabled: false, dispatchWorkerProfiles: null };
  assert.deepEqual(resolveAutoTriggerConfig({}), { enabled: false, label: "auto", maxConcurrent: 1, requireProjectFields: true, ...dispatchDefaults });
  const on = resolveAutoTriggerConfig({
    MYAGENTTOOL_AUTOTRIGGER_ENABLED: "1",
    MYAGENTTOOL_AUTOTRIGGER_LABEL: "agent-ready",
    MYAGENTTOOL_AUTOTRIGGER_MAX_CONCURRENT: "3",
  });
  assert.deepEqual(on, { enabled: true, label: "agent-ready", maxConcurrent: 3, requireProjectFields: true, ...dispatchDefaults });
  // Cap is clamped into [1,10].
  assert.equal(resolveAutoTriggerConfig({ MYAGENTTOOL_AUTOTRIGGER_MAX_CONCURRENT: "999" }).maxConcurrent, 10);
  assert.equal(resolveAutoTriggerConfig({ MYAGENTTOOL_AUTOTRIGGER_MAX_CONCURRENT: "0" }).maxConcurrent, 1);
  // Project-fields requirement can be opted out.
  assert.equal(resolveAutoTriggerConfig({ MYAGENTTOOL_AUTOTRIGGER_REQUIRE_PROJECT_FIELDS: "0" }).requireProjectFields, false);
});

test("selectAutoTriggerCandidates requires Project Fields by default, and can opt out", () => {
  const issues = [
    { number: 1, title: "no fields", state: "open", body: "just a description" },
    { number: 2, title: "has fields", state: "open", body: "## Project Fields\nMilestone: M3" },
  ];
  const withGate = selectAutoTriggerCandidates({ issues, autoRuns: [], projectId: "prj", maxConcurrent: 5 });
  assert.deepEqual(withGate.map((i) => i.number), [2], "only the Project-Fields issue is eligible");

  const noGate = selectAutoTriggerCandidates({ issues, autoRuns: [], projectId: "prj", maxConcurrent: 5, requireProjectFields: false });
  assert.deepEqual(noGate.map((i) => i.number), [1, 2], "opt-out selects both");
});

test("selectAutoTriggerCandidates skips already-handled issues and honors the cap", () => {
  const issues = [
    { number: 1, title: "one", state: "open" },
    { number: 2, title: "two", state: "open" },
    { number: 3, title: "three", state: "open" },
  ];
  const autoRuns = [{ projectId: "prj", link: { number: 1 }, status: "running" }]; // #1 handled + active
  const selected = selectAutoTriggerCandidates({ issues, autoRuns, projectId: "prj", maxConcurrent: 2, requireProjectFields: false });
  // #1 handled → skip; one active run + cap 2 → headroom 1 → only #2.
  assert.deepEqual(selected.map((i) => i.number), [2]);
});

test("selectAutoTriggerCandidates ignores closed issues and settled runs don't consume headroom", () => {
  const issues = [
    { number: 5, title: "closed", state: "closed" },
    { number: 6, title: "open", state: "open" },
  ];
  const autoRuns = [{ projectId: "prj", link: { number: 9 }, status: "pr_open" }]; // settled, not active
  const selected = selectAutoTriggerCandidates({ issues, autoRuns, projectId: "prj", maxConcurrent: 1, requireProjectFields: false });
  assert.deepEqual(selected.map((i) => i.number), [6], "closed skipped; #6 within headroom");
});

test("selectAutoTriggerCandidates never re-triggers an issue with a settled (e.g. blocked) run", () => {
  const issues = [{ number: 7, title: "was blocked", state: "open" }];
  const autoRuns = [{ projectId: "prj", link: { number: 7 }, status: "blocked" }];
  const selected = selectAutoTriggerCandidates({ issues, autoRuns, projectId: "prj", maxConcurrent: 5, requireProjectFields: false });
  assert.deepEqual(selected, [], "a blocked issue is not respawned");
});

function makeState() {
  return {
    projects: [
      { id: "prj_repo", source: "user", defaultAgentId: "agt_claude" },
      { id: "prj_wt", source: "worktree" },
      { id: "prj_norepo", source: "user" },
    ],
    projectTargets: [{ projectId: "prj_repo", state: "ready" }],
    autoRuns: [],
  };
}

test("scanOnce is a no-op when disabled", async () => {
  const started = [];
  const runtime = createAutoTriggerRuntime({
    state: makeState(),
    config: { enabled: false, label: "auto", maxConcurrent: 1 },
    listLabeledIssues: async () => [{ number: 1, title: "x", state: "open" }],
    startAutoRun: (arg) => started.push(arg),
  });
  const result = await runtime.scanOnce();
  assert.deepEqual(result, { enabled: false, scanned: 0, started: 0, assigned: 0 });
  assert.equal(started.length, 0);
});

test("scanOnce starts auto-runs only for ready repo-backed projects, with issue-derived branch names", async () => {
  const state = makeState();
  const started = [];
  const listedFor = [];
  const runtime = createAutoTriggerRuntime({
    state,
    config: { enabled: true, label: "auto", maxConcurrent: 5, requireProjectFields: false },
    listLabeledIssues: async (project) => {
      listedFor.push(project.id);
      return [{ number: 42, title: "Add the Widget", url: "u", state: "open" }];
    },
    startAutoRun: (arg) => started.push(arg),
  });

  const result = await runtime.scanOnce();

  // Only prj_repo (ready + non-worktree) is scanned.
  assert.deepEqual(listedFor, ["prj_repo"]);
  assert.equal(result.started, 1);
  assert.equal(started.length, 1);
  assert.equal(started[0].projectId, "prj_repo");
  assert.equal(started[0].link.number, 42);
  assert.equal(started[0].name, "issue-42-add-the-widget", "branch name from the shared helper");
  assert.equal(started[0].agentId, "agt_claude", "the project's configured agent is used, not the demo default");
});

test("scanOnce keeps going when one project's issue list or a startAutoRun throws", async () => {
  const state = makeState();
  state.projectTargets.push({ projectId: "prj_norepo", state: "ready" });
  const started = [];
  const runtime = createAutoTriggerRuntime({
    state,
    config: { enabled: true, label: "auto", maxConcurrent: 5, requireProjectFields: false },
    listLabeledIssues: async (project) => {
      if (project.id === "prj_norepo") throw new Error("gh failed");
      return [{ number: 1, title: "ok", state: "open" }];
    },
    startAutoRun: () => started.push(1),
    log: () => {},
  });
  const result = await runtime.scanOnce();
  assert.equal(result.scanned, 2, "both ready projects scanned");
  assert.equal(result.started, 1, "the failing project is skipped, the other still runs");
});

// ── #1165 dispatch mode ───────────────────────────────────────────────────────

test("#1165 config parses dispatch role, server id, worker list, caps", () => {
  const cfg = resolveAutoTriggerConfig({
    MYAGENTTOOL_AUTOTRIGGER_DISPATCH_ROLE: "dispatcher",
    MYAGENTTOOL_AUTOTRIGGER_SERVER_ID: "desk",
    MYAGENTTOOL_AUTOTRIGGER_WORKERS: "desk, laptop ,office",
    MYAGENTTOOL_AUTOTRIGGER_WORKER_CAP: "3",
    MYAGENTTOOL_AUTOTRIGGER_ASSIGN_TTL_MINUTES: "60",
  });
  assert.equal(cfg.dispatchRole, "dispatcher");
  assert.equal(cfg.serverId, "desk");
  assert.deepEqual(cfg.dispatchWorkers, ["desk", "laptop", "office"]);
  assert.equal(cfg.dispatchWorkerCap, 3);
  assert.equal(cfg.dispatchAssignTtlMinutes, 60);
  assert.equal(resolveAutoTriggerConfig({ MYAGENTTOOL_AUTOTRIGGER_DISPATCH_ROLE: "bogus" }).dispatchRole, "standalone");
});

test("#1165 a worker only selects issues assigned to it", () => {
  const issues = [
    { number: 1, title: "mine", state: "open", labels: ["auto", "assigned/laptop"] },
    { number: 2, title: "theirs", state: "open", labels: ["auto", "assigned/office"] },
    { number: 3, title: "unassigned", state: "open", labels: ["auto"] },
  ];
  const mine = selectAutoTriggerCandidates({ issues, autoRuns: [], projectId: "prj", maxConcurrent: 5, requireProjectFields: false, assignedTo: "laptop" });
  assert.deepEqual(mine.map((i) => i.number), [1], "foreign and unassigned issues are never picked up");
  // No filter (standalone) selects everything, unchanged.
  const all = selectAutoTriggerCandidates({ issues, autoRuns: [], projectId: "prj", maxConcurrent: 5, requireProjectFields: false });
  assert.deepEqual(all.map((i) => i.number), [1, 2, 3]);
});

const T0 = "2026-07-16T12:00:00.000Z";

test("#1165 planDispatch assigns least-loaded round-robin under per-worker caps", () => {
  const issues = [
    // #99 is a's live open assignment — present in the listing (else #1169's
    // settle-on-absence would rightly free that load).
    { number: 99, title: "held", state: "open", labels: ["auto", "assigned/a"] },
    ...[1, 2, 3, 4, 5].map((n) => ({ number: n, title: `t${n}`, state: "open", labels: ["auto"] })),
  ];
  const assignments = [{ projectId: "prj", issueNumber: 99, workerId: "a", status: "open", assignedAt: T0 }];
  const plan = planDispatch({ issues, assignments, projectId: "prj", workers: ["a", "b"], workerCap: 2, requireProjectFields: false, nowIso: T0 });
  // a already carries one open assignment → b, a, b fill to the caps; 2 remain unassigned.
  assert.deepEqual(plan.assign.map((x) => `${x.issue.number}:${x.workerId}`), ["1:b", "2:a", "3:b"]);
  assert.equal(plan.reassign.length, 0);
});

test("#1165 planDispatch never touches in-progress or already-labeled issues (fresh), and respects foreign labels", () => {
  const issues = [
    { number: 1, title: "working", state: "open", labels: ["auto", "assigned/a", "status/in-progress"] },
    { number: 2, title: "assigned-fresh", state: "open", labels: ["auto", "assigned/a"] },
    { number: 3, title: "label-no-record", state: "open", labels: ["auto", "assigned/ghost"] },
    { number: 4, title: "free", state: "open", labels: ["auto"] },
  ];
  const assignments = [{ projectId: "prj", issueNumber: 2, workerId: "a", status: "open", assignedAt: T0 }];
  const plan = planDispatch({ issues, assignments, projectId: "prj", workers: ["a", "b"], workerCap: 2, requireProjectFields: false, ttlMinutes: 120, nowIso: T0 });
  assert.deepEqual(plan.assign.map((x) => x.issue.number), [4], "only the free issue is assigned");
  assert.equal(plan.reassign.length, 0, "fresh assignments and foreign labels are left alone");
});

test("#1165 planDispatch reassigns a stale assignment (TTL passed, no in-progress) to another worker", () => {
  const issues = [{ number: 7, title: "stalled", state: "open", labels: ["auto", "assigned/a"] }];
  const assignments = [{ projectId: "prj", issueNumber: 7, workerId: "a", status: "open", assignedAt: "2026-07-16T08:00:00.000Z" }];
  const plan = planDispatch({ issues, assignments, projectId: "prj", workers: ["a", "b"], workerCap: 2, requireProjectFields: false, ttlMinutes: 120, nowIso: T0 });
  assert.equal(plan.assign.length, 0);
  assert.equal(plan.reassign.length, 1);
  assert.equal(plan.reassign[0].from, "a");
  assert.equal(plan.reassign[0].to, "b", "prefers a different worker");

  // In-progress protects a stale-by-clock assignment from reassignment.
  const working = [{ number: 7, title: "stalled", state: "open", labels: ["auto", "assigned/a", "status/in-progress"] }];
  const guarded = planDispatch({ issues: working, assignments, projectId: "prj", workers: ["a", "b"], workerCap: 2, requireProjectFields: false, ttlMinutes: 120, nowIso: T0 });
  assert.equal(guarded.reassign.length, 0);
});

test("#1165 dispatcher runtime assigns via labels + bookkeeping and never starts foreign work; a self-worker dispatcher works its own", async () => {
  const state = {
    projects: [{ id: "prj", name: "P", source: "default", defaultAgentId: undefined }],
    projectTargets: [{ projectId: "prj", state: "ready", rootPath: "/repo" }],
    autoRuns: [],
    dispatchAssignments: [],
    events: [],
  };
  const labelEdits = [];
  const startedRuns = [];
  const issues = [
    { number: 1, title: "one", state: "open", labels: ["auto"] },
    { number: 2, title: "two", state: "open", labels: ["auto", "assigned/desk"] },
  ];
  const runtime = createAutoTriggerRuntime({
    state,
    config: {
      enabled: true, label: "auto", maxConcurrent: 5, requireProjectFields: false,
      dispatchRole: "dispatcher", serverId: "desk", dispatchWorkers: ["desk", "laptop"], dispatchWorkerCap: 2, dispatchAssignTtlMinutes: 120,
    },
    listLabeledIssues: async () => issues,
    startAutoRun: async (args) => { startedRuns.push(args); return {}; },
    editIssueLabels: async (project, edit) => labelEdits.push(edit),
    appendEvent: () => {},
    persistStateSoon: () => {},
  });

  const result = await runtime.scanOnce();
  // #1 was free → assigned to the least-loaded worker (laptop: desk already has #2 by label? —
  // no record for #2, so load counts records only → both 0 → first in list, desk... but #2 has
  // an assigned label and is skipped from assignment; #1 goes to the first least-loaded: desk.
  assert.equal(result.assigned, 1);
  assert.equal(labelEdits.length, 1);
  assert.equal(labelEdits[0].issueNumber, 1);
  assert.match(labelEdits[0].add[0], /^assigned\//);
  // Two rows: the fresh assignment of #1, plus #1169's adoption of #2's
  // pre-existing assigned/desk label (ours, but had no record).
  assert.equal(state.dispatchAssignments.length, 2, "assignment + adopted rows recorded");
  // The dispatcher's own id is in the worker list → it starts ONLY the issue
  // already assigned to it (#2), never the freshly-assigned-elsewhere or free ones.
  assert.deepEqual(startedRuns.map((r) => r.link.number), [2]);
});

test("#1165 a pure dispatcher (not in the worker list) starts nothing", async () => {
  const state = {
    projects: [{ id: "prj", name: "P", source: "default" }],
    projectTargets: [{ projectId: "prj", state: "ready", rootPath: "/repo" }],
    autoRuns: [],
    dispatchAssignments: [],
  };
  const startedRuns = [];
  const runtime = createAutoTriggerRuntime({
    state,
    config: {
      enabled: true, label: "auto", maxConcurrent: 5, requireProjectFields: false,
      dispatchRole: "dispatcher", serverId: "hub", dispatchWorkers: ["laptop"], dispatchWorkerCap: 2, dispatchAssignTtlMinutes: 120,
    },
    listLabeledIssues: async () => [{ number: 5, title: "x", state: "open", labels: ["auto", "assigned/hub"] }],
    startAutoRun: async (args) => { startedRuns.push(args); return {}; },
    editIssueLabels: async () => {},
  });
  await runtime.scanOnce();
  assert.equal(startedRuns.length, 0, "assignment-only role; execution belongs to workers");
});

// ── #1169 dispatch lifecycle hardening ───────────────────────────────────────

test("#1169 settle-on-absence: a closed issue's record settles and frees the worker's load", () => {
  // Worker a is "full" with two records, but both issues are gone from the
  // open listing (closed) — without settle-on-absence dispatch starves forever.
  const assignments = [
    { projectId: "prj", issueNumber: 1, workerId: "a", status: "open", assignedAt: T0 },
    { projectId: "prj", issueNumber: 2, workerId: "a", status: "open", assignedAt: T0 },
  ];
  const issues = [{ number: 3, title: "new", state: "open", labels: ["auto"] }];
  const plan = planDispatch({ issues, assignments, projectId: "prj", workers: ["a"], workerCap: 2, requireProjectFields: false, nowIso: T0 });
  assert.equal(plan.settle.length, 2, "both finished assignments settle");
  assert.deepEqual(plan.assign.map((x) => `${x.issue.number}:${x.workerId}`), ["3:a"], "freed load is assignable the same tick");
});

test("#1169 TTL reassignment requires the progress signal to exist (ttlEnabled) and respects status/review", () => {
  const staleAssignments = [{ projectId: "prj", issueNumber: 7, workerId: "a", status: "open", assignedAt: "2026-07-16T08:00:00.000Z" }];
  const issue = { number: 7, title: "long run", state: "open", labels: ["auto", "assigned/a"] };

  // Writeback off → no signal exists → a healthy long run is NOT "stale".
  const gated = planDispatch({ issues: [issue], assignments: staleAssignments, projectId: "prj", workers: ["a", "b"], workerCap: 2, requireProjectFields: false, ttlMinutes: 120, ttlEnabled: false, nowIso: T0 });
  assert.equal(gated.reassign.length, 0, "no progress signal → no staleness verdict → no duplicate run");

  // status/review protects like in-progress (review REMOVES in-progress).
  const inReview = { ...issue, labels: ["auto", "assigned/a", "status/review"] };
  const reviewed = planDispatch({ issues: [inReview], assignments: staleAssignments, projectId: "prj", workers: ["a", "b"], workerCap: 2, requireProjectFields: false, ttlMinutes: 120, ttlEnabled: true, nowIso: T0 });
  assert.equal(reviewed.reassign.length, 0, "an issue in human review is never reassigned");
});

test("#1169 an actively claimed issue is never dispatched", () => {
  const issues = [{ number: 9, title: "human's", state: "open", labels: ["auto"] }];
  const issueClaims = [{ projectId: "prj", issueNumber: 9, status: "active", leaseExpiresAt: "2026-07-17T00:00:00.000Z" }];
  const plan = planDispatch({ issues, issueClaims, assignments: [], projectId: "prj", workers: ["a"], workerCap: 2, requireProjectFields: false, nowIso: T0 });
  assert.equal(plan.assign.length, 0, "a person holds it — dispatch keeps hands off");
});

test("#1169 our own stranded label is adopted (record + load), foreign labels stay respected", () => {
  const issues = [
    { number: 1, title: "ours", state: "open", labels: ["auto", "assigned/a"] },     // ours, no record → adopt
    { number: 2, title: "foreign", state: "open", labels: ["auto", "assigned/ghost"] }, // unknown id → respect
    { number: 3, title: "free", state: "open", labels: ["auto"] },
  ];
  const plan = planDispatch({ issues, assignments: [], projectId: "prj", workers: ["a"], workerCap: 2, requireProjectFields: false, nowIso: T0 });
  assert.equal(plan.adopt.length, 1);
  assert.equal(plan.adopt[0].record.workerId, "a");
  // Adopted record counts toward a's load: cap 2 → one slot left → #3 assigned.
  assert.deepEqual(plan.assign.map((x) => `${x.issue.number}:${x.workerId}`), ["3:a"]);
});

test("#1169 a stale assignment never returns to its own worker (no add+remove-same-label churn)", () => {
  const issues = [{ number: 7, title: "stalled", state: "open", labels: ["auto", "assigned/a"] }];
  const assignments = [{ projectId: "prj", issueNumber: 7, workerId: "a", status: "open", assignedAt: "2026-07-16T08:00:00.000Z" }];
  // b is at cap → nobody else has room → the assignment stays put.
  const others = [
    { projectId: "prj", issueNumber: 11, workerId: "b", status: "open", assignedAt: T0 },
    { projectId: "prj", issueNumber: 12, workerId: "b", status: "open", assignedAt: T0 },
  ];
  const blocked = [
    { number: 11, title: "x", state: "open", labels: ["auto", "assigned/b"] },
    { number: 12, title: "y", state: "open", labels: ["auto", "assigned/b"] },
    ...issues,
  ];
  const plan = planDispatch({ issues: blocked, assignments: [...assignments, ...others], projectId: "prj", workers: ["a", "b"], workerCap: 2, requireProjectFields: false, ttlMinutes: 120, ttlEnabled: true, nowIso: T0 });
  assert.equal(plan.reassign.length, 0, "waits for room elsewhere instead of self-reassigning");
});

test("#1169 dispatcher runtime applies settle + adopt bookkeeping without gh writes", async () => {
  const state = {
    projects: [{ id: "prj", name: "P", source: "default" }],
    projectTargets: [{ projectId: "prj", state: "ready", rootPath: "/repo" }],
    autoRuns: [],
    issueClaims: [],
    dispatchAssignments: [
      { projectId: "prj", issueNumber: 1, workerId: "a", status: "open", assignedAt: T0 }, // issue gone → settle
    ],
    events: [],
  };
  const labelEdits = [];
  const runtime = createAutoTriggerRuntime({
    state,
    config: {
      enabled: true, label: "auto", maxConcurrent: 5, requireProjectFields: false,
      dispatchRole: "dispatcher", serverId: "hub", dispatchWorkers: ["a"], dispatchWorkerCap: 2, dispatchAssignTtlMinutes: 120, dispatchTtlEnabled: false,
    },
    listLabeledIssues: async () => [{ number: 5, title: "stranded", state: "open", labels: ["auto", "assigned/a"] }],
    startAutoRun: async () => ({}),
    editIssueLabels: async (project, edit) => labelEdits.push(edit),
    appendEvent: () => {},
    persistStateSoon: () => {},
  });
  await runtime.scanOnce();
  assert.equal(labelEdits.length, 0, "settle and adopt are bookkeeping-only");
  assert.equal(state.dispatchAssignments.find((r) => r.issueNumber === 1).status, "completed", "absent issue settled");
  const adopted = state.dispatchAssignments.find((r) => r.issueNumber === 5);
  assert.equal(adopted?.status, "open");
  assert.equal(adopted?.adopted, true, "stranded label adopted into bookkeeping");
});

// ── #1172 R1: capability-aware routing ───────────────────────────────────────

test("#1172 WORKERS_JSON parses profiles, derives the worker list, and falls back loudly on garbage", () => {
  const cfg = resolveAutoTriggerConfig({
    MYAGENTTOOL_AUTOTRIGGER_WORKERS_JSON: JSON.stringify([
      { id: "desk", platform: "macos", areas: ["server", "web"], agents: ["cli"], maxRisk: "high" },
      { id: "office" },
    ]),
    MYAGENTTOOL_AUTOTRIGGER_WORKERS: "ignored,list",
  });
  assert.deepEqual(cfg.dispatchWorkers, ["desk", "office"], "worker ids derive from profiles; the plain list is ignored");
  assert.equal(cfg.dispatchWorkerProfiles[0].maxRisk, "high");
  assert.deepEqual(cfg.dispatchWorkerProfiles[1], { id: "office", platform: null, areas: null, agents: null, maxRisk: null }, "bare id = all wildcards");

  assert.equal(parseWorkerProfiles("not json"), null);
  assert.equal(parseWorkerProfiles("[]"), null);
  assert.equal(parseWorkerProfiles(JSON.stringify([{ platform: "macos" }])), null, "a row without an id invalidates the whole config");
});

test("#1172 issueRequirements reads the governance taxonomy; all/none are unconstrained", () => {
  const issue = { labels: ["auto", "platform/macos", "area/web", "risk/high", "agent/cli", "priority/p1"] };
  assert.deepEqual(issueRequirements(issue), { platforms: ["macos"], areas: ["web"], risk: "high", agents: ["cli"] });
  assert.deepEqual(issueRequirements({ labels: ["platform/all", "agent/none"] }), { platforms: [], areas: [], risk: null, agents: [] });
});

test("#1172 hard constraints are never overridden: mismatched workers are ineligible with named reasons", () => {
  const profiles = [
    { id: "winbox", platform: "windows", areas: null, agents: null, maxRisk: null },
    { id: "lowrisk", platform: "macos", areas: null, agents: null, maxRisk: "low" },
    { id: "nocli", platform: "macos", areas: null, agents: ["http"], maxRisk: null },
    { id: "fit", platform: "macos", areas: ["web"], agents: ["cli"], maxRisk: "high" },
  ];
  const issue = { number: 1, labels: ["platform/macos", "risk/high", "agent/cli", "area/web"] };
  const { eligible, ineligible } = scoreWorkers({ issue, profiles, load: new Map(), workerCap: 2 });
  assert.deepEqual(eligible.map((e) => e.id), ["fit"]);
  const reasons = Object.fromEntries(ineligible.map((i) => [i.id, i.reason]));
  assert.match(reasons.winbox, /platform_mismatch/);
  assert.match(reasons.lowrisk, /risk_above_ceiling/);
  assert.match(reasons.nocli, /agent_mismatch/);
});

test("#1172 area affinity beats load among eligible; load breaks affinity ties; hard constraints beat both", () => {
  const profiles = [
    { id: "generalist", platform: null, areas: null, agents: null, maxRisk: null },
    { id: "webber", platform: null, areas: ["web"], agents: null, maxRisk: null },
  ];
  const issue = { number: 1, labels: ["area/web"] };
  // webber is BUSIER but has affinity → still wins.
  const load = new Map([["generalist", 0], ["webber", 1]]);
  const { eligible } = scoreWorkers({ issue, profiles, load, workerCap: 2 });
  assert.equal(eligible[0].id, "webber", "affinity outranks load");
  // Without affinity, least-loaded wins.
  const plain = scoreWorkers({ issue: { number: 2, labels: [] }, profiles, load, workerCap: 2 });
  assert.equal(plain.eligible[0].id, "generalist");
});

test("#1172 bare-id profiles keep planDispatch byte-identical to least-loaded round-robin", () => {
  const issues = [1, 2, 3].map((n) => ({ number: n, title: `t${n}`, state: "open", labels: ["auto"] }));
  const base = planDispatch({ issues, assignments: [], projectId: "prj", workers: ["a", "b"], workerCap: 2, requireProjectFields: false, nowIso: T0 });
  const withBareProfiles = planDispatch({
    issues, assignments: [], projectId: "prj", workers: ["a", "b"], workerCap: 2, requireProjectFields: false, nowIso: T0,
    profiles: [{ id: "a", platform: null, areas: null, agents: null, maxRisk: null }, { id: "b", platform: null, areas: null, agents: null, maxRisk: null }],
  });
  assert.deepEqual(
    withBareProfiles.assign.map((x) => `${x.issue.number}:${x.workerId}`),
    base.assign.map((x) => `${x.issue.number}:${x.workerId}`),
    "wildcard profiles degenerate to the unconstrained pick",
  );
});

test("#1172 assignments carry an explainable routing record; unroutable issues surface instead of parking silently", () => {
  const profiles = [
    { id: "mac", platform: "macos", areas: ["web"], agents: null, maxRisk: null },
    { id: "linux", platform: "linux", areas: null, agents: null, maxRisk: null },
  ];
  const issues = [
    { number: 1, title: "mac web", state: "open", labels: ["auto", "platform/macos", "area/web"] },
    { number: 2, title: "windows only", state: "open", labels: ["auto", "platform/windows"] },
  ];
  const plan = planDispatch({ issues, assignments: [], projectId: "prj", workers: ["mac", "linux"], workerCap: 2, requireProjectFields: false, nowIso: T0, profiles });
  assert.equal(plan.assign.length, 1);
  assert.equal(plan.assign[0].workerId, "mac");
  assert.equal(plan.assign[0].routing.why, "area_affinity");
  assert.match(plan.assign[0].routing.ineligible.find((i) => i.id === "linux").reason, /platform_mismatch/);
  assert.equal(plan.unroutable.length, 1);
  assert.equal(plan.unroutable[0].issue.number, 2, "no configured worker can ever take it — visible, not parked");
});

test("#1172 dispatcher runtime stamps routing on the assignment row and events unroutable once", async () => {
  const state = {
    projects: [{ id: "prj", name: "P", source: "default" }],
    projectTargets: [{ projectId: "prj", state: "ready", rootPath: "/repo" }],
    autoRuns: [], issueClaims: [], dispatchAssignments: [], events: [],
  };
  const events = [];
  const runtime = createAutoTriggerRuntime({
    state,
    config: {
      enabled: true, label: "auto", maxConcurrent: 5, requireProjectFields: false,
      dispatchRole: "dispatcher", serverId: "hub", dispatchWorkers: ["mac"], dispatchWorkerCap: 2, dispatchAssignTtlMinutes: 120, dispatchTtlEnabled: false,
      dispatchWorkerProfiles: [{ id: "mac", platform: "macos", areas: null, agents: null, maxRisk: null }],
    },
    listLabeledIssues: async () => [
      { number: 1, title: "fits", state: "open", labels: ["auto", "platform/macos"] },
      { number: 2, title: "never fits", state: "open", labels: ["auto", "platform/windows"] },
    ],
    startAutoRun: async () => ({}),
    editIssueLabels: async () => {},
    appendEvent: (e) => events.push(e),
    persistStateSoon: () => {},
  });
  await runtime.scanOnce();
  await runtime.scanOnce(); // second tick: unroutable must NOT re-event
  const row = state.dispatchAssignments.find((r) => r.issueNumber === 1);
  assert.equal(row.routing.chosen, "mac");
  assert.equal(events.filter((e) => e.type === "auto_trigger_unroutable").length, 1, "reported once per process, not per tick");
});
