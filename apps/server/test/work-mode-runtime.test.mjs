import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkModeSnapshot, normalizeWorkModeSnapshot } from "../src/services/work-mode-runtime.mjs";

function base(overrides = {}) {
  return {
    goal: "整理本月订单并核对回款",
    outputExpectation: "订单跟进结果",
    selectedTemplate: {
      definitionId: "routine-order-follow-up-v2",
      templateId: "order-follow-up",
      version: 2,
      name: "订单跟进",
      expectedOutput: "订单跟进结果",
    },
    templateMatch: { state: "matched", decision: { kind: "auto_apply", confidence: "high", reason: "strong_template_match" } },
    selectedDefinition: { templateContract: { inputSummary: "订单与回款资料" } },
    dataPlan: {
      status: "ready",
      requirements: [
        { id: "orders", kind: "order", label: "订单表", fields: ["order_no", "status"], required: true, state: "ready", sourceId: "orders-xlsx" },
        { id: "payments", kind: "receivable", label: "回款表", fields: ["order_no", "amount"], required: true, state: "ready", sourceId: "payments-xlsx" },
      ],
      relations: [{ id: "order-payment", fromRequirementId: "orders", fromField: "order_no", toRequirementId: "payments", toField: "order_no", state: "ready" }],
      sources: [
        { sourceId: "orders-xlsx", fileName: "订单.xlsx", revision: 3, fingerprint: "orders-hash" },
        { sourceId: "payments-xlsx", fileName: "回款.xlsx", revision: 1, fingerprint: "payments-hash" },
      ],
      digest: "plan-digest",
    },
    dataRelationPreview: { status: "ready", digest: "relation-digest" },
    dataMutationPreview: { status: "not_required" },
    riskLevel: "low",
    executionPreview: { digest: "execution-digest" },
    generatedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

test("runtime work mode freezes template, data versions and trace digests", () => {
  const mode = buildWorkModeSnapshot(base());
  assert.equal(mode.state, "matched");
  assert.equal(mode.name, "订单跟进");
  assert.equal(mode.version, 2);
  assert.deepEqual(mode.data.sources.map((source) => [source.fileName, source.revision]), [["订单.xlsx", 3], ["回款.xlsx", 1]]);
  assert.equal(mode.data.requirements[0].label, "订单表");
  assert.equal(mode.confirmationRequired, false);
  assert.equal(mode.trace.templateVersion, 2);
  assert.equal(mode.digest.length, 64);
});

test("ambiguous matching becomes a user confirmation state without forcing a template", () => {
  const mode = buildWorkModeSnapshot(base({
    selectedTemplate: null,
    selectedDefinition: null,
    templateMatch: {
      state: "ambiguous",
      decision: { kind: "confirm_output", confidence: "low", reason: "close_different_results" },
      candidates: [
        { name: "报价单", expectedOutput: "报价", definitionId: "quotation", version: 1 },
        { name: "订单跟进", expectedOutput: "订单跟进结果", definitionId: "follow-up", version: 2 },
      ],
    },
  }));
  assert.equal(mode.state, "needs_confirmation");
  assert.equal(mode.name, "待确认的工作方式");
  assert.equal(mode.candidates.length, 2);
  assert.equal(mode.confirmationRequired, true);
});

test("mutation or missing sources always raises the confirmation gate", () => {
  const mode = buildWorkModeSnapshot(base({
    dataPlan: { status: "needs_sources", requirements: [{ id: "orders", kind: "order", required: true, state: "missing" }], sources: [], relations: [], digest: "missing" },
    dataMutationPreview: { status: "ready", estimatedAffectedRows: 4, digest: "mutation" },
  }));
  assert.equal(mode.confirmationRequired, true);
  assert.equal(mode.mutation.required, true);
  assert.equal(mode.mutation.targetCount, 4);
});

test("normalization keeps old or partially persisted snapshots safe", () => {
  const normalized = normalizeWorkModeSnapshot({
    state: "matched",
    source: "my_template",
    name: "订单跟进",
    version: 2,
    confidence: "high",
    goal: "处理订单",
    expectedOutput: "跟进结果",
    data: { status: "not_required", requirements: [], sources: [], relations: [], relationStatus: "not_required" },
    mutation: { required: false, status: "not_required" },
    confirmationRequired: false,
    candidates: [{ name: "报价单", expectedOutput: "报价", definitionId: "quote", version: 1 }],
    trace: { templateDefinitionId: "def", templateFamilyId: "family", templateVersion: 2, dataPlanDigest: "plan" },
    digest: "persisted-digest",
  });
  assert.equal(normalized.state, "matched");
  assert.equal(normalized.digest, "persisted-digest");
  assert.equal(normalized.data.status, "not_required");
  assert.equal(normalized.candidates[0].name, "报价单");
  assert.equal(normalized.trace.dataPlanDigest, "plan");
});
