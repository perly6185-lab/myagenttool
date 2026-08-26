import assert from "node:assert/strict";
import test from "node:test";

import {
  ledgerPostingActions,
  normalizeBusinessLedgerRecordRef,
  normalizeLedgerPostingPlan,
  normalizeTaskRecordBinding,
  normalizeTaskTemplateContractV2,
  taskResourceSchemaVersion,
} from "@myagenttool/protocol/task-resources";

const fingerprint = `sha256:${"a".repeat(64)}`;
const record = {
  ledgerDefinitionId: "ledger_customer",
  recordId: "record_001",
  recordType: "customer",
  businessKey: "CUS-001",
  title: "客户 A",
  revision: 4,
  fingerprint,
  observedAt: "2026-08-26T08:00:00.000Z",
};

test("business ledger record refs are provider-neutral and bounded", () => {
  assert.equal(taskResourceSchemaVersion, 2);
  assert.deepEqual(normalizeBusinessLedgerRecordRef({
    ...record,
    provider: "feishu",
    providerObjectId: "base/table/row",
  }), record);
  assert.equal(normalizeBusinessLedgerRecordRef({ ...record, fingerprint: "sha256:short" }), null);
  assert.equal(normalizeBusinessLedgerRecordRef({ ...record, observedAt: "not-a-date" }), null);
  assert.equal(normalizeBusinessLedgerRecordRef({ ...record, recordId: "/private/path" }), null);
});

test("task record bindings enforce direction, role, scope, and snapshot shape", () => {
  const result = normalizeTaskRecordBinding({
    id: "binding_1",
    slotKey: "customer",
    direction: "input",
    role: "required",
    record,
    ledgerDefinitionId: "ledger_customer",
    selection: { fieldKeys: ["name", "industry"], queryId: null, rowLimit: 1 },
    snapshot: { revision: 4, fingerprint, capturedAt: "2026-08-26T08:01:00Z", evidenceRefs: [{ artifactId: "art_1", field: "name" }] },
    resolution: { source: "explicit_user", confidence: 1, state: "resolved", reasons: ["用户明确选择"] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.snapshot.revision, 4);
  assert.deepEqual(normalizeTaskRecordBinding({
    id: "binding_1", direction: "input", role: "primary_ledger", ledgerDefinitionId: "ledger_customer",
    selection: {}, resolution: { source: "intent_match", confidence: 0.5, state: "needs_confirmation", reasons: [] },
  }), { ok: false, error: "invalid_task_record_binding" });
  assert.deepEqual(normalizeTaskRecordBinding({
    id: "binding_1", direction: "input", role: "required", ledgerDefinitionId: "ledger_other",
    record, selection: {}, resolution: { source: "intent_match", confidence: 0.5, state: "resolved", reasons: [] },
  }), { ok: false, error: "invalid_task_record_binding" });
});

test("template contracts require one bounded, independently verifiable outcome", () => {
  const result = normalizeTaskTemplateContractV2({
    id: "tpl_customer_plan",
    familyId: "family_customer",
    version: 1,
    taskKind: "customer_plan",
    domain: "sales",
    name: "客户方案",
    outcome: { label: "客户方案文档", artifactKinds: ["document"], acceptanceCriteria: ["包含客户需求和方案"] },
    inputSlots: [{
      key: "customer", label: "客户", sourceKinds: ["ledger_record"], recordTypes: ["customer"], artifactKinds: [],
      required: true, cardinality: "one", freshness: "execution_snapshot", purpose: "required",
    }],
    ledgerRouting: { primaryRecordType: "customer_plan", relatedRecordTypes: ["customer"] },
    method: [{ key: "draft", kind: "generate", label: "生成方案", required: true }],
    externalEffect: false,
    approvalPolicy: "none",
    state: "draft",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.schemaVersion, 2);
  assert.deepEqual(normalizeTaskTemplateContractV2({
    ...result.value, externalEffect: true, approvalPolicy: "none",
  }), { ok: false, error: "invalid_task_template_contract_v2" });
  assert.deepEqual(normalizeTaskTemplateContractV2({
    ...result.value, method: [{ key: "write", kind: "create_issue", label: "偷偷创建任务", required: true }],
  }), { ok: false, error: "invalid_task_template_contract_v2" });
});

test("posting plans require evidence and distinguish create from update", () => {
  assert.deepEqual(ledgerPostingActions, ["create", "update", "append_activity", "link_only"]);
  const base = {
    ledgerDefinitionId: "ledger_customer",
    recordId: null,
    action: "create",
    fields: { name: "客户 A", status: "active" },
    sourceEvidence: [{ artifactId: "art_result", field: "name" }],
    approvalRequired: true,
  };
  const result = normalizeLedgerPostingPlan({
    workItemId: "work_1", resultRevision: 2, primary: base, related: [], state: "proposed",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.primary.recordId, null);
  assert.deepEqual(normalizeLedgerPostingPlan({
    workItemId: "work_1", resultRevision: 2, primary: { ...base, recordId: "record_1" }, related: [], state: "proposed",
  }), { ok: false, error: "invalid_ledger_posting_plan" });
  assert.deepEqual(normalizeLedgerPostingPlan({
    workItemId: "work_1", resultRevision: 2, primary: { ...base, action: "update", recordId: "record_1", fields: { token: "secret" } }, related: [], state: "proposed",
  }), { ok: false, error: "invalid_ledger_posting_plan" });
});
