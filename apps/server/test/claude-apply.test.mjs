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

import { buildEvidenceCenterRecords } from "../src/read-models/evidence-center.mjs";
import { createApprovalGrantService } from "../src/services/approval-grants.mjs";
import { createToolService } from "../src/services/tools.mjs";
import { createClaudeApplyAgentRegistration, isGovernedClaudeApplyAgent } from "../src/services/claude-apply-agent.mjs";
import { createClaudeApplyImportService } from "../src/services/claude-apply-imports.mjs";

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

// --- Phase 4b: execution dispatch + result recording ---

function governedApplyAgent() {
  const reg = createClaudeApplyAgentRegistration();
  return {
    id: reg.id,
    name: reg.name,
    adapter: { type: "cli", command: reg.command, args: reg.args, outputFormat: reg.outputFormat },
    toolContract: reg.toolContract,
    capabilities: [{ name: reg.capabilityName }],
    status: "available",
    health: { status: "healthy" },
    location: { type: "local_device", deviceId: "dev_local_001" },
  };
}

test("createClaudeApplyAgentRegistration is a governed WRITE runner (canonical path, code_apply)", () => {
  assert.equal(isGovernedClaudeApplyAgent(governedApplyAgent()), true);
  const foreign = governedApplyAgent();
  foreign.adapter.args = ["/tmp/evil/claude-apply-wrapper.mjs"];
  assert.equal(isGovernedClaudeApplyAgent(foreign), false, "a wrapper outside tools/agents is not governed");
});

test("Phase 4b: with a runner available, an authorized apply is dispatched as a queued invocation carrying the patch", () => {
  setApplyFlag(true);
  try {
    const { service, state, grantFor } = harness();
    state.agents.push(governedApplyAgent());
    const created = [];
    // Re-wire createInvocation on the same state via a fresh tool service so the
    // dispatch can create the apply invocation (the base harness throws on create).
    let id = 100;
    const { validateApprovalToken } = createApprovalGrantService({ state, now, nextId: (p) => `${p}_${id += 1}`, appendEvent: (e) => state.events.push(e), persistStateSoon: () => {} });
    const svc = createToolService({
      state, now, nextId: (p) => `${p}_${id += 1}`, appendEvent: (e) => state.events.push(e),
      createInvocation: (task, agent, options) => { const inv = { id: `inv_apply_${id += 1}`, status: "queued", agentId: agent.id, options, task }; created.push(inv); state.invocations.push(inv); return inv; },
      startInvocationIfAllowed: () => {}, findApplication: () => null, findAgent: (aid) => state.agents.find((a) => a.id === aid) ?? null,
      planApplicationWrapperInvocation: () => ({}), validateApprovalToken, persistStateSoon: () => {},
    });
    const res = svc.createToolInvocation("claude.apply.patch", { worktreeId: "wt_a", proposalInvocationId: "inv_proposal", approvalToken: grantFor("inv_proposal") }, ACTOR);
    assert.equal(res.status, 201);
    assert.equal(res.body.status, "applying");
    assert.equal(res.body.executable, true);
    assert.ok(res.body.executionInvocationId);
    assert.equal(created.length, 1, "a queued apply invocation was dispatched");
    assert.equal(created[0].options.metadata.tool, "claude.apply.patch");
    assert.match(created[0].options.metadata.applyPatch, /diff --git/);
    assert.equal(created[0].options.metadata.claudeApplyAuthorizationId, state.claudeApplyAuthorizations[0].id);
    assert.equal(state.claudeApplyAuthorizations[0].status, "applying");
  } finally {
    setApplyFlag(false);
  }
});

// --- Governed rollback (#914 follow-up): guidance becomes an executable action ---

