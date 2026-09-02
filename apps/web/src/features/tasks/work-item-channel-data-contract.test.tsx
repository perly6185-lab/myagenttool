import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LocalWorkItem } from "./task-view-types";
import { WorkItemChannelDataPlan, WorkItemChannelMutationPreview } from "./work-item-channel-data-contract";

type ChannelTaskContract = NonNullable<LocalWorkItem["channelTaskContract"]>;

function contract(overrides: Partial<ChannelTaskContract>): ChannelTaskContract {
  return {
    schemaVersion: 1,
    source: "channel",
    domain: "office",
    riskLevel: "medium",
    goal: "Update customer records",
    ...overrides,
  };
}

afterEach(cleanup);

describe("work item Channel data contract presentation", () => {
  it("presents bounded sources, relation results, and confirmation evidence", () => {
    const value = contract({
      dataPlan: {
        status: "ready",
        digest: "hidden-plan-digest",
        requirements: [{ id: "customers", label: "Customer records", kind: "table", fields: ["id"], required: true, state: "ready", sourceId: "src_customers" }],
        relations: [{ id: "orders-to-customers", fromRequirementId: "orders", fromField: "customer_id", toRequirementId: "customers", toField: "id", state: "ready" }],
        sources: [{ sourceId: "src_customers", fileName: "customers.xlsx", revision: 3, rowCount: 24, fingerprint: "hidden-fingerprint" }],
      },
      dataRelationPreview: {
        status: "ready",
        relations: [{ id: "orders-to-customers", state: "ready", fromRequirementId: "orders", fromField: "customer_id", toRequirementId: "customers", toField: "id", matchedRows: 24, unmatchedRows: 0 }],
        digest: "hidden-relation-digest",
      },
      dataRelationConfirmation: {
        schemaVersion: 1,
        id: "drc_1",
        status: "verified",
        confirmationMode: "user_confirmation",
        planDigest: "hidden-plan-digest",
        relationDigest: "hidden-relation-digest",
        objectSnapshotCount: 2,
        confirmedAt: "2026-09-01T00:00:00.000Z",
        confirmedBy: "usr_1",
      },
    });

    render(<WorkItemChannelDataPlan contract={value} language="en" />);

    const section = screen.getByRole("region", { name: "Source check results" });
    expect(section.textContent).toContain("customers.xlsx");
    expect(section.textContent).toContain("24 rows");
    expect(section.textContent).toContain("24 matched");
    expect(section.textContent).toContain("Source relationships checked and recorded");
    expect(section.textContent).toContain("2 object versions recorded");
    expect(section.textContent).not.toContain("hidden-plan-digest");
    expect(section.textContent).not.toContain("hidden-fingerprint");
  });

  it("presents batch recovery evidence without exposing a mutation action", () => {
    const value = contract({
      dataMutationPreview: {
        status: "ready",
        operation: "update",
        targetSourceIds: ["src_customers"],
        targetSources: [{ sourceId: "src_customers", fileName: "customers.xlsx", revision: 3, contentHash: "hidden-content-hash", rowCount: 24 }],
        targetStatus: "explicit",
        dataMutationScope: {
          schemaVersion: 1,
          operation: "update",
          targets: [{ sourceId: "src_customers", revision: 3, contentHash: "hidden-content-hash", selector: { field: "status", operator: "equals", criteriaDigest: "hidden-criteria", matchCount: 4, allMatching: false }, expectedRows: 4 }],
          changes: [{ field: "status", operation: "set", valueDigest: "hidden-value", valueProvided: true }],
          expectedAffectedRows: 4,
          allowAllMatching: false,
        },
        rowSelector: null,
        fieldChanges: [{ field: "status", operation: "set", valueDigest: "hidden-value", valueProvided: true }],
        requiredFields: [],
        estimatedAffectedRows: 4,
        maxAffectedRows: 4,
        writeMode: "batch",
        digest: "hidden-mutation-digest",
      },
      dataMutationBinding: {
        id: "binding_1",
        projectId: "prj_1",
        fileSourceId: "src_customers",
        ledgerDefinitionId: "ledger_customers",
        fileName: "customers.xlsx",
        format: "xlsx",
        fileSourceRevision: 3,
        ledgerDefinitionRevision: 2,
        stale: false,
      },
      ledgerMutationPreview: {
        kind: "batch",
        id: "lmp_1",
        ledgerDefinitionId: "ledger_customers",
        targetCount: 1,
        operationCount: 4,
        journal: { id: "journal_1", status: "recovering", appliedCount: 2, snapshotCount: 1, rollback: null },
        children: [],
        action: "update",
        rowNumber: null,
        changedCells: [],
        targetRevision: "3",
        proposedTargetRevision: "4",
        sourceEvidence: [],
        approvalRequired: true,
        state: "committing",
        queue: null,
        expiresAt: null,
        revision: 1,
      },
    });

    render(<WorkItemChannelMutationPreview contract={value} language="zh" />);

    const section = screen.getByRole("region", { name: "批量文件修改预览" });
    expect(section.textContent).toContain("修改范围已固定");
    expect(section.textContent).toContain("预计 4 条");
    expect(section.textContent).toContain("正在恢复修改进度");
    expect(section.textContent).toContain("已完成 2 项、保留 1 个文件备份");
    expect(section.textContent).not.toContain("hidden-content-hash");
    expect(section.querySelector("button")).toBeNull();
  });
});
