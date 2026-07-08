import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeEpicChildren } from "../src/services/auto-run-epic.mjs";

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
  assert.deepEqual(r.items.find((i) => i.number === 12), { number: 12, title: "C", status: null, prState: null });
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
    total: 0, started: 0, notStarted: 0, merged: 0, prOpen: 0, failed: 0, inProgress: 0, items: [],
  });
});