// A tool service over `state` whose createInvocation records dispatches, with the
// real grant service — the rollback tests drive the same wiring the route uses.
function rollbackHarness({ authorizationStatus = "applied", withRunner = true } = {}) {
  let id = 500;
  const created = [];
  const state = {
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }, { id: "prj_b", ownerTeamId: "team_b" }],
    worktrees: [{ id: "wt_a", projectId: "prj_a" }],
    currentProjectId: "prj_a",
    agents: withRunner ? [governedApplyAgent()] : [],
    applications: [],
    invocations: [],
    claudeApplyAuthorizations: [{
      id: "cap_roll",
      proposalInvocationId: "inv_proposal",
      invocationId: "inv_proposal",
      projectId: "prj_a",
      worktreeId: "wt_a",
      status: authorizationStatus,
      applied: authorizationStatus === "applied",
      patch: "diff --git a/x.mjs b/x.mjs\n--- a/x.mjs\n+++ b/x.mjs\n@@ -1 +1,2 @@\n foo\n+bar\n",
      appliedFiles: [{ path: "x.mjs", added: 1, deleted: 0 }],
      rollback: { available: true, strategy: "git_apply_reverse" },
    }],
    approvalGrants: [],
    approvalTokenLegacyUses: { count: 0, lastAt: null },
    autoRunSettings: {},
    events: [],
    device: { unlinkState: "linked" },
  };
  const { issueApprovalGrant, validateApprovalToken } = createApprovalGrantService({
    state, now, nextId: (p) => `${p}_${id += 1}`, appendEvent: (e) => state.events.push(e), persistStateSoon: () => {},
  });
  const service = createToolService({
    state, now, nextId: (p) => `${p}_${id += 1}`, appendEvent: (e) => state.events.push(e),
    createInvocation: (task, agent, options) => { const inv = { id: `inv_rb_${id += 1}`, status: "queued", agentId: agent.id, options, task }; created.push(inv); state.invocations.push(inv); return inv; },
    startInvocationIfAllowed: () => {}, findApplication: () => null, findAgent: (aid) => state.agents.find((a) => a.id === aid) ?? null,
    planApplicationWrapperInvocation: () => ({}), validateApprovalToken, persistStateSoon: () => {},
  });
  const grantFor = (targetId, actor = ACTOR) => issueApprovalGrant({ action: "rollback_patch", targetId }, actor).body.token;
  return { state, service, created, grantFor };
}

test("rollback dispatches a --reverse run for an applied authorization under a fresh grant", () => {
  setApplyFlag(true);
  try {
    const { service, state, created, grantFor } = rollbackHarness();
    const res = service.rollbackClaudeApply("cap_roll", { approvalToken: grantFor("cap_roll") }, ACTOR);
    assert.equal(res.status, 202);
    assert.equal(res.body.status, "rolling_back");
    assert.ok(res.body.rollbackInvocationId);
    assert.equal(created.length, 1, "a queued rollback invocation was dispatched");
    const metadata = created[0].options.metadata;
    assert.equal(metadata.claudeApplyRollback, true, "the bridge injects --reverse from this flag");
    assert.match(metadata.applyPatch, /diff --git/, "the SAME server-held patch travels to the runner");
    assert.equal(state.claudeApplyAuthorizations[0].status, "rolling_back");
    assert(state.events.some((e) => e.type === "claude_rollback_authorized"));
  } finally {
    setApplyFlag(false);
  }
});

