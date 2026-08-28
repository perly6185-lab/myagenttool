import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWorkItemIntentContract, freezeWorkItemIntentContract } from "../src/services/work-item-intent-contract.mjs";

test("intent contract reconciles the task goal, method, materials, and destination", () => {
  const contract = buildWorkItemIntentContract({
    id: "lwi_1",
    title: "更新客户台账",
    intentStatement: "把已联系客户写回台账",
    taskKind: "business_spreadsheet",
    acceptanceCriteria: ["三条记录状态正确"],
    verificationSop: ["核对三条变更记录"],
    taskResourceRefs: [{
      id: "wrr_1", title: "客户台账", purpose: "change_target",
      capabilities: ["read", "query", "propose_change", "commit_change"],
    }],
    myTemplateBinding: {
      definitionId: "rtd_1", familyId: "family_1", version: 2,
      name: "客户跟进更新", expectedOutput: "客户台账.xlsx",
    },
  });

  assert.equal(contract.status, "ready");
  assert.equal(contract.goal, "把已联系客户写回台账");
  assert.equal(contract.method.kind, "template");
  assert.equal(contract.materials.changeTargets[0].canCommit, true);
  assert.equal(contract.delivery.destination, "task");
  assert.match(contract.digest, /^[a-f0-9]{64}$/);
});

test("intent contract asks only the highest-priority question while preserving all conflicts", () => {
  const contract = buildWorkItemIntentContract({
    id: "lwi_conflict",
    title: "只读分析后发布",
    taskKind: "content_publish",
    acceptanceCriteria: ["分析完成"],
    verificationSop: ["检查分析结果"],
    channelTaskContract: {
      source: "channel",
      operationIntent: { accessMode: "read_only", action: "read_files" },
    },
    taskResourceRefs: [{
      id: "wrr_1", title: "客户台账", purpose: "change_target", capabilities: ["read"],
    }],
  });

  assert.equal(contract.status, "needs_clarification");
  assert.equal(contract.clarification.code, "read_only_with_change_targets");
  assert.equal(contract.conflicts.length, 4);
  assert.ok(contract.conflicts.some((conflict) => conflict.code === "platform_target_missing"));
});

test("frozen intent contract is deterministic and records confirmation evidence", () => {
  const item = {
    id: "lwi_1", title: "整理结果", acceptanceCriteria: ["结果完整"], verificationSop: ["打开检查"],
  };
  const first = freezeWorkItemIntentContract(item, { confirmedAt: "2026-08-27T08:00:00.000Z", confirmedBy: "usr_a" });
  const second = freezeWorkItemIntentContract(item, { confirmedAt: "2026-08-27T08:00:00.000Z", confirmedBy: "usr_a" });

  assert.equal(first.digest, second.digest);
  assert.equal(first.confirmedBy, "usr_a");
  assert.equal(first.readOnly, true);
});
