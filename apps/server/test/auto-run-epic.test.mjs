import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeEpicChildren, refreshEpicChildStates } from "../src/services/auto-run-epic.mjs";

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
  assert.deepEqual(r.items.find((i) => i.number === 12), { number: 12, title: "C", status: null, prState: null, issueState: null, done: false });
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
    total: 0, started: 0, notStarted: 0, done: 0, merged: 0, prOpen: 0, failed: 0, inProgress: 0, items: [],
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
