/*
 * Phase 3 auto-trigger: selecting which labeled issues to auto-run (dedup +
 * per-project concurrency), and the scan runtime that calls startAutoRun. Pure
 * selector + injected fakes — no gh, no server.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createAutoTriggerRuntime,
  resolveAutoTriggerConfig,
  selectAutoTriggerCandidates,
} from "../src/services/auto-trigger.mjs";

test("resolveAutoTriggerConfig is off by default and reads the env opt-in", () => {
  assert.deepEqual(resolveAutoTriggerConfig({}), { enabled: false, label: "auto", maxConcurrent: 1, requireProjectFields: true });
  const on = resolveAutoTriggerConfig({
    MYAGENTTOOL_AUTOTRIGGER_ENABLED: "1",
    MYAGENTTOOL_AUTOTRIGGER_LABEL: "agent-ready",
    MYAGENTTOOL_AUTOTRIGGER_MAX_CONCURRENT: "3",
  });
  assert.deepEqual(on, { enabled: true, label: "agent-ready", maxConcurrent: 3, requireProjectFields: true });
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
  assert.deepEqual(result, { enabled: false, scanned: 0, started: 0 });
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
