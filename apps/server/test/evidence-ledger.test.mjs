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
