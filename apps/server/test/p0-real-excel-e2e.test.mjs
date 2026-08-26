import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";

import { businessLifecycleSummaries } from "../src/read-models/business-lifecycle.mjs";
import { createChannelObjectImportService } from "../src/services/channel-object-imports.mjs";
import { createChannelObjectRegistryService } from "../src/services/channel-object-registry.mjs";

const ACTOR = { userId: "usr_local", teamId: "team_local", role: "owner" };

async function writeWorkbook(directory, fileName, headers, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("业务数据");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  const path = join(directory, fileName);
  await workbook.xlsx.writeFile(path);
  return path;
}

test("P0 real Excel E2E preserves quote revisions, split shipments/payments, returns, and after-sales", async () => {
  const directory = await mkdtemp(join(tmpdir(), "myagenttool-real-xlsx-"));
  const state = {
    projects: [{ id: "prj_real_excel", ownerTeamId: ACTOR.teamId }],
    channelObjectRecords: [],
    channelObjectImports: [],
    channelObjectFileSources: [],
  };
  let sequence = 0;
  const options = {
    state,
    now: () => `2026-08-18T00:00:${String(++sequence).padStart(2, "0")}.000Z`,
    nextId: (prefix) => `${prefix}_real_${++sequence}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    validateApprovalToken: (token, request) => token === "issued-token" && request.action === "channel_object_import_confirm"
      ? { approved: true, grantId: "apg_test" }
      : { approved: false, reason: "grant_required" },
  };
  const registry = createChannelObjectRegistryService(options);
  const imports = createChannelObjectImportService({
    ...options,
    upsertChannelObject: registry.upsertChannelObject,
    setChannelObjectStatus: registry.setChannelObjectStatus,
  });

  const files = [
    {
      kind: "quotation",
      fileName: "报价版本.xlsx",
      headers: ["报价单号", "订单号", "客户", "报价金额", "状态"],
      rows: [["Q-2026-01", "O-2026-01", "海棠科技", "12000", "已修改"], ["Q-2026-02", "O-2026-01", "海棠科技", "10000", "已确认"]],
    },
    {
      kind: "order",
      fileName: "订单.xlsx",
      headers: ["订单号", "客户", "金额", "订单状态"],
      rows: [["O-2026-01", "海棠科技", "10000", "已完成"]],
    },
    {
      kind: "shipment",
      fileName: "分批发货.xlsx",
      headers: ["物流单号", "订单号", "客户", "发货数量", "发货状态"],
      rows: [["S-2026-01", "O-2026-01", "海棠科技", "3", "已发货"], ["S-2026-02", "O-2026-01", "海棠科技", "2", "已完成"]],
    },
    {
      kind: "receivable",
      fileName: "分批回款.xlsx",
      headers: ["回款单号", "订单号", "客户", "金额", "已回款金额", "回款状态"],
      rows: [["P-2026-01", "O-2026-01", "海棠科技", "5000", "3000", "部分回款"], ["P-2026-02", "O-2026-01", "海棠科技", "5000", "3000", "已回款"]],
    },
    {
      kind: "bank_transaction",
      fileName: "到账流水.xlsx",
      headers: ["银行流水号", "交易日期", "订单号", "客户", "金额", "状态"],
      rows: [["T-2026-01", "2026-08-18", "O-2026-01", "海棠科技", "6000", "已到账"]],
    },
    {
      kind: "after_sales",
      fileName: "售后记录.xlsx",
      headers: ["售后单号", "订单号", "客户", "售后问题", "处理结果", "售后状态"],
      rows: [["AS-2026-01", "O-2026-01", "海棠科技", "设备异常", "更换配件", "已关闭"], ["AS-2026-02", "O-2026-01", "海棠科技", "包装破损", "补发配件", "已关闭"]],
    },
    {
      kind: "return",
      fileName: "退货记录.xlsx",
      headers: ["退货单号", "订单号", "客户", "退货数量", "退货金额", "退货状态", "退货原因"],
      rows: [["RT-2026-01", "O-2026-01", "海棠科技", "1", "2000", "已完成", "客户换货"]],
    },
  ];

  try {
    for (const definition of files) {
      const path = await writeWorkbook(directory, definition.fileName, definition.headers, definition.rows);
      const bytes = await readFile(path);
      assert.ok(bytes.subarray(0, 2).equals(Buffer.from("PK")), `${definition.fileName} is not an XLSX zip`);
      const preview = await imports.previewChannelObjectImport({
        projectId: "prj_real_excel",
        kind: definition.kind,
        format: "xlsx",
        fileName: basename(path),
        content: bytes.toString("base64"),
      }, ACTOR);
      assert.equal(preview.status, 201, `${definition.fileName}: ${JSON.stringify(preview)}`);
      assert.equal(preview.body.import.acceptedRows, definition.rows.length);
      assert.equal(preview.body.canConfirm, true);
      const confirmed = imports.confirmChannelObjectImport({ importId: preview.body.import.id, approvalToken: "issued-token" }, ACTOR);
      assert.equal(confirmed.status, 200, `${definition.fileName}: ${JSON.stringify(confirmed)}`);
      assert.equal(confirmed.body.replayed, false);
    }

    const summary = businessLifecycleSummaries({
      records: state.channelObjectRecords,
      sources: state.channelObjectFileSources,
      projectId: "prj_real_excel",
    });
    assert.equal(summary.length, 1);
    assert.equal(summary[0].state, "closed");
    assert.equal(summary[0].orderNumber, "O-2026-01");
    assert.equal(summary[0].stages.quotation.count, 2);
    assert.equal(summary[0].stages.shipment.count, 2);
    assert.equal(summary[0].stages.receivable.count, 2);
    assert.equal(summary[0].stages.after_sales.count, 2);
    assert.equal(summary[0].stages.return.count, 1);
    assert.equal(summary[0].totals.quotationAmount, 22000);
    assert.equal(summary[0].totals.collectedAmount, 6000);
    assert.equal(summary[0].totals.shipmentQuantity, 5);
    assert.equal(summary[0].totals.returnAmount, 2000);
    assert.equal(summary[0].totals.returnQuantity, 1);
    assert.equal(state.channelObjectFileSources.length, files.length);
    assert.equal(state.channelObjectFileSources.every((source) => source.status === "active"), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
