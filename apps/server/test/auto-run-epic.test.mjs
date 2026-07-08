import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeEpicChildren, refreshEpicChildStates, scoreDecompositionOverlap, isRedundancyBlock } from "../src/services/auto-run-epic.mjs";

const epic = {
  id: "aur_epic", projectId: "prj_1",
  childIssues: [{ number: 10, title: "A" }, { number: 11, title: "B" }, { number: 12, title: "C" }],
};

test("summarizeEpicChildren rolls up children from their own auto-runs (same project)", () => {
  const autoRuns = [
    epic,
    { id: "aur_a", projectId: "prj_1", link: { type: "issue", number: 10 }, status: "pr_open", prState: "MERGED", updatedAt: "2" },
    { id: "aur_b", projectId: "prj_1", link: { type: "issue", number: 11 }, status: "running", updatedAt: "2" },
    // #12 has no auto-run yet -> not started
    // a same-number issue in ANOTHER project must NOT count
    { id: "aur_x", projectId: "prj_2", link: { type: "issue", number: 12 }, status: "pr_open", prState: "MERGED", updatedAt: "9" },
  ];
  const r = summarizeEpicChildren(epic, autoRuns);
  assert.equal(r.total, 3);
  assert.equal(r.started, 2);
  assert.equal(r.notStarted, 1);
  assert.equal(r.merged, 1, "#10 merged");
  assert.equal(r.inProgress, 1, "#11 running");
  assert.deepEqual(r.items.find((i) => i.number === 12), { number: 12, title: "C", status: null, prState: null, issueState: null, done: false, redundant: false });
  assert.equal(r.items.find((i) => i.number === 10).prState, "MERGED");
});

test("summarizeEpicChildren takes the latest run per child (retries) and ignores the epic itself", () => {
  const autoRuns = [
    epic,
    { id: "aur_old", projectId: "prj_1", link: { type: "issue", number: 10 }, status: "failed", updatedAt: "1" },
    { id: "aur_new", projectId: "prj_1", link: { type: "issue", number: 10 }, status: "pr_open", prState: "MERGED", updatedAt: "5" },
  ];
  const r = summarizeEpicChildren(epic, autoRuns);
  assert.equal(r.merged, 1, "latest (merged) wins over the earlier failed run");
  assert.equal(r.failed, 0);
});

test("summarizeEpicChildren on an epic with no children is empty", () => {
  assert.deepEqual(summarizeEpicChildren({ id: "e", childIssues: [] }, []), {
    total: 0, started: 0, notStarted: 0, done: 0, merged: 0, prOpen: 0, failed: 0, inProgress: 0, redundant: 0, items: [],
  });
});

test("summarizeEpicChildren counts a CLOSED child issue as done even without a merged auto-run (human override)", () => {
  const e = { id: "aur_epic", projectId: "prj_1", childIssues: [{ number: 10, title: "A", issueState: "CLOSED" }, { number: 11, title: "B", issueState: "OPEN" }] };
  // #10's auto-run BLOCKED (never merged its own PR) but the ISSUE is CLOSED
  // (merged via a human-override PR outside the loop) — must count as done.
  const autoRuns = [{ id: "aur_a", projectId: "prj_1", link: { type: "issue", number: 10 }, status: "blocked" }];
  const r = summarizeEpicChildren(e, autoRuns);
  assert.equal(r.done, 1, "closed issue counts done despite the blocked auto-run");
  assert.equal(r.merged, 0, "its own auto-run did not merge");
  assert.equal(r.items.find((i) => i.number === 10).done, true);
});

test("refreshEpicChildStates fetches OPEN children, marks CLOSED (terminal), throttles, never throws", async () => {
  const state = { projects: [{ id: "prj_1", path: "/repo" }], autoRuns: [
    { id: "e1", status: "decomposed", projectId: "prj_1", childIssues: [{ number: 10 }, { number: 11, issueState: "CLOSED" }] },
    { id: "nope", status: "pr_open", projectId: "prj_1", childIssues: [{ number: 99 }] },
  ] };
  const seen = [];
  const fetchIssueState = async ({ issueNumber }) => { seen.push(issueNumber); return issueNumber === 10 ? "CLOSED" : "OPEN"; };
  const projectPathFor = (id) => (id === "prj_1" ? "/repo" : null);
  const now = () => "2026-07-08T00:00:00.000Z";
  const r = await refreshEpicChildStates({ state, now, fetchIssueState, projectPathFor });
  assert.equal(r.changed, true);
  assert.deepEqual(seen, [10], "only the OPEN child of the decomposed run is fetched (CLOSED terminal; pr_open run ignored)");
  assert.equal(state.autoRuns[0].childIssues[0].issueState, "CLOSED");
  seen.length = 0;
  await refreshEpicChildStates({ state, now, fetchIssueState, projectPathFor });
  assert.equal(seen.length, 0, "throttled within the window");
  const bad = await refreshEpicChildStates({ state: { projects: [{ id: "prj_1", path: "/r" }], autoRuns: [{ id: "e2", status: "decomposed", projectId: "prj_1", childIssues: [{ number: 5 }] }] }, now: () => "2026-07-09T00:00:00.000Z", fetchIssueState: async () => { throw new Error("gh down"); }, projectPathFor });
  assert.ok(bad, "a throwing fetch never propagates");
});

