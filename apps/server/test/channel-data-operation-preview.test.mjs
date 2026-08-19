import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildChannelDataOperationPreview,
  channelDataOperationReply,
  exportChannelDataOperationPreview,
} from "../src/services/channel-data-operation-preview.mjs";

async function fixture(content = "订单号,客户,状态,金额\nQ-1001,海棠科技,待跟进,12800\nQ-1002,远山贸易,已跟进,6400\n") {
  const projectPath = await mkdtemp(join(tmpdir(), "myagenttool-data-preview-"));
  const path = join(projectPath, "orders.csv");
  await writeFile(path, content, "utf8");
  const hash = "sha256:" + createHash("sha256").update(Buffer.from(content)).digest("hex");
  const asset = {
    id: "asset-orders",
    path: "orders.csv",
    hash,
    version: "v1",
    projectId: "project-1",
    terminalId: "terminal-1",
    readiness: { state: "ready" },
  };
  const plan = {
    schemaVersion: 1,
    status: "ready",
    origin: "channel_attachment",
    requirements: [{
      id: "asset-orders",
      kind: "file",
      label: "orders.csv",
      fields: ["order_number", "customer", "status", "amount"],
      required: true,
      state: "ready",
      sourceId: asset.id,
    }],
    relations: [],
    mutationPolicy: null,
    sources: [{
      sourceId: asset.id,
      kind: "file",
      sourceKind: "channel_attachment",
      fileName: "orders.csv",
      fingerprint: hash,
      rowCount: 2,
    }],
  };
  return { projectPath, asset, plan };
}

test("controlled preview queries a bounded result without writing the source", async () => {
  const h = await fixture();
  const preview = await buildChannelDataOperationPreview({
    text: "查询订单 Q-1001",
    plan: h.plan,
    attachments: [h.asset],
    projectPath: h.projectPath,
  });
  assert.equal(preview.status, "ready");
  assert.equal(preview.operation, "query");
  assert.equal(preview.matchedRows, 1);
  assert.equal(preview.sampleRows[0]["订单号"], "Q-1001");
  assert.match(channelDataOperationReply(preview), /海棠科技/);
});

test("count preview does not expose row values", async () => {
  const h = await fixture();
  const preview = await buildChannelDataOperationPreview({
    text: "统计订单数量",
    plan: h.plan,
    attachments: [h.asset],
    projectPath: h.projectPath,
  });
  assert.equal(preview.status, "ready");
  assert.equal(preview.operation, "count");
  assert.equal(preview.matchedRows, 2);
  assert.deepEqual(preview.sampleRows, []);
  assert.doesNotMatch(channelDataOperationReply(preview), /海棠科技|Q-1001/);
});

test("preview fails closed when the attachment changes or the request asks to write", async () => {
  const h = await fixture();
  await writeFile(join(h.projectPath, "orders.csv"), "订单号,客户\nQ-1001,已替换\n", "utf8");
  const stale = await buildChannelDataOperationPreview({
    text: "查询订单 Q-1001",
    plan: h.plan,
    attachments: [h.asset],
    projectPath: h.projectPath,
  });
  assert.equal(stale.status, "stale");
  assert.match(channelDataOperationReply(stale), /重新上传/);
  const blocked = await buildChannelDataOperationPreview({
    text: "把 Q-1001 的状态改成已跟进",
    plan: h.plan,
    attachments: [h.asset],
    projectPath: h.projectPath,
  });
  assert.equal(blocked.status, "blocked");
  assert.match(channelDataOperationReply(blocked), /不会写入原文件/);
});

test("explicit export creates a new bounded result and leaves the source unchanged", async () => {
  const h = await fixture();
  const sourceBefore = await readFile(join(h.projectPath, "orders.csv"), "utf8");
  const result = await exportChannelDataOperationPreview({
    text: "查询订单 Q-1001",
    plan: h.plan,
    attachments: [h.asset],
    projectPath: h.projectPath,
    outputName: "channel-results/orders-result.csv",
  });
  assert.equal(result.ok, true);
  assert.equal(result.matchedRows, 1);
  assert.equal(result.relativePath, "channel-results/orders-result.csv");
  assert.match(await readFile(join(h.projectPath, result.relativePath), "utf8"), /Q-1001/);
  assert.doesNotMatch(await readFile(join(h.projectPath, result.relativePath), "utf8"), /Q-1002/);
  assert.equal(await readFile(join(h.projectPath, "orders.csv"), "utf8"), sourceBefore);
});

test("export revalidates the source before writing", async () => {
  const h = await fixture();
  await writeFile(join(h.projectPath, "orders.csv"), "订单号,客户\nQ-1001,已替换\n", "utf8");
  const result = await exportChannelDataOperationPreview({
    text: "查询订单 Q-1001",
    plan: h.plan,
    attachments: [h.asset],
    projectPath: h.projectPath,
    outputName: "channel-results/stale.csv",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "stale");
});
