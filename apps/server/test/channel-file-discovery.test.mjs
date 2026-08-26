import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  discoverChannelFileAsset,
  fileDiscoveryReply,
} from "../src/services/channel-file-discovery.mjs";

async function fixture() {
  const projectPath = await mkdtemp(join(tmpdir(), "myagenttool-file-discovery-"));
  await mkdir(join(projectPath, "uploads"), { recursive: true });
  const content = "订单号,客户,订单状态,金额\nO-1,海棠科技,待处理,1200\n";
  await writeFile(join(projectPath, "uploads/orders.csv"), content, "utf8");
  const hash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  return { projectPath, hash };
}

test("discovers CSV schema without exposing row values", async () => {
  const { projectPath, hash } = await fixture();
  const result = await discoverChannelFileAsset({
    projectPath,
    asset: {
      projectId: "prj_local",
      path: "uploads/orders.csv",
      originalName: "orders.csv",
      hash,
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.rowCount, 1);
  assert.deepEqual(result.recognizedFields, ["order_number", "customer", "status", "amount"]);
  assert.deepEqual(result.keyCandidates, [{ name: "订单号", field: "order_number" }]);
  assert.match(fileDiscoveryReply([result]), /1 条记录/);
  assert.doesNotMatch(JSON.stringify(result), /海棠科技|待处理|1200/);
});

test("file discovery detects source drift and refuses path escape", async () => {
  const { projectPath, hash } = await fixture();
  await writeFile(join(projectPath, "uploads/orders.csv"), "订单号,客户\nO-1,新内容\n", "utf8");
  const stale = await discoverChannelFileAsset({
    projectPath,
    asset: { projectId: "prj_local", path: "uploads/orders.csv", hash },
  });
  assert.equal(stale.status, "stale");

  const escaped = await discoverChannelFileAsset({
    projectPath,
    asset: { projectId: "prj_local", path: "../orders.csv", hash },
  });
  assert.equal(escaped.status, "forbidden");
});

test("unsupported or malformed files produce a bounded non-executing result", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "myagenttool-file-discovery-"));
  await writeFile(join(projectPath, "notes.txt"), "订单号\nO-1\n", "utf8");
  const result = await discoverChannelFileAsset({
    projectPath,
    asset: { projectId: "prj_local", path: "notes.txt" },
  });
  assert.equal(result.status, "unsupported");
  assert.equal(fileDiscoveryReply([result]), null);
});

test("legacy XLS is refused explicitly with a safe recovery instruction", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "myagenttool-file-discovery-"));
  const bytes = Buffer.from("D0CF11E0A1B11AE1", "hex");
  await writeFile(join(projectPath, "legacy.xls"), bytes);
  const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const result = await discoverChannelFileAsset({
    projectPath,
    asset: { id: "asset_xls", projectId: "prj_local", path: "legacy.xls", originalName: "历史台账.xls", hash },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "file_discovery_legacy_xls_unsupported");
  assert.equal(result.format, "xls");
  assert.match(fileDiscoveryReply([result]), /另存为 \.xlsx 或 CSV/);
});
