import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { i18n } from "@/lib/i18n";
import { ProfessionalWorkSummary } from "./professional-work-summary";
import type { LocalWorkItem, LocalWorkItemObservability } from "./task-view-types";

const item = {
  id: "lwi_professional",
  revision: 4,
  title: "跟进客户报价",
  acceptanceCriteria: ["报价已更新", "结果已复核"],
  acceptanceResults: [{ criterion: "报价已更新", status: "passed" }, { criterion: "结果已复核", status: "passed" }],
  completionGate: { ready: true, missingCriteria: [], verificationRequired: true },
  channelTaskContract: {
    schemaVersion: 1,
    source: "channel",
    domain: "commercial",
    riskLevel: "medium",
    goal: "跟进客户报价",
    workMode: {
      schemaVersion: 1,
      state: "matched",
      source: "my_template",
      name: "报价跟进",
      version: 3,
      confidence: "high",
      goal: "跟进客户报价",
      expectedOutput: "更新后的报价记录",
      inputs: null,
      data: { status: "ready", requirements: [], sources: [{ sourceId: "src_quote", fileName: "报价.xlsx", revision: 7, fingerprint: "fp" }], relations: [], relationStatus: "ready" },
      mutation: { required: true, status: "ready", targetCount: 2, digest: "mutation-digest" },
      confirmationRequired: true,
      candidates: [],
      trace: { templateDefinitionId: "tpl_quote", templateFamilyId: "family_quote", templateVersion: 3, templateMatchReason: "结果匹配", dataPlanDigest: "plan-digest", relationDigest: "relation-digest", executionDigest: "execution-digest" },
      digest: "mode-digest",
      generatedAt: "2026-08-18T00:00:00.000Z",
    },
    dataPlan: { status: "ready", digest: "plan-digest", requirements: [], relations: [], sources: [{ sourceId: "src_quote", fileName: "报价.xlsx", revision: 7, rowCount: 20, fingerprint: "fp" }] },
    dataMutationPreview: { status: "ready", operation: "update", targetSourceIds: ["src_quote"], targetSources: [{ sourceId: "src_quote", fileName: "报价.xlsx", revision: 7, contentHash: "hash", rowCount: 20 }], targetStatus: "explicit", fieldChanges: [{ field: "报价金额", operation: "replace", valueDigest: "value", valueProvided: true }], requiredFields: [], estimatedAffectedRows: 2, maxAffectedRows: 10, writeMode: "preview", digest: "mutation-digest", dataMutationScope: { schemaVersion: 1, operation: "update", targets: [], changes: [], expectedAffectedRows: 2, allowAllMatching: false } },
    dataMutationBinding: { id: "bind_1", projectId: "prj_1", fileSourceId: "src_quote", ledgerDefinitionId: "ledger_1", fileName: "报价.xlsx", format: "xlsx", fileSourceRevision: 7, ledgerDefinitionRevision: 2, stale: false },
    ledgerMutationPreview: { id: "ledger_preview", ledgerDefinitionId: "ledger_1", targetCount: 1, operationCount: 2, action: "update", rowNumber: 3, changedCells: [{ field: "报价金额", column: "报价金额", before: "100", after: "120" }], targetRevision: "7", proposedTargetRevision: "8", sourceEvidence: [], approvalRequired: true, state: "pending", queue: null, expiresAt: null, revision: 1, journal: { id: "journal_1", status: "pending", appliedCount: 0, snapshotCount: 1, rollback: null } },
    dataRelationConfirmation: { schemaVersion: 1, id: "rel_1", status: "verified", confirmationMode: "runtime_verified", planDigest: "plan-digest", relationDigest: "relation-digest", objectSnapshotCount: 2, confirmedAt: "2026-08-18T00:00:00.000Z", confirmedBy: "system" },
  },
} as unknown as LocalWorkItem;

const observability = {
  executionChainId: "chain_1",
  nextAction: "review_delivery",
  attention: [],
  latestRun: null,
  timeline: [
    { id: "event_1", at: "2026-08-18T00:00:00.000Z", source: "issue", type: "created", actorId: "user", message: "created", stage: "creation", data: {} },
    { id: "event_2", at: "2026-08-18T00:01:00.000Z", source: "execution", type: "retry", actorId: "system", message: "retry", stage: "retry", data: {} },
  ],
} as unknown as LocalWorkItemObservability;

beforeEach(async () => { await i18n.changeLanguage("zh-CN"); });
afterEach(() => cleanup());

describe("ProfessionalWorkSummary", () => {
  it("gives a professional user one fact-chain summary without changing the ordinary wording", () => {
    render(<ProfessionalWorkSummary item={item} observability={observability} />);
    const summary = screen.getByTestId("professional-work-summary");
    expect(summary.textContent).toContain("专业处理摘要");
    expect(summary.textContent).toContain("报价跟进");
    expect(summary.textContent).toContain("报价.xlsx · v7");
    expect(summary.textContent).toContain("资料变更事实");
    expect(summary.textContent).toContain("文件保护设置已绑定");
    expect(screen.getByTestId("professional-fact-chain").getAttribute("open")).toBeNull();
  });

  it("reveals bounded digests, revision, recovery and next action when expanded", () => {
    render(<ProfessionalWorkSummary item={item} observability={observability} />);
    const details = screen.getByTestId("professional-fact-chain");
    details.setAttribute("open", "");
    expect(details.textContent).toContain("v4");
    expect(details.textContent).toContain("chain_1");
    expect(details.textContent).toContain("plan-digest");
    expect(details.textContent).toContain("备份与恢复");
    expect(details.textContent).toContain("审核交付结果");
  });
});
