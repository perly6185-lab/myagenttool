import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DeliveryDecisionCard } from "./work-item-delivery-decision-card";
import { COPY } from "./work-item-summary-copy";
import type { DeliveryDecision } from "./work-item-summary-model";

afterEach(() => cleanup());

const decision: DeliveryDecision = {
  state: "changes",
  risk: "high",
  domain: "office",
  domainLabel: "Office/data work",
  statusLabel: "Batch needs attention",
  riskReason: "Batch evidence is incomplete.",
  headline: "This office batch cannot be applied yet",
  scope: "Two workbook targets",
  checks: "Review passed, but one operation receipt is missing.",
  recommendation: "Review the batch details.",
  confirmEffect: "Apply office result",
  confirmRisk: "Medium",
  revisionEffect: "Keep current result",
  revisionRisk: "Low",
};

describe("office batch delivery evidence", () => {
  it("separates operation conservation from file recovery and exposes inconsistent evidence", () => {
    render(<DeliveryDecisionCard
      decision={decision}
      copy={COPY.en}
      language="en"
      actionPreview={{
        mode: "local_merge",
        operation: "apply_office_result",
        targetType: "office_artifact",
        worktreeId: null,
        branchName: null,
        remoteUrl: null,
        changedFileCount: 2,
        changedFiles: ["ledger.xlsx", "archive.xlsx"],
        reviewedCommit: null,
        requiresConfirmation: true,
        canProceed: false,
        blockedReasonCodes: ["office_batch_attention", "office_batch_evidence_inconsistent"],
        officeDetails: {
          targetFiles: ["ledger.xlsx", "archive.xlsx"],
          estimatedAffectedRows: 3,
          fields: ["status"],
          operation: "update",
          writeMode: "batch",
          reversible: true,
          batch: {
            schemaVersion: 1,
            state: "committed",
            targetCount: 2,
            operationCount: 3,
            successCount: 2,
            restoredCount: 0,
            failedCount: 0,
            pendingCount: 0,
            unknownCount: 1,
            accountedCount: 2,
            countConsistent: false,
            anomalyCodes: ["operation_count_mismatch", "terminal_state_mismatch"],
            rollback: {
              status: "not_available",
              protectedTargets: 0,
              restoredTargets: 0,
              blockedTargets: 0,
              unknownTargets: 0,
              countConsistent: true,
            },
            detailCount: 2,
            detailsTruncated: false,
            details: [
              { id: "op_1", businessKey: "CUS-001", action: "update", rowNumber: 2, state: "committed", changedFields: ["status"] },
              { id: "op_2", businessKey: "CUS-002", action: "update", rowNumber: 3, state: "committed", changedFields: ["status"] },
            ],
          },
        },
      }}
    />);

    const batch = screen.getByTestId("office-batch-result");
    expect(batch.textContent).toContain("Operation receipts: 2/3");
    expect(batch.textContent).toContain("File targets: 2");
    expect(batch.textContent).toContain("Unknown operations: 1");
    const warning = within(batch).getByTestId("office-batch-inconsistent");
    expect(warning.textContent).toContain("Batch evidence is inconsistent; applying is blocked");
    expect(warning.textContent).toContain("Operation total does not match the receipts");
    expect(warning.textContent).toContain("terminal batch state conflicts with operation outcomes");
  });
});
