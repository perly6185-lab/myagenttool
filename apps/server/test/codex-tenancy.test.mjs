/*
 * Route-level regression test for the codex approval-broker tenancy guard.
 *
 * Codex approval requests carry an invocationId; resolving one is a decision on
 * another team's codex session, so it must be scoped by that invocation's
 * project. Drives handleCodexRoutes with stubs — no server boot.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { handleCodexRoutes } from "../src/routes/codex.mjs";

const TEAM_A = "team_a";
const TEAM_B = "team_b";

function stateWithPendingApproval(status = "pending") {
  return {
    projects: [{ id: "proj_a", ownerTeamId: TEAM_A }],
    invocations: [{ id: "inv_1", projectId: "proj_a" }],
    codexApprovalBrokerRequests: [{ id: "cdx_appr_1", invocationId: "inv_1", status }],
  };
}

async function approve({ actor, state, recoverTimedOutCodexApproval = undefined }) {
  const calls = [];
  let resolved = false;
  const handled = await handleCodexRoutes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://local/api/codex/approval-broker/cdx_appr_1/approve"),
    sendJson: (_res, status, payload) => calls.push({ status, payload }),
    readJson: async () => ({}),
    state,
    actor,
    recordCodexHookEvent: () => ({}),
    expireCodexApprovalBrokerRequests: () => {},
    resolveCodexApprovalBrokerRequest: (request) => {
      resolved = true;
      return { ...request, status: "approved" };
    },
    recoverTimedOutCodexApproval,
    createCodexImportedEvidenceRecord: () => ({}),
    createCodexChangeReview: () => ({}),
  });
  return { handled, calls, resolved };
}

test("codex approval-broker: a foreign team cannot resolve another team's request (404, no side effect)", async () => {
  const { handled, calls, resolved } = await approve({
    actor: { teamId: TEAM_B },
    state: stateWithPendingApproval(),
  });
  assert.equal(handled, true);
  assert.equal(calls.at(-1).status, 404);
  assert.equal(resolved, false, "the approval must not be resolved for a foreign team");
});

test("codex approval-broker: the owning team can resolve its request", async () => {
  const { calls, resolved } = await approve({
    actor: { teamId: TEAM_A },
    state: stateWithPendingApproval(),
  });
  assert.equal(calls.at(-1).status, 200);
  assert.equal(resolved, true);
});

test("codex approval-broker: the owning team can recover an approval that timed out", async () => {
  let recovered = false;
  const { calls, resolved } = await approve({
    actor: { teamId: TEAM_A, userId: "usr_owner" },
    state: stateWithPendingApproval("timed_out"),
    recoverTimedOutCodexApproval: async (request, actor) => {
      recovered = true;
      assert.equal(request.id, "cdx_appr_1");
      assert.equal(actor.userId, "usr_owner");
      return { status: "resumed", autoRunId: "aur_1", resumedInvocationId: "inv_2" };
    },
  });
  assert.equal(calls.at(-1).status, 200);
  assert.equal(calls.at(-1).payload.recoveredAfterTimeout, true);
  assert.equal(calls.at(-1).payload.recovery.status, "resumed");
  assert.equal(resolved, false, "the immutable timed-out row is recovered, not rewritten");
  assert.equal(recovered, true);
});
