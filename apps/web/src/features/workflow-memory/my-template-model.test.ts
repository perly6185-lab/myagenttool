import { describe, expect, it } from "vitest";

import { buildMyTemplateSummaries } from "@/features/workflow-memory/my-template-model";
import type { BusinessRoutineDefinition, WorkflowSource } from "@/lib/api-client";

const source = {
  id: "source-1", projectId: "project-1", name: "客户询价历史", relativePath: "history",
  readMode: "supported_text", state: "active", scanState: "ready", scanRevision: 1, revision: 1,
  fileCount: 12, skippedCount: 0, truncated: false, lastScanAt: null, lastError: null,
} satisfies WorkflowSource;

function definition(patch: Partial<BusinessRoutineDefinition> = {}): BusinessRoutineDefinition {
  return {
    id: "definition-1", familyId: "family-1", projectId: "project-1", sourceId: source.id,
    name: "客户询价报价", description: "收到询价后生成报价单", version: 1, state: "published",
    discoveryCandidateId: "candidate-1", historicalCaseIds: ["case-1", "case-2", "case-3"],
    triggerDocumentTypes: ["inquiry"],
    steps: [{ key: "output", kind: "generate", label: "生成报价单", required: true, dependsOn: [],
      evidenceRefs: [], configuration: { output: "报价单 Excel" } }],
    confidence: 0.9, supersedesId: null, supersededById: null,
    templateScope: "team",
    evidenceHealth: { state: "valid", issues: [], recovery: null }, revision: 1,
    createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z",
    ...patch,
  };
}

describe("buildMyTemplateSummaries", () => {
  it("presents learned routines as input-to-output templates", () => {
    const [template] = buildMyTemplateSummaries([source], [definition()]);
    expect(template).toMatchObject({
      name: "客户询价报价",
      state: "ready",
      input: "客户询价单",
      output: "报价单 Excel",
      historyCaseCount: 3,
    });
  });

  it("shows an authorized history folder as learning until it produces a template", () => {
    const [template] = buildMyTemplateSummaries([{ ...source, purpose: "template_learning" }], []);
    expect(template).toMatchObject({ state: "learning", sourceId: source.id, input: "待识别" });
  });

  it("keeps one current version per template family", () => {
    const next = definition({ id: "definition-2", version: 2, state: "draft", name: "客户询价报价 v2" });
    const [template] = buildMyTemplateSummaries([source], [definition(), next]);
    expect(template).toMatchObject({ definitionId: "definition-1", definitionVersion: 1, state: "ready" });
  });

  it("shows one card when separately learned families describe the same work", () => {
    const duplicate = definition({
      id: "definition-duplicate",
      familyId: "family-duplicate",
      version: 2,
      historicalCaseIds: ["case-1", "case-2", "case-3", "case-4"],
    });
    const templates = buildMyTemplateSummaries([source], [definition(), duplicate]);
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ definitionId: "definition-duplicate", historyCaseCount: 4 });
  });

  it("shows the learned result instead of exposing an internal output folder", () => {
    const current = definition();
    const [template] = buildMyTemplateSummaries([source], [{
      ...current,
      steps: [{
        ...current.steps[0],
        label: "生成客户报价单",
        configuration: { outputDirectory: "drafts/quotations" },
      }],
    }]);

    expect(template.output).toBe("生成客户报价单");
  });

  it("presents the built-in commercial routine consistently in Chinese", () => {
    const [template] = buildMyTemplateSummaries([source], [definition({
      name: "Commercial inquiry and quotation",
      description: "Register an inquiry, retrieve references, prepare and approve a quotation, then hand off a confirmed order.",
      steps: [{
        ...definition().steps[0],
        key: "quotation_generation",
        label: "Prepare the quotation",
        configuration: { expectedOutput: "Prepare the quotation" },
      }],
    })]);

    expect(template).toMatchObject({
      name: "客户询价与报价",
      description: "登记客户询价，查找参考资料，准备并确认报价；客户确认后再交接订单处理。",
      output: "准备报价单",
      applicability: "当收到 客户询价单，并希望得到 准备报价单 时",
    });
  });
});