test("scoreDecompositionOverlap flags children that cover the same scope, spares distinct ones", () => {
  const tree = { issues: [
    { title: "Add language selection to the greeting service", problem: "greeting supports english and spanish", acceptanceCriteria: ["greeting accepts a language", "unsupported language falls back to english"] },
    { title: "Harden greeting input handling", problem: "greeting handles blank name and unsupported language", acceptanceCriteria: ["blank name returns a default greeting", "unsupported language falls back to english"] },
    { title: "Add a database migration for the audit log", problem: "persist audit events in postgres", acceptanceCriteria: ["migration creates the audit table"] },
  ]};
  const r = scoreDecompositionOverlap(tree);
  // #1 and #2 share the language-fallback scope -> flagged; #3 (db migration) distinct
  assert.ok(r.flagged.some((p) => (p.a === 0 && p.b === 1)), "the two greeting children are flagged as overlapping");
  assert.ok(r.flagged.every((p) => !(p.a === 2 || p.b === 2)), "the unrelated migration child is never flagged");
  assert.ok(r.maxOverlap >= 0.5);
  assert.equal(r.perChild.length, 3);
  assert.ok(r.perChild[2] < 0.5, "the distinct child has low overlap");
});

test("scoreDecompositionOverlap: a single child or empty tree has no overlap", () => {
  assert.deepEqual(scoreDecompositionOverlap({ issues: [] }).flagged, []);
  assert.deepEqual(scoreDecompositionOverlap({ issues: [{ title: "Only child", acceptanceCriteria: ["x"] }] }).flagged, []);
  assert.equal(scoreDecompositionOverlap({ issues: [] }).maxOverlap, 0);
});

test("scoreDecompositionOverlap ignores governance boilerplate (identical scaffolding is not overlap)", () => {
  // two children with identical Project-Fields-style boilerplate words but different domains
  const tree = { issues: [
    { title: "[Task]: Add the login page", problem: "implement the login page", acceptanceCriteria: ["login works"] },
    { title: "[Task]: Add the metrics exporter", problem: "implement the metrics exporter", acceptanceCriteria: ["metrics exported"] },
  ]};
  const r = scoreDecompositionOverlap(tree);
  assert.ok(r.maxOverlap < 0.5, "shared boilerplate (task/add/implement) is not counted as overlap");
});

test("isRedundancyBlock detects a judge block that means 'already covered', spares genuine failures", () => {
  // the real devdemo #28 verdict
  assert.equal(isRedundancyBlock({ solved: false, summary: "omits the implementation", gaps: ["diff only adds documentation and tests, not the behavior they test"] }), true);
  assert.equal(isRedundancyBlock({ solved: false, summary: "the behavior already exists in GreetingService" }), true);
  assert.equal(isRedundancyBlock({ solved: false, summary: "no new implementation; duplicate of the feature child" }), true);
  // a genuine failure is NOT redundancy
  assert.equal(isRedundancyBlock({ solved: false, summary: "the endpoint returns 500; the null check is wrong" }), false);
  // a solved run is never redundant; missing judgment is safe
  assert.equal(isRedundancyBlock({ solved: true, summary: "diff only adds tests" }), false);
  assert.equal(isRedundancyBlock(null), false);
});

test("summarizeEpicChildren counts children whose run was judge-blocked as redundant (S5.1)", () => {
  const e = { id: "aur_epic", projectId: "prj_1", childIssues: [{ number: 10, title: "feature" }, { number: 11, title: "overlap" }, { number: 12, title: "real fail" }] };
  const autoRuns = [
    { id: "a", projectId: "prj_1", link: { type: "issue", number: 10 }, status: "pr_open", prState: "MERGED" },
    { id: "b", projectId: "prj_1", link: { type: "issue", number: 11 }, status: "blocked", judgment: { solved: false, summary: "diff only adds documentation and tests" } },
    { id: "c", projectId: "prj_1", link: { type: "issue", number: 12 }, status: "blocked", judgment: { solved: false, summary: "the endpoint crashes" } },
  ];
  const r = summarizeEpicChildren(e, autoRuns);
  assert.equal(r.redundant, 1, "only the already-covered child counts redundant");
  assert.equal(r.items.find((i) => i.number === 11).redundant, true);
  assert.equal(r.items.find((i) => i.number === 12).redundant, false, "a genuine failure is not redundancy");
  assert.equal(r.items.find((i) => i.number === 10).redundant, false, "a merged child is not redundant");
});