test("rollback refuses without a valid grant, on a non-applied authorization, and for a foreign team — no dispatch", () => {
  setApplyFlag(true);
  try {
    // Missing token.
    const h1 = rollbackHarness();
    const noToken = h1.service.rollbackClaudeApply("cap_roll", {}, ACTOR);
    assert.equal(noToken.status, 409);
    assert.equal(noToken.body.error, "approval_required");
    // A grant for the WRONG action (apply_patch) does not authorize a rollback.
    const h2 = rollbackHarness();
    const { issueApprovalGrant } = createApprovalGrantService({ state: h2.state, now, nextId: (p) => `${p}_w`, appendEvent: () => {}, persistStateSoon: () => {} });
    const applyGrant = issueApprovalGrant({ action: "apply_patch", targetId: "cap_roll" }, ACTOR).body.token;
    const wrong = h2.service.rollbackClaudeApply("cap_roll", { approvalToken: applyGrant }, ACTOR);
    assert.equal(wrong.status, 409);
    assert.match(wrong.body.reason, /action_mismatch/);
    assert.equal(h2.created.length, 0);
    // Not applied yet.
    const h3 = rollbackHarness({ authorizationStatus: "authorized" });
    const notApplied = h3.service.rollbackClaudeApply("cap_roll", { approvalToken: h3.grantFor("cap_roll") }, ACTOR);
    assert.equal(notApplied.status, 409);
    assert.equal(notApplied.body.error, "authorization_not_applied");
    // Foreign team reads as unknown (no existence leak).
    const h4 = rollbackHarness();
    const foreign = h4.service.rollbackClaudeApply("cap_roll", { approvalToken: h4.grantFor("cap_roll", { userId: "usr_b", teamId: "team_b" }) }, { userId: "usr_b", teamId: "team_b" });
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.error, "authorization_not_found");
    // No runner available.
    const h5 = rollbackHarness({ withRunner: false });
    const noRunner = h5.service.rollbackClaudeApply("cap_roll", { approvalToken: h5.grantFor("cap_roll") }, ACTOR);
    assert.equal(noRunner.status, 409);
    assert.equal(noRunner.body.error, "agent_not_available");
  } finally {
    setApplyFlag(false);
  }
});

test("a successful rollback run retires the authorization; a failed one returns it to applied", () => {
  const base = () => ({
    id: "cap_roll",
    proposalInvocationId: "inv_proposal",
    status: "rolling_back",
    rollbackInvocationId: "inv_rb",
    rollback: { available: true, strategy: "git_apply_reverse" },
  });
  // Success → rolled_back, guidance consumed.
  const okState = { claudeApplyAuthorizations: [base()], events: [] };
  const okSvc = createClaudeApplyImportService({ state: okState, now, appendEvent: (e) => okState.events.push(e) });
  const rolledBack = okSvc.recordClaudeApplyResult({
    invocation: { id: "inv_rb", options: { metadata: { claudeApplyAuthorizationId: "cap_roll", claudeApplyRollback: true } } },
    result: { output: { source: "claude", tool: "claude.apply.patch", applied: true, reversed: true, appliedFiles: [{ path: "x.mjs" }], verification: { checkPassed: true }, rollback: null } },
    agent: governedApplyAgent(),
  });
  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(rolledBack.rollback.available, false, "the rollback guidance is consumed");
  assert.equal(rolledBack.rollback.executed, true);
  assert(okState.events.some((e) => e.type === "claude_rollback_completed"));

  // Failure → back to applied (git apply is atomic; the patch is still on disk),
  // with the error recorded so the operator can retry under a fresh grant.
  const failState = { claudeApplyAuthorizations: [base()], events: [] };
  const failSvc = createClaudeApplyImportService({ state: failState, now, appendEvent: (e) => failState.events.push(e) });
  const failed = failSvc.recordClaudeApplyResult({
    invocation: { id: "inv_rb", options: { metadata: { claudeApplyAuthorizationId: "cap_roll", claudeApplyRollback: true } } },
    result: { output: { source: "claude", tool: "claude.apply.patch", applied: false, reversed: true, appliedFiles: [], verification: { checkPassed: false, error: "does not reverse" }, rollback: null } },
    agent: governedApplyAgent(),
  });
  assert.equal(failed.status, "applied", "a failed rollback leaves the patch applied");
  assert.match(failed.rollbackError, /does not reverse/);
  assert(failState.events.some((e) => e.type === "claude_rollback_failed"));
});

