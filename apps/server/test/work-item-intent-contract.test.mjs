import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildWorkItemIntentContract,
  freezeWorkItemIntentContract,
  workItemIntentResolutionScopeDigest,
} from "../src/services/work-item-intent-contract.mjs";

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
  assert.equal(contract.schemaVersion, 2);
  assert.equal(contract.snapshotKind, "current");
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
  assert.equal(first.snapshotKind, "execution_snapshot");
  assert.equal(first.confirmedBy, "usr_a");
  assert.equal(first.readOnly, true);
});

test("desktop-created development requests freeze explicit delivery prohibitions", () => {
  const contract = buildWorkItemIntentContract({
    id: "wi_no_commit",
    title: "软件实现",
    intentStatement: "新增 docs/result.md，不创建提交、不创建 PR、不推送远程。",
    taskKind: "software_implementation",
    acceptanceCriteria: ["文件存在"],
    verificationSop: ["检查文件"],
  });

  assert.equal(contract.action.accessMode, "write");
  assert.deepEqual(contract.action.forbiddenActions, ["commit", "pull_request", "push"]);
  assert.equal(contract.sources.action, "current_user");
});

test("a current explicit read-only instruction narrows a stale writable Channel interpretation", () => {
  const contract = buildWorkItemIntentContract({
    id: "wi_read_only_override",
    title: "检查项目，不要修改文件",
    body: "只读分析，不创建任何内容。",
    taskKind: "software_analysis",
    acceptanceCriteria: ["给出分析结论"],
    verificationSop: ["核对分析范围"],
    channelTaskContract: {
      source: "channel",
      operationIntent: { accessMode: "write", action: "mutate_files", forbiddenActions: [] },
    },
  });

  assert.equal(contract.status, "ready");
  assert.equal(contract.action.accessMode, "read_only");
  assert.equal(contract.sources.action, "current_user");
  assert.ok(contract.action.forbiddenActions.includes("modify"));
  assert.ok(contract.conflicts.some((conflict) => conflict.code === "operation_intent_restricted_by_user"));
});

test("a new write request cannot silently expand a confirmed read-only boundary", () => {
  const item = {
    id: "wi_write_expansion",
    title: "修改客户台账",
    intentStatement: "把已联系客户写回台账",
    taskKind: "business_spreadsheet",
    acceptanceCriteria: ["三条记录状态正确"],
    verificationSop: ["核对三条记录"],
    channelTaskContract: {
      source: "channel",
      operationIntent: { accessMode: "read_only", action: "query_data", forbiddenActions: ["commit"] },
    },
  };
  const contract = buildWorkItemIntentContract(item);

  assert.equal(contract.status, "needs_clarification");
  assert.equal(contract.action.accessMode, "read_only");
  assert.equal(contract.clarification.code, "write_request_exceeds_confirmed_boundary");
  assert.match(contract.clarification.reason.zh, /只读/);
  assert.equal(contract.clarification.options.length, 2);
  assert.deepEqual(contract.clarification.options.map((option) => [option.id, option.applyMode]), [
    ["keep_read_only", "automatic"],
    ["allow_write", "automatic"],
  ]);
  assert.deepEqual(contract.clarification.options[0].targetFields, ["action.accessMode", "action.operation"]);

  item.intentClarificationResolutions = [{
    code: "write_request_exceeds_confirmed_boundary",
    choiceId: "allow_write",
    scopeDigest: workItemIntentResolutionScopeDigest(item, "write_request_exceeds_confirmed_boundary"),
  }];
  const resolved = buildWorkItemIntentContract(item);
  assert.equal(resolved.status, "ready");
  assert.equal(resolved.action.accessMode, "write");
  assert.deepEqual(resolved.action.forbiddenActions, ["commit"]);
  assert.equal(resolved.sources.action, "confirmed_task_context");
  assert.deepEqual(resolved.resolutions, [{
    code: "write_request_exceeds_confirmed_boundary",
    choiceId: "allow_write",
    targetFields: ["action.accessMode", "action.operation", "action.forbiddenActions"],
  }]);
});

test("changing an input material identity changes the intent digest even when counts match", () => {
  const base = {
    id: "wi_material_drift",
    title: "分析资料",
    intentStatement: "分析选定资料",
    taskKind: "business_research",
    acceptanceCriteria: ["形成结论"],
    verificationSop: ["核对来源"],
  };
  const first = buildWorkItemIntentContract({
    ...base,
    localContentRefs: [{ id: "content_a", title: "客户 A", purpose: "required_input" }],
  });
  const second = buildWorkItemIntentContract({
    ...base,
    localContentRefs: [{ id: "content_b", title: "客户 B", purpose: "required_input" }],
  });

  assert.equal(first.materials.inputCount, 1);
  assert.equal(second.materials.inputCount, 1);
  assert.notEqual(first.digest, second.digest);
  assert.equal(first.materials.inputs[0].id, "content_a");
  assert.equal(second.materials.inputs[0].id, "content_b");
});

test("desktop and Channel intake use the same current-user prohibition boundary", () => {
  const base = {
    title: "只读检查项目，不要修改文件",
    taskKind: "software_analysis",
    acceptanceCriteria: ["给出结论"],
    verificationSop: ["核对范围"],
  };
  const desktop = buildWorkItemIntentContract(base);
  const channel = buildWorkItemIntentContract({
    ...base,
    channelTaskContract: {
      source: "channel",
      operationIntent: { accessMode: "unknown", action: "unknown", forbiddenActions: [] },
    },
  });

  assert.deepEqual(channel.action, desktop.action);
  assert.equal(channel.sources.action, "current_user");
  assert.equal(desktop.sources.action, "current_user");
});

test("an unknown intake operation falls back to the full task statement before freezing", () => {
  const contract = buildWorkItemIntentContract({
    id: "wi_unknown_intake",
    title: "文档型代码任务",
    intentStatement: "在当前 Git 项目新增 docs/result.md，不修改其他文件，不创建提交、不创建 PR、不推送远程。",
    taskKind: "software_implementation",
    acceptanceCriteria: ["文件存在"],
    verificationSop: ["检查文件"],
    channelTaskContract: {
      source: "desktop",
      operationIntent: { accessMode: "unknown", action: "unknown", forbiddenActions: [] },
    },
  });

  assert.equal(contract.action.accessMode, "write");
  assert.equal(contract.action.operation, "mutate_files");
  assert.deepEqual(contract.action.forbiddenActions, ["commit", "pull_request", "push"]);
});
