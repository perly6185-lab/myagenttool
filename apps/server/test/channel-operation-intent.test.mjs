import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeChannelOperationIntent,
  normalizeChannelOperationIntent,
} from "../src/services/channel-operation-intent.mjs";

test("extracts a durable read-only contract from the real iLink request", () => {
  const intent = analyzeChannelOperationIntent("帮我只读取当前项目目录，列出 3 个文件，不要修改任何文件。");
  assert.equal(intent.accessMode, "read_only");
  assert.equal(intent.action, "list_directory");
  assert.equal(intent.resource, "current_project");
  assert.equal(intent.explicitReadOnly, true);
  assert.equal(intent.mutatesExistingData, false);
  assert.deepEqual(intent.evidence.positiveWriteTerms, []);
  assert.deepEqual(intent.evidence.negatedWriteTerms, ["修改"]);
  assert.ok(intent.forbiddenActions.includes("write"));
  assert.equal(intent.confidence, 0.99);
});

test("extracts the same read-only boundary from the real desktop acceptance request", () => {
  const intent = analyzeChannelOperationIntent("客户端闭环验收 20260829-A：只读取当前 Documents 项目根目录，列出最多 3 个可见文件或文件夹，并用一句话说明每项用途；不要创建、修改、删除或发送任何内容。");
  assert.equal(intent.accessMode, "read_only");
  assert.equal(intent.action, "list_directory");
  assert.equal(intent.resource, "directory");
  assert.equal(intent.explicitReadOnly, true);
  assert.equal(intent.createsOutput, false);
  assert.equal(intent.mutatesExistingData, false);
});

test("keeps an actual write request writable even when another clause is negated", () => {
  const intent = analyzeChannelOperationIntent("不要修改 customers.csv，只修改 orders.xlsx 的状态");
  assert.equal(intent.accessMode, "write");
  assert.equal(intent.mutatesExistingData, true);
  assert.deepEqual(intent.evidence.negatedWriteTerms, ["修改"]);
  assert.deepEqual(intent.evidence.positiveWriteTerms, ["修改"]);
});

test("negated output creation stays read-only", () => {
  const intent = analyzeChannelOperationIntent("只查看当前目录，不要创建或修改任何文件");
  assert.equal(intent.accessMode, "read_only");
  assert.equal(intent.createsOutput, false);
  assert.equal(intent.mutatesExistingData, false);
  assert.deepEqual(intent.evidence.positiveWriteTerms, []);
  assert.equal(intent.evidence.negatedWriteTerms.length, 2);
  assert.ok(intent.evidence.negatedWriteTerms.includes("创建"));
  assert.ok(intent.evidence.negatedWriteTerms.includes("修改"));
});

test("normalization is bounded and cannot turn unknown input into write authority", () => {
  const intent = normalizeChannelOperationIntent({
    accessMode: "root",
    action: "shell",
    resource: "filesystem",
    mutatesExistingData: true,
    forbiddenActions: [],
    confidence: 99,
  });
  assert.equal(intent.accessMode, "unknown");
  assert.equal(intent.action, "unknown");
  assert.equal(intent.resource, "unspecified");
  assert.equal(intent.mutatesExistingData, false);
  assert.equal(intent.confidence, 1);
});

test("write intent preserves explicit no-commit, no-PR, and no-push boundaries", () => {
  const intent = analyzeChannelOperationIntent(
    "新增 docs/result.md，不创建提交、不创建 PR、不推送远程。",
  );
  assert.equal(intent.accessMode, "write");
  assert.deepEqual(intent.forbiddenActions, ["commit", "pull_request", "push"]);
});
