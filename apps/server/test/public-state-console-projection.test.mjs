import assert from "node:assert/strict";
import test from "node:test";

import { buildConsoleState } from "../src/read-models/state.mjs";

test("console state bounds history while preserving active, pending, and attention runs", () => {
  const invocations = Array.from({ length: 420 }, (_, index) => ({
    id: `inv_${index}`,
    status: index === 390 ? "running" : "succeeded",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  }));
  const state = {
    namespace: "local",
    projects: [{ id: "project_1" }],
    invocations,
    pendingDecisions: [{ id: "decision_1", ref: { invocationId: "inv_400" } }],
    evidenceLedger: invocations.map((row, index) => ({
      invocationId: row.id,
      attention: index === 410,
    })),
    auditSummaries: invocations.map((row) => ({ invocationId: row.id })),
    evidenceCenterRecords: invocations.map((row) => ({ invocationId: row.id })),
    spans: invocations.map((row) => ({ invocationId: row.id })),
    events: [{ id: "global_event" }, ...invocations.map((row) => ({ invocationId: row.id }))],
  };

  const projected = buildConsoleState(state);
  const ids = new Set(projected.invocations.map((row) => row.id));

  assert.equal(projected.namespace, "local");
  assert.deepEqual(projected.projects, state.projects);
  assert.equal(projected.invocations.length, 300);
  assert.equal(projected.invocations[0].id, "inv_419", "the browser keeps newest-first ordering");
  assert.equal(ids.has("inv_419"), true, "the newest completed invocation is retained");
  assert.equal(ids.has("inv_0"), false, "old completed history falls outside the console window");
  assert.equal(ids.has("inv_390"), true, "active invocation survives outside the recent window");
  assert.equal(ids.has("inv_400"), true, "pending-decision invocation survives outside the recent window");
  assert.equal(ids.has("inv_410"), true, "attention invocation survives outside the recent window");
  assert.equal(projected.auditSummaries.every((row) => ids.has(row.invocationId)), true);
  assert.equal(projected.evidenceCenterRecords.every((row) => ids.has(row.invocationId)), true);
  assert.equal(projected.events.some((row) => row.id === "global_event"), true);
  assert.equal(projected.stateWindow.projection, "console");
  assert.equal(projected.stateWindow.totals.invocations, 420);
  assert.equal(projected.stateWindow.truncated.includes("invocations"), true);
});

test("console state reports and enforces per-collection limits", () => {
  const invocation = { id: "inv_active", status: "running" };
  const spans = Array.from({ length: 900 }, (_, index) => ({ id: `span_${index}`, invocationId: invocation.id }));
  const projected = buildConsoleState({ invocations: [invocation], spans });

  assert.equal(projected.spans.length, 800);
  assert.equal(projected.stateWindow.totals.spans, 900);
  assert.equal(projected.stateWindow.truncated.includes("spans"), true);
});
