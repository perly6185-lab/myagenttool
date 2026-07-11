import assert from "node:assert/strict";
import { test } from "node:test";

import { evidenceLedger } from "../src/read-models/evidence-ledger.mjs";

const inv = (id, over = {}) => ({ id, task: `task ${id}`, agentId: "agt", projectId: "projA", status: "succeeded", createdAt: "2026-07-09T00:00:00Z", ...over });

test("rolls up review findings by severity + flags high-severity as attention", () => {
  const rows = evidenceLedger({
    invocations: [inv("inv_1")],
    reviewFindings: [
      { invocationId: "inv_1", severity: "high", projectId: "projA" },
      { invocationId: "inv_1", severity: "medium" },
      { invocationId: "inv_1", severity: "low" },
    ],
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].review, { total: 3, high: 1, medium: 1, low: 1 });
  assert.equal(rows[0].attention, true);
  assert.match(rows[0].attentionReasons[0], /1 high-severity finding/);
});

test("medium/low-only findings produce a row but NOT attention", () => {
  const rows = evidenceLedger({
    invocations: [inv("inv_1")],
    reviewFindings: [{ invocationId: "inv_1", severity: "medium" }, { invocationId: "inv_1", severity: "low" }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].attention, false);
  assert.deepEqual(rows[0].attentionReasons, []);
});

test("denied audit + failed status + troubleshooting each earn a row and attention", () => {
  const rows = evidenceLedger({
    invocations: [inv("inv_denied"), inv("inv_failed", { status: "failed" }), inv("inv_ts")],
    auditSummaries: [{ invocationId: "inv_denied", permissionDecision: "denied", status: "rejected" }],
    troubleshootingReports: [{ invocationId: "inv_ts", suggestedFixes: ["a", "b"], status: "generated" }],
  });
  const byId = Object.fromEntries(rows.map((r) => [r.invocationId, r]));
  assert.equal(rows.length, 3);
  assert.match(byId.inv_denied.attentionReasons.join(), /permission denied/);
  assert.match(byId.inv_failed.attentionReasons.join(), /run failed/);
  assert.equal(byId.inv_ts.troubleshooting.fixes, 2);
  assert.match(byId.inv_ts.attentionReasons.join(), /needs troubleshooting/);
});

test("a plain allowed run with no findings/evidence is EXCLUDED (not just the invocation list)", () => {
  const rows = evidenceLedger({
    invocations: [inv("inv_clean")],
    auditSummaries: [{ invocationId: "inv_clean", permissionDecision: "allowed", status: "succeeded" }],
  });
  assert.deepEqual(rows, []);
});

test("runtime (codex/terminal) evidence count attaches and earns a row", () => {
  const rows = evidenceLedger({
    invocations: [inv("inv_1")],
    evidenceCenterRecords: [
      { invocationId: "inv_1", type: "file_change" },
      { invocationId: "inv_1", type: "command" },
      { invocationId: null, type: "imported_evidence" }, // no subject — ignored
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].runtimeEvidence, 2);
});

test("evidence whose invocation isn't visible never produces a row (tenancy)", () => {
  const rows = evidenceLedger({
    invocations: [inv("inv_mine")],
    reviewFindings: [{ invocationId: "inv_theirs", severity: "high" }], // foreign run
  });
  assert.deepEqual(rows, []);
});

test("recovery requests attach to the failed run: latest status, executed flag, application context", () => {
  const rows = evidenceLedger({
    invocations: [
      inv("inv_failed", {
        status: "failed",
        options: { metadata: { source: "application_orchestration", applicationId: "app_1", applicationName: "ccusage", routineId: "rt_1" } },
      }),
    ],
    applicationRecoveryActions: [
      { id: "rec_1", invocationId: "inv_failed", actionType: "rerun", status: "failed", createdAt: "2026-07-11T01:00:00Z", updatedAt: "2026-07-11T01:00:00Z" },
      { id: "rec_2", invocationId: "inv_failed", actionType: "regenerate_orchestration", status: "executed", createdAt: "2026-07-11T02:00:00Z", updatedAt: "2026-07-11T02:30:00Z" },
    ],
  });
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.deepEqual(row.application, { id: "app_1", name: "ccusage", routineId: "rt_1" });
  assert.deepEqual(row.recovery, { total: 2, latestStatus: "executed", latestActionType: "regenerate_orchestration", executed: true });
  // The failed status flags attention; a successfully executed recovery adds no extra reason.
  assert.deepEqual(row.attentionReasons, ["run failed"]);
});

test("unresolved recovery states add attention reasons", () => {
  const at = (id, status) => ({ id, invocationId: `inv_${id}`, actionType: "regenerate_orchestration", status, createdAt: "2026-07-11T01:00:00Z" });
  const rows = evidenceLedger({
    invocations: [
      inv("inv_p", { status: "failed" }), inv("inv_f", { status: "failed" }),
      inv("inv_d", { status: "failed" }), inv("inv_t", { status: "failed" }),
    ],
    applicationRecoveryActions: [
      { ...at("p", "approval_pending"), invocationId: "inv_p" },
      { ...at("f", "failed"), invocationId: "inv_f" },
      { ...at("d", "approval_denied"), invocationId: "inv_d" },
      { ...at("t", "approval_timed_out"), invocationId: "inv_t" },
    ],
  });
  const byId = Object.fromEntries(rows.map((r) => [r.invocationId, r]));
  assert.match(byId.inv_p.attentionReasons.join(), /recovery awaiting approval/);
  assert.match(byId.inv_f.attentionReasons.join(), /recovery failed/);
  assert.match(byId.inv_d.attentionReasons.join(), /recovery denied/);
  assert.match(byId.inv_t.attentionReasons.join(), /recovery approval timed out/);
});

test("a recovery RESULT run earns a row with provenance even when otherwise clean", () => {
  const rows = evidenceLedger({
    invocations: [inv("inv_result", { status: "succeeded" })],
    applicationRecoveryActions: [
      { id: "rec_9", invocationId: "inv_failed_elsewhere", resultInvocationId: "inv_result", actionType: "rerun", status: "executed" },
    ],
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].recoveryResultOf, { invocationId: "inv_failed_elsewhere", actionType: "rerun", recoveryActionRequestId: "rec_9" });
  assert.equal(rows[0].recovery, null); // provenance, not an open recovery on this run
  assert.equal(rows[0].attention, false); // a clean recovery product needs no attention
});

test("runs without recovery/application context keep null fields (shape regression)", () => {
  const rows = evidenceLedger({
    invocations: [inv("inv_plain", { status: "failed" })],
  });
  assert.equal(rows[0].application, null);
  assert.equal(rows[0].recovery, null);
  assert.equal(rows[0].recoveryResultOf, null);
});

test("rows are newest-first by createdAt", () => {
  const rows = evidenceLedger({
    invocations: [
      inv("inv_old", { status: "failed", createdAt: "2026-07-09T01:00:00Z" }),
      inv("inv_new", { status: "failed", createdAt: "2026-07-09T05:00:00Z" }),
      inv("inv_mid", { status: "failed", createdAt: "2026-07-09T03:00:00Z" }),
    ],
  });
  assert.deepEqual(rows.map((r) => r.invocationId), ["inv_new", "inv_mid", "inv_old"]);
});

test("empty / missing inputs → empty ledger, no throw", () => {
  assert.deepEqual(evidenceLedger(), []);
  assert.deepEqual(evidenceLedger({ invocations: [inv("x")] }), []); // no evidence for x
});
