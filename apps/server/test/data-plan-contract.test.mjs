import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAttachmentDataPlan,
  buildRuntimeDataPlan,
  dataPlanMatchesCurrent,
  normalizeDataContract,
} from "../src/services/data-plan-contract.mjs";
import {
  buildDataRelationPreview,
  dataRelationPreviewMatchesCurrent,
} from "../src/services/data-relation-preview.mjs";

test("channel attachment discovery becomes a read-only plan and detects replacement", () => {
  const attachments = [{
    id: "asset-1",
    hash: "sha256:one",
    version: "v1",
  }];
  const plan = buildAttachmentDataPlan({
    attachments,
    discoveries: [{
      assetId: "asset-1",
      status: "ready",
      fileName: "orders.csv",
      format: "csv",
      contentHash: "sha256:one",
      rowCount: 3,
      recognizedFields: ["order_number", "customer", "amount"],
    }],
  });
  assert.equal(plan.status, "ready");
  assert.equal(plan.origin, "channel_attachment");
  assert.equal(plan.requirements[0].state, "ready");
  assert.equal(plan.sources[0].sourceId, "asset-1");
  assert.equal(plan.mutationPolicy, null);
  assert.equal(JSON.stringify(plan).includes("customer"), true);
  assert.equal(JSON.stringify(plan).includes("sha256:one"), true);
  assert.equal(dataPlanMatchesCurrent({ plan, inputAssets: attachments }).ok, true);
  assert.equal(dataPlanMatchesCurrent({
    plan,
    inputAssets: [{ ...attachments[0], hash: "sha256:two" }],
  }).ok, false);
});

test("an unsupported or stale attachment does not become an executable data source", () => {
  const plan = buildAttachmentDataPlan({
    attachments: [{ id: "asset-2", hash: "sha256:two" }],
    discoveries: [{
      assetId: "asset-2",
      status: "stale",
      fileName: "orders.csv",
      format: "csv",
      contentHash: "sha256:old",
      recognizedFields: ["order_number"],
    }, {
      assetId: "asset-3",
      status: "ready",
      fileName: "photo.png",
      format: "png",
    }],
  });
  assert.equal(plan.status, "stale");
  assert.equal(plan.sources.length, 0);
  assert.equal(plan.requirements[0].state, "missing");
});

const requirement = {
  id: "customers",
  kind: "contact",
  label: "客户表",
  fields: ["name", "email"],
};

test("template data requirements stay abstract and reject concrete paths or secrets", () => {
  const contract = normalizeDataContract({
    dataRequirements: [requirement],
    relations: [{
      id: "customer_order",
      type: "lookup",
      fromRequirementId: "orders",
      fromField: "customer",
      toRequirementId: "customers",
      toField: "name",
    }],
  });
  assert.equal(contract, null);
  const valid = normalizeDataContract({ dataRequirements: [requirement] });
  assert.deepEqual(valid.dataRequirements[0], {
    id: "customers",
    kind: "contact",
    label: "客户表",
    fields: ["name", "email"],
    required: true,
    multiple: false,
    description: null,
  });
});

test("template mutation policy declares the safe boundary without embedding file paths", () => {
  const contract = normalizeDataContract({
    dataRequirements: [
      { id: "orders", kind: "order", label: "订单表", fields: ["order_number", "customer"] },
    ],
    mutationPolicy: {
      operations: ["update"],
      targetRequirementIds: ["orders"],
      keyFields: ["order_number"],
      mutableFields: ["customer"],
      allowMultipleSources: true,
      allowMultipleRows: true,
      maxRows: 500,
      writeMode: "safe_copy_replace",
    },
  });
  assert.equal(contract.mutationPolicy.allowMultipleSources, true);
  assert.equal(contract.mutationPolicy.maxRows, 500);
  assert.deepEqual(contract.mutationPolicy.mutableFields, ["customer"]);
  assert.equal(normalizeDataContract({
    dataRequirements: [{ id: "orders", kind: "order", label: "订单表", fields: ["order_number"] }],
    mutationPolicy: { mutableFields: ["password"] },
  }), null);
});

