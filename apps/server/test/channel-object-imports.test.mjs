import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";

import { createChannelObjectImportService } from "../src/services/channel-object-imports.mjs";
import { asImportedRow, csvRows, objectRows } from "../src/services/channel-object-imports.mjs";
import { createLocalFileConnector } from "../src/services/channel-object-local-file-connector.mjs";
import { createChannelObjectConnectorService } from "../src/services/channel-object-connectors.mjs";
import { createChannelObjectRegistryService } from "../src/services/channel-object-registry.mjs";
import { channelObjectValidationMatches, resolveChannelObjectRequests } from "../src/services/channel-object-resolver.mjs";

const ACTOR = { userId: "usr_a", teamId: "team_a", role: "owner" };

function harness() {
  const state = {
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }],
    businessEntities: [], channelObjectRecords: [], channelObjectImports: [], channelObjectSyncs: [],
  };
  let counter = 0;
  const serviceOptions = {
    state, now: () => "2026-08-17T00:00:00.000Z", nextId: (prefix) => `${prefix}_${++counter}`,
    appendEvent: () => {}, persistStateSoon: () => {},
  };
  const registry = createChannelObjectRegistryService(serviceOptions);
  const imports = createChannelObjectImportService({ ...serviceOptions, upsertChannelObject: registry.upsertChannelObject, setChannelObjectStatus: registry.setChannelObjectStatus });
  const connectors = createChannelObjectConnectorService({ ...serviceOptions, upsertChannelObject: registry.upsertChannelObject });
  return { state, imports, connectors };
}

function base64(value) { return Buffer.from(value).toString("base64"); }

test("local file source exposes the common read-only adapter contract", async () => {
  const connector = createLocalFileConnector({
    decodeRows: async ({ bytes }) => ({ rows: objectRows(csvRows(bytes.toString("utf8"))), format: "csv" }),
    normalizeRow: asImportedRow,
  });
  const result = await connector.read({ bytes: Buffer.from("姓名\n本地用户\n"), format: "csv", fileName: "contacts.csv", kind: "contact" });
  assert.equal(connector.id, "local_file");
  assert.equal(result.rows[0].label, "本地用户");
});

test("previews CSV, rejects duplicate rows, and does not write objects before confirmation", async () => {
  const h = harness();
  const preview = await h.imports.previewChannelObjectImport({
    projectId: "prj_a", kind: "contact", format: "csv", fileName: "contacts.csv",
    content: base64("姓名,邮箱\n张三,zhang@example.test\n李四,zhang@example.test\n"),
  }, ACTOR);
  assert.equal(preview.status, 201);
  assert.equal(preview.body.import.errorRows, 1);
  assert.equal(preview.body.canConfirm, false);
  assert.equal(h.state.channelObjectRecords.length, 0);
});

test("imports JSON only after confirmation, is replay-safe, and masks account data", async () => {
  const h = harness();
  const preview = await h.imports.previewChannelObjectImport({
    projectId: "prj_a", kind: "account", format: "json", fileName: "accounts.json",
    content: base64(JSON.stringify([{ accountName: "公司账户", 账号: "6222 0000 1234 5678", currency: "CNY" }])),
  }, ACTOR);
  assert.equal(preview.body.canConfirm, true);
  assert.equal(h.state.channelObjectRecords.length, 0);
  const confirmed = h.imports.confirmChannelObjectImport({ importId: preview.body.import.id }, ACTOR);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.objects[0].fields.accountNumber, "****5678");
  assert.equal(confirmed.body.objects[0].source, "local_file");
  assert.equal(JSON.stringify(h.state).includes("6222 0000 1234 5678"), false);
  const replay = h.imports.confirmChannelObjectImport({ importId: preview.body.import.id }, ACTOR);
  assert.equal(replay.body.replayed, true);
  assert.equal(h.state.channelObjectRecords.length, 1);
});

test("local CSV data flows into Channel object verification and revision invalidation", async () => {
  const h = harness();
  const preview = await h.imports.previewChannelObjectImport({
    projectId: "prj_a", kind: "contact", format: "csv", fileName: "contacts.csv",
    content: base64("姓名,邮箱\n张三,zhangsan@example.test\n"),
  }, ACTOR);
  const confirmed = h.imports.confirmChannelObjectImport({ importId: preview.body.import.id }, ACTOR);
  assert.equal(confirmed.status, 200);
  const before = resolveChannelObjectRequests({
    state: h.state, projectId: "prj_a", ownerTeamId: "team_a", text: "把报价单发给张三", riskLevel: "external_communication",
  });
  assert.equal(before.state, "verified");
  assert.equal(before.verifiedObjects[0].kind, "contact");
  const record = h.state.channelObjectRecords[0];
  record.revision += 1;
  const after = resolveChannelObjectRequests({
    state: h.state, projectId: "prj_a", ownerTeamId: "team_a", text: "把报价单发给张三", riskLevel: "external_communication",
  });
  assert.equal(channelObjectValidationMatches(before, after), false);

  const nextPreview = await h.imports.previewChannelObjectImport({
    projectId: "prj_a", kind: "contact", format: "csv", fileName: "contacts.csv",
    content: base64("姓名,邮箱\n李四,lisi@example.test\n"),
  }, ACTOR);
  assert.deepEqual(nextPreview.body.import.diff, { created: 1, updated: 0, unchanged: 0, removed: 1 });
  assert.equal(h.imports.confirmChannelObjectImport({ importId: nextPreview.body.import.id }, ACTOR).status, 200);
  assert.equal(h.state.channelObjectRecords.some((row) => row.label === "张三" && row.status === "disabled"), true);
  assert.equal(h.state.channelObjectRecords.some((row) => row.label === "李四" && row.status === "active"), true);
  assert.equal(h.state.channelObjectFileSources[0].revision, 2);
});

