/*
 * Routing evaluation (slice 5): per-path alignment cross-tab, the overall
 * alignment rate, and the bounded/throttled PR-disposition refresh.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { refreshPrDispositions, routingEvaluation } from "../src/services/auto-run-eval.mjs";

function run(path, status, extra = {}) {
  return { decision: { path }, status, ...extra };
}

test("routingEvaluation: alignment per path and the overall rate", () => {
  const evaluation = routingEvaluation([
    run("develop", "pr_open"),      // aligned
    run("develop", "blocked", { error: "The agent run produced no changes to open a pull request with." }),
    run("develop", "running"),      // inconclusive
    run("design", "report_posted"), // aligned
    run("design", "pr_open"),       // diverted (made a real diff)
    run("clarify", "needs_input"),  // aligned
    run("decompose", "decomposed"), // aligned
    { status: "pr_open" },           // no decision -> ignored
  ]);
  assert.equal(evaluation.byPath.develop.aligned, 1);
  assert.equal(evaluation.byPath.develop.misaligned, 1);
  assert.equal(evaluation.byPath.develop.inconclusive, 1);
  assert.equal(evaluation.byPath.design.aligned, 1);
  assert.equal(evaluation.byPath.design.diverted, 1);
  assert.equal(evaluation.byPath.clarify.aligned, 1);
  assert.equal(evaluation.byPath.decompose.aligned, 1);
  // Conclusive = 6; aligned = 4.
  assert.equal(evaluation.conclusive, 6);
  assert.equal(evaluation.alignmentRate, 4 / 6);
});

test("routingEvaluation keeps recommendation quality separate from human truth", () => {
  const evaluation = routingEvaluation([
    run("develop", "report_posted", {
      routingOverride: { actualPath: "design", reason: "The requested output was a design." },
    }),
    run("clarify", "needs_input", {
      routingOverride: { actualPath: "clarify", reason: "Requirements were incomplete." },
    }),
  ]);
  assert.equal(evaluation.byPath.develop.total, 1, "the recommendation stays in its original bucket");
  assert.equal(evaluation.byPath.design.total, 0, "human truth never rewrites historical model output");
  assert.deepEqual(evaluation.humanTruth, { total: 2, recommendationMatched: 1, accuracy: 0.5 });
});

test("routingEvaluation: no data -> null rate; PR dispositions counted per path", () => {
  assert.equal(routingEvaluation([]).alignmentRate, null);
  const evaluation = routingEvaluation([
    run("develop", "pr_open", { prState: "MERGED" }),
    run("develop", "pr_open", { prState: "CLOSED" }),
    run("develop", "pr_open"),
  ]);
  assert.equal(evaluation.byPath.develop.prMerged, 1);
  assert.equal(evaluation.byPath.develop.prClosed, 1);
});

test("refreshPrDispositions updates open PRs, skips terminal/throttled/capped", async () => {
  const now = () => "2026-07-06T12:00:00.000Z";
  const state = {
    projects: [{ id: "prj", path: "/repo" }],
    autoRuns: [
      { status: "pr_open", prNumber: 1, projectId: "prj" },                                   // -> checked, MERGED
      { status: "pr_open", prNumber: 2, projectId: "prj", prState: "MERGED" },                // terminal -> skip
      { status: "pr_open", prNumber: 3, projectId: "prj", prStateCheckedAt: now() },          // just checked -> throttled
      { status: "blocked", prNumber: 4, projectId: "prj" },                                   // not pr_open -> skip
      { status: "pr_open", prNumber: 5, projectId: "missing" },                               // no project -> skip
    ],
  };
  const fetched = [];
  const changes = [];
  const result = await refreshPrDispositions({
    state,
    now,
    fetchPrState: async ({ prNumber, repoPath }) => {
      fetched.push({ prNumber, repoPath });
      return "MERGED";
    },
    onDispositionChanged: ({ run: changedRun, prState }) => changes.push({ changedRun, prState }),
  });
  assert.deepEqual(fetched, [{ prNumber: 1, repoPath: "/repo" }]);
  assert.equal(result.checked, 1);
  assert.equal(result.updated, 1);
  assert.equal(state.autoRuns[0].prState, "MERGED");
  assert.equal(state.autoRuns[0].prStateCheckedAt, now());
  assert.deepEqual(changes, [{ changedRun: state.autoRuns[0], prState: "MERGED" }]);
});

test("refreshPrDispositions: fetch failure stamps the check time and moves on", async () => {
  const state = { projects: [{ id: "p", path: "/r" }], autoRuns: [{ status: "pr_open", prNumber: 9, projectId: "p" }] };
  const result = await refreshPrDispositions({
    state,
    fetchPrState: async () => {
      throw new Error("gh offline");
    },
  });
  assert.equal(result.updated, 0);
  assert.equal(state.autoRuns[0].prState, undefined);
  assert.ok(state.autoRuns[0].prStateCheckedAt, "stamped so it is not retried immediately");
});

test("refreshPrDispositions respects the per-call cap", async () => {
  const state = {
    projects: [{ id: "p", path: "/r" }],
    autoRuns: Array.from({ length: 15 }, (_, i) => ({ status: "pr_open", prNumber: i + 1, projectId: "p" })),
  };
  const result = await refreshPrDispositions({ state, maxChecks: 3, fetchPrState: async () => "OPEN" });
  assert.equal(result.checked, 3);
});