test("runtime plan selects one local file source and freezes its revision", () => {
  const state = {
    channelObjectFileSources: [{
      id: "src_customers",
      ownerTeamId: "local",
      projectId: "project_1",
      kind: "contact",
      fileName: "customers.xlsx",
      contentHash: "hash-1",
      revision: 3,
      rowCount: 12,
      status: "active",
    }],
  };
  const plan = buildRuntimeDataPlan({
    state,
    projectId: "project_1",
    ownerTeamId: "local",
    dataRequirements: [requirement],
  });
  assert.equal(plan.status, "ready");
  assert.equal(plan.sources[0].fileName, "customers.xlsx");
  assert.equal(plan.sources[0].revision, 3);
  assert.equal(dataPlanMatchesCurrent({
    state,
    plan,
    projectId: "project_1",
    ownerTeamId: "local",
  }).ok, true);
  state.channelObjectFileSources[0].revision = 4;
  assert.equal(dataPlanMatchesCurrent({
    state,
    plan,
    projectId: "project_1",
    ownerTeamId: "local",
  }).ok, false);
});

test("runtime plan fails closed for missing or ambiguous local sources", () => {
  const base = {
    channelObjectFileSources: [],
  };
  const missing = buildRuntimeDataPlan({
    state: base,
    projectId: "project_1",
    ownerTeamId: "local",
    dataRequirements: [requirement],
  });
  assert.equal(missing.status, "needs_sources");
  const ambiguous = buildRuntimeDataPlan({
    state: {
      channelObjectFileSources: [
        { id: "a", ownerTeamId: "local", projectId: "project_1", kind: "contact", fileName: "a.csv", revision: 1 },
        { id: "b", ownerTeamId: "local", projectId: "project_1", kind: "contact", fileName: "b.csv", revision: 1 },
      ],
    },
    projectId: "project_1",
    ownerTeamId: "local",
    dataRequirements: [requirement],
  });
  assert.equal(ambiguous.status, "ambiguous");
});

test("relation preview is read-only, explains unmatched rows, and detects object drift", () => {
  const plan = buildRuntimeDataPlan({
    state: {
      channelObjectFileSources: [
        { id: "orders", ownerTeamId: "local", projectId: "project_1", kind: "order", fileName: "orders.csv", revision: 1 },
        { id: "contacts", ownerTeamId: "local", projectId: "project_1", kind: "contact", fileName: "contacts.csv", revision: 1 },
      ],
    },
    projectId: "project_1",
    ownerTeamId: "local",
    dataRequirements: [
      { id: "orders_req", kind: "order", label: "订单表", fields: ["customer"] },
      { id: "contacts_req", kind: "contact", label: "客户表", fields: ["name"] },
    ],
    relations: [{
      id: "order_customer",
      type: "lookup",
      fromRequirementId: "orders_req",
      fromField: "customer",
      toRequirementId: "contacts_req",
      toField: "name",
    }],
  });
  const state = {
    channelObjectFileSources: [
      { id: "orders", ownerTeamId: "local", projectId: "project_1", kind: "order", fileName: "orders.csv", revision: 1 },
      { id: "contacts", ownerTeamId: "local", projectId: "project_1", kind: "contact", fileName: "contacts.csv", revision: 1 },
    ],
    channelObjectRecords: [
      { id: "order_1", ownerTeamId: "local", projectId: "project_1", sourceId: "orders", status: "active", revision: 1, label: "订单1", fields: { customer: "张三" } },
      { id: "contact_1", ownerTeamId: "local", projectId: "project_1", sourceId: "contacts", status: "active", revision: 1, label: "李四", fields: { name: "李四" } },
    ],
  };
  const preview = buildDataRelationPreview({ state, plan, projectId: "project_1", ownerTeamId: "local" });
  assert.equal(preview.status, "needs_review");
  assert.equal(preview.relations[0].unmatchedRows, 1);
  assert.equal(preview.objectSnapshot.some((record) => record.id === "order_1"), true);
  assert.equal(dataRelationPreviewMatchesCurrent({
    state,
    preview,
    plan,
    projectId: "project_1",
    ownerTeamId: "local",
  }).ok, true);
  state.channelObjectRecords[0].revision = 2;
  assert.equal(dataRelationPreviewMatchesCurrent({
    state,
    preview,
    plan,
    projectId: "project_1",
    ownerTeamId: "local",
  }).ok, false);
});
