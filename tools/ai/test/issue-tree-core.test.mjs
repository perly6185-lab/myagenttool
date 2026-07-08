import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePmBrief,
  issueTreeFromBrief,
  decompositionTree,
  issueSpecFromBrief,
  issueTreeApplyFailures,
  humanApprovalRequiredReasons,
  issueTreeWithHumanApproval,
} from "../src/issue-tree-core.mjs";

// A brief that normalizes to a governance-clean issue (benign risk text so it does
// NOT trip humanApprovalRequiredReasons — the DEFAULT riskFlags mention security/
// cost/release, which would require approval).
function cleanBrief(overrides = {}) {
  return {
    issueTitle: "[Task]: Add a widget",
    problem: "Users need a widget.",
    userStory: "As a user I can use a widget.",
    acceptanceCriteria: ["A widget renders.", "The widget is tested."],
    riskFlags: ["No notable risk."],
    nonGoals: ["No unrelated refactors."],
    projectFields: { milestone: "M2", area: "server", type: "task", risk: "low", platform: "all", priority: "p2" },
    ...overrides,
  };
}

test("normalizePmBrief fills governance defaults", () => {
  const n = normalizePmBrief({});
  assert.equal(n.projectFields.milestone, "M0");
  assert.equal(n.projectFields.status, "backlog");
  assert.equal(n.issueTitle, "[Task]: TODO");
  assert.deepEqual(n.acceptanceCriteria, []);
});

test("issueTreeFromBrief yields exactly one root issue", () => {
  const tree = issueTreeFromBrief(cleanBrief());
  assert.equal(tree.source, "pm-brief");
  assert.equal(tree.issues.length, 1);
  assert.equal(tree.issues[0].role, "root");
  assert.equal(tree.issues[0].title, "[Task]: Add a widget");
});

test("decompositionTree yields one governed child per input brief, tagged with the parent", () => {
  const tree = decompositionTree({
    parentLink: { number: 42, title: "[Epic]: Ship the thing" },
    children: [cleanBrief({ issueTitle: "[Task]: Part A" }), cleanBrief({ issueTitle: "[Task]: Part B" })],
  });
  assert.equal(tree.source, "decomposition");
  assert.deepEqual(tree.parent, { number: 42, title: "[Epic]: Ship the thing" });
  assert.equal(tree.issues.length, 2);
  assert.deepEqual(tree.issues.map((i) => i.title), ["[Task]: Part A", "[Task]: Part B"]);
  assert.ok(tree.issues.every((i) => i.role === "child"));
  // each child carries the full governance label set + inherited Project Fields
  for (const child of tree.issues) {
    for (const group of ["type/", "status/", "area/", "risk/", "acceptance/", "platform/", "agent/"]) {
      assert.ok(child.labels.some((l) => l.startsWith(group)), `child missing ${group} label`);
    }
  }
});

test("issueTreeApplyFailures passes a clean decomposition; flags each defect class", () => {
  const clean = decompositionTree({ children: [cleanBrief(), cleanBrief({ issueTitle: "[Task]: Second" })] });
  assert.deepEqual(issueTreeApplyFailures(clean), [], "a clean multi-child tree applies with no failures");

  // TODO title
  assert.ok(issueTreeApplyFailures(decompositionTree({ children: [cleanBrief({ issueTitle: "[Task]: TODO" })] }))
    .some((f) => /title is missing or TODO/.test(f)));
  // missing acceptance criteria
  assert.ok(issueTreeApplyFailures(decompositionTree({ children: [cleanBrief({ acceptanceCriteria: [] })] }))
    .some((f) => /acceptance criteria are missing/.test(f)));
  // a child that trips the approval scanner requires evidence
  const risky = decompositionTree({ children: [cleanBrief({ riskFlags: ["Touches credential storage and auth."] })] });
  assert.ok(issueTreeApplyFailures(risky).some((f) => /human approval is required/.test(f)), "risky child needs approval");
  assert.deepEqual(issueTreeApplyFailures(risky, "approved by maintainer"), [], "explicit approval clears it");
});

test("humanApprovalRequiredReasons classifies the sensitive dimensions", () => {
  const security = decompositionTree({ children: [cleanBrief({ problem: "Rotate the auth credential secret." })] });
  assert.ok(humanApprovalRequiredReasons(security).includes("security or data/privacy impact"));
  const billing = decompositionTree({ children: [cleanBrief({ problem: "Add per-seat billing and quota." })] });
  assert.ok(humanApprovalRequiredReasons(billing).includes("billing or cost impact"));
  const clean = decompositionTree({ children: [cleanBrief()] });
  assert.deepEqual(humanApprovalRequiredReasons(clean), [], "a benign child needs no approval");
});

test("issueTreeWithHumanApproval stamps evidence on the tree and every issue", () => {
  const tree = decompositionTree({ children: [cleanBrief(), cleanBrief()] });
  const approved = issueTreeWithHumanApproval(tree, "  approved: maintainer sign-off  ");
  assert.equal(approved.governance.humanApprovalProvided, true);
  assert.equal(approved.governance.humanApprovalEvidence, "approved: maintainer sign-off");
  assert.ok(approved.issues.every((i) => i.humanApproval === "approved: maintainer sign-off"));
  // empty evidence is a no-op
  assert.equal(issueTreeWithHumanApproval(tree, "   "), tree);
});

test("issueSpecFromBrief shares the root/child shape (same validation applies)", () => {
  const root = issueSpecFromBrief(cleanBrief(), "root");
  const child = issueSpecFromBrief(cleanBrief(), "child");
  assert.equal(root.role, "root");
  assert.equal(child.role, "child");
  assert.deepEqual(Object.keys(root).sort(), Object.keys(child).sort());
});
