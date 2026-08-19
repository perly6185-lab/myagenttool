import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";

import { createServerRuntimeServices } from "../../src/runtime/service-composer.mjs";
import { createServerState } from "../../src/runtime/state-factory.mjs";

const NOW = "2026-08-19T00:00:00.000Z";
const OWNER = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

async function xlsxBytes() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("订单");
  sheet.addRow(["订单号", "客户", "状态", "金额"]);
  sheet.addRow(["Q-1001", "海棠科技", "待跟进", 12800]);
  sheet.addRow(["Q-1002", "远山贸易", "已跟进", 6400]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function makeHarness() {
  const projectPath = await mkdtemp(join(tmpdir(), "myagenttool-ilink-data-e2e-"));
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
  const { httpDependencies: deps } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: projectPath,
    persistenceEnabled: false,
    stateStorePath: join(projectPath, "state.json"),
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now: () => NOW,
  });
  const channel = {
    id: "chn_ilink_data_e2e",
    provider: "wechat_ilink",
    ownerTeamId: OWNER.teamId,
    status: "enabled",
    operationMode: "personal",
    taskAutoRoute: true,
    allowSelfApprove: true,
    taskProjectId: defaultProject.id,
    taskTerminalId: (state.devices ?? [])[0]?.id ?? "dev_local",
  };
  state.channels.push(channel);
  assert.equal(deps.mapChannelIdentity({ channelId: channel.id, externalUserId: "wx-data-e2e", userId: OWNER.userId }, OWNER).ok, true);
  const sent = [];
  deps.setChannelDeliverySender("wechat_ilink", async (payload) => {
    sent.push(payload);
    return { ok: true, clientId: payload.clientId };
  });
  return { projectPath, state, defaultProject, channel, deps, sent };
}

async function runFormat(format) {
  const h = await makeHarness();
  const source = format === "csv"
    ? Buffer.from("订单号,客户,状态,金额\nQ-1001,海棠科技,待跟进,12800\nQ-1002,远山贸易,已跟进,6400\n", "utf8")
    : await xlsxBytes();
  const sourceText = format === "csv" ? source.toString("utf8") : null;
  const imported = await h.deps.importChannelEvent({
    channelId: h.channel.id,
    providerMessageId: `data-${format}-task`,
    externalUserId: "wx-data-e2e",
    content: "/task 查询订单 Q-1001",
    attachmentCandidates: [{ filename: `orders.${format}`, bytes: source, contentType: format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }],
  });
  assert.equal(imported.ok, true);
  const taskEvent = h.state.channelEvents.find((event) => event.id === imported.eventId);
  assert.match(taskEvent.replyText, /Q-1001|海棠科技/);
  const thread = h.state.channelTaskThreads.at(-1);
  assert.equal(thread.dataOperationPreview.status, "ready");
  assert.equal(thread.dataOperationPreview.matchedRows, 1);
  assert.equal(thread.dataOperationPreview.sampleRows[0]["订单号"], "Q-1001");

  const exported = await h.deps.importChannelEvent({
    channelId: h.channel.id,
    providerMessageId: `data-${format}-export`,
    externalUserId: "wx-data-e2e",
    content: "确认导出",
  });
  assert.equal(exported.ok, true);
  const exportEvent = h.state.channelEvents.find((event) => event.id === exported.eventId);
  assert.equal(exportEvent.status, "dispatched");
  const outputAsset = thread.exportedAsset;
  assert.ok(outputAsset?.path);
  assert.equal(h.state.workItems.find((item) => item.id === thread.workItemId).outputAssets.some((asset) => asset.id === outputAsset.id), true);
  const output = await readFile(join(h.projectPath, outputAsset.path), "utf8");
  assert.match(output, /Q-1001/);
  assert.doesNotMatch(output, /Q-1002/);
  if (sourceText) assert.equal(await readFile(join(h.projectPath, thread.attachmentAssets[0].path), "utf8"), sourceText);

  await h.deps.sweepWorkItemOperationalAlerts?.();
  await h.deps.sweepChannelDeliveries();
  assert.ok(h.sent.some((message) => message.mediaAssets?.some((asset) => asset.id === outputAsset.id)));

  const deliveryCount = h.state.channelDeliveries.length;
  await h.deps.importChannelEvent({
    channelId: h.channel.id,
    providerMessageId: `data-${format}-repeat`,
    externalUserId: "wx-data-e2e",
    content: "确认导出",
  });
  assert.equal(h.state.channelDeliveries.length, deliveryCount + 1, "repeated confirmation creates a fresh delivery but reuses the result file");
  assert.equal(thread.exportedAsset.path, outputAsset.path);
}

test("real iLink-shaped CSV flow exports, delivers, and reuses the result", async () => {
  await runFormat("csv");
});

test("real iLink-shaped XLSX flow exports through the same user path", async () => {
  await runFormat("xlsx");
});
