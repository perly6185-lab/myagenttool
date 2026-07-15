/*
 * #913: the artifact bindings stamped on a completed claude.propose.patch result.
 * The content hash is computed server-side (tamper evidence for the later apply
 * gate), the wrapper-reported base commit is kept only when it is a real sha, and
 * the descriptor lineage stamped at creation is copied onto the artifact. Every
 * other tool's result passes through untouched.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { proposalContentHash, stampClaudeProposalArtifact } from "../src/services/claude-propose-imports.mjs";

const PATCH = "diff --git a/x.mjs b/x.mjs\n--- a/x.mjs\n+++ b/x.mjs\n@@ -1 +1,2 @@\n foo\n+bar\n";
const SHA = "AbCd".repeat(10);

function proposeInvocation(metadata = {}) {
  return { options: { metadata: { tool: "claude.propose.patch", ...metadata } } };
}

test("stamps the sha256 content hash of the patch on the artifact", () => {
  const result = { output: { patch: PATCH } };
  const stamped = stampClaudeProposalArtifact({ invocation: proposeInvocation(), result });
  assert.equal(stamped.contentHash, createHash("sha256").update(PATCH, "utf8").digest("hex"));
  assert.equal(stamped.contentHash, proposalContentHash(PATCH));
});

test("keeps a real wrapper-reported base commit (lowercased) and nulls anything else", () => {
  const good = { output: { patch: PATCH, baseCommit: ` ${SHA} ` } };
  stampClaudeProposalArtifact({ invocation: proposeInvocation(), result: good });
  assert.equal(good.output.baseCommit, SHA.toLowerCase());

  for (const junk of ["not-a-sha", "abc123", 42, null, `${SHA}0`, "$(rm -rf /)"]) {
    const bad = { output: { patch: PATCH, baseCommit: junk } };
    stampClaudeProposalArtifact({ invocation: proposeInvocation(), result: bad });
    assert.equal(bad.output.baseCommit, null, `junk base ${String(junk)} must not become a binding`);
  }
});

test("copies the descriptor lineage stamped at creation onto the artifact", () => {
  const result = { output: { patch: PATCH } };
  stampClaudeProposalArtifact({
    invocation: proposeInvocation({ applicationId: "app_claude", descriptorRevision: 3 }),
    result,
  });
  assert.equal(result.output.applicationId, "app_claude");
  assert.equal(result.output.descriptorRevision, 3);
});

test("no-ops for other tools, a missing output, and an empty patch", () => {
  const otherTool = { output: { patch: PATCH } };
  assert.equal(stampClaudeProposalArtifact({ invocation: { options: { metadata: { tool: "claude.review.diff" } } }, result: otherTool }), null);
  assert.equal(otherTool.output.contentHash, undefined);

  assert.equal(stampClaudeProposalArtifact({ invocation: proposeInvocation(), result: null }), null);
  assert.equal(stampClaudeProposalArtifact({ invocation: proposeInvocation(), result: { output: { patch: "   " } } }), null);
  assert.equal(stampClaudeProposalArtifact({ invocation: proposeInvocation(), result: { output: { patch: 7 } } }), null);
});

// --- #913: Evidence Center provenance for the proposal artifact ---

test("a completed proposal leaves a provenance row with bindings and verification guidance", async () => {
  const { buildEvidenceCenterRecords } = await import("../src/read-models/evidence-center.mjs");
  const invocation = {
    id: "inv_p1",
    status: "succeeded",
    agentId: "agt_claude_propose_patch",
    completedAt: "2026-07-15T00:00:00.000Z",
    options: { metadata: { tool: "claude.propose.patch", worktreeId: "wt_a" } },
    result: { output: {
      patch: PATCH,
      summary: "Add a null guard.",
      files: [{ path: "x.mjs", action: "modified" }],
      contentHash: proposalContentHash(PATCH),
      baseCommit: SHA.toLowerCase(),
      descriptorRevision: 2,
      applicationId: "app_claude",
    } },
  };
  const state = { invocations: [invocation], worktrees: [{ id: "wt_a", worktreePath: "/repo/wt_a" }] };
  const records = buildEvidenceCenterRecords({
    state,
    findInvocation: (id) => state.invocations.find((i) => i.id === id) ?? null,
    codexSessionForInvocation: () => null,
    repoPathForEvidence: () => null,
  });
  const row = records.find((r) => r.type === "patch_proposal");
  assert.ok(row, "the proposal artifact is trust-ledger evidence");
  assert.equal(row.source, "governed_claude_propose");
  assert.equal(row.redactionState, "summary_only");
  assert.equal(row.invocationId, "inv_p1");
  assert.equal(row.repoPath, "/repo/wt_a");
  assert.equal(row.provenance.contentHash, proposalContentHash(PATCH));
  assert.equal(row.provenance.baseCommit, SHA.toLowerCase());
  assert.equal(row.provenance.descriptorRevision, 2);
  assert.equal(row.provenance.applicationId, "app_claude");
  assert.match(row.verificationGuidance, /revalidates the content hash/);
  assert.match(row.summary, /proposed: 1 file/);

  // Provenance must not vanish with the payload: after the retention reap the
  // row remains, marked payload_reaped.
  delete invocation.result.output.patch;
  invocation.result.output.patchRedacted = true;
  const after = buildEvidenceCenterRecords({
    state,
    findInvocation: (id) => state.invocations.find((i) => i.id === id) ?? null,
    codexSessionForInvocation: () => null,
    repoPathForEvidence: () => null,
  });
  const reaped = after.find((r) => r.type === "patch_proposal");
  assert.ok(reaped);
  assert.equal(reaped.redactionState, "payload_reaped");
});
