/*
 * Efficiency (review follow-up): a claude.propose.patch result carries the full
 * proposed diff (up to 100 KB). buildPublicState must bound it to a preview so it
 * does not ride every /api/state poll verbatim — the console only needs a preview
 * to display and the invocation id to apply.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPublicState } from "../src/read-models/state.mjs";

function build(invocations) {
  return buildPublicState({
    namespace: "test",
    protocolVersion: "1",
    state: { projects: [{ id: "prj_a", ownerTeamId: "team_a" }], invocations },
    defaultProjectPath: "/tmp",
    currentProject: () => null,
    defaultAgent: () => null,
    loopRoutineReadModel: () => null,
    codexApprovalQueue: () => [],
    evidenceCenterRecords: () => [],
    ledgerSummary: () => null,
    budgetStatuses: () => [],
  });
}

test("a large proposal patch is bounded to a preview in public state", () => {
  const bigPatch = `diff --git a/x b/x\n${"+line\n".repeat(5000)}`; // ~30 KB
  const publicState = build([{
    id: "inv_p", projectId: "prj_a", status: "succeeded",
    options: { metadata: { tool: "claude.propose.patch", worktreeId: "wt_a", projectId: "prj_a" } },
    result: { output: { source: "claude", tool: "claude.propose.patch", summary: "big", patch: bigPatch, files: [] } },
  }]);
  const projected = publicState.invocations.find((item) => item.id === "inv_p");
  assert.ok(projected.result.output.patch.length < bigPatch.length, "the full patch must not ride public state");
  assert.ok(projected.result.output.patch.length <= 8100, "bounded to the preview cap + marker");
  assert.match(projected.result.output.patch, /patch truncated/);
  assert.equal(projected.result.output.patchTruncated, true);
});

test("a small proposal patch is left intact", () => {
  const smallPatch = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n";
  const publicState = build([{
    id: "inv_s", projectId: "prj_a", status: "succeeded",
    options: { metadata: { tool: "claude.propose.patch", worktreeId: "wt_a", projectId: "prj_a" } },
    result: { output: { source: "claude", tool: "claude.propose.patch", patch: smallPatch, files: [] } },
  }]);
  const projected = publicState.invocations.find((item) => item.id === "inv_s");
  assert.equal(projected.result.output.patch, smallPatch, "a small patch is shown in full");
  assert.ok(!projected.result.output.patchTruncated);
});

test("a non-proposal invocation result is untouched", () => {
  const publicState = build([{
    id: "inv_o", projectId: "prj_a", status: "succeeded",
    options: { metadata: { tool: "codex.exec" } },
    result: { output: { source: "codex", patch: "x".repeat(20000) } },
  }]);
  const projected = publicState.invocations.find((item) => item.id === "inv_o");
  assert.equal(projected.result.output.patch.length, 20000, "only propose patches are bounded");
});

// --- #913: applyValidity — staleness visible in the read model, not at the gate ---

function proposeInvocation(output, { status = "succeeded" } = {}) {
  return {
    id: "inv_v", projectId: "prj_a", status,
    options: { metadata: { tool: "claude.propose.patch", worktreeId: "wt_a", projectId: "prj_a" } },
    result: { output: { source: "claude", tool: "claude.propose.patch", files: [], ...output } },
  };
}

function buildWith(invocations, stateExtra = {}) {
  return buildPublicState({
    namespace: "test",
    protocolVersion: "1",
    state: { projects: [{ id: "prj_a", ownerTeamId: "team_a" }], invocations, ...stateExtra },
    defaultProjectPath: "/tmp",
    currentProject: () => null,
    defaultAgent: () => null,
    loopRoutineReadModel: () => null,
    codexApprovalQueue: () => [],
    evidenceCenterRecords: () => [],
    ledgerSummary: () => null,
    budgetStatuses: () => [],
  });
}

test("a stamped, current artifact reads applyReady with no reasons", () => {
  const publicState = buildWith([proposeInvocation({ patch: "diff --git a/x b/x\n+y\n", contentHash: "aa".repeat(32) })]);
  const validity = publicState.invocations[0].result.output.applyValidity;
  assert.deepEqual(validity, { applyReady: true, reasons: [] });
});

test("a reaped payload and a missing stamp are visibly not applicable", () => {
  const reaped = buildWith([proposeInvocation({ patchRedacted: true, contentHash: "aa".repeat(32) })]);
  assert.equal(reaped.invocations[0].result.output.applyValidity.applyReady, false);
  assert.ok(reaped.invocations[0].result.output.applyValidity.reasons.includes("payload_reaped"));

  const unstamped = buildWith([proposeInvocation({ patch: "diff --git a/x b/x\n+y\n" })]);
  assert.ok(unstamped.invocations[0].result.output.applyValidity.reasons.includes("bindings_missing"));
});

test("a proposal bound to a replaced or revision-moved descriptor reads descriptor_stale", () => {
  const artifact = { patch: "diff --git a/x b/x\n+y\n", contentHash: "aa".repeat(32), applicationId: "app_claude", descriptorRevision: 1 };
  const moved = buildWith([proposeInvocation(artifact)], { applications: [{ id: "app_claude", descriptorRevision: 2 }] });
  assert.ok(moved.invocations[0].result.output.applyValidity.reasons.includes("descriptor_stale"));

  const replaced = buildWith([proposeInvocation(artifact)], { applications: [{ id: "app_claude", descriptorRevision: 1, successorApplicationId: "app_claude_v2" }] });
  assert.ok(replaced.invocations[0].result.output.applyValidity.reasons.includes("descriptor_stale"));

  const current = buildWith([proposeInvocation(artifact)], { applications: [{ id: "app_claude", descriptorRevision: 1 }] });
  assert.equal(current.invocations[0].result.output.applyValidity.applyReady, true);
});