test("Phase 4b: recording a successful apply result marks the authorization applied with files + rollback", () => {
  const state = { claudeApplyAuthorizations: [{ id: "cap_1", proposalInvocationId: "inv_proposal", status: "applying", executable: true, executionInvocationId: "inv_apply" }], events: [] };
  const { recordClaudeApplyResult } = createClaudeApplyImportService({ state, now, appendEvent: (e) => state.events.push(e) });
  const authorization = recordClaudeApplyResult({
    invocation: { id: "inv_apply", options: { metadata: { claudeApplyAuthorizationId: "cap_1" } } },
    result: { output: { source: "claude", tool: "claude.apply.patch", applied: true, appliedFiles: [{ path: "x.mjs", added: 1, deleted: 0 }], verification: { checkPassed: true }, rollback: { available: true, strategy: "git_apply_reverse" } } },
    agent: governedApplyAgent(),
  });
  assert.equal(authorization.status, "applied");
  assert.equal(authorization.applied, true);
  assert.equal(authorization.executable, false);
  assert.deepEqual(authorization.appliedFiles.map((f) => f.path), ["x.mjs"]);
  assert.equal(authorization.rollback.available, true);
  assert(state.events.some((e) => e.type === "claude_apply_completed"));
});

test("Phase 4b: a failed apply marks the authorization failed with no rollback and no file claim", () => {
  const state = { claudeApplyAuthorizations: [{ id: "cap_1", status: "applying", executionInvocationId: "inv_apply" }], events: [] };
  const { recordClaudeApplyResult } = createClaudeApplyImportService({ state, now, appendEvent: (e) => state.events.push(e) });
  const authorization = recordClaudeApplyResult({
    invocation: { id: "inv_apply", options: { metadata: { claudeApplyAuthorizationId: "cap_1" } } },
    result: { output: { source: "claude", tool: "claude.apply.patch", applied: false, appliedFiles: [], verification: { checkPassed: false, error: "does not apply" }, rollback: null } },
    agent: governedApplyAgent(),
  });
  assert.equal(authorization.status, "failed");
  assert.equal(authorization.applied, false);
  assert.equal(authorization.rollback, null);
  assert.equal(authorization.verification.checkPassed, false);
  assert(state.events.some((e) => e.type === "claude_apply_failed"));
});

// --- Post-apply verification hook (#914 follow-up) ---

test("apply accepts an allowlisted verify id, stamps it on the dispatch, and rejects an unknown one", () => {
  setApplyFlag(true);
  try {
    const { service, state, grantFor } = harness();
    state.agents.push(governedApplyAgent());
    const created = [];
    let id = 300;
    const { validateApprovalToken } = createApprovalGrantService({ state, now, nextId: (p) => `${p}_${id += 1}`, appendEvent: (e) => state.events.push(e), persistStateSoon: () => {} });
    const svc = createToolService({
      state, now, nextId: (p) => `${p}_${id += 1}`, appendEvent: (e) => state.events.push(e),
      createInvocation: (task, agent, options) => { const inv = { id: `inv_v_${id += 1}`, status: "queued", agentId: agent.id, options, task }; created.push(inv); state.invocations.push(inv); return inv; },
      startInvocationIfAllowed: () => {}, findApplication: () => null, findAgent: (aid) => state.agents.find((a) => a.id === aid) ?? null,
      planApplicationWrapperInvocation: () => ({}), validateApprovalToken, persistStateSoon: () => {},
    });
    // Unknown verify id → refused before any grant is consumed or dispatch happens.
    const bad = svc.createToolInvocation("claude.apply.patch", { worktreeId: "wt_a", proposalInvocationId: "inv_proposal", approvalToken: "t", verify: "rm-rf" }, ACTOR);
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, "invalid_verify_command");
    assert.equal(created.length, 0);
    // Allowlisted id → stamped on the dispatch metadata and the authorization.
    const good = svc.createToolInvocation("claude.apply.patch", { worktreeId: "wt_a", proposalInvocationId: "inv_proposal", approvalToken: grantFor("inv_proposal"), verify: "node-test" }, ACTOR);
    assert.equal(good.status, 201);
    assert.equal(created[0].options.metadata.verifyCommandId, "node-test");
    assert.equal(state.claudeApplyAuthorizations[0].verifyCommandId, "node-test");
  } finally {
    setApplyFlag(false);
  }
});