test("imports after-sales CSV fields through the local file connector", async () => {
  const h = harness();
  const preview = await h.imports.previewChannelObjectImport({
    projectId: "prj_a", kind: "after_sales", format: "csv", fileName: "after-sales.csv",
    content: base64("售后单号,订单号,客户,售后问题,处理结果\nAS-1,O-1,海棠科技,设备异常,更换配件\n"),
  }, ACTOR);
  assert.equal(preview.status, 201);
  const confirmed = h.imports.confirmChannelObjectImport({ importId: preview.body.import.id }, ACTOR);
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed));
  assert.equal(confirmed.body.objects[0].fields.case_number, "AS-1");
  assert.equal(confirmed.body.objects[0].fields.issue, "设备异常");
  assert.equal(confirmed.body.objects[0].fields.resolution, "更换配件");
});

test("imports return records with order linkage, quantity, amount, and status", async () => {
  const h = harness();
  const preview = await h.imports.previewChannelObjectImport({
    projectId: "prj_a", kind: "return", format: "csv", fileName: "returns.csv",
    content: base64("退货单号,订单号,退货数量,退货金额,退货状态,退货原因\nRT-1,O-1,2,1200,已完成,客户换货\n"),
  }, ACTOR);
  assert.equal(preview.status, 201, JSON.stringify(preview));
  const confirmed = h.imports.confirmChannelObjectImport({ importId: preview.body.import.id }, ACTOR);
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed));
  assert.deepEqual(confirmed.body.objects[0].fields, {
    return_number: "RT-1", order_number: "O-1", quantity: "2", return_amount: "1200", return_status: "已完成", return_reason: "客户换货",
  });
});

test("reads the first XLSX sheet and syncs existing business entities through a read-only connector", async () => {
  const h = harness();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Contacts");
  sheet.addRow(["姓名", "电话"]);
  sheet.addRow(["李四", "13800000000"]);
  const bytes = await workbook.xlsx.writeBuffer();
  const preview = await h.imports.previewChannelObjectImport({
    projectId: "prj_a", kind: "contact", format: "xlsx", fileName: "contacts.xlsx", content: Buffer.from(bytes).toString("base64"),
  }, ACTOR);
  assert.equal(preview.body.import.acceptedRows, 1);
  assert.equal(h.imports.confirmChannelObjectImport({ importId: preview.body.import.id }, ACTOR).status, 200);

  h.state.businessEntities.push({
    id: "entity_1", ownerTeamId: "team_a", projectId: "prj_a", entityType: "customer", businessKey: "customer-王五",
    fields: { name: "王五", phone: "13900000000" },
  });
  const connectors = h.connectors.listChannelObjectConnectors();
  assert.equal(connectors.body.connectors[0].id, "business_entities");
  const sync = await h.connectors.syncChannelObjectConnector({ connectorId: "business_entities", projectId: "prj_a", kind: "contact" }, ACTOR);
  assert.equal(sync.status, 200);
  assert.equal(sync.body.sync.imported, 1);
  assert.equal(h.state.channelObjectRecords.some((row) => row.label === "王五" && row.source === "business_entities"), true);
});

test("external connector configuration stores only a credential reference and requires sync confirmation", async () => {
  const state = {
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }],
    businessEntities: [], channelObjectRecords: [], channelObjectImports: [], channelObjectSyncs: [],
  };
  let counter = 0;
  const registry = createChannelObjectRegistryService({
    state, now: () => "2026-08-17T00:00:00.000Z", nextId: (prefix) => `${prefix}_${++counter}`,
    appendEvent: () => {}, persistStateSoon: () => {},
  });
  const service = createChannelObjectConnectorService({
    state, now: () => "2026-08-17T00:00:00.000Z", nextId: (prefix) => `${prefix}_${++counter}`,
    appendEvent: () => {}, persistStateSoon: () => {}, upsertChannelObject: registry.upsertChannelObject,
    adapters: {
      crm: {
        id: "crm", name: "示例 CRM", kinds: ["contact"],
        async test() { return { ok: true }; },
        async list() { return [{ kind: "contact", label: "赵六", businessKey: "crm-6", fields: { name: "赵六", phone: "13600000000" }, sourceRef: "crm-6" }]; },
      },
    },
  });
  const saved = service.upsertChannelObjectConnectorConfig({
    projectId: "prj_a", connectorId: "crm", kinds: ["contact"], credentialRef: "application:crm.read",
  }, ACTOR);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.config.credentialConfigured, true);
  assert.equal(JSON.stringify(state).includes("application:crm.read"), true);
  const tested = await service.testChannelObjectConnectorConfig(saved.body.config.id, ACTOR);
  assert.equal(tested.status, 200);
  const preview = await service.previewChannelObjectConnectorSync({ configId: saved.body.config.id, kind: "contact" }, ACTOR);
  assert.equal(preview.status, 201);
  assert.equal(preview.body.preview.creates, 1);
  assert.equal(state.channelObjectRecords.length, 0);
  const confirmed = service.confirmChannelObjectConnectorSync({ previewId: preview.body.preview.id }, ACTOR);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.sync.imported, 1);
  assert.equal(service.confirmChannelObjectConnectorSync({ previewId: preview.body.preview.id }, ACTOR).body.replayed, true);
});
