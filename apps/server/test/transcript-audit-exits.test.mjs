import assert from "node:assert/strict";
import { test } from "node:test";
import { createInvocationCompletionRuntime } from "../src/services/invocations/completion.mjs";
import { evidenceLedger } from "../src/read-models/evidence-ledger.mjs";
import { createM3Service } from "../src/services/m3.mjs";
import { transcriptContentHash } from "../src/services/run-transcripts.mjs";

// #1085: transcripts become visible from the sanctioned audit exits — the
// per-run audit summary, the evidence ledger, and the audit export.

const NOW = "2026-07-15T12:00:00.000Z";
const now = () => NOW;

const transcriptResult = () => ({
  transcript: { blocks: [{ kind: "thinking", text: "look", durationMs: 1000 }, { kind: "text", text: "**done**" }] },
});

function completionHarness() {
  const state = {
    runTranscripts: [],
    auditSummaries: [],
    agentUsageSummaries: [],
    spans: [],
    compareRuns: [],
    invocations: [],
  };
  const runtime = createInvocationCompletionRuntime({
    state,
    now,
    appendEvent: () => {},
    persistStateSoon: () => {},
    persistStateNow: () => {},
    namespace: "test",
    protocolVersion: "1",
    findAgent: () => null,
    findInvocation: () => null,
    closeCodexSession: () => {},
    isTerminal: (status) => ["succeeded", "failed", "cancelled", "timed_out"].includes(status),
  });
  return { state, runtime };
}

const makeInvocation = (id) => ({
  id,
  status: "running",
  agentId: "agt_claude",
  projectId: "prj_a",
  traceId: `trc_${id}`,
  requestedBy: "usr_a",
  delivery: { deviceId: "dev_1" },
  cancellation: { state: "none" },
});

// --- exit 1: the audit summary ---

test("audit summary states the transcript's presence, hash and size — metadata only, no payload", () => {
  const { state, runtime } = completionHarness();
  runtime.completeInvocation(makeInvocation("inv_t"), { status: "succeeded", result: transcriptResult() });
  const summary = state.auditSummaries.find((item) => item.invocationId === "inv_t");
  assert.equal(summary.transcript.present, true);
  assert.equal(summary.transcript.contentHash, state.runTranscripts[0].contentHash);
  assert.equal(summary.transcript.blocks, 2);
  assert.equal(summary.transcript.truncated, false);
  assert.equal(typeof summary.transcript.blocks, "number", "counts, never block payloads");
});

test("audit summary of a transcript-less run says null, not a fabricated stamp", () => {
  const { state, runtime } = completionHarness();
  runtime.completeInvocation(makeInvocation("inv_plain"), { status: "succeeded", result: { output: {} } });
  const summary = state.auditSummaries.find((item) => item.invocationId === "inv_plain");
  assert.equal(summary.transcript, null);
});

// --- exit 2: the evidence ledger ---

const ledgerInvocation = (id, status = "succeeded") => ({ id, status, agentId: "agt_claude", projectId: "prj_a", createdAt: NOW, input: { task: "t" } });

test("evidence ledger rows carry transcript summary metadata (hash/counts, never blocks)", () => {
  const rows = evidenceLedger({
    invocations: [ledgerInvocation("inv_1", "failed")],
    runTranscripts: [{ invocationId: "inv_1", contentHash: "a".repeat(64), blocks: [{ kind: "text", text: "x" }], truncated: false, payloadReaped: false }],
  });
  assert.equal(rows.length, 1, "failed run earns a row as before");
  assert.equal(rows[0].transcript.present, true);
  assert.equal(rows[0].transcript.contentHash, "a".repeat(64));
  assert.equal(rows[0].transcript.blocks, 1);
  assert.ok(!Array.isArray(rows[0].transcript.blocks), "block COUNT, not the blocks themselves");
});

test("a transcript's mere presence does not create a ledger row; a SUPERSEDED one does, with an attention reason", () => {
  const quiet = evidenceLedger({
    invocations: [ledgerInvocation("inv_ok")],
    runTranscripts: [{ invocationId: "inv_ok", contentHash: "b".repeat(64), blocks: [] }],
  });
  assert.equal(quiet.length, 0, "plain successful run with a transcript stays off the trust ledger");

  const flagged = evidenceLedger({
    invocations: [ledgerInvocation("inv_swap")],
    runTranscripts: [{ invocationId: "inv_swap", contentHash: "c".repeat(64), supersededHash: "d".repeat(64), blocks: [] }],
  });
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].transcript.superseded, true);
  assert.equal(flagged[0].attention, true);
  assert.ok(flagged[0].attentionReasons.includes("transcript superseded after delivery"));
});

// --- exit 3: the audit export ---

test("audit export accepts the transcript subject and refs every transcript record", () => {
  const state = {
    invocations: [],
    lifecycleAuditRecords: [],
    lifecycleRecipes: [],
    lifecycleRollbackRequests: [],
    quotaDecisionRecords: [],
    aiUsageRecords: [],
    importedUsageEstimates: [],
    ledgerEntries: [],
    policyDecisionRecords: [],
    lifecyclePolicyDecisions: [],
    approvalRequests: [],
    codexApprovalBrokerRequests: [],
    auditSummaries: [],
    privateCatalogEntries: [],
    signedBundleManifests: [],
    auditExportRequests: [],
    events: [],
    runTranscripts: [
      { id: "trs_inv_1", invocationId: "inv_1", contentHash: transcriptContentHash([]), blocks: [] },
      { id: "trs_inv_2", invocationId: "inv_2", contentHash: transcriptContentHash([]), blocks: [] },
    ],
    privateDeploymentConfig: { mode: "private_deployment", auditExportEnabled: true, auditSinks: [], immutableAuditOption: "disabled" },
  };
  let id = 0;
  const m3 = createM3Service({
    state,
    now,
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent: () => {},
    findAgent: () => null,
  });
  const request = m3.createAuditExportRequest({ subjects: ["transcript", "audit"], dryRun: false });
  assert.equal(request.status, "exported");
  assert.equal(request.recordCounts.transcript, 2);
  const transcriptRefs = request.manifest.recordRefs.filter((ref) => ref.subject === "transcript");
  assert.deepEqual(transcriptRefs.map((ref) => ref.id).sort(), ["trs_inv_1", "trs_inv_2"]);
});