test("completion folds the verification verdict into the authorization", () => {
  const state = { claudeApplyAuthorizations: [{ id: "cap_1", status: "applying", executionInvocationId: "inv_apply" }], events: [] };
  const { recordClaudeApplyResult } = createClaudeApplyImportService({ state, now, appendEvent: (e) => state.events.push(e) });
  const authorization = recordClaudeApplyResult({
    invocation: { id: "inv_apply", options: { metadata: { claudeApplyAuthorizationId: "cap_1" } } },
    result: { output: { source: "claude", tool: "claude.apply.patch", applied: true, appliedFiles: [{ path: "x.mjs" }], verification: { checkPassed: true, verifyCommand: "node --test", testsPassed: false, testExitCode: 1, testOutputPreview: "1 failing" }, rollback: { available: true } } },
    agent: governedApplyAgent(),
  });
  assert.equal(authorization.status, "applied", "a failing verification does not fail the apply");
  assert.equal(authorization.verification.testsPassed, false);
  assert.equal(authorization.verification.verifyCommand, "node --test");
  assert.equal(authorization.verification.testExitCode, 1);
  assert.match(authorization.verification.testOutputPreview, /1 failing/);
  assert.equal(authorization.rollback.available, true, "rollback stays available as the undo for a failed verification");
});

// --- Evidence unification: Claude applies share the codex.exec trust-ledger vocabulary ---

test("applied and rolled-back authorizations surface as governed file_change evidence; unexecuted ones do not", () => {
  const state = {
    worktrees: [{ id: "wt_a", worktreePath: "/tmp/wt-a" }],
    claudeApplyAuthorizations: [
      {
        id: "cap_applied", proposalInvocationId: "inv_p1", invocationId: "inv_p1", worktreeId: "wt_a",
        status: "applied", appliedFiles: [{ path: "x.mjs" }, { path: "y.mjs" }],
        resultSummary: "Applied a Claude patch touching 2 file(s).", appliedAt: "2026-07-14T00:01:00.000Z",
      },
      {
        id: "cap_rolled", proposalInvocationId: "inv_p2", invocationId: "inv_p2", worktreeId: "wt_a",
        status: "rolled_back", appliedFiles: [{ path: "z.mjs" }], rolledBackAt: "2026-07-14T00:02:00.000Z",
      },
      // Authorized but never executed: nothing reached the worktree, no evidence row.
      { id: "cap_pending", proposalInvocationId: "inv_p3", invocationId: "inv_p3", status: "authorized", files: [{ path: "n.mjs" }] },
    ],
  };
  const records = buildEvidenceCenterRecords({
    state,
    findInvocation: () => null,
    codexSessionForInvocation: () => null,
    repoPathForEvidence: () => null,
  }).filter((record) => record.source === "governed_claude_apply");
  assert.equal(records.length, 3, "two applied files + one rolled-back file");
  assert.ok(records.every((record) => record.type === "file_change" && record.marker === "governed" && record.redactionState === "summary_only"),
    "claude applies use the same trust-ledger vocabulary as codex exec");
  assert.deepEqual(records.filter((r) => r.invocationId === "inv_p1").map((r) => r.summary).sort(), ["applied: x.mjs", "applied: y.mjs"]);
  assert.equal(records.find((r) => r.invocationId === "inv_p2").summary, "rolled back: z.mjs", "evidence of a write does not vanish on undo — the summary reflects the final state");
  assert.equal(records[0].repoPath, "/tmp/wt-a");
  assert.ok(!records.some((r) => r.invocationId === "inv_p3"), "an unexecuted authorization leaves no file_change evidence");
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
