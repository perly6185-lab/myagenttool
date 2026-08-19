import assert from "node:assert/strict";
import test from "node:test";

import {
  channelRequestLooksLikeFileMutation,
  normalizeChannelExecutionStrategy,
  selectChannelExecutionStrategy,
} from "../src/services/channel-execution-strategy.mjs";

test("registered ledger work reuses the local connector and forbids ad-hoc scripts", () => {
  const strategy = selectChannelExecutionStrategy({
    goal: "把 quotations.csv 的 Q-1 跟进状态改成已报价",
    selectedTemplate: { definitionId: "rtd_quote", version: 1 },
    selectedDefinition: { id: "rtd_quote", dataRequirements: [{ id: "quote" }] },
    dataPlan: { status: "ready", requirements: [{ id: "quote" }] },
    dataMutationPreview: { status: "ready" },
    ledgerMutationPreview: { action: "update" },
    riskLevel: "local_change",
    generatedAt: "2026-08-19T00:00:00.000Z",
  });

  assert.equal(strategy.strategy, "reusable_operation");
  assert.equal(strategy.boundary, "local_connector");
  assert.equal(strategy.dynamicScript, "forbidden");
  assert.equal(strategy.safeToAutoRoute, true);
  assert.match(strategy.reason, /复用/);
});

test("generic development work remains inside the governed Bridge path", () => {
  const strategy = selectChannelExecutionStrategy({
    goal: "检查这个项目的登录问题并给出修复方案",
    riskLevel: "low",
    generatedAt: "2026-08-19T00:00:00.000Z",
  });

  assert.equal(strategy.strategy, "governed_bridge");
  assert.equal(strategy.boundary, "governed_bridge");
  assert.equal(strategy.safeToAutoRoute, true);
});

test("file mutations without a reusable operation stop before auto-routing", () => {
  assert.equal(channelRequestLooksLikeFileMutation("请修改 orders.csv 里的订单状态"), true);
  const strategy = selectChannelExecutionStrategy({
    goal: "请修改 orders.csv 里的订单状态",
    dataPlan: { status: "not_required", requirements: [] },
    riskLevel: "local_change",
    generatedAt: "2026-08-19T00:00:00.000Z",
  });

  assert.equal(strategy.strategy, "blocked");
  assert.equal(strategy.safeToAutoRoute, false);
  assert.equal(strategy.boundary, "none");
  assert.match(strategy.reason, /不能临时发明写回脚本/);
});

test("explicit read-only constraints override negated mutation words", () => {
  const goal = "帮我只读取当前项目目录，列出 3 个文件，不要修改任何文件";
  assert.equal(channelRequestLooksLikeFileMutation(goal), false);
  const strategy = selectChannelExecutionStrategy({
    goal,
    dataPlan: { status: "not_required", requirements: [] },
    riskLevel: "low",
    generatedAt: "2026-08-19T00:00:00.000Z",
  });
  assert.equal(strategy.strategy, "governed_bridge");
  assert.equal(strategy.accessMode, "read_only");
  assert.equal(strategy.safeToAutoRoute, true);
  assert.equal(strategy.operationIntent.mutatesExistingData, false);
});

test("strategy normalization is bounded and fail-closed", () => {
  const normalized = normalizeChannelExecutionStrategy({
    strategy: "unknown",
    boundary: "shell",
    operation: "x".repeat(500),
    safeToAutoRoute: true,
    dynamicScript: "anything",
    reason: "reason",
  });

  assert.equal(normalized.strategy, "blocked");
  assert.equal(normalized.boundary, "none");
  assert.equal(normalized.safeToAutoRoute, false);
  assert.equal(normalized.dynamicScript, "capability_bound");
  assert.equal(normalized.operation.length, 80);
});
