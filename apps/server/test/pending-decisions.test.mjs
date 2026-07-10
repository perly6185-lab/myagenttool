import assert from "node:assert/strict";
import { test } from "node:test";

import { pendingDecisions } from "../src/read-models/pending-decisions.mjs";

const invocationsById = new Map([
  ["inv_1", { id: "inv_1", projectId: "projA", task: "Refactor the auth module" }],
  ["inv_cx", { id: "inv_cx", projectId: "projB", task: "Run the migration" }],
]);

test("invocation approvals: only pending ones become rows, with risk + task subtitle", () => {
  const rows = pendingDecisions({
    approvalRequests: [
      { id: "apr_1", invocationId: "inv_1", status: "pending", riskLevel: "high", summary: "writes to prod" },
      { id: "apr_2", invocationId: "inv_1", status: "approved", riskLevel: "high" },
    ],
    invocationsById,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "invocation_approval");
  assert.equal(rows[0].id, "approval:apr_1");
  assert.equal(rows[0].projectId, "projA"); // resolved from the invocation
  assert.match(rows[0].subtitle, /high risk/);
  assert.match(rows[0].subtitle, /writes to prod/);
  assert.equal(rows[0].ref.approvalId, "apr_1");
  assert.equal(rows[0].section, "invocations");
});

test("auto-run gates: decomposition / design / clarify / merge each map to one row", () => {
  const autoRuns = [
    { id: "ar_dec", status: "plan_proposed", decision: { path: "decompose" }, link: { number: 25, title: "Epic" }, updatedAt: "2026-07-09T01:00:00Z" },
    { id: "ar_des", status: "report_posted", decision: { path: "design" }, link: { number: 30, title: "Design me" }, updatedAt: "2026-07-09T02:00:00Z" },
    { id: "ar_clr", status: "needs_input", decision: { path: "clarify" }, link: { number: 31, title: "Which db?" }, updatedAt: "2026-07-09T03:00:00Z" },
    { id: "ar_mrg", status: "pr_open", prNumber: 42, prState: "OPEN", mergeRisk: "low", decision: { path: "develop" }, link: { number: 32, title: "Add greet" }, updatedAt: "2026-07-09T04:00:00Z" },
  ];
  const rows = pendingDecisions({ autoRuns });
  const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
  assert.deepEqual(rows.map((r) => r.kind), ["decomposition", "design", "clarify", "merge"]); // oldest-first
  assert.equal(byKind.decomposition.ref.autoRunId, "ar_dec");
  assert.match(byKind.decomposition.subtitle, /#25 Epic/);
  assert.equal(byKind.merge.title, "PR #42 ready to merge");
  assert.equal(byKind.merge.ref.prNumber, 42);
  assert.match(byKind.merge.subtitle, /low risk/);
  assert.equal(byKind.design.section, "autoRuns");
});

test("auto-run gates exclude settled / in-flight / wrong-path states", () => {
  const rows = pendingDecisions({
    autoRuns: [
      { id: "ar_done", status: "decomposed", decision: { path: "decompose" } }, // already decomposed
      { id: "ar_approving", status: "plan_proposed", decision: { path: "decompose" }, decompositionApproval: { status: "approving" } }, // in-flight
      { id: "ar_prototype", status: "report_posted", decision: { path: "prototype" } }, // report but NOT a design gate
      { id: "ar_designed", status: "report_posted", decision: { path: "design" }, designApproval: { status: "approved" } }, // already approved
      { id: "ar_merged", status: "pr_open", prNumber: 7, prState: "MERGED", decision: { path: "develop" } }, // already merged
      { id: "ar_nopr", status: "pr_open", prNumber: null, decision: { path: "develop" } }, // no PR yet
    ],
  });
  assert.deepEqual(rows, []);
});

test("settled auto-run gates that leave STATUS parked are excluded (review-sweep regressions)", () => {
  const rows = pendingDecisions({
    autoRuns: [
      // rejectDecomposition sets decompositionApproval=rejected but leaves status plan_proposed.
      { id: "ar_rej", status: "plan_proposed", decision: { path: "decompose" }, decompositionApproval: { status: "rejected" } },
      // answerClarify sets clarifyAnswer but leaves status needs_input.
      { id: "ar_ans", status: "needs_input", decision: { path: "clarify" }, clarifyAnswer: { text: "yes" } },
      // a PR closed without merging: prState CLOSED but status still pr_open.
      { id: "ar_closed", status: "pr_open", prNumber: 9, prState: "CLOSED", decision: { path: "develop" } },
    ],
  });
  assert.deepEqual(rows, [], "rejected plan / answered clarify / closed PR must NOT re-appear as pending");
});

test("a partially-created decomposition stays visible (retryable) — not over-filtered", () => {
  const rows = pendingDecisions({
    autoRuns: [{ id: "ar_partial", status: "plan_proposed", decision: { path: "decompose" }, link: { number: 5 }, decompositionApproval: { status: "partial" } }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "decomposition");
});

test("compare promotions: isolated + preferred + not-yet-promoted only", () => {
  const rows = pendingDecisions({
    compareRuns: [
      { id: "cmp_ready", isolated: true, preferredInvocationId: "inv_a", promotion: null, task: "port to esm", projectId: "projA", createdAt: "2026-07-09T00:00:00Z" },
      { id: "cmp_shared", isolated: false, preferredInvocationId: "inv_b", promotion: null }, // shared/answer compare — nothing to promote
      { id: "cmp_nopick", isolated: true, preferredInvocationId: null, promotion: null }, // no winner picked yet
      { id: "cmp_done", isolated: true, preferredInvocationId: "inv_c", promotion: { prNumber: 9 } }, // already promoted
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "compare_promote");
  assert.equal(rows[0].ref.compareRunId, "cmp_ready");
  assert.equal(rows[0].ref.invocationId, "inv_a");
  assert.equal(rows[0].section, "compare");
});

test("codex approval-broker: pending only, project resolved from the invocation", () => {
  const rows = pendingDecisions({
    codexApprovalBrokerRequests: [
      { id: "cx_1", invocationId: "inv_cx", status: "pending", toolName: "shell" },
      { id: "cx_2", invocationId: "inv_cx", status: "approved", toolName: "shell" },
    ],
    invocationsById,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "codex_broker");
  assert.equal(rows[0].projectId, "projB");
  assert.equal(rows[0].ref.requestId, "cx_1");
});

test("lifecycle local approvals join the queue (pending only)", () => {
  const rows = pendingDecisions({
    lifecycleLocalApprovals: [
      { id: "lc_1", status: "pending", riskLevel: "high", summary: "rotate agent credential", agentId: "agt_x", recipeId: "rec_1" },
      { id: "lc_2", status: "approved", riskLevel: "low", summary: "already decided" },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "lifecycle_approval");
  assert.equal(rows[0].id, "lifecycle:lc_1");
  assert.equal(rows[0].ref.approvalId, "lc_1");
  assert.equal(rows[0].ref.recipeId, "rec_1");
  assert.match(rows[0].subtitle, /rotate agent credential/);
});

test("lifecycle rollback requests join the queue only while 'available' (queued excluded)", () => {
  const rows = pendingDecisions({
    lifecycleRollbackRequests: [
      { id: "rb_1", status: "available", summary: "roll back failed credential rotation", agentId: "agt_x", recipeId: "rec_1" },
      { id: "rb_2", status: "queued", summary: "already queued" },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "lifecycle_rollback");
  assert.equal(rows[0].ref.rollbackRequestId, "rb_1");
  assert.match(rows[0].subtitle, /roll back failed/);
});

test("everything merges into one queue, sorted oldest-waiting first", () => {
  const rows = pendingDecisions({
    approvalRequests: [{ id: "apr_new", invocationId: "inv_1", status: "pending", createdAt: "2026-07-09T05:00:00Z" }],
    autoRuns: [{ id: "ar_old", status: "needs_input", decision: { path: "clarify" }, link: { number: 1 }, updatedAt: "2026-07-09T01:00:00Z" }],
    compareRuns: [{ id: "cmp_mid", isolated: true, preferredInvocationId: "inv_z", promotion: null, createdAt: "2026-07-09T03:00:00Z" }],
    invocationsById,
  });
  assert.deepEqual(rows.map((r) => r.id), ["clarify:ar_old", "promote:cmp_mid", "approval:apr_new"]);
});

test("empty inputs → empty queue (no throw on missing fields)", () => {
  assert.deepEqual(pendingDecisions(), []);
  assert.deepEqual(pendingDecisions({ approvalRequests: [{ id: "x", status: "pending" }] }).length, 1);
});
