import { describe, expect, it } from "vitest";
import type { LocalWorkItem } from "./task-view-types";
import { deriveDeliveryDecision, deriveWorkItemIntentSummary } from "./work-item-summary-model";

const baseDecision = {
  language: "en" as const,
  mode: "local_merge" as const,
  changedFiles: ["src/feature.ts"],
  reviewVerdict: null,
  reviewStatus: null,
  verification: null,
  executionKind: "auto_run" as const,
  resultFiles: [],
};

describe("work item delivery decision", () => {
  it("blocks acceptance when reproducible verification failed", () => {
    const decision = deriveDeliveryDecision({
      ...baseDecision,
      verification: { passed: false, verified: true, summary: "test failed" },
    });

    expect(decision.state).toBe("changes");
    expect(decision.risk).toBe("high");
  });

  it("waits while independent review is still running", () => {
    const decision = deriveDeliveryDecision({
      ...baseDecision,
      reviewStatus: "running",
      verification: { passed: true, verified: true, summary: "checks passed" },
    });

    expect(decision.state).toBe("waiting");
    expect(decision.risk).toBe("unknown");
  });

  it("recommends acceptance only after review and verification pass", () => {
    const decision = deriveDeliveryDecision({
      ...baseDecision,
      reviewVerdict: "approved",
      reviewStatus: "completed",
      verification: { passed: true, verified: true, summary: "checks passed" },
    });

    expect(decision.state).toBe("ready");
    expect(decision.risk).toBe("low");
  });

  it("treats a verified article import as a completed low-risk result", () => {
    const decision = deriveDeliveryDecision({
      ...baseDecision,
      changedFiles: [],
      executionKind: "article_import",
      resultFiles: ["article.md"],
      verification: { passed: true, verified: true, summary: "accepted" },
    });

    expect(decision.state).toBe("ready");
    expect(decision.scope).toContain("1 output file");
  });

  it("separates missing verification evidence from a confirmed code defect", () => {
    const decision = deriveDeliveryDecision({
      ...baseDecision,
      reviewVerdict: "approved",
      reviewStatus: "completed",
      verification: { passed: true, verified: false, summary: "No verification command configured." },
    });

    expect(decision.domain).toBe("development");
    expect(decision.statusLabel).toBe("Verification needed");
    expect(decision.risk).toBe("medium");
    expect(decision.riskReason).toContain("missing evidence");
  });

  it("flags a positive summary with a changes-requested verdict as an inconsistent review", () => {
    const decision = deriveDeliveryDecision({
      ...baseDecision,
      reviewVerdict: "changes_requested",
      reviewStatus: "completed",
      reviewSummary: "The change is consistent, type-safe, and introduces no observable regressions.",
      reviewFindings: [],
      verification: { passed: true, verified: true, summary: "checks passed" },
    });

    expect(decision.statusLabel).toBe("Review is inconsistent");
    expect(decision.risk).toBe("unknown");
    expect(decision.recommendation).toContain("review again");
  });

  it("labels office/data work separately from development delivery", () => {
    const decision = deriveDeliveryDecision({
      ...baseDecision,
      executionKind: "application_invocation",
      taskKind: "business_document",
      taskText: "整理客户报价表",
      changedFiles: ["报价表.xlsx"],
      reviewVerdict: null,
      reviewStatus: null,
      verification: null,
    });

    expect(decision.domain).toBe("office");
    expect(decision.domainLabel).toBe("Office/data work");
    expect(decision.scope).toContain("office/data work");
    expect(decision.confirmEffect).toContain("office/data result");
    expect(decision.confirmEffect).not.toContain("base branch");
  });

  it("blocks a partially failed office batch even when review and file verification passed", () => {
    const decision = deriveDeliveryDecision({
      ...baseDecision,
      executionKind: "application_invocation",
      taskKind: "business_spreadsheet",
      taskText: "更新客户台账",
      changedFiles: ["客户台账.xlsx"],
      reviewVerdict: "approved",
      reviewStatus: "completed",
      verification: { passed: true, verified: true, summary: "file validated" },
      evidenceStatus: "office_batch_attention",
    });

    expect(decision.state).toBe("changes");
    expect(decision.risk).toBe("high");
    expect(decision.statusLabel).toBe("Batch needs attention");
  });

  it("keeps a rolled-back office batch separate from a successful result", () => {
    const decision = deriveDeliveryDecision({
      ...baseDecision,
      executionKind: "application_invocation",
      taskKind: "business_spreadsheet",
      taskText: "更新客户台账",
      changedFiles: ["客户台账.xlsx"],
      reviewVerdict: "approved",
      reviewStatus: "completed",
      verification: { passed: true, verified: true, summary: "file validated" },
      evidenceStatus: "office_batch_rolled_back",
    });

    expect(decision.state).toBe("caution");
    expect(decision.risk).toBe("medium");
    expect(decision.statusLabel).toBe("Batch rolled back");
  });
});

describe("work item intent summary", () => {
  it("restates an aligned office task with its real sources, rows, fields, and safety boundary", () => {
    const item = {
      title: "更新客户台账",
      intentStatement: "把待跟进客户改为已联系",
      acceptanceCriteria: ["三条记录状态正确"],
      executionContractGate: { ready: true },
      channelTaskContract: {
        goal: "更新客户台账中的联系状态",
        outputExpectation: "生成一份可以复核的更新结果",
        dataMutationPreview: {
          status: "ready",
          targetSources: [{ fileName: "客户台账.xlsx" }],
          estimatedAffectedRows: 3,
          requiredFields: ["状态"],
          fieldChanges: [{ field: "状态" }],
        },
      },
    } as unknown as LocalWorkItem;

    const summary = deriveWorkItemIntentSummary({ item, domain: "office", language: "zh" });
    expect(summary.state).toBe("aligned");
    expect(summary.goal).toBe("更新客户台账中的联系状态");
    expect(summary.expectedOutcome).toBe("生成一份可以复核的更新结果");
    expect(summary.scope).toContain("客户台账.xlsx");
    expect(summary.scope).toContain("预计 3 条记录");
    expect(summary.scope).toContain("状态");
    expect(summary.boundary).toContain("对外发送仍需单独确认");
  });

  it("makes ambiguity explicit instead of pretending to understand", () => {
    const item = {
      title: "处理这些表格",
      acceptanceCriteria: [],
      channelTaskContract: {
        goal: "处理这些表格",
        dataPlan: { status: "ambiguous" },
      },
    } as unknown as LocalWorkItem;

    const summary = deriveWorkItemIntentSummary({ item, domain: "office", language: "zh" });
    expect(summary.state).toBe("needs_confirmation");
    expect(summary.statusLabel).toBe("需要你确认");
    expect(summary.confidenceReason).toContain("仍有歧义");
  });
});
