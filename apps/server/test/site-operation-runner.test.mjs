import test from "node:test";
import assert from "node:assert/strict";

import { createSiteOperationRunner } from "../src/services/site-operation-runner.mjs";

const manifest = {
  schemaVersion: 1,
  id: "wechat_official",
  name: "微信公众号",
  version: "0.1.0",
  kind: "site_capability",
  executorId: "builtin.wechat_official",
  hosts: ["mp.weixin.qq.com"],
  session: { required: true, authMethod: "persistent_profile", heartbeatTier: "manual", accountScoped: true },
  operations: [
    { id: "draft.sync", mode: "write", riskLevel: "medium", requiresApproval: true },
    { id: "draft.inspect", mode: "read", riskLevel: "low", requiresApproval: false },
  ],
};

function operationInput(overrides = {}) {
  return {
    pluginId: "wechat_official",
    operationId: "draft.sync",
    workItem: { id: "wi_1", projectId: "prj_1", terminalId: "dev_1", ownerTeamId: "team_1" },
    principalId: "usr_1",
    accountId: "account_1",
    approvalId: "approval_1",
    ...overrides,
  };
}

test("write operations require approval and confirmed writes replay without dispatch", async () => {
  const state = {};
  let calls = 0;
  const runner = createSiteOperationRunner({
    manifests: [manifest],
    executors: new Map([["builtin.wechat_official", async () => {
      calls += 1;
      return { status: "succeeded", remoteObject: { type: "wechat_draft", id: "draft_1", version: "v1" } };
    }]]),
    state,
  });
  await assert.rejects(() => runner.run(operationInput({ approvalId: null })), /site_operation_approval_required/);
  const first = await runner.run(operationInput());
  const replay = await runner.run(operationInput());
  assert.equal(first.result.status, "succeeded");
  assert.equal(replay.replayed, true);
  assert.equal(calls, 1);
  assert.equal(state.siteOperationReceipts.length, 1);
});

test("site operation receipts require an owning team scope", async () => {
  const runner = createSiteOperationRunner({
    manifests: [manifest],
    executors: new Map([["builtin.wechat_official", async () => ({ status: "succeeded" })]]),
    state: {},
  });
  await assert.rejects(() => runner.run(operationInput({
    workItem: { id: "wi_1", projectId: "prj_1", terminalId: "dev_1" },
  })), /site_operation_scope_required/);
});

test("unknown write outcomes require reconciliation and never auto-dispatch again", async () => {
  let calls = 0;
  const runner = createSiteOperationRunner({
    manifests: [manifest],
    executors: new Map([["builtin.wechat_official", async () => {
      calls += 1;
      return { status: "unconfirmed", summary: "browser closed after save" };
    }]]),
    state: {},
  });
  const first = await runner.run(operationInput());
  const replay = await runner.run(operationInput());
  assert.equal(first.next.action, "reconcile");
  assert.equal(replay.replayed, true);
  assert.equal(calls, 1);
});

test("credential-like values are redacted from executor summaries", async () => {
  const runner = createSiteOperationRunner({
    manifests: [manifest],
    executors: new Map([["builtin.wechat_official", async () => ({ status: "failed", summary: "cookie=abc secret=def" })]]),
    state: {},
  });
  const result = await runner.run(operationInput());
  assert.doesNotMatch(result.result.summary, /abc|def/);
  assert.match(result.result.summary, /\[redacted\]/);
});

test("JSON-shaped credential summaries are redacted recursively enough for logs", async () => {
  const runner = createSiteOperationRunner({
    manifests: [manifest],
    executors: new Map([["builtin.wechat_official", async () => ({
      status: "failed",
      summary: "{\"token\":\"secret123\",\"cookie\":\"session456\"}",
    })]]),
    state: {},
  });
  const result = await runner.run(operationInput());
  assert.doesNotMatch(result.result.summary, /secret123|session456/);
  assert.equal((result.result.summary.match(/\[redacted\]/g) ?? []).length, 2);
});
