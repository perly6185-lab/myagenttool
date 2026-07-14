/*
 * Claude governance Phase 4a (#914): the approval-bound apply GATE. This slice
 * authorizes an apply — it never writes. `claude.apply.patch` binds to a Phase 3
 * proposal, enforces tenancy, and requires a valid single-use approval grant; on
 * success it records an immutable, non-executable authorization. The whole tool is
 * behind a default-OFF flag. These tests prove: nothing is discoverable/invokable
 * without the flag, and no authorization is created without a valid grant + a bound,
 * applicable proposal.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApprovalGrantService } from "../src/services/approval-grants.mjs";
import { createToolService } from "../src/services/tools.mjs";

const now = () => "2026-07-14T00:00:00.000Z";
const ACTOR = { userId: "usr_a", teamId: "team_a" };

function setApplyFlag(on) {
  if (on) process.env.MYAGENTTOOL_CLAUDE_APPLY_ENABLED = "1";
  else delete process.env.MYAGENTTOOL_CLAUDE_APPLY_ENABLED;
}

function harness({ withProposal = true, patch = "diff --git a/x.mjs b/x.mjs\n--- a/x.mjs\n+++ b/x.mjs\n@@ -1 +1,2 @@\n foo\n+bar\n" } = {}) {
  let id = 0;
  const nextId = (prefix) => `${prefix}_${(id += 1)}`;
  const state = {
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }, { id: "prj_b", ownerTeamId: "team_b" }],
    worktrees: [{ id: "wt_a", projectId: "prj_a" }, { id: "wt_b", projectId: "prj_b" }],
    currentProjectId: "prj_a",
    agents: [],
    applications: [],
    invocations: [],
    claudeApplyAuthorizations: [],
    approvalGrants: [],
    approvalTokenLegacyUses: { count: 0, lastAt: null },
    autoRunSettings: {},
    events: [],
    device: { unlinkState: "linked" },
  };
  if (withProposal) {
    state.invocations.push({
      id: "inv_proposal",
      projectId: "prj_a",
      status: "succeeded",
      options: { metadata: { tool: "claude.propose.patch", worktreeId: "wt_a", projectId: "prj_a" } },
      result: { output: { source: "claude", tool: "claude.propose.patch", summary: "Add bar.", patch, files: [{ path: "x.mjs", action: "modified" }] } },
    });
  }
  const { issueApprovalGrant, validateApprovalToken } = createApprovalGrantService({
    state, now, nextId, appendEvent: (e) => state.events.push(e), persistStateSoon: () => {},
  });
  const service = createToolService({
    state,
    now,
    nextId,
    appendEvent: (e) => state.events.push(e),
    createInvocation: () => { throw new Error("apply must not create a review invocation"); },
    startInvocationIfAllowed: () => {},
    findApplication: () => null,
    findAgent: () => null,
    planApplicationWrapperInvocation: () => ({ ok: false, status: 500, body: {} }),
    validateApprovalToken,
    persistStateSoon: () => {},
  });
  const grantFor = (targetId, actor = ACTOR) => issueApprovalGrant({ action: "apply_patch", targetId }, actor).body.token;
  return { state, service, grantFor };
}

// --- Flag gating ---

test("claude.apply.patch is absent from discovery and refuses invocation when the flag is off", () => {
  setApplyFlag(false);
  const { service, grantFor } = harness();
  assert.equal(service.getTool("claude.apply.patch"), null, "not discoverable when disabled");
  const token = grantFor("inv_proposal");
  const res = service.createToolInvocation("claude.apply.patch", { worktreeId: "wt_a", proposalInvocationId: "inv_proposal", approvalToken: token }, ACTOR);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "apply_not_enabled");
});

test("claude.apply.patch is discoverable as a write-adjacent, approval-gated tool when enabled", () => {
  setApplyFlag(true);
  try {
    const { service } = harness();
    const descriptor = service.getTool("claude.apply.patch");
    assert.ok(descriptor);
    assert.equal(descriptor.riskLevel, "high");
    assert.equal(descriptor.approvalPolicy.applyPatch, "approval_required");
    assert.equal(descriptor.approvalPolicy.executable, false, "4a authorizes only");
  } finally {
    setApplyFlag(false);
  }
});

// --- Approval + binding gate (flag on) ---

test("apply authorizes with a valid grant, records a non-executable authorization, and writes nothing", () => {
  setApplyFlag(true);
  try {
    const { service, state, grantFor } = harness();
    const token = grantFor("inv_proposal");
    const res = service.createToolInvocation("claude.apply.patch", { projectId: "prj_a", worktreeId: "wt_a", proposalInvocationId: "inv_proposal", approvalToken: token }, ACTOR);
    assert.equal(res.status, 201);
    assert.equal(res.body.status, "authorized");
    assert.equal(res.body.executable, false);
    assert.equal(res.body.applied, false);
    assert.equal(state.claudeApplyAuthorizations.length, 1);
    const authorization = state.claudeApplyAuthorizations[0];
    assert.equal(authorization.proposalInvocationId, "inv_proposal");
    assert.equal(authorization.worktreeId, "wt_a");
    assert.ok(authorization.grantId, "the authorization records which grant approved it");
    assert.match(authorization.patch, /diff --git a\/x\.mjs/);
    assert(state.events.some((e) => e.type === "claude_apply_authorized"));

    // Single-use: replaying the same grant token is refused, no second authorization.
    const replay = service.createToolInvocation("claude.apply.patch", { worktreeId: "wt_a", proposalInvocationId: "inv_proposal", approvalToken: token }, ACTOR);
    assert.equal(replay.status, 409);
    assert.equal(replay.body.error, "approval_required");
    assert.match(replay.body.reason, /consumed/);
    assert.equal(state.claudeApplyAuthorizations.length, 1, "a refused apply creates no authorization");
  } finally {
    setApplyFlag(false);
  }
});

test("apply refuses a missing token, a wrong-action grant, and a foreign-team grant — no authorization", () => {
  setApplyFlag(true);
  try {
    const { service, state, grantFor } = harness();
    // Missing token.
    const noToken = service.createToolInvocation("claude.apply.patch", { worktreeId: "wt_a", proposalInvocationId: "inv_proposal" }, ACTOR);
    assert.equal(noToken.status, 409);
    assert.equal(noToken.body.error, "approval_required");
    // A grant minted for the WRONG action does not authorize an apply.
    const { issueApprovalGrant } = createApprovalGrantService({ state, now, nextId: (p) => `${p}_wrong`, appendEvent: () => {}, persistStateSoon: () => {} });
    const wrongAction = issueApprovalGrant({ action: "offline", targetId: "inv_proposal" }, ACTOR).body.token;
    const wrong = service.createToolInvocation("claude.apply.patch", { worktreeId: "wt_a", proposalInvocationId: "inv_proposal", approvalToken: wrongAction }, ACTOR);
    assert.equal(wrong.status, 409);
    assert.match(wrong.body.reason, /action_mismatch/);
    // A grant issued by another team cannot be consumed by this actor.
    const foreignGrant = grantFor("inv_proposal", { userId: "usr_b", teamId: "team_b" });
    const foreign = service.createToolInvocation("claude.apply.patch", { worktreeId: "wt_a", proposalInvocationId: "inv_proposal", approvalToken: foreignGrant }, ACTOR);
    assert.equal(foreign.status, 409);
    assert.equal(state.claudeApplyAuthorizations.length, 0, "no failed path creates an authorization");
  } finally {
    setApplyFlag(false);
  }
});

test("apply fails closed when the grant validator is not wired", () => {
  setApplyFlag(true);
  try {
    const state = {
      projects: [{ id: "prj_a", ownerTeamId: "team_a" }],
      worktrees: [{ id: "wt_a", projectId: "prj_a" }],
      currentProjectId: "prj_a",
      invocations: [{ id: "inv_proposal", projectId: "prj_a", status: "succeeded", options: { metadata: { tool: "claude.propose.patch", worktreeId: "wt_a", projectId: "prj_a" } }, result: { output: { tool: "claude.propose.patch", patch: "diff --git a/x b/x\n+y\n", files: [] } } }],
      claudeApplyAuthorizations: [],
      events: [],
      device: { unlinkState: "linked" },
    };
    const service = createToolService({
      state, now, nextId: (p) => `${p}_1`, appendEvent: (e) => state.events.push(e),
      createInvocation: () => ({}), startInvocationIfAllowed: () => {}, findApplication: () => null, findAgent: () => null,
      planApplicationWrapperInvocation: () => ({}),
      // validateApprovalToken intentionally omitted.
    });
    const res = service.createToolInvocation("claude.apply.patch", { worktreeId: "wt_a", proposalInvocationId: "inv_proposal", approvalToken: "anything" }, ACTOR);
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "approval_required");
    assert.equal(state.claudeApplyAuthorizations.length, 0);
  } finally {
    setApplyFlag(false);
  }
});

test("apply refuses an unknown proposal, a non-proposal invocation, and a worktree binding mismatch", () => {
  setApplyFlag(true);
  try {
    // Unknown proposal id → proposal_not_found (no existence leak).
    const h1 = harness();
    const unknown = h1.service.createToolInvocation("claude.apply.patch", { worktreeId: "wt_a", proposalInvocationId: "inv_nope", approvalToken: h1.grantFor("inv_nope") }, ACTOR);
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error, "proposal_not_found");

    // A completed review (not a proposal) in the same project → proposal_not_applicable.
    const h2 = harness({ withProposal: false });
    h2.state.invocations.push({ id: "inv_review", projectId: "prj_a", status: "succeeded", options: { metadata: { tool: "claude.review.diff", worktreeId: "wt_a", projectId: "prj_a" } }, result: { output: { tool: "claude.review.diff", findings: [] } } });
    const notProposal = h2.service.createToolInvocation("claude.apply.patch", { worktreeId: "wt_a", proposalInvocationId: "inv_review", approvalToken: h2.grantFor("inv_review") }, ACTOR);
    assert.equal(notProposal.status, 409);
    assert.equal(notProposal.body.error, "proposal_not_applicable");

    // A proposal bound to a different worktree in the same project → binding mismatch.
    const h3 = harness({ withProposal: false });
    h3.state.worktrees.push({ id: "wt_a2", projectId: "prj_a" });
    h3.state.invocations.push({ id: "inv_prop2", projectId: "prj_a", status: "succeeded", options: { metadata: { tool: "claude.propose.patch", worktreeId: "wt_a2", projectId: "prj_a" } }, result: { output: { tool: "claude.propose.patch", patch: "diff --git a/x b/x\n+y\n", files: [] } } });
    const mismatch = h3.service.createToolInvocation("claude.apply.patch", { worktreeId: "wt_a", proposalInvocationId: "inv_prop2", approvalToken: h3.grantFor("inv_prop2") }, ACTOR);
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.error, "worktree_binding_mismatch");
    assert.equal(h3.state.claudeApplyAuthorizations.length, 0);
  } finally {
    setApplyFlag(false);
  }
});
