import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeDeliveryEvidenceDomain,
  normalizeDeliveryEvidenceRisk,
  normalizeDeliveryEvidenceStatus,
  normalizeWorkItemReviewBlockedReasonCodes,
  projectOfficeBatchEvidence,
} from "../src/delivery-evidence.mjs";

test("delivery evidence values fail closed when a producer sends an unknown enum member", () => {
  assert.equal(normalizeDeliveryEvidenceStatus("future_ready_state"), "evidence_incomplete");
  assert.equal(normalizeDeliveryEvidenceRisk("safe_enough"), "unknown");
  assert.equal(normalizeDeliveryEvidenceDomain("future_domain"), "other");
});

test("blocked reason codes preserve known values and replace unknown values with a safe generic reason", () => {
  assert.deepEqual(normalizeWorkItemReviewBlockedReasonCodes([
    "verification_required",
    "provider_specific_failure",
    "verification_required",
  ]), ["verification_required", "delivery_evidence_not_ready"]);
});

test("office batch operation outcomes conserve operationCount independently from rollback file targets", () => {
  const batch = projectOfficeBatchEvidence({
    state: "needs_attention",
    targetCount: 1,
    operationCount: 3,
    children: [
      { id: "op_1", state: "committed", changedCells: [] },
      { id: "op_2", state: "rolled_back", changedCells: [] },
      { id: "op_3", state: "invalidated", changedCells: [] },
    ],
    journal: {
      snapshotCount: 1,
      rollback: { restoredTargets: 1, blockedTargets: 0 },
    },
  });

  assert.equal(batch.successCount, 1);
  assert.equal(batch.restoredCount, 1);
  assert.equal(batch.failedCount, 1);
  assert.equal(batch.successCount + batch.restoredCount + batch.failedCount + batch.pendingCount + batch.unknownCount, 3);
  assert.equal(batch.rollback.protectedTargets, 1);
  assert.equal(batch.rollback.restoredTargets, 1);
  assert.equal(batch.countConsistent, true);
});

test("office batch projection fails closed when terminal counts or rollback coverage conflict", () => {
  const terminalMismatch = projectOfficeBatchEvidence({
    state: "committed",
    targetCount: 2,
    operationCount: 3,
    children: [
      { id: "op_1", state: "committed", changedCells: [] },
      { id: "op_2", state: "committed", changedCells: [] },
    ],
  });
  assert.equal(terminalMismatch.unknownCount, 1);
  assert.equal(terminalMismatch.countConsistent, false);
  assert.ok(terminalMismatch.anomalyCodes.includes("operation_count_mismatch"));

  const rollbackMismatch = projectOfficeBatchEvidence({
    state: "needs_attention",
    targetCount: 1,
    operationCount: 1,
    children: [{ id: "op_1", state: "rolled_back", changedCells: [] }],
    journal: { snapshotCount: 1, rollback: { restoredTargets: 1, blockedTargets: 1 } },
  });
  assert.equal(rollbackMismatch.rollback.countConsistent, false);
  assert.equal(rollbackMismatch.countConsistent, false);
  assert.ok(rollbackMismatch.anomalyCodes.includes("rollback_count_mismatch"));
});
