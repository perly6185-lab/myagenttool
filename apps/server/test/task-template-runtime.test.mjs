import assert from "node:assert/strict";
import { test } from "node:test";

import { projectRoutineDefinitionToTaskTemplate } from "../src/services/task-template-runtime.mjs";

function routine(overrides = {}) {
  return {
    id: "routine_customer_plan",
    familyId: "family_customer_plan",
    version: 3,
    state: "published",
    name: "客户方案生成",
    triggerDocumentTypes: ["customer_reference"],
    dataRequirements: [{ id: "customer", kind: "contact", label: "客户记录", required: true }],
    mutationPolicy: { targetRequirementIds: ["customer"] },
    steps: [
      { key: "read", kind: "extract", label: "读取客户资料", required: true },
      { key: "write", kind: "generate", label: "生成方案", required: true },
      { key: "approval", kind: "human_approval", label: "检查结果", required: true },
    ],
    ...overrides,
  };
}

test("projects a published routine into a provider-neutral task template", () => {
  const result = projectRoutineDefinitionToTaskTemplate(routine());
  assert.equal(result.ok, true);
  assert.equal(result.value.schemaVersion, 2);
  assert.equal(result.value.taskKind, "business_customer_reference");
  assert.equal(result.value.state, "published");
  assert.equal(result.value.approvalPolicy, "before_sensitive_write");
  assert.equal(result.value.ledgerRouting.primaryRecordType, "contact");
  assert.deepEqual(result.value.method.map((step) => step.kind), ["extract", "generate"]);
  assert.equal(result.value.inputSlots[0].sourceKinds[0], "ledger_record");
});

test("projects file-only learned inputs without exposing provider details", () => {
  const result = projectRoutineDefinitionToTaskTemplate(routine({
    dataRequirements: [],
    mutationPolicy: null,
    templateContract: {
      inputSummary: "客户需求文档",
      inputFormats: ["pdf"],
      outputSummary: "客户方案文档",
      outputFormat: "docx",
    },
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.inputSlots[0].sourceKinds, ["artifact"]);
  assert.deepEqual(result.value.inputSlots[0].artifactKinds, ["pdf"]);
  assert.deepEqual(result.value.ledgerRouting, { primaryRecordType: null, relatedRecordTypes: [] });
  assert.equal(result.value.approvalPolicy, "none");
});

test("multi-task routines fail closed instead of becoming one task template", () => {
  const issue = projectRoutineDefinitionToTaskTemplate(routine({
    steps: [{ key: "create", kind: "create_issue", label: "创建后续任务", required: true }],
  }));
  assert.deepEqual(issue, { ok: false, error: "task_template_contains_create_issue" });

  const outputs = projectRoutineDefinitionToTaskTemplate(routine({
    steps: [
      { key: "one", kind: "generate", label: "结果一", required: true },
      { key: "two", kind: "generate", label: "结果二", required: true },
    ],
  }));
  assert.deepEqual(outputs, { ok: false, error: "task_template_multiple_outputs" });
});

