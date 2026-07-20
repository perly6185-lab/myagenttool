/*
 * #6: the issue-ownership read-model unifies the TWO issue-keyed ownership signals
 * (develop/review claim lease + Layer-B dispatch assignment) per issue. Decision
 * soft-claims (decisionId-keyed) are a different domain and are NOT folded in.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeIssueOwnership } from "../src/read-models/issue-ownership.mjs";

const nowIso = "2026-07-20T00:00:00.000Z";
const future = "2026-07-21T00:00:00.000Z";
const past = "2026-07-19T00:00:00.000Z";

test("unifies a develop claim and a dispatch assignment on the same issue", () => {
  const state = {
    issueClaims: [
      { status: "active", mode: "develop", claimedBy: "usr_a", projectId: "prj", issueNumber: 42, leaseExpiresAt: future },
      { status: "active", mode: "review", claimedBy: "usr_r", projectId: "prj", issueNumber: 42, leaseExpiresAt: future },
    ],
    dispatchAssignments: [
      { status: "open", workerId: "worker-3", projectId: "prj", issueNumber: 42, assignedAt: past },
    ],
  };
  const { issues } = computeIssueOwnership(state, { nowIso });
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0], {
    projectId: "prj",
    issueNumber: 42,
    develop: { claimedBy: "usr_a", leaseExpiresAt: future },
    reviewers: ["usr_r"],
    dispatch: { workerId: "worker-3", assignedAt: past, adopted: false },
  });
});

test("excludes expired claims, settled assignments, and non-open rows", () => {
  const state = {
    issueClaims: [
      { status: "active", mode: "develop", claimedBy: "usr_a", projectId: "prj", issueNumber: 1, leaseExpiresAt: past }, // expired
      { status: "released", mode: "develop", claimedBy: "usr_b", projectId: "prj", issueNumber: 2, leaseExpiresAt: future }, // settled
    ],
    dispatchAssignments: [
      { status: "settled", workerId: "w1", projectId: "prj", issueNumber: 3, assignedAt: past }, // not open
    ],
  };
  assert.deepEqual(computeIssueOwnership(state, { nowIso }).issues, [], "nothing live → empty");
});

test("team scoping: includeProject filters out other teams' issues", () => {
  const state = {
    issueClaims: [
      { status: "active", mode: "develop", claimedBy: "usr_a", projectId: "mine", issueNumber: 7, leaseExpiresAt: future },
      { status: "active", mode: "develop", claimedBy: "usr_x", projectId: "theirs", issueNumber: 9, leaseExpiresAt: future },
    ],
    dispatchAssignments: [
      { status: "open", workerId: "w", projectId: "theirs", issueNumber: 9, assignedAt: past },
    ],
  };
  const { issues } = computeIssueOwnership(state, { nowIso, includeProject: (p) => p === "mine" });
  assert.deepEqual(issues.map((i) => `${i.projectId}#${i.issueNumber}`), ["mine#7"]);
});

test("a claim-only and an assignment-only issue each surface; sorted by project then number", () => {
  const state = {
    issueClaims: [{ status: "active", mode: "develop", claimedBy: "usr_a", projectId: "b", issueNumber: 5, leaseExpiresAt: future }],
    dispatchAssignments: [
      { status: "open", workerId: "w", projectId: "a", issueNumber: 20, assignedAt: past, adopted: true },
      { status: "open", workerId: "w", projectId: "a", issueNumber: 3, assignedAt: past },
    ],
  };
  const { issues } = computeIssueOwnership(state, { nowIso });
  assert.deepEqual(issues.map((i) => `${i.projectId}#${i.issueNumber}`), ["a#3", "a#20", "b#5"]);
  assert.equal(issues.find((i) => i.issueNumber === 20).dispatch.adopted, true);
  assert.equal(issues.find((i) => i.issueNumber === 5).dispatch, null, "claim-only issue has no dispatch");
});

test("decision soft-claims are NOT part of issue ownership (different domain)", () => {
  const state = {
    decisionSoftClaims: [{ status: "active", decisionId: "approval:rec_1", claimedBy: "usr_a", expiresAt: future }],
    issueClaims: [],
    dispatchAssignments: [],
  };
  assert.deepEqual(computeIssueOwnership(state, { nowIso }).issues, [], "a soft-claim never creates an ownership row");
});
