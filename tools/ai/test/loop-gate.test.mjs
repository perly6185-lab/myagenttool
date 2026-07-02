/*
 * Tests for the loop promotion human-gate state machine: the pure gate record
 * (createLoopHumanGate) and the event-replay reconstruction
 * (registryEntryFromEvents) that decides a run's gate state from its event log
 * — required → approved (clears the error, records the approver) or rejected
 * (keeps the reason as the error). A regression here silently mis-states
 * whether a human approved a promotion.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createLoopHumanGate, registryEntryFromEvents } from "../src/loop/registry.mjs";

const T0 = "2026-07-02T00:00:00.000Z";
const T1 = "2026-07-02T00:01:00.000Z";
const T2 = "2026-07-02T00:02:00.000Z";

function baseEvents() {
  return [
    { type: "loop_run_created", createdAt: T0, data: { apply: true, verify: true, openPr: false, branch: "loop/issue-42" } },
    {
      type: "loop_human_gate_required",
      createdAt: T1,
      data: {
        gateId: "gate-1",
        reason: "Diff touches auth code.",
        risk: "high",
        scope: "apps/server",
        requestedAction: "Review the diff.",
        requestedBy: "loop-worker",
        expiresAt: null,
        evidence: "diff.patch",
      },
    },
  ];
}

function replay(events) {
  const runDir = mkdtempSync(join(tmpdir(), "loop-gate-"));
  return registryEntryFromEvents({ runId: "loop-issue-42-abc", runDir, events });
}

test("createLoopHumanGate: a fresh gate is requested with the full audit shape", () => {
  const gate = createLoopHumanGate({
    reason: "r", risk: "high", scope: "s", requestedAction: "a", requestedBy: "w", expiresAt: null, evidence: "e",
  });
  assert.match(gate.gateId, /^gate-/);
  assert.equal(gate.state, "requested");
  assert.equal(gate.approvedBy, null);
  assert.equal(gate.rejectedBy, null);
  assert.equal(gate.evidence, "e");
});

test("replay: gate required → the run carries a requested gate and the reason as its error", () => {
  const entry = replay(baseEvents());
  assert.equal(entry.issue, "42", "issue id derived from the runId");
  assert.equal(entry.humanGate.state, "requested");
  assert.equal(entry.humanGate.risk, "high");
  assert.equal(entry.lastError, "Diff touches auth code.");
  assert.equal(entry.humanApproval, null);
});

test("replay: approval flips the gate, records the approver, clears the error", () => {
  const entry = replay([
    ...baseEvents(),
    { type: "loop_human_gate_approved", createdAt: T2, data: { approvedBy: "usr_admin" } },
  ]);
  assert.equal(entry.humanGate.state, "approved");
  assert.equal(entry.humanGate.approvedBy, "usr_admin");
  assert.equal(entry.humanGate.approvedAt, T2);
  assert.equal(entry.humanApproval, "usr_admin");
  assert.equal(entry.lastError, null);
});

test("replay: rejection keeps the rejection reason as the run's error", () => {
  const entry = replay([
    ...baseEvents(),
    { type: "loop_human_gate_rejected", createdAt: T2, data: { rejectedBy: "usr_admin", reason: "Too risky." } },
  ]);
  assert.equal(entry.humanGate.state, "rejected");
  assert.equal(entry.humanGate.rejectedBy, "usr_admin");
  assert.equal(entry.lastError, "Too risky.");
  assert.equal(entry.humanApproval, null);
});

test("replay: an approval without a prior gate request is ignored", () => {
  const entry = replay([
    { type: "loop_run_created", createdAt: T0, data: { branch: "loop/issue-42" } },
    { type: "loop_human_gate_approved", createdAt: T1, data: { approvedBy: "usr_admin" } },
  ]);
  assert.equal(entry.humanGate, null);
  assert.equal(entry.humanApproval, null);
});
