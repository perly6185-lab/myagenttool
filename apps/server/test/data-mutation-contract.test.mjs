import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDataMutationPreview,
  dataMutationPreviewMatchesCurrent,
  detectsDataMutationIntent,
  normalizeDataMutationScope,
  normalizeDataMutationPreview,
} from "../src/services/data-mutation-contract.mjs";

const sources = [
  {
    id: "src_customers",
    ownerTeamId: "team_local",
    projectId: "prj_local",
    fileName: "customers.csv",
    revision: 2,
    contentHash: "hash-customers-v2",
    rowCount: 20,
    status: "active",
  },
  {
    id: "src_orders",
    ownerTeamId: "team_local",
    projectId: "prj_local",
    fileName: "orders.xlsx",
    revision: 4,
    contentHash: "hash-orders-v4",
    rowCount: 80,
    status: "active",
  },
];

test("data mutation intent detects file write requests but ignores read-only work", () => {
  assert.equal(detectsDataMutationIntent("统计 customers.csv 中的客户数量"), false);
  assert.equal(detectsDataMutationIntent("批量修改 customers.csv 和 orders.xlsx 的客户字段"), true);
  const fromFilePlan = buildDataMutationPreview({
    state: { channelObjectFileSources: [] },
    projectId: "prj_local",
    ownerTeamId: "team_local",
    text: "把客户地址改一下",
    dataPlan: { sources: [{ kind: "file", sourceId: "src_customers" }] },
  });
  assert.equal(fromFilePlan.status, "needs_sources");
});

test("data mutation preview is fail-closed for multi-file, multi-row edits", () => {
  const state = { channelObjectFileSources: sources };
  const preview = buildDataMutationPreview({
    state,
    projectId: "prj_local",
    ownerTeamId: "team_local",
    text: "批量修改 customers.csv 和 orders.xlsx 的客户字段",
  });
  assert.equal(preview.status, "needs_review");
  assert.equal(preview.operation, "update");
  assert.deepEqual(preview.targetSourceIds, ["src_customers", "src_orders"]);
  assert.equal(preview.writeMode, "not_authorized");
  assert.equal(preview.estimatedAffectedRows, null);
  assert.ok(preview.requiredFields.some((field) => field.includes("定位记录")));
  assert.ok(preview.requiredFields.some((field) => field.includes("字段及新值")));
  assert.ok(preview.requiredFields.some((field) => field.includes("全部匹配记录")));
  assert.equal(dataMutationPreviewMatchesCurrent({
    state,
    preview,
    projectId: "prj_local",
    ownerTeamId: "team_local",
  }).ok, true);

  sources[1].revision = 5;
  assert.equal(dataMutationPreviewMatchesCurrent({
    state,
    preview,
    projectId: "prj_local",
    ownerTeamId: "team_local",
  }).ok, false);
  sources[1].revision = 4;
});

test("data mutation preview requires a source and drops untrusted write details", () => {
  const preview = buildDataMutationPreview({
    state: { channelObjectFileSources: [] },
    projectId: "prj_local",
    ownerTeamId: "team_local",
    text: "更新客户表.xlsx 中的地址",
  });
  assert.equal(preview.status, "needs_sources");
  const normalized = normalizeDataMutationPreview({
    ...preview,
    rowSelector: { query: "secret raw value" },
    fieldChanges: [{ field: "address", value: "new value" }],
    writeMode: "direct_write",
  });
  assert.equal(normalized.rowSelector, null);
  assert.deepEqual(normalized.fieldChanges, []);
  assert.equal(normalized.writeMode, "not_authorized");
});

test("task scope binds concrete file revisions, row counts, and allowed fields without raw values", () => {
  const state = { channelObjectFileSources: sources };
  const dataPlan = {
    sources: sources.map((source) => ({ kind: "file", sourceId: source.id })),
    mutationPolicy: {
      operations: ["update"],
      targetRequirementIds: [],
      keyFields: ["customer_id"],
      mutableFields: ["address"],
      allowMultipleSources: true,
      allowMultipleRows: true,
      maxRows: 10,
      writeMode: "safe_copy_replace",
    },
  };
  const scope = {
    targets: sources.map((source, index) => ({
      sourceId: source.id,
      revision: source.revision,
      contentHash: source.contentHash,
      selector: {
        field: "customer_id",
        operator: "equals",
        criteriaDigest: `selector-digest-${index}`,
        matchCount: 2,
      },
      expectedRows: 2,
    })),
    changes: [{ field: "address", operation: "set", valueDigest: "value-digest-address" }],
    expectedAffectedRows: 4,
  };
  const preview = buildDataMutationPreview({
    state,
    projectId: "prj_local",
    ownerTeamId: "team_local",
    text: "修改 customers.csv 和 orders.xlsx 的地址",
    dataPlan,
    dataMutationScope: scope,
  });
  assert.equal(preview.status, "ready");
  assert.equal(preview.estimatedAffectedRows, 4);
  assert.equal(preview.dataMutationScope.targets.length, 2);
  assert.deepEqual(preview.fieldChanges.map((change) => change.field), ["address"]);
  assert.equal(preview.writeMode, "not_authorized");
  assert.equal(dataMutationPreviewMatchesCurrent({
    state,
    preview,
    projectId: "prj_local",
    ownerTeamId: "team_local",
  }).ok, true);
  assert.deepEqual(normalizeDataMutationScope({
    ...scope,
    expectedAffectedRows: 2,
    targets: [{ ...scope.targets[0], selector: { ...scope.targets[0].selector, query: "张三" } }],
  }, {
    policy: dataPlan.mutationPolicy,
    sourceSnapshots: preview.sourceSnapshot,
    operation: "update",
  }).targets[0].selector.query, undefined);
});

test("task scope fails closed on stale revisions and template boundary violations", () => {
  const policy = {
    operations: ["update"],
    keyFields: ["customer_id"],
    mutableFields: ["address"],
    allowMultipleSources: false,
    allowMultipleRows: false,
    maxRows: 1,
  };
  const result = normalizeDataMutationScope({
    targets: [{
      sourceId: "src_customers",
      revision: 999,
      selector: { field: "customer_id", operator: "all", criteriaDigest: "digest", matchCount: 2 },
    }],
    changes: [{ field: "email", operation: "set", valueDigest: "value" }],
    expectedAffectedRows: 2,
  }, {
    policy,
    sourceSnapshots: [sources[0]],
    operation: "update",
  });
  assert.equal(result, null);
});
