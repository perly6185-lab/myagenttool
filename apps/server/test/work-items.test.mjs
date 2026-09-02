import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";
import {
  backfillWorkItemTerminalOwnership,
  createWorkItemService,
  extractAcceptanceCriteriaFromBody,
  taskTraceStage,
} from "../src/services/work-items.mjs";
import { backfillWorkItemFollowUpContext } from "../src/services/work-item-follow-up.mjs";
import {
  evaluateMyTemplateGovernance,
  matchPublishedMyTemplate,
} from "../src/services/work-item-template-matching.mjs";

const ACTOR_A = { userId: "usr_a", teamId: "team_a", role: "operator" };
const ACTOR_B = { userId: "usr_b", teamId: "team_b" };
const ACTOR_C = { userId: "usr_c", teamId: "team_a" };

function harness({
  clock = () => "2026-07-24T00:00:00.000Z",
  projectPath = null,
  store,
  persistStateSoon,
  budgetStatusFor = () => null,
  teamBudgetStatusFor = () => null,
  retryAlert = () => null,
  resolveApplicationCapability,
  invokeResolvedCapability,
  issueApplicationApprovalGrant,
  enqueueChannelDeliveryBatch,
  validateApprovalToken,
  onWorkItemChanged,
  claimTaskMaterialDraft,
  inspectTaskMaterialDraft,
  resolveClaimedTaskMaterial,
  resolveLocalContentReference,
  resolveWorkResourceReference,
  probeMediaAsset,
} = {}) {
  let counter = 0;
  const events = [];
  const alerts = [];
  const state = {
    devices: [{ id: "dev_local" }],
    workItems: [],
    workItemComments: [],
    workItemActivities: [],
    users: [
      { id: "usr_a", teamId: "team_a" },
      { id: "usr_b", teamId: "team_b" },
      { id: "usr_c", teamId: "team_a" },
    ],
    projects: [
      { id: "prj_a", ownerTeamId: "team_a", ...(projectPath ? { path: projectPath } : {}) },
      { id: "prj_b", ownerTeamId: "team_b", ...(projectPath ? { path: projectPath } : {}) },
    ],
  };
  const service = createWorkItemService({
    state,
    now: clock,
    nextId: (prefix) => `${prefix}_${++counter}`,
    appendEvent: (event) => events.push(event),
    sendAlert: (alert) => {
      alerts.push(alert);
      return Promise.resolve({ sent: true });
    },
    store,
    persistStateSoon,
    budgetStatusFor,
    teamBudgetStatusFor,
    retryAlert,
    resolveApplicationCapability,
    invokeResolvedCapability,
    issueApplicationApprovalGrant,
    enqueueChannelDeliveryBatch,
    validateApprovalToken,
    onWorkItemChanged,
    claimTaskMaterialDraft,
    inspectTaskMaterialDraft,
    resolveClaimedTaskMaterial,
    resolveLocalContentReference,
    resolveWorkResourceReference,
    probeMediaAsset,
  });
  return { state, events, alerts, service };
}

test("work item detail exposes one task context summary over existing Channel and material records", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({ projectId: "prj_a", title: "整理供应商报价" }, ACTOR_A).body.workItem;
  const stored = state.workItems.find((item) => item.id === created.id);
  stored.channelOrigin = { channelId: "chn_quote", conversationId: "conv_quote", threadId: "cth_quote", messageId: "evt_quote" };
  stored.inputAssets = [{
    id: "asset_quote",
    originalName: "报价单.xlsx",
    hash: "sha256:quote",
    readiness: { state: "ready", reason: "channel_attachment_ingested" },
  }];
  stored.channelTaskContract = { dataSources: [{ kind: "channel_attachment", id: "asset_quote" }] };
  state.channels = [{ id: "chn_quote", ownerTeamId: "team_a", provider: "wechat_ilink", name: "采购协作" }];
  state.channelTaskThreads = [{
    id: "cth_quote", workItemId: created.id, channelId: "chn_quote", conversationId: "conv_quote", sourceEventIds: ["evt_quote"],
  }];

  const detail = service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem;

  assert.equal(detail.taskContextSummary.origin.kind, "channel");
  assert.equal(detail.taskContextSummary.origin.label, "采购协作");
  assert.equal(detail.taskContextSummary.method.kind, "custom");
  assert.deepEqual(detail.taskContextSummary.materials.map((material) => [material.title, material.source, material.role]), [
    ["报价单.xlsx", "channel_attachment", "required_input"],
  ]);
  assert.equal(detail.taskContextSummary.delivery.destination, "channel");
});

test("task context correction updates canonical material roles and result destination before execution", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({ projectId: "prj_a", title: "整理供应商报价" }, ACTOR_A).body.workItem;
  const stored = state.workItems.find((item) => item.id === created.id);
  stored.channelOrigin = { channelId: "chn_quote", conversationId: "conv_quote", threadId: "cth_quote" };
  stored.localContentRefs = [{ id: "wcr_rules", contentId: "lc_rules", title: "采购规则", purpose: "reference" }];
  stored.taskResourceRefs = [{
    id: "wrr_ledger",
    resourceId: "res_ledger",
    title: "供应商台账",
    purpose: "query_source",
    locality: "local",
    capabilities: ["read", "query", "propose_change", "commit_change"],
    allowedPurposes: ["reference", "query_source", "change_target"],
  }];
  state.channels = [{ id: "chn_quote", ownerTeamId: "team_a", name: "采购协作" }];

  const corrected = service.updateTaskContext({
    workItemId: created.id,
    expectedRevision: stored.revision,
    deliveryDestination: "task",
    materialRoles: [
      { id: "wcr_rules", role: "required_input" },
      { id: "wrr_ledger", role: "change_target" },
    ],
  }, ACTOR_A);

  assert.equal(corrected.status, 200);
  assert.equal(stored.localContentRefs[0].purpose, "required_input");
  assert.equal(stored.taskResourceRefs[0].purpose, "change_target");
  assert.equal(stored.dataContextSnapshot.schemaVersion, 2);
  assert.equal(stored.dataContextSnapshot.deliveryDestination, "task");
  assert.ok(stored.dataContextSnapshot.sources.find((source) => source.referenceId === "wrr_ledger").allowedOperations.includes("commit_change"));
  assert.equal(corrected.body.workItem.taskContextSummary.delivery.destination, "task");
  assert.deepEqual(corrected.body.workItem.taskContextSummary.materials.map((material) => [material.id, material.role]), [
    ["wcr_rules", "required_input"],
    ["wrr_ledger", "change_target"],
  ]);
  assert.equal(state.workItemActivities[0].action, "task_context_corrected");
  assert.deepEqual(state.workItemActivities[0].details.materials, [
    { referenceId: "wcr_rules", from: "reference", to: "required_input" },
    { referenceId: "wrr_ledger", from: "query_source", to: "change_target" },
  ]);
});

test("task context correction rejects unsupported roles and locks after execution starts", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({ projectId: "prj_a", title: "整理规则" }, ACTOR_A).body.workItem;
  const stored = state.workItems.find((item) => item.id === created.id);
  stored.localContentRefs = [{ id: "wcr_rules", contentId: "lc_rules", title: "规则", purpose: "reference" }];

  const invalid = service.updateTaskContext({
    workItemId: created.id,
    expectedRevision: stored.revision,
    materialRoles: [{ id: "wcr_rules", role: "change_target" }],
  }, ACTOR_A);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, "work_item_context_material_role_not_allowed");

  stored.taskResourceRefs = [{
    id: "wrr_remote",
    resourceId: "res_remote",
    title: "远程只读台账",
    purpose: "query_source",
    locality: "remote",
    allowedPurposes: ["reference", "query_source"],
  }];
  const elevated = service.updateTaskContext({
    workItemId: created.id,
    expectedRevision: stored.revision,
    materialRoles: [{ id: "wrr_remote", role: "change_target" }],
  }, ACTOR_A);
  assert.equal(elevated.status, 400);
  assert.equal(elevated.body.error, "work_item_context_material_role_not_allowed");

  stored.executionBindings = [{ kind: "auto_run", targetId: "run_1" }];
  const locked = service.updateTaskContext({
    workItemId: created.id,
    expectedRevision: stored.revision,
    materialRoles: [{ id: "wcr_rules", role: "required_input" }],
  }, ACTOR_A);
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error, "work_item_context_locked_after_start");
});

test("intent clarification applies only a current server-defined choice and replays idempotently", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "修改客户台账",
    intentStatement: "把已联系客户写回台账",
    acceptanceCriteria: ["三条记录状态正确"],
    verificationSop: ["核对三条记录"],
  }, ACTOR_A).body.workItem;
  const stored = state.workItems.find((item) => item.id === created.id);
  stored.channelTaskContract = {
    source: "channel",
    operationIntent: { accessMode: "read_only", action: "query_data", forbiddenActions: [] },
  };
  const current = service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem;
  assert.equal(current.intentContract.clarification.code, "write_request_exceeds_confirmed_boundary");

  const stale = service.updateTaskContext({
    workItemId: created.id,
    expectedRevision: current.revision,
    intentResolution: {
      idempotencyKey: "intent-stale",
      expectedIntentDigest: "0".repeat(64),
      conflictCode: "write_request_exceeds_confirmed_boundary",
      choiceId: "allow_write",
    },
  }, ACTOR_A);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "work_item_intent_clarification_stale");

  const denied = service.updateTaskContext({
    workItemId: created.id,
    expectedRevision: current.revision,
    intentResolution: {
      idempotencyKey: "intent-denied",
      expectedIntentDigest: current.intentContract.digest,
      conflictCode: "write_request_exceeds_confirmed_boundary",
      choiceId: "write_everything",
    },
  }, ACTOR_A);
  assert.equal(denied.status, 400);
  assert.equal(denied.body.error, "work_item_intent_resolution_choice_not_allowed");

  const arbitraryPatch = service.updateTaskContext({
    workItemId: created.id,
    expectedRevision: current.revision,
    intentResolution: {
      idempotencyKey: "intent-arbitrary-patch",
      expectedIntentDigest: current.intentContract.digest,
      conflictCode: "write_request_exceeds_confirmed_boundary",
      choiceId: "allow_write",
      targetFields: ["delivery.platform"],
    },
  }, ACTOR_A);
  assert.equal(arbitraryPatch.status, 400);
  assert.equal(arbitraryPatch.body.error, "work_item_intent_resolution_must_be_isolated");

  const resolved = service.updateTaskContext({
    workItemId: created.id,
    expectedRevision: current.revision,
    intentResolution: {
      idempotencyKey: "intent-allow-write",
      expectedIntentDigest: current.intentContract.digest,
      conflictCode: "write_request_exceeds_confirmed_boundary",
      choiceId: "allow_write",
    },
  }, ACTOR_A);
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.replayed, false);
  assert.equal(resolved.body.workItem.revision, current.revision + 1);
  assert.equal(resolved.body.workItem.intentContract.status, "ready");
  assert.equal(resolved.body.workItem.intentContract.action.accessMode, "write");

  const replayed = service.updateTaskContext({
    workItemId: created.id,
    expectedRevision: current.revision,
    intentResolution: {
      idempotencyKey: "intent-allow-write",
      expectedIntentDigest: current.intentContract.digest,
      conflictCode: "write_request_exceeds_confirmed_boundary",
      choiceId: "allow_write",
    },
  }, ACTOR_A);
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.workItem.revision, resolved.body.workItem.revision);

  const conflictingReplay = service.updateTaskContext({
    workItemId: created.id,
    expectedRevision: current.revision,
    intentResolution: {
      idempotencyKey: "intent-allow-write",
      expectedIntentDigest: current.intentContract.digest,
      conflictCode: "write_request_exceeds_confirmed_boundary",
      choiceId: "keep_read_only",
    },
  }, ACTOR_A);
  assert.equal(conflictingReplay.status, 409);
  assert.equal(conflictingReplay.body.error, "work_item_intent_resolution_idempotency_conflict");
  assert.equal(state.workItemActivities[0].action, "work_item_intent_clarification_resolved");
});

test("manual intent clarification choices cannot be applied as an automatic context patch", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "只读分析客户台账，不要修改",
    acceptanceCriteria: ["给出分析结论"],
    verificationSop: ["核对分析范围"],
  }, ACTOR_A).body.workItem;
  const stored = state.workItems.find((item) => item.id === created.id);
  stored.taskResourceRefs = [{
    id: "wrr_ledger",
    resourceId: "res_ledger",
    title: "客户台账",
    purpose: "change_target",
    locality: "local",
    capabilities: ["read", "query", "propose_change", "commit_change"],
    allowedPurposes: ["reference", "query_source", "change_target"],
  }];
  const current = service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem;
  assert.equal(current.intentContract.clarification.code, "read_only_with_change_targets");

  const result = service.updateTaskContext({
    workItemId: created.id,
    expectedRevision: current.revision,
    intentResolution: {
      idempotencyKey: "intent-manual-option",
      expectedIntentDigest: current.intentContract.digest,
      conflictCode: "read_only_with_change_targets",
      choiceId: "review_material_roles",
    },
  }, ACTOR_A);

  assert.equal(result.status, 409);
  assert.equal(result.body.error, "work_item_intent_choice_requires_manual_edit");
  assert.deepEqual(result.body.targetFields, ["materials.roles"]);
  assert.equal(stored.revision, current.revision);
  assert.equal(stored.taskResourceRefs[0].purpose, "change_target");
});

test("desktop intent planning creates discrete typed tasks instead of one giant task", () => {
  const { service, state } = harness();
  const input = {
    projectId: "prj_a",
    title: "分析系统为什么报错，修好后测试，再部署上线",
    body: "分析系统为什么报错，修好后测试，再部署上线",
    mode: "ai",
    idempotencyKey: "desktop-plan-software-1",
  };
  const preview = service.previewIntentTaskPlan(input, ACTOR_A);
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.plan.tasks.map((task) => task.kind), [
    "software_analysis", "software_implementation", "software_verification", "software_deployment",
  ]);
  assert.equal(preview.body.summary.requiresRepository, true);
  assert.equal(preview.body.summary.approvalTaskCount, 1);

  const committed = service.commitIntentTaskPlan(input, ACTOR_A);
  assert.equal(committed.status, 201);
  assert.equal(committed.body.workItems.length, 4);
  assert.equal(state.workGoals.length, 1);
  assert.deepEqual(state.workGoals[0].taskIds, committed.body.workItems.map((item) => item.id));
  assert.equal(committed.body.workItems[0].taskKind, "software_analysis");
  assert.deepEqual(committed.body.workItems[1].dependencyIds, [committed.body.workItems[0].id]);
  assert.deepEqual(committed.body.workItems[2].dependencyIds, [committed.body.workItems[1].id]);
  assert.equal(committed.body.workItems[3].status, "backlog");
  assert.equal(committed.body.workItems[3].waitingOn, "me");

  const replay = service.commitIntentTaskPlan(input, ACTOR_A);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(state.workItems.length, 4);
});

test("desktop office validation wording stays out of the software verification flow", () => {
  const { service } = harness();
  const officecli = service.previewIntentTaskPlan({
    projectId: "prj_a",
    title: "用 officecli 更新 sales.xlsx，并验证公式和单元格格式",
    body: "用 officecli 更新 sales.xlsx，并验证公式和单元格格式",
    mode: "ai",
  }, ACTOR_A);
  assert.equal(officecli.status, 200);
  assert.deepEqual(officecli.body.plan.tasks.map((task) => task.kind), ["business_document"]);
  assert.equal(officecli.body.summary.requiresRepository, false);
  assert.equal(officecli.body.plan.tasks[0].artifactContract.verification, undefined);

  const spreadsheet = service.previewIntentTaskPlan({
    projectId: "prj_a",
    title: "整理 Excel 客户表格并测试公式是否正确",
    body: "整理 Excel 客户表格并测试公式是否正确",
    mode: "ai",
  }, ACTOR_A);
  assert.equal(spreadsheet.status, 200);
  assert.deepEqual(spreadsheet.body.plan.tasks.map((task) => task.kind), ["business_document"]);
  assert.equal(spreadsheet.body.summary.requiresRepository, false);
  assert.equal(spreadsheet.body.plan.tasks[0].artifactContract.verification, undefined);

  const clientAcceptance = service.previewIntentTaskPlan({
    projectId: "prj_a",
    title: "客户端闭环验收 20260829-B：在当前 Documents 项目下创建‘客户端验收/办公验证清单-20260829.xlsx’，包含‘清单’和‘统计’两个工作表；清单录入 4 条示例事项（事项、负责人、状态、金额），统计表按状态汇总数量和金额。完成后验证工作表名称与合计公式正确。只创建该文件，不覆盖、不发送其他内容。",
    body: "客户端闭环验收 20260829-B：在当前 Documents 项目下创建‘客户端验收/办公验证清单-20260829.xlsx’，包含‘清单’和‘统计’两个工作表；清单录入 4 条示例事项（事项、负责人、状态、金额），统计表按状态汇总数量和金额。完成后验证工作表名称与合计公式正确。只创建该文件，不覆盖、不发送其他内容。",
    mode: "ai",
  }, ACTOR_A);
  assert.equal(clientAcceptance.status, 200);
  assert.deepEqual(clientAcceptance.body.plan.tasks.map((task) => task.kind), ["business_document"]);
  assert.equal(clientAcceptance.body.summary.requiresRepository, false);
  assert.equal(clientAcceptance.body.summary.canStartAi, true);
  assert.equal(clientAcceptance.body.plan.tasks[0].artifactContract.verification, undefined);
});

test("work items persist provider-neutral record bindings and require managed refreshes", () => {
  const { service, state } = harness();
  const fingerprint = `sha256:${"b".repeat(64)}`;
  const binding = {
    id: "binding_customer",
    slotKey: "customer",
    direction: "input",
    role: "required",
    ledgerDefinitionId: "ledger_customer",
    record: {
      ledgerDefinitionId: "ledger_customer",
      recordId: "blr_customer_1",
      recordType: "customer",
      businessKey: "CUS-001",
      title: "客户 A",
      revision: "revision-1",
      fingerprint,
      observedAt: "2026-08-26T08:00:00Z",
    },
    selection: { fieldKeys: ["name"], queryId: null, rowLimit: 1 },
    snapshot: { revision: "revision-1", fingerprint, capturedAt: "2026-08-26T08:00:00Z", evidenceRefs: [{ artifactId: "art_customer", field: "name" }] },
    resolution: { source: "explicit_user", confidence: 1, state: "resolved", reasons: ["用户明确选择"] },
  };
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "为客户 A 制作方案",
    recordBindings: [binding],
  }, ACTOR_A);
  assert.equal(created.status, 201);
  assert.equal(created.body.workItem.recordBindings[0].record.recordId, "blr_customer_1");
  const workItemId = created.body.workItem.id;
  const managed = service.updateWorkItem({
    workItemId,
    expectedRevision: created.body.workItem.revision,
    recordBindings: [{ ...binding, resolution: { ...binding.resolution, state: "stale" } }],
  }, ACTOR_A);
  assert.equal(managed.status, 409);
  assert.equal(managed.body.error, "work_item_record_bindings_require_managed_update");

  const stored = state.workItems.find((item) => item.id === workItemId);
  stored.recordBindings[0].resolution.state = "stale";
  const admission = service.beginExecution({ workItemId, kind: "auto_run" }, ACTOR_A);
  assert.equal(admission.status, 409);
  assert.equal(admission.body.error, "work_item_record_bindings_stale");
  assert.deepEqual(admission.body.blockingBindings, [{ bindingId: "binding_customer", state: "stale" }]);

  stored.executionBindings = [{ kind: "auto_run", targetId: "run_1" }];
  const blocked = service.updateWorkItem({
    workItemId,
    expectedRevision: stored.revision,
    recordBindings: [binding],
  }, ACTOR_A);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "work_item_record_bindings_immutable");
});

test("work item record bindings keep IDs unique and allow one primary ledger only", () => {
  const { service } = harness();
  const fingerprint = `sha256:${"c".repeat(64)}`;
  const binding = {
    id: "binding_output_a",
    direction: "output",
    role: "primary_ledger",
    ledgerDefinitionId: "ledger_customer",
    record: null,
    selection: { fieldKeys: ["name"], queryId: null, rowLimit: 1 },
    snapshot: null,
    resolution: { source: "template_default", confidence: 0.8, state: "needs_confirmation", reasons: ["等待确认"] },
  };
  const duplicate = service.createWorkItem({
    projectId: "prj_a",
    title: "重复绑定",
    recordBindings: [binding, { ...binding }],
  }, ACTOR_A);
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.error, "duplicate_work_item_record_binding");

  const secondPrimary = service.createWorkItem({
    projectId: "prj_a",
    title: "多个主台账",
    recordBindings: [binding, { ...binding, id: "binding_output_b" }],
  }, ACTOR_A);
  assert.equal(secondPrimary.status, 400);
  assert.equal(secondPrimary.body.error, "multiple_primary_work_item_ledgers");
});

test("desktop intent planning asks one ordinary clarification before ambiguous publishing", () => {
  const { service } = harness();
  const preview = service.previewIntentTaskPlan({
    projectId: "prj_a",
    title: "写文章和做图片，然后发布到公众号和小红书",
  }, ACTOR_A);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.summary.canCommit, false);
  assert.equal(preview.body.plan.clarification.kind, "publication_content_mapping");
  const committed = service.commitIntentTaskPlan({
    projectId: "prj_a",
    title: "写文章和做图片，然后发布到公众号和小红书",
    mode: "ai",
    idempotencyKey: "desktop-plan-publish-1",
  }, ACTOR_A);
  assert.equal(committed.status, 409);
  assert.equal(committed.body.error, "intent_clarification_required");
});

test("desktop intent planning asks for scope instead of silently creating a vague task", () => {
  const { service } = harness();
  const preview = service.previewIntentTaskPlan({
    projectId: "prj_a",
    title: "按这个优化一下",
  }, ACTOR_A);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.summary.canCommit, false);
  assert.equal(preview.body.plan.tasks.length, 0);
  assert.equal(preview.body.plan.clarification.kind, "task_scope");
  assert.match(preview.body.summary.nextStep, /优化或修改什么/);
});

test("desktop intent planning continues from a short clarification answer without rewriting the request", () => {
  const { service } = harness();
  const initial = service.previewIntentTaskPlan({
    projectId: "prj_a",
    title: "帮我处理一下这批合同",
  }, ACTOR_A);
  assert.equal(initial.body.plan.clarification.kind, "professional_action");

  const continued = service.previewIntentTaskPlan({
    projectId: "prj_a",
    title: "帮我处理一下这批合同",
    clarificationAnswer: "审查条款风险",
  }, ACTOR_A);
  assert.equal(continued.body.summary.canCommit, true);
  assert.deepEqual(continued.body.plan.tasks.map((task) => task.kind), ["legal_contract_review"]);

  const committed = service.commitIntentTaskPlan({
    projectId: "prj_a",
    title: "帮我处理一下这批合同",
    clarificationAnswer: "审查条款风险",
    mode: "task",
    idempotencyKey: "desktop-clarification-continuation-1",
  }, ACTOR_A);
  assert.equal(committed.status, 201);
  assert.equal(committed.body.workItems[0].taskKind, "legal_contract_review");
});

test("desktop intent planning can save media work but refuses AI until a real capability exists", () => {
  const { service, state } = harness();
  const input = {
    projectId: "prj_a",
    title: "做三张产品配图",
    body: "做三张产品配图",
  };
  const preview = service.previewIntentTaskPlan(input, ACTOR_A);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.summary.canCommit, true);
  assert.equal(preview.body.summary.canStartAi, false);
  assert.deepEqual(preview.body.summary.capabilityBlockers.map((blocker) => blocker.taskKind), ["content_image"]);

  const refused = service.commitIntentTaskPlan({
    ...input, mode: "ai", idempotencyKey: "desktop-image-ai-blocked",
  }, ACTOR_A);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "intent_task_capability_required");
  assert.equal(state.workItems.length, 0);

  const saved = service.commitIntentTaskPlan({
    ...input, mode: "task", idempotencyKey: "desktop-image-saved",
  }, ACTOR_A);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.workItems[0].taskKind, "content_image");
  assert.equal(saved.body.workItems[0].executionPolicy, "manual");
});

test("desktop continuation work asks before binding a completed task result and records the real handoff", () => {
  const { service } = harness();
  const sourceResult = service.createWorkItem({
    projectId: "prj_a",
    title: "登录问题分析",
    body: "已经确认登录回调处理错误。",
    type: "task",
    status: "done",
    priority: "p2",
    labels: [],
    assigneeIds: [],
    acceptanceCriteria: ["根因已经确认"],
    verificationSop: ["复核分析证据"],
    artifactContract: { consumes: [], produces: ["software_analysis"], requirements: [] },
    outputAssets: [{
      id: "asset_login_analysis",
      originalName: "登录问题分析.md",
      path: "results/login-analysis.md",
      terminalId: "dev_local",
      family: "markdown",
      capabilities: [],
    }],
  }, ACTOR_A);
  assert.equal(sourceResult.status, 201);
  const source = sourceResult.body.workItem;
  const request = {
    projectId: "prj_a",
    title: "根据已有分析修复登录问题并跑测试，部署先别做",
    body: "根据已有分析修复登录问题并跑测试，部署先别做",
  };

  const needsChoice = service.previewIntentTaskPlan(request, ACTOR_A);
  assert.equal(needsChoice.status, 200);
  assert.equal(needsChoice.body.summary.canCommit, false);
  assert.equal(needsChoice.body.plan.sourceSelection.required, true);
  assert.deepEqual(needsChoice.body.plan.sourceSelection.candidates.map((candidate) => candidate.workItemId), [source.id]);

  const selected = service.previewIntentTaskPlan({ ...request, sourceWorkItemId: source.id }, ACTOR_A);
  assert.equal(selected.status, 200);
  assert.equal(selected.body.summary.canCommit, true);
  assert.deepEqual(selected.body.plan.tasks.map((task) => task.kind), ["software_implementation", "software_verification"]);
  assert.equal(selected.body.plan.tasks[0].externalSource.workItemId, source.id);
  assert.deepEqual(selected.body.plan.tasks[0].artifactContract.consumes, ["software_analysis"]);
  assert.equal(selected.body.plan.tasks[1].externalSource, undefined);

  const missingChoice = service.commitIntentTaskPlan({
    ...request, mode: "task", idempotencyKey: "continue-login-without-source",
  }, ACTOR_A);
  assert.equal(missingChoice.status, 409);
  assert.equal(missingChoice.body.error, "intent_source_selection_required");

  const committed = service.commitIntentTaskPlan({
    ...request,
    sourceWorkItemId: source.id,
    mode: "task",
    idempotencyKey: "continue-login-with-source",
  }, ACTOR_A);
  assert.equal(committed.status, 201);
  const implementation = committed.body.workItems[0];
  assert.deepEqual(implementation.dependencyIds, [source.id]);
  assert.equal(implementation.inputAssets[0].id, "asset_login_analysis");
  assert.equal(implementation.artifactHandoffs[0].sourceWorkItemId, source.id);
  assert.equal(implementation.artifactHandoffs[0].status, "attached");
  assert.deepEqual(implementation.artifactHandoffs[0].kinds, ["software_analysis"]);
  assert.deepEqual(committed.body.workItems[1].dependencyIds, [implementation.id]);
});

test("desktop task basket exclusions re-plan without the removed task kind", () => {
  const { service } = harness();
  const preview = service.previewIntentTaskPlan({
    projectId: "prj_a",
    title: "写一篇深度文章、做漫画和口播",
    excludeKinds: ["content_comic"],
  }, ACTOR_A);
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.plan.tasks.map((task) => task.kind), ["content_article", "content_voiceover"]);
  assert.deepEqual(preview.body.plan.excludedKinds, ["content_comic"]);
});

test("desktop continuation never labels an invalid existing output as an attached artifact", () => {
  const { service } = harness();
  const source = service.createWorkItem({
    projectId: "prj_a",
    title: "登录问题分析",
    body: "分析记录",
    type: "task",
    status: "done",
    priority: "p2",
    acceptanceCriteria: ["给出根因"],
    verificationSop: ["复核格式"],
    artifactContract: {
      consumes: [],
      produces: ["software_analysis"],
      requirements: [{ kind: "software_analysis", minCount: 1, extensions: [".md"] }],
    },
    outputAssets: [{
      id: "asset_invalid_analysis",
      originalName: "analysis.png",
      path: "results/analysis.png",
      terminalId: "dev_local",
      family: "image",
      capabilities: [],
    }],
  }, ACTOR_A).body.workItem;
  const committed = service.commitIntentTaskPlan({
    projectId: "prj_a",
    title: "根据已有分析修复登录问题",
    sourceWorkItemId: source.id,
    mode: "task",
    idempotencyKey: "continue-with-invalid-analysis",
  }, ACTOR_A);
  assert.equal(committed.status, 409);
  assert.equal(committed.body.error, "intent_source_artifacts_invalid");
  assert.match(committed.body.validationErrors[0], /software_analysis/);
});

test("existing-result selection uses the same explicit handoff contract for content and business work", () => {
  const { service } = harness();
  const createSource = ({ title, produces, assetId, path }) => service.createWorkItem({
    projectId: "prj_a",
    title,
    body: `${title}已经完成。`,
    type: "task",
    status: "done",
    priority: "p2",
    labels: [],
    assigneeIds: [],
    acceptanceCriteria: ["结果可供后续任务使用"],
    verificationSop: ["复核结果文件"],
    artifactContract: { consumes: [], produces: [produces], requirements: [] },
    outputAssets: [{ id: assetId, originalName: path.split("/").at(-1), path, terminalId: "dev_local", family: "markdown", capabilities: [] }],
  }, ACTOR_A).body.workItem;
  const analysis = createSource({ title: "产品分析", produces: "analysis_report", assetId: "asset_product_analysis", path: "results/product-analysis.md" });
  const research = createSource({ title: "客户调研", produces: "business_research", assetId: "asset_customer_research", path: "results/customer-research.md" });

  const content = service.previewIntentTaskPlan({
    projectId: "prj_a",
    title: "基于已有分析写一篇深度文章并做3张配图",
    sourceWorkItemId: analysis.id,
  }, ACTOR_A);
  assert.equal(content.status, 200);
  assert.deepEqual(content.body.plan.tasks.map((task) => task.kind), ["content_article", "content_image"]);
  assert.equal(content.body.plan.tasks[0].externalSource.workItemId, analysis.id);
  assert.deepEqual(content.body.plan.tasks[1].requires, ["content_article"]);

  const business = service.previewIntentTaskPlan({
    projectId: "prj_a",
    title: "根据已有结果准备客户方案并邮件发给王总",
    sourceWorkItemId: research.id,
  }, ACTOR_A);
  assert.equal(business.status, 200);
  assert.deepEqual(business.body.plan.tasks.map((task) => task.kind), ["business_document", "business_communication"]);
  assert.equal(business.body.plan.tasks[0].externalSource.workItemId, research.id);
  assert.deepEqual(business.body.plan.tasks[1].requires, ["business_document"]);

  const foreign = service.previewIntentTaskPlan({
    projectId: "prj_b",
    title: "根据已有结果准备客户方案",
    sourceWorkItemId: research.id,
  }, ACTOR_B);
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.error, "intent_source_work_item_invalid");
});

test("desktop result repair creates one independent task and preserves the failed result", () => {
  const { service, state } = harness();
  const planned = service.commitIntentTaskPlan({
    projectId: "prj_a",
    title: "准备客户方案",
    mode: "task",
    idempotencyKey: "business-document-for-repair",
  }, ACTOR_A);
  assert.equal(planned.status, 201);
  const source = state.workItems.find((item) => item.id === planned.body.workItems[0].id);
  source.status = "blocked";
  source.outputAssets = [{
    id: "asset_wrong_format",
    originalName: "customer-notes.png",
    path: "results/customer-notes.png",
    terminalId: "dev_local",
    family: "document",
    size: 20,
    capabilities: [],
  }];

  const repaired = service.createResultRepairTask({ workItemId: source.id }, ACTOR_A);
  assert.equal(repaired.status, 201, JSON.stringify(repaired.body));
  assert.equal(repaired.body.replayed, false);
  assert.equal(repaired.body.workItem.repairOfWorkItemId, source.id);
  assert.equal(repaired.body.workItem.status, "backlog");
  assert.equal(repaired.body.workItem.executionPolicy, "manual");
  assert.deepEqual(repaired.body.workItem.dependencyIds, []);
  assert.equal(repaired.body.workItem.inputAssets[0].id, "asset_wrong_format");
  assert.equal(repaired.body.workItem.artifactHandoffs[0].sourceWorkItemId, source.id);
  assert.equal(repaired.body.workItem.artifactHandoffs[0].status, "attached");
  assert.deepEqual(repaired.body.workItem.artifactHandoffs[0].kinds, ["failed_output_evidence"]);
  assert.equal(repaired.body.workItem.artifactHandoffs[0].evidenceOnly, true);
  assert.deepEqual(repaired.body.workItem.artifactContract.consumes, ["failed_output_evidence"]);
  assert.ok(!repaired.body.workItem.artifactHandoffs[0].kinds.includes("business_document"));
  assert.match(repaired.body.workItem.body, /独立返工任务/);
  assert.equal(source.status, "blocked");
  assert.equal(source.outputAssets[0].id, "asset_wrong_format");
  assert.ok(state.workGoals[0].taskIds.includes(repaired.body.workItem.id));

  const replay = service.createResultRepairTask({ workItemId: source.id }, ACTOR_A);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.workItem.id, repaired.body.workItem.id);
  assert.equal(state.workItems.filter((item) => item.repairOfWorkItemId === source.id).length, 1);

  const foreign = service.createResultRepairTask({ workItemId: source.id }, ACTOR_B);
  assert.equal(foreign.status, 404);
});

test("result repair reuses original materials without inventing a missing artifact dependency", () => {
  const { service, state } = harness();
  const source = service.createWorkItem({
    projectId: "prj_a",
    title: "深度文章",
    body: "根据访谈资料撰写文章。",
    status: "blocked",
    taskKind: "content_article",
    acceptanceCriteria: ["生成文章文件"],
    artifactContract: {
      consumes: ["source_material"],
      produces: ["article_draft"],
      requirements: [{ kind: "article_draft", minCount: 1, extensions: [".md"] }],
    },
    inputAssets: [{
      id: "asset_interview",
      originalName: "interview.md",
      path: "materials/interview.md",
      terminalId: "dev_local",
      family: "markdown",
      capabilities: [],
    }],
  }, ACTOR_A).body.workItem;

  const repaired = service.createResultRepairTask({ workItemId: source.id }, ACTOR_A);
  assert.equal(repaired.status, 201);
  assert.deepEqual(repaired.body.workItem.dependencyIds, []);
  assert.equal(repaired.body.workItem.artifactHandoffs?.length ?? 0, 0);
  assert.equal(repaired.body.workItem.inputAssets[0].id, "asset_interview");
  assert.equal(state.workItems.find((item) => item.id === source.id).status, "blocked");

  const active = service.createWorkItem({
    projectId: "prj_a",
    title: "尚未执行的文章",
    status: "ready",
    taskKind: "content_article",
    artifactContract: {
      consumes: [], produces: ["article_draft"],
      requirements: [{ kind: "article_draft", minCount: 1, extensions: [".md"] }],
    },
  }, ACTOR_A).body.workItem;
  const refused = service.createResultRepairTask({ workItemId: active.id }, ACTOR_A);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "work_item_result_repair_not_ready");
});

test("projects work-item status and verification changes immediately", () => {
  const changes = [];
  const { service } = harness({
    onWorkItemChanged: (item, actor, reason) => changes.push({
      id: item.id,
      status: item.status,
      verificationCount: item.verificationRecords?.length ?? 0,
      actorId: actor.userId,
      reason,
    }),
  });
  const created = service.createWorkItem({ projectId: "prj_a", title: "Realtime outcome" }, ACTOR_A).body.workItem;
  const updated = service.updateWorkItem({
    workItemId: created.id,
    expectedRevision: created.revision,
    status: "ready",
  }, ACTOR_A);
  assert.equal(updated.status, 200);
  const verified = service.recordVerification({
    workItemId: created.id,
    expectedRevision: updated.body.workItem.revision,
    kind: "manual",
    status: "passed",
    summary: "Reviewed output",
    acceptanceResults: [],
    evidence: [],
  }, ACTOR_A);
  assert.equal(verified.status, 201);
  const bulk = service.bulkUpdateWorkItems({
    items: [{ id: created.id, expectedRevision: verified.body.workItem.revision }],
    changes: { status: "blocked" },
  }, ACTOR_A);
  assert.equal(bulk.status, 200);
  assert.deepEqual(changes, [{
    id: created.id,
    status: "backlog",
    verificationCount: 0,
    actorId: "usr_a",
    reason: "created",
  }, {
    id: created.id,
    status: "ready",
    verificationCount: 0,
    actorId: "usr_a",
    reason: "updated",
  }, {
    id: created.id,
    status: "ready",
    verificationCount: 1,
    actorId: "usr_a",
    reason: "verification_recorded",
  }, {
    id: created.id,
    status: "blocked",
    verificationCount: 1,
    actorId: "usr_a",
    reason: "bulk_updated",
  }]);
});

test("creates a local work item with server-owned identity and defaults", () => {
  const { service, events, state } = harness();
  const result = service.createWorkItem({
    projectId: "prj_a",
    title: "Local planning",
    ownerTeamId: "team_b",
  }, ACTOR_A);
  assert.equal(result.status, 201);
  assert.equal(result.body.workItem.localRef, "LOCAL-1");
  assert.equal(result.body.workItem.ownerTeamId, "team_a");
  assert.equal(result.body.workItem.createdBy, "usr_a");
  assert.equal(result.body.workItem.status, "backlog");
  assert.equal(result.body.workItem.terminalId, "dev_local");
  assert.equal(result.body.workItem.revision, 1);
  assert.equal(events[0].type, "work_item_created");
  assert.deepEqual(state.workItemActivities[0].details, {
    title: "Local planning",
    type: "task",
    status: "backlog",
    priority: "p2",
    followUpContext: {
      followUpSchemaVersion: 1,
      requesterRelation: "unknown",
      requesterName: null,
      requesterOrganization: null,
      requesterUserId: null,
      intakeChannel: "unknown",
      externalReference: null,
      waitingOn: "none",
      commitmentDate: null,
      nextFollowUpAt: null,
      lastProgressAt: null,
      lastProgressSummary: null,
    },
    principalId: "usr_a",
    deviceId: "dev_local",
    effectiveAuthority: "operator",
    terminalId: "dev_local",
    entryContext: "task",
    traceParent: result.body.workItem.id,
  });
});

test("adds, removes, and restores task materials with revision and completed-task guards", () => {
  const claims = [];
  const materialAsset = {
    id: "asset_1", originalName: "brief.txt", path: ".myagenttool/inputs/work/asset_1--brief.txt",
    family: "text", mimeType: "text/plain", terminalId: "dev_local", size: 5,
    resourceClass: "small", hash: "hash", version: null, worktreeId: null, capabilities: [],
    readiness: { state: "ready", reason: "task_material_claimed" },
  };
  const { service } = harness({
    claimTaskMaterialDraft: (input) => {
      claims.push(input);
      return { ok: true, assets: [{ ...materialAsset, path: `.myagenttool/inputs/${input.workItemId}/asset_1--brief.txt`, terminalId: input.terminalId }] };
    },
    resolveClaimedTaskMaterial: () => ({ ok: true, asset: materialAsset }),
  });
  const created = service.createWorkItem({ projectId: "prj_a", title: "Material task" }, ACTOR_A).body.workItem;
  const added = service.addMaterials({
    workItemId: created.id,
    expectedRevision: created.revision,
    materialDraftId: "draft_1",
    materialDraftRevision: 1,
  }, ACTOR_A);
  assert.equal(added.status, 200);
  assert.equal(added.body.workItem.inputAssets[0].originalName, "brief.txt");
  assert.equal(added.body.appliesTo, "next_execution");
  assert.equal(added.body.workItem.materialChangesPending, true);
  assert.equal(claims[0].deferPersist, true);

  const bound = service.recordExecutionBinding({ workItemId: created.id, kind: "auto_run", targetId: "run_materials" }, ACTOR_A);
  assert.equal(bound.body.workItem.materialChangesPending, false);

  const removed = service.removeMaterial({ workItemId: created.id, assetId: "asset_1", expectedRevision: bound.body.workItem.revision }, ACTOR_A);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.workItem.inputAssets.length, 0);
  assert.equal(removed.body.workItem.materialChangesPending, true);

  const restored = service.restoreMaterial({ workItemId: created.id, assetId: "asset_1", expectedRevision: removed.body.workItem.revision }, ACTOR_A);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.workItem.inputAssets[0].originalName, "brief.txt");
  assert.equal(restored.body.workItem.materialChangesPending, true);

  const closed = service.transitionWorkItem({ workItemId: created.id, action: "close", expectedRevision: restored.body.workItem.revision }, ACTOR_A);
  assert.equal(closed.status, 200);
  const rejected = service.addMaterials({
    workItemId: created.id,
    expectedRevision: closed.body.workItem.revision,
    materialDraftId: "draft_2",
    materialDraftRevision: 1,
  }, ACTOR_A);
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error, "work_item_reopen_required_for_materials");
});

test("creates, normalizes, updates, and audits structured follow-up context", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "Customer delivery",
    requesterRelation: "customer",
    requesterName: " 张总 ",
    requesterOrganization: " 远山科技 ",
    intakeChannel: "meeting",
    externalReference: " 客户周会 2026-07-24 ",
    waitingOn: "me",
    commitmentDate: "2026-07-25T17:00:00+08:00",
    nextFollowUpAt: "2026-07-25T10:00:00+08:00",
  }, ACTOR_A);
  assert.equal(created.status, 201);
  assert.deepEqual({
    requesterRelation: created.body.workItem.requesterRelation,
    requesterName: created.body.workItem.requesterName,
    requesterOrganization: created.body.workItem.requesterOrganization,
    requesterUserId: created.body.workItem.requesterUserId,
    intakeChannel: created.body.workItem.intakeChannel,
    externalReference: created.body.workItem.externalReference,
    waitingOn: created.body.workItem.waitingOn,
    commitmentDate: created.body.workItem.commitmentDate,
    nextFollowUpAt: created.body.workItem.nextFollowUpAt,
  }, {
    requesterRelation: "customer",
    requesterName: "张总",
    requesterOrganization: "远山科技",
    requesterUserId: null,
    intakeChannel: "meeting",
    externalReference: "客户周会 2026-07-24",
    waitingOn: "me",
    commitmentDate: "2026-07-25T09:00:00.000Z",
    nextFollowUpAt: "2026-07-25T02:00:00.000Z",
  });
  assert.equal(state.workItemActivities[0].details.followUpContext.requesterRelation, "customer");

  const updated = service.updateWorkItem({
    workItemId: created.body.workItem.id,
    expectedRevision: created.body.workItem.revision,
    requesterRelation: "colleague",
    requesterUserId: "usr_c",
    requesterName: null,
    requesterOrganization: null,
    intakeChannel: "chat",
    waitingOn: "internal",
    nextFollowUpAt: "2026-07-26T09:30:00Z",
  }, ACTOR_A);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.workItem.requesterRelation, "colleague");
  assert.equal(updated.body.workItem.requesterUserId, "usr_c");
  assert.equal(updated.body.workItem.waitingOn, "internal");
  const audit = state.workItemActivities[0];
  assert.equal(audit.action, "updated");
  assert.equal(audit.details.followUpContextChanged, true);
  assert.deepEqual(audit.details.changes.requesterRelation, { from: "customer", to: "colleague" });
  assert.deepEqual(audit.details.changes.requesterUserId, { from: null, to: "usr_c" });
});

test("enforces requester identity, tenancy, waiting-on, and follow-up time rules", () => {
  const { service } = harness();
  const create = (overrides) => service.createWorkItem({
    projectId: "prj_a",
    title: "Validate follow-up",
    ...overrides,
  }, ACTOR_A);

  assert.equal(create({ requesterRelation: "vendor" }).body.error, "invalid_work_item_requester_relation");
  assert.equal(create({ requesterRelation: "customer" }).body.error, "work_item_customer_requester_name_required");
  assert.equal(create({
    requesterRelation: "customer", requesterName: "Client", requesterUserId: "usr_c",
  }).body.error, "work_item_customer_internal_requester_forbidden");
  assert.equal(create({
    requesterRelation: "child", requesterUserId: "usr_c",
  }).body.error, "work_item_child_internal_requester_forbidden");
  assert.equal(create({
    requesterRelation: "manager", requesterUserId: "usr_b",
  }).body.error, "invalid_work_item_requester_user");
  assert.equal(create({
    requesterRelation: "unknown", requesterName: "Guessed requester",
  }).body.error, "work_item_unknown_requester_identity_forbidden");
  assert.equal(create({
    requesterRelation: "self", requesterUserId: "usr_c",
  }).body.error, "work_item_self_requester_mismatch");
  assert.equal(create({
    requesterRelation: "self", waitingOn: "requester",
  }).body.error, "work_item_waiting_on_requester_requires_requester");
  assert.equal(create({
    nextFollowUpAt: "2026-07-23T23:59:59Z",
  }).body.error, "work_item_next_follow_up_at_in_past");
  assert.equal(create({
    commitmentDate: "2026-02-30T10:00:00Z",
  }).body.error, "invalid_work_item_commitment_date");
  assert.equal(create({
    lastProgressSummary: "Caller supplied history",
  }).body.error, "work_item_follow_up_server_fields_immutable");

  const own = create({ requesterRelation: "self", intakeChannel: "manual", waitingOn: "me" });
  assert.equal(own.status, 201);
  assert.equal(own.body.workItem.requesterUserId, "usr_a");
  assert.equal(own.body.workItem.requesterName, null);
  const manager = create({ requesterRelation: "manager", requesterUserId: "usr_c", waitingOn: "requester" });
  assert.equal(manager.status, 201);
  const child = create({ requesterRelation: "child" });
  assert.equal(child.status, 201);
  assert.equal(child.body.workItem.requesterRelation, "child");
  assert.equal(child.body.workItem.requesterUserId, null);
});

test("records append-only progress with follow-up changes, audit attribution, and idempotent replay", () => {
  const changes = [];
  const { service, state, events } = harness({
    onWorkItemChanged: (item, actor, reason) => changes.push({
      id: item.id, actorId: actor.userId, reason,
    }),
  });
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "Customer checkpoint",
    requesterRelation: "customer",
    requesterName: "Client",
    waitingOn: "me",
  }, ACTOR_A).body.workItem;

  const recorded = service.recordWorkItemProgress({
    workItemId: created.id,
    expectedRevision: created.revision,
    idempotencyKey: "progress-1",
    summary: "  Demo complete; waiting for customer sign-off.  ",
    waitingOn: "requester",
    nextFollowUpAt: "2026-07-25T10:00:00+08:00",
  }, ACTOR_A);

  assert.equal(recorded.status, 201);
  assert.equal(recorded.body.replayed, false);
  assert.equal(recorded.body.workItem.revision, 2);
  assert.equal(recorded.body.workItem.lastProgressAt, "2026-07-24T00:00:00.000Z");
  assert.equal(recorded.body.workItem.lastProgressSummary, "Demo complete; waiting for customer sign-off.");
  assert.equal(recorded.body.workItem.waitingOn, "requester");
  assert.equal(recorded.body.workItem.nextFollowUpAt, "2026-07-25T02:00:00.000Z");
  assert.equal(state.workItemActivities[0].action, "progress_recorded");
  assert.equal(state.workItemActivities[0].details.principalId, "usr_a");
  assert.deepEqual(state.workItemActivities[0].details.changes.waitingOn, { from: "me", to: "requester" });
  assert.equal(events.at(-1).type, "work_item_progress_recorded");
  assert.deepEqual(changes, [
    { id: created.id, actorId: "usr_a", reason: "created" },
    { id: created.id, actorId: "usr_a", reason: "progress_recorded" },
  ]);

  const replayed = service.recordWorkItemProgress({
    workItemId: created.id,
    expectedRevision: created.revision,
    idempotencyKey: "progress-1",
    summary: "Demo complete; waiting for customer sign-off.",
    waitingOn: "requester",
    nextFollowUpAt: "2026-07-25T02:00:00.000Z",
  }, ACTOR_A);
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(state.workItemActivities.filter((activity) => activity.action === "progress_recorded").length, 1);
  assert.equal(events.filter((event) => event.type === "work_item_progress_recorded").length, 1);

  const conflictingReplay = service.recordWorkItemProgress({
    workItemId: created.id,
    expectedRevision: 2,
    idempotencyKey: "progress-1",
    summary: "Different progress",
  }, ACTOR_A);
  assert.equal(conflictingReplay.status, 409);
  assert.equal(conflictingReplay.body.error, "work_item_progress_idempotency_conflict");
  assert.equal(service.recordWorkItemProgress({
    workItemId: created.id,
    expectedRevision: 2,
    idempotencyKey: "progress-2",
    summary: "Foreign update",
  }, ACTOR_B).status, 404);
});

test("validates progress input and optimistic concurrency", () => {
  const { service } = harness();
  const created = service.createWorkItem({ projectId: "prj_a", title: "Progress validation" }, ACTOR_A).body.workItem;
  const record = (overrides = {}) => service.recordWorkItemProgress({
    workItemId: created.id,
    expectedRevision: created.revision,
    idempotencyKey: "progress-validation",
    summary: "Checkpoint",
    ...overrides,
  }, ACTOR_A);
  assert.equal(record({ summary: " " }).body.error, "invalid_work_item_progress_summary");
  assert.equal(record({ idempotencyKey: "" }).body.error, "work_item_progress_idempotency_key_required");
  assert.equal(record({ expectedRevision: 99 }).body.error, "work_item_revision_conflict");
  assert.equal(record({ nextFollowUpAt: "2026-07-23T23:59:59Z" }).body.error, "work_item_next_follow_up_at_in_past");
  assert.equal(record({ waitingOn: "requester" }).body.error, "work_item_waiting_on_requester_requires_requester");
});

test("materializes one revision-deduplicated due reminder and resolves it after progress", () => {
  let timestamp = "2026-07-24T00:00:00.000Z";
  const { service, state, events } = harness({ clock: () => timestamp });
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "Send customer checkpoint",
    requesterRelation: "customer",
    requesterName: "Alex",
    nextFollowUpAt: "2026-07-24T01:00:00.000Z",
  }, ACTOR_A).body.workItem;
  assert.equal("followUpScheduleRevision" in created, false, "internal reminder generation is not public");

  assert.deepEqual(service.sweepFollowUpReminders(), { created: 0, resolved: 0 });
  timestamp = "2026-07-24T01:00:00.000Z";
  assert.deepEqual(service.sweepFollowUpReminders(), { created: 1, resolved: 0 });
  assert.equal(service.listFollowUpReminders(ACTOR_A, { status: "due" }).length, 1);
  assert.equal(service.listFollowUpReminders(ACTOR_B, { status: "due" }).length, 0, "foreign team cannot list the reminder");
  const reminder = state.workItemFollowUpReminders[0];
  assert.equal(reminder.sourceRevision, 1);
  assert.equal(reminder.scheduleRevision, 1);

  const updated = service.updateWorkItem({
    workItemId: created.id,
    expectedRevision: created.revision,
    title: "Send concise customer checkpoint",
  }, ACTOR_A).body.workItem;
  assert.deepEqual(service.sweepFollowUpReminders(), { created: 0, resolved: 0 });
  assert.equal(state.workItemFollowUpReminders.length, 1, "an unrelated Issue revision does not duplicate the reminder");

  const progressed = service.recordWorkItemProgress({
    workItemId: created.id,
    expectedRevision: updated.revision,
    idempotencyKey: "resolve-due-reminder",
    summary: "Customer checkpoint prepared.",
  }, ACTOR_A);
  assert.equal(progressed.status, 201);
  assert.equal(reminder.status, "resolved");
  assert.equal(reminder.resolution, "progress_recorded");
  assert.deepEqual(service.sweepFollowUpReminders(), { created: 0, resolved: 0 });
  assert.equal(state.workItemActivities.filter((row) => row.action === "follow_up_reminder_due").length, 1);
  assert.equal(state.workItemActivities.filter((row) => row.action === "follow_up_reminder_resolved").length, 1);
  assert.equal(events.filter((event) => event.type === "work_item_follow_up_reminder_due").length, 1);
});

test("rescheduling creates a new reminder generation and completion resolves it", () => {
  let timestamp = "2026-07-24T00:00:00.000Z";
  const { service, state } = harness({ clock: () => timestamp });
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "Manager follow-up",
    requesterRelation: "manager",
    requesterName: "Morgan",
    nextFollowUpAt: "2026-07-24T01:00:00.000Z",
  }, ACTOR_A).body.workItem;
  timestamp = "2026-07-24T01:00:00.000Z";
  service.sweepFollowUpReminders();

  const rescheduled = service.updateWorkItem({
    workItemId: created.id,
    expectedRevision: created.revision,
    nextFollowUpAt: "2026-07-24T02:00:00.000Z",
  }, ACTOR_A).body.workItem;
  assert.equal(state.workItemFollowUpReminders[0].status, "resolved");
  assert.equal(state.workItemFollowUpReminders[0].resolution, "rescheduled");

  timestamp = "2026-07-24T02:00:00.000Z";
  assert.deepEqual(service.sweepFollowUpReminders(), { created: 1, resolved: 0 });
  const due = service.listFollowUpReminders(ACTOR_A, { status: "due" })[0];
  assert.equal(due.scheduleRevision, 2);
  assert.notEqual(due.dedupeKey, state.workItemFollowUpReminders[1].dedupeKey);

  const completed = service.updateWorkItem({
    workItemId: created.id,
    expectedRevision: rescheduled.revision,
    status: "done",
  }, ACTOR_A);
  assert.equal(completed.status, 200);
  assert.equal(due.status, "resolved");
  assert.equal(due.resolution, "completed");
});

test("backfills legacy work-item follow-up context without inventing requester identity", () => {
  const state = {
    workItems: [
      { id: "legacy" },
      { id: "partial", requesterRelation: "customer", requesterName: "Existing client" },
    ],
  };
  assert.equal(backfillWorkItemFollowUpContext(state), 2);
  assert.deepEqual({
    requesterRelation: state.workItems[0].requesterRelation,
    requesterName: state.workItems[0].requesterName,
    intakeChannel: state.workItems[0].intakeChannel,
    waitingOn: state.workItems[0].waitingOn,
    commitmentDate: state.workItems[0].commitmentDate,
    nextFollowUpAt: state.workItems[0].nextFollowUpAt,
    lastProgressAt: state.workItems[0].lastProgressAt,
    lastProgressSummary: state.workItems[0].lastProgressSummary,
  }, {
    requesterRelation: "unknown",
    requesterName: null,
    intakeChannel: "unknown",
    waitingOn: "none",
    commitmentDate: null,
    nextFollowUpAt: null,
    lastProgressAt: null,
    lastProgressSummary: null,
  });
  assert.equal(state.workItems[1].requesterRelation, "customer");
  assert.equal(state.workItems[1].requesterName, "Existing client");
  assert.equal(backfillWorkItemFollowUpContext(state), 0);
});

test("local delivery closes only after base integration; pull-request delivery stays in review", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({ projectId: "prj_a", title: "Deliver by PR" }, ACTOR_A).body.workItem;
  state.autoRuns = [{
    id: "aur_local", status: "done", link: { type: "local_issue", number: created.localNumber },
    localDelivery: { worktreeId: "wtr_1", branchName: "local-1" },
  }];
  service.recordExecutionBinding({
    workItemId: created.id, kind: "auto_run", targetId: "aur_local", worktreeId: "wtr_1",
  }, ACTOR_A);
  const item = state.workItems[0];
  item.status = "review";

  const promoted = service.completeDelivery({
    workItemId: item.id,
    expectedRevision: item.revision,
    mode: "pull_request",
    autoRunId: "aur_local",
    result: { number: 14, url: "https://github.test/o/r/pull/14" },
  }, ACTOR_A);
  assert.equal(promoted.status, 200);
  assert.equal(item.status, "review");
  assert.equal(item.state, "open");
  assert.equal(state.autoRuns[0].status, "pr_open");

  const localCreated = service.createWorkItem({ projectId: "prj_a", title: "Deliver locally" }, ACTOR_A).body.workItem;
  state.autoRuns.unshift({
    id: "aur_local_merge", status: "done", link: { type: "local_issue", number: localCreated.localNumber },
    localDelivery: { worktreeId: "wtr_2", branchName: "local-2" },
  });
  service.recordExecutionBinding({
    workItemId: localCreated.id, kind: "auto_run", targetId: "aur_local_merge", worktreeId: "wtr_2",
  }, ACTOR_A);
  const localItem = state.workItems.find((candidate) => candidate.id === localCreated.id);
  localItem.status = "review";
  const delivered = service.completeDelivery({
    workItemId: localItem.id,
    expectedRevision: localItem.revision,
    mode: "local_merge",
    autoRunId: "aur_local_merge",
    result: { baseBranch: "main", commit: "abc123" },
  }, ACTOR_A);
  assert.equal(delivered.status, 200);
  assert.equal(localItem.status, "done");
  assert.equal(localItem.state, "closed");
  assert.equal(state.autoRuns[0].localDelivery.deliveredCommit, "abc123");
});

test("links asset requirements to the owning terminal and exposes waiting capability", () => {
  const { service } = harness();
  const waiting = service.createWorkItem({
    projectId: "prj_a",
    title: "Update workbook",
    inputAssets: [{
      id: "asset-1", path: "reports/input.xlsx", family: "excel",
      terminalId: "dev_local", capabilities: ["preview"],
      readiness: { state: "ready", reason: "available_on_owning_terminal" },
    }],
    requiredCapabilities: ["edit"],
  }, ACTOR_A);
  assert.equal(waiting.status, 201);
  assert.deepEqual(waiting.body.workItem.assetReadiness, {
    state: "waiting_capability",
    reason: "missing_local_capability:edit",
    terminalId: "dev_local",
  });
  assert.equal(waiting.body.workItem.inputAssets[0].path, "reports/input.xlsx");

  const foreign = service.createWorkItem({
    projectId: "prj_a",
    title: "Foreign asset",
    inputAssets: [{
      path: "reports/input.xlsx", terminalId: "dev_other",
      capabilities: ["preview"], readiness: { state: "ready" },
    }],
    requiredCapabilities: ["preview"],
  }, ACTOR_A);
  assert.equal(foreign.status, 409);
  assert.equal(foreign.body.error, "asset_terminal_mismatch");
  assert.equal(foreign.body.terminalId, "dev_local");

  const large = service.createWorkItem({
    projectId: "prj_a",
    title: "Compare large local images",
    inputAssets: [{
      id: "asset-large", path: "media/source.png", family: "image",
      terminalId: "dev_local", size: 120 * 1024 * 1024, resourceClass: "large",
      capabilities: ["compare"], readiness: { state: "ready" },
    }],
    requiredCapabilities: ["compare"],
  }, ACTOR_A);
  assert.equal(large.status, 201);
  assert.equal(large.body.workItem.assetReadiness.state, "waiting_capability");
  assert.equal(large.body.workItem.assetReadiness.reason, "local_resource_class_required:large");
  assert.equal(large.body.workItem.assetReadiness.terminalId, "dev_local");
});

test("backfills legacy work items and rejects terminal ownership changes", () => {
  const state = {
    devices: [{ id: "dev_local" }],
    agents: [{ id: "agt", location: { type: "local_device", deviceId: "dev_agent" } }],
    invocations: [{ id: "inv", agentId: "agt", delivery: { deviceId: "dev_agent" } }],
    autoRuns: [{ id: "run", invocationId: "inv" }],
    approvalRequests: [{ id: "approval", invocationId: "inv" }],
    auditSummaries: [{ invocationId: "inv", deviceId: "dev_agent" }],
    workItems: [
      { id: "legacy", executionBindings: [{ kind: "auto_run", targetId: "run" }] },
      { id: "owned", terminalId: "dev_existing" },
    ],
  };
  assert.equal(backfillWorkItemTerminalOwnership(state), 6);
  assert.equal(state.workItems[0].terminalId, "dev_local");
  assert.equal(state.workItems[0].executionBindings[0].terminalId, "dev_local");
  assert.equal(state.workItems[1].terminalId, "dev_existing");
  assert.equal(state.invocations[0].terminalId, "dev_agent");
  assert.equal(state.autoRuns[0].terminalId, "dev_agent");
  assert.equal(state.approvalRequests[0].terminalId, "dev_agent");
  assert.equal(state.auditSummaries[0].terminalId, "dev_agent");
  assert.equal(backfillWorkItemTerminalOwnership(state), 0);

  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Pinned task" }, ACTOR_A).body.workItem;
  const result = service.updateWorkItem({
    workItemId: item.id,
    expectedRevision: item.revision,
    terminalId: "dev_other",
  }, ACTOR_A);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "work_item_terminal_immutable");
  assert.equal(result.body.terminalId, "dev_local");
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.revision, 1);
});

test("normalizes task trace events into the user execution chain", () => {
  assert.equal(taskTraceStage("created"), "creation");
  assert.equal(taskTraceStage("auto_run_started"), "routing");
  assert.equal(taskTraceStage("delivery_queued", "execution"), "queue");
  assert.equal(taskTraceStage("local_approval_requested", "execution"), "approval");
  assert.equal(taskTraceStage("tool_invocation_created", "execution"), "tool");
  assert.equal(taskTraceStage("verification_recorded"), "verification");
  assert.equal(taskTraceStage("auto_run_retry"), "retry");
  assert.equal(taskTraceStage("invocation_completed", "execution"), "completion");
});

test("exposes independent business, planning, and fact-derived execution states", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a", title: "Three state model", status: "ready",
  }, ACTOR_A).body.workItem;
  assert.deepEqual(created.statusModel, {
    business: "open", planning: "ready", execution: "unclaimed",
  });
  assert.equal(created.businessState, created.state);
  assert.equal(created.planningStatus, created.status);

  service.claimWorkItem({ workItemId: created.id, agentId: "agt_a" }, ACTOR_A);
  assert.equal(service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem.executionState, "claimed");

  state.workItems[0].executionBindings = [{
    kind: "auto_run", targetId: "ar_1", worktreeId: null, createdAt: "2026-07-24T00:00:00.000Z",
  }];
  state.autoRuns = [{ id: "ar_1", status: "running" }];
  for (const [runStatus, expected] of [
    ["running", "running"],
    ["awaiting_approval", "awaiting_approval"],
    ["verifying", "verifying"],
    ["failed", "failed"],
    ["done", "completed"],
  ]) {
    state.autoRuns[0].status = runStatus;
    assert.equal(
      service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem.executionState,
      expected,
    );
  }
});

test("Entry execution state follows the bound Application invocation lifecycle", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Render evidence" }, ACTOR_A).body.workItem;
  state.workItems[0].executionBindings.push({
    kind: "application_invocation", id: "inv-app", terminalId: "dev_local",
    applicationId: "app-image", capabilityId: "render", traceId: item.id,
    createdAt: "2026-07-24T00:00:00.000Z",
  });
  state.invocations = [{ id: "inv-app", status: "running" }];
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.executionState, "running");
  state.invocations[0].status = "waiting_for_local_approval";
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.executionState, "awaiting_approval");
  state.invocations[0].status = "succeeded";
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.executionState, "completed");
  state.invocations = [];
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.executionState, "failed");
});

test("Entry execution state follows the newest binding across Application and Auto-run kinds", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Use one execution source" }, ACTOR_A).body.workItem;
  state.workItems[0].executionBindings = [
    { kind: "application_invocation", id: "inv-old", createdAt: "2026-07-23T00:00:00.000Z" },
    { kind: "auto_run", targetId: "ar-new", createdAt: "2026-07-24T00:00:00.000Z" },
  ];
  state.invocations = [{ id: "inv-old", status: "failed" }];
  state.autoRuns = [{ id: "ar-new", status: "running" }];
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.executionState, "running");

  state.workItems[0].executionBindings.push({
    kind: "application_invocation", id: "inv-newest", createdAt: "2026-07-25T00:00:00.000Z",
  });
  state.invocations.push({ id: "inv-newest", status: "succeeded" });
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.executionState, "completed");
});

test("GitHub sync pulls one-sided changes and exposes two-sided conflicts", () => {
  const { service } = harness();
  let item = service.createWorkItem({ projectId: "prj_a", title: "Initial" }, ACTOR_A).body.workItem;
  const remote = {
    number: 42, title: "Initial", body: "", state: "open", labels: [],
    url: "https://github.com/acme/repo/issues/42", repository: "acme/repo",
    updatedAt: "2026-07-23T20:00:00.000Z",
  };
  assert.equal(service.bindGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, remote,
  }, ACTOR_A).status, 201);
  const pulled = service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "pull",
    remote: { ...remote, title: "Remote title", updatedAt: "2026-07-24T01:00:00.000Z" },
  }, ACTOR_A);
  assert.equal(pulled.body.action, "pulled");
  assert.equal(pulled.body.workItem.title, "Remote title");

  item = service.updateWorkItem({
    workItemId: item.id, expectedRevision: pulled.body.workItem.revision, title: "Local title",
  }, ACTOR_A).body.workItem;
  const conflict = service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "pull",
    remote: { ...remote, title: "Other remote title", updatedAt: "2026-07-24T02:00:00.000Z" },
  }, ACTOR_A);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "github_sync_conflict");
  assert.deepEqual(conflict.body.conflict.fields, ["title"]);
  assert.equal(service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "push",
  }, ACTOR_A).status, 409);
  const resolved = service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "resolve_local",
  }, ACTOR_A);
  assert.equal(resolved.body.action, "push_required");
  assert.equal(resolved.body.payload.title, "Local title");
});

test("GitHub push uses a two-step payload and confirmation baseline", () => {
  const { service } = harness();
  let item = service.createWorkItem({ projectId: "prj_a", title: "Initial" }, ACTOR_A).body.workItem;
  service.bindGithubIssue({
    workItemId: item.id, expectedRevision: item.revision,
    remote: {
      number: 7, title: "Initial", body: "", state: "open", labels: [],
      updatedAt: "2026-07-23T20:00:00.000Z",
    },
  }, ACTOR_A);
  item = service.updateWorkItem({
    workItemId: item.id, expectedRevision: item.revision, title: "Publish me",
  }, ACTOR_A).body.workItem;
  const required = service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "push",
  }, ACTOR_A);
  assert.equal(required.body.action, "push_required");
  assert.equal(required.body.payload.title, "Publish me");
  const confirmed = service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "push",
    pushedRemoteUpdatedAt: "2026-07-24T03:00:00.000Z",
  }, ACTOR_A);
  assert.equal(confirmed.body.action, "pushed");
});

test("external issue contract supports GitLab and Gitea without overstating adapter capabilities", () => {
  const { service } = harness();
  const providers = service.listExternalProviders().body.providers;
  assert.deepEqual(providers.map(({ id }) => id), ["github", "gitlab", "gitea"]);
  assert.equal(providers.find(({ id }) => id === "gitlab").apiSync, false);
  assert.equal(providers.find(({ id }) => id === "gitea").webhook, false);

  const item = service.createWorkItem({ projectId: "prj_a", title: "Portable issue" }, ACTOR_A).body.workItem;
  const remote = {
    number: 18, title: "Portable issue", body: "", state: "open", labels: ["portable"],
    url: "https://gitlab.example/acme/repo/-/issues/18", repository: "acme/repo",
    updatedAt: "2026-07-23T20:00:00.000Z",
  };
  const linked = service.bindExternalIssue({
    workItemId: item.id, expectedRevision: item.revision, provider: "gitlab", remote,
  }, ACTOR_A);
  assert.equal(linked.status, 201);
  assert.deepEqual({
    kind: linked.body.binding.kind,
    provider: linked.body.binding.provider,
    resourceType: linked.body.binding.resourceType,
    externalId: linked.body.binding.externalId,
    relation: linked.body.binding.relation,
    isPrimary: linked.body.binding.isPrimary,
    syncPolicy: linked.body.binding.syncPolicy,
    linkedBy: linked.body.binding.linkedBy,
  }, {
    kind: "gitlab_issue", provider: "gitlab", resourceType: "issue", externalId: "18",
    relation: "source", isPrimary: true, syncPolicy: "manual", linkedBy: "usr_a",
  });
  assert.equal(linked.body.binding.bindingId, "gitlab:issue:acme/repo:18");

  const pulled = service.syncExternalIssue({
    workItemId: item.id, expectedRevision: item.revision, provider: "gitlab", direction: "pull",
    remote: { ...remote, title: "Updated in GitLab", updatedAt: "2026-07-24T01:00:00.000Z" },
  }, ACTOR_A);
  assert.equal(pulled.body.action, "pulled");
  assert.equal(pulled.body.workItem.title, "Updated in GitLab");
  assert.equal(service.bindExternalIssue({
    workItemId: item.id, expectedRevision: pulled.body.workItem.revision, provider: "bitbucket", remote,
  }, ACTOR_A).body.error, "unsupported_external_provider");
});

test("external intake creates a Local Issue before execution and preserves the source relation", () => {
  const { service } = harness();
  const imported = service.createWorkItemFromExternal({
    projectId: "prj_a",
    provider: "gitlab",
    remote: {
      number: 19, title: "Imported from GitLab", body: "Remote description", state: "open", labels: ["bug"],
      url: "https://gitlab.example/acme/repo/-/issues/19", repository: "acme/repo",
      updatedAt: "2026-07-24T00:00:00.000Z",
    },
  }, ACTOR_A);
  assert.equal(imported.status, 201);
  assert.equal(imported.body.created, true);
  assert.equal(imported.body.workItem.title, "Imported from GitLab");
  assert.equal(imported.body.workItem.body, "Remote description");
  assert.deepEqual(imported.body.workItem.externalBindings[0], imported.body.binding);
  assert.equal(imported.body.binding.relation, "source");
  assert.equal(imported.body.binding.isPrimary, true);
});

test("GitLab and Gitea webhook ingestion is idempotent, tenant-aware, and replayable", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Webhook portable" }, ACTOR_A).body.workItem;
  const remote = {
    number: 28, title: "Webhook portable", body: "", state: "open", labels: [],
    repository: "acme/repo", updatedAt: "2026-07-24T00:00:00.000Z",
  };
  service.bindExternalIssue({
    workItemId: item.id, expectedRevision: item.revision, provider: "gitea", remote,
  }, ACTOR_A);
  const accepted = service.ingestExternalWebhook({
    provider: "gitea", deliveryId: "delivery-28",
    snapshot: { ...remote, title: "Webhook changed", updatedAt: "2026-07-24T01:00:00.000Z" },
  });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.synced, 1);
  assert.equal(service.ingestExternalWebhook({
    provider: "gitea", deliveryId: "delivery-28",
    snapshot: { ...remote, title: "Ignored duplicate", updatedAt: "2026-07-24T02:00:00.000Z" },
  }).body.replayed, true);
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.title, "Webhook changed");
  assert.equal(service.replayExternalWebhook({
    provider: "gitea", deliveryId: "delivery-28",
  }, ACTOR_B).status, 404);
  assert.equal(service.replayExternalWebhook({
    provider: "gitea", deliveryId: "delivery-28",
  }, ACTOR_A).status, 202);
});

test("structured acceptance and verification gate completion", () => {
  const { service } = harness();
  let item = service.createWorkItem({
    projectId: "prj_a", title: "Verified delivery",
    acceptanceCriteria: ["Tests pass", "Docs updated"],
  }, ACTOR_A).body.workItem;
  const blocked = service.updateWorkItem({
    workItemId: item.id, expectedRevision: item.revision, status: "done",
  }, ACTOR_A);
  assert.equal(blocked.status, 409);
  assert.deepEqual(blocked.body.missingCriteria, ["Tests pass", "Docs updated"]);
  assert.equal(blocked.body.verificationRequired, true);

  const recorded = service.recordVerification({
    workItemId: item.id, expectedRevision: item.revision,
    kind: "test", status: "passed", command: "pnpm test", summary: "All suites passed.",
    acceptanceResults: [
      { criterion: "Tests pass", status: "passed", note: "321 tests" },
      { criterion: "Docs updated", status: "passed", note: "README checked" },
    ],
    evidence: [
      { kind: "commit", ref: "abc123", summary: "Implementation" },
      { kind: "log", ref: "run:test-1", summary: "Test output" },
    ],
  }, ACTOR_A);
  assert.equal(recorded.status, 201);
  assert.equal(recorded.body.workItem.completionGate.ready, true);
  assert.equal(recorded.body.workItem.verificationRecords[0].recordedBy, "usr_a");
  item = recorded.body.workItem;
  assert.equal(service.updateWorkItem({
    workItemId: item.id, expectedRevision: item.revision, status: "done",
  }, ACTOR_A).status, 200);
});

test("an enforced content result contract blocks completion until the output is valid", () => {
  const { service } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "写文章",
    taskKind: "content_article",
    acceptanceCriteria: ["形成文章稿件"],
    artifactContract: {
      consumes: [],
      produces: ["article_draft"],
      requirements: [{ kind: "article_draft", minCount: 1, extensions: [".md"], families: ["markdown"] }],
    },
  }, ACTOR_A).body.workItem;
  const stored = service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem;
  stored.outputAssets = [{ id: "empty_article", path: "outputs/article.md", family: "markdown", terminalId: "dev_local", size: 0 }];
  const rejected = service.updateWorkItem({
    workItemId: created.id,
    expectedRevision: created.revision,
    status: "done",
  }, ACTOR_A);
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.error, "work_item_result_verification_incomplete");

  const attached = service.updateWorkItem({
    workItemId: created.id,
    expectedRevision: created.revision,
    outputAssets: [{ id: "article_md", path: "outputs/article.md", family: "markdown", terminalId: "dev_local", size: 128 }],
    status: "review",
  }, ACTOR_A);
  assert.equal(attached.status, 200);
  const verified = service.recordVerification({
    workItemId: created.id,
    expectedRevision: attached.body.workItem.revision,
    kind: "manual",
    status: "passed",
    summary: "文章稿件已检查。",
    acceptanceResults: [{ criterion: "形成文章稿件", status: "passed", note: "文章文件存在且格式正确。" }],
    evidence: [{ kind: "asset", ref: "outputs/article.md", summary: "文章稿件", assetId: "article_md", terminalId: "dev_local" }],
  }, ACTOR_A);
  assert.equal(verified.status, 201);
  const completed = service.updateWorkItem({
    workItemId: created.id,
    expectedRevision: verified.body.workItem.revision,
    status: "done",
  }, ACTOR_A);
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.workItem.resultVerification.status, "passed");
});

test("software completion requires passed test and build records", () => {
  const { service } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "实现并验证功能",
    taskKind: "software_implementation",
    acceptanceCriteria: ["实现完成"],
    artifactContract: {
      consumes: [],
      produces: ["software_change"],
      requirements: [{ kind: "software_change", minCount: 1 }],
      verification: { requiredKinds: ["test", "build"] },
    },
  }, ACTOR_A).body.workItem;
  const attached = service.updateWorkItem({
    workItemId: created.id,
    expectedRevision: created.revision,
    outputAssets: [{ id: "change", path: "outputs/change.diff", terminalId: "dev_local", size: 20 }],
  }, ACTOR_A);
  assert.equal(attached.status, 200);
  const testRecord = service.recordVerification({
    workItemId: created.id,
    expectedRevision: attached.body.workItem.revision,
    kind: "test",
    status: "passed",
    summary: "测试通过",
    acceptanceResults: [{ criterion: "实现完成", status: "passed", note: "测试通过" }],
    evidence: [{ kind: "run", ref: "test-run", summary: "测试运行" }],
  }, ACTOR_A);
  assert.equal(testRecord.status, 201);
  const missingBuild = service.updateWorkItem({
    workItemId: created.id,
    expectedRevision: testRecord.body.workItem.revision,
    status: "done",
  }, ACTOR_A);
  assert.equal(missingBuild.status, 409);
  assert.equal(missingBuild.body.error, "work_item_result_verification_incomplete");
  const buildRecord = service.recordVerification({
    workItemId: created.id,
    expectedRevision: testRecord.body.workItem.revision,
    kind: "build",
    status: "passed",
    summary: "构建通过",
    acceptanceResults: [{ criterion: "实现完成", status: "passed", note: "构建通过" }],
    evidence: [{ kind: "run", ref: "build-run", summary: "构建运行" }],
  }, ACTOR_A);
  assert.equal(buildRecord.status, 201);
  const completed = service.updateWorkItem({
    workItemId: created.id,
    expectedRevision: buildRecord.body.workItem.revision,
    status: "done",
  }, ACTOR_A);
  assert.equal(completed.status, 200);
  assert.equal(completed.body.workItem.resultVerification.status, "passed");
});

test("work-item output updates derive local article metrics before completion verification", () => {
  const root = mkdtempSync(join(tmpdir(), "work-item-output-"));
  try {
    mkdirSync(join(root, "outputs"));
    writeFileSync(join(root, "outputs", "article.md"), "# 背景\n内容\n## 分析\n内容", "utf8");
    const { service } = harness({ projectPath: root });
    const created = service.createWorkItem({
      projectId: "prj_a",
      title: "自动检查文章",
      taskKind: "content_article",
      acceptanceCriteria: ["文章结构合格"],
      artifactContract: {
        consumes: [],
        produces: ["article_draft"],
        requirements: [{ kind: "article_draft", minCount: 1, extensions: [".md"], quality: { minChars: 5, minSections: 2 } }],
      },
    }, ACTOR_A).body.workItem;
    const attached = service.updateWorkItem({
      workItemId: created.id,
      expectedRevision: created.revision,
      outputAssets: [{ id: "article", path: "outputs/article.md", terminalId: "dev_local", size: 20 }],
    }, ACTOR_A);
    assert.equal(attached.status, 200);
    assert.equal(attached.body.workItem.outputAssets[0].contentMetrics.sectionCount, 2);
    const verified = service.recordVerification({
      workItemId: created.id,
      expectedRevision: attached.body.workItem.revision,
      kind: "manual",
      status: "passed",
      summary: "文章结构已检查",
      acceptanceResults: [{ criterion: "文章结构合格", status: "passed", note: "章节指标达标" }],
      evidence: [{ kind: "asset", ref: "outputs/article.md", summary: "文章文件", assetId: "article", terminalId: "dev_local" }],
    }, ACTOR_A);
    const completed = service.updateWorkItem({
      workItemId: created.id,
      expectedRevision: verified.body.workItem.revision,
      status: "done",
    }, ACTOR_A);
    assert.equal(completed.status, 200);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("work-item output updates persist trusted media probe metrics", () => {
  const root = mkdtempSync(join(tmpdir(), "work-item-media-"));
  try {
    writeFileSync(join(root, "video.mp4"), "placeholder", "utf8");
    const { service } = harness({
      projectPath: root,
      probeMediaAsset: () => ({
        format: { duration: "42.5", format_name: "mov,mp4" },
        streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }],
      }),
    });
    const created = service.createWorkItem({
      projectId: "prj_a",
      title: "检查视频",
      taskKind: "content_video",
      acceptanceCriteria: ["视频规格合格"],
      artifactContract: {
        consumes: [],
        produces: ["video_package"],
        requirements: [{ kind: "video_package", minCount: 1, extensions: [".mp4"], quality: { minWidth: 1280, minHeight: 720 } }],
      },
    }, ACTOR_A).body.workItem;
    const attached = service.updateWorkItem({
      workItemId: created.id,
      expectedRevision: created.revision,
      outputAssets: [{ id: "video", path: "video.mp4", family: "video", terminalId: "dev_local", size: 20 }],
    }, ACTOR_A);
    assert.equal(attached.status, 200);
    assert.deepEqual(attached.body.workItem.outputAssets[0].contentMetrics, {
      source: "media_probe", durationSeconds: 42.5, width: 1920, height: 1080, codec: "h264",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a combined status and acceptance edit evaluates the candidate completion gate", () => {
  const { service } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a",
    title: "Do not bypass acceptance",
    idempotencyKey: "candidate-gate",
  }, ACTOR_A).body.workItem;

  const blocked = service.updateWorkItem({
    workItemId: item.id,
    expectedRevision: item.revision,
    status: "done",
    acceptanceCriteria: ["Must pass"],
  }, ACTOR_A);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "work_item_acceptance_incomplete");

  const current = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem;
  assert.equal(current.status, "backlog");
  assert.deepEqual(current.acceptanceCriteria, []);
  assert.equal(Object.hasOwn(current, "createIdempotencyKey"), false);

  const closed = service.transitionWorkItem({
    workItemId: item.id,
    expectedRevision: current.revision,
    action: "close",
  }, ACTOR_A);
  assert.equal(Object.hasOwn(closed.body.workItem, "createIdempotencyKey"), false);
});

test("verification rejects unknown criteria and malformed evidence", () => {
  const { service } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a", title: "Evidence", acceptanceCriteria: ["Known"],
  }, ACTOR_A).body.workItem;
  assert.equal(service.recordVerification({
    workItemId: item.id, expectedRevision: item.revision, kind: "test", status: "passed",
    acceptanceResults: [{ criterion: "Unknown", status: "passed" }],
  }, ACTOR_A).body.error, "invalid_work_item_acceptance_result");
  assert.equal(service.recordVerification({
    workItemId: item.id, expectedRevision: item.revision, kind: "test", status: "passed",
    evidence: [{ kind: "secret", ref: "x" }],
  }, ACTOR_A).body.error, "invalid_work_item_evidence");
});

test("cross-asset task trace links Excel input through PowerPoint output to image evidence", () => {
  const { service, events } = harness();
  let item = service.createWorkItem({
    projectId: "prj_a",
    title: "Build a review deck from the workbook",
    acceptanceCriteria: ["Rendered deck evidence is verified"],
    inputAssets: [{
      id: "asset-xlsx", path: "reports/source.xlsx", family: "excel",
      terminalId: "dev_local", hash: "sha256:excel-v1", version: "excel-v1",
      capabilities: ["preview", "inspect", "edit"],
      readiness: { state: "ready", reason: "available_on_owning_terminal" },
    }],
    requiredCapabilities: ["edit"],
  }, ACTOR_A).body.workItem;
  assert.equal(item.assetReadiness.state, "ready");
  const queued = service.claimWorkItem({
    workItemId: item.id, agentId: "agt-office", idempotencyKey: "asset-e2e-queue",
  }, ACTOR_A);
  assert.equal(queued.status, 201);
  item = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem;
  assert.equal(item.executionState, "claimed");
  assert.equal(item.terminalId, "dev_local");

  const deck = service.recordAssetOperation({
    workItemId: item.id, expectedRevision: item.revision,
    capability: "edit", inputAssetId: "asset-xlsx",
    invocationId: "inv-office-1", approvalId: "apr-office-1",
    applicationResolution: {
      state: "ready", reason: "local_capability_selected", terminalId: "dev_local",
      capability: { applicationId: "app_officecli", displayName: "Update workbook", name: "internal.must-not-render" },
      telemetry: { durationMs: 2.5 },
    },
    summary: "Generated the quarterly review deck from workbook data.",
    outputAsset: {
      id: "asset-pptx", path: "outputs/review.pptx", family: "powerpoint",
      terminalId: "dev_local", hash: "sha256:pptx-v1", version: "pptx-v1",
      capabilities: ["preview", "inspect", "edit", "render", "attach_evidence"],
      readiness: { state: "ready", reason: "available_on_owning_terminal" },
    },
  }, ACTOR_A);
  assert.equal(deck.status, 201);
  assert.equal(deck.body.operation.traceId, item.id);
  assert.equal(deck.body.operation.approvalId, "apr-office-1");
  assert.deepEqual(deck.body.operation.applicationResolution, {
    state: "ready", terminalId: "dev_local", applicationId: "app_officecli",
    label: "Update workbook", reason: "local_capability_selected", durationMs: 2.5,
  });
  item = deck.body.workItem;

  const image = service.recordAssetOperation({
    workItemId: item.id, expectedRevision: item.revision,
    capability: "render", inputAssetId: "asset-pptx",
    invocationId: "inv-render-1", summary: "Rendered a safe review image.",
    outputAsset: {
      id: "asset-image", path: "evidence/review.png", family: "image",
      terminalId: "dev_local", hash: "sha256:image-v1", version: "image-v1",
      capabilities: ["preview", "inspect", "compare", "attach_evidence"],
      readiness: { state: "ready", reason: "available_on_owning_terminal" },
    },
  }, ACTOR_A);
  assert.equal(image.status, 201);
  item = image.body.workItem;

  const previewed = service.recordAssetOperation({
    workItemId: item.id, expectedRevision: item.revision,
    capability: "preview", inputAssetId: "asset-image",
    invocationId: "inv-preview-1", summary: "Previewed the bounded local image.",
  }, ACTOR_A);
  assert.equal(previewed.status, 201);
  item = previewed.body.workItem;

  const verified = service.recordVerification({
    workItemId: item.id, expectedRevision: item.revision,
    kind: "manual", status: "passed", summary: "Deck image reviewed.",
    acceptanceResults: [{
      criterion: "Rendered deck evidence is verified", status: "passed", note: "Image matches source totals.",
    }],
    evidence: [{
      kind: "asset", assetId: "asset-image", ref: "evidence/review.png",
      hash: "sha256:image-v1", version: "image-v1", terminalId: "dev_local",
      summary: "Rendered PowerPoint evidence.",
    }],
  }, ACTOR_A);
  assert.equal(verified.status, 201);
  assert.equal(verified.body.workItem.completionGate.ready, true);
  assert.equal(verified.body.workItem.outputAssets.length, 2);
  assert.equal(verified.body.workItem.verificationRecords[0].evidence[0].assetId, "asset-image");

  const detail = service.getWorkItem({ workItemId: item.id }, ACTOR_A);
  assert.equal(detail.body.observability.executionChainId, item.id);
  assert.ok(detail.body.observability.timeline.some((row) => row.type === "asset_operation_recorded" && row.stage === "tool"));
  assert.ok(detail.body.observability.timeline.some((row) => row.type === "asset_evidence_attached" && row.stage === "verification"));
  assert.equal(events.filter((event) => event.type === "work_item_asset_operation_recorded").length, 3);
  assert.ok(events.every((event) => event.type !== "work_item_asset_operation_recorded"
    || (event.data.traceId === item.id && event.data.terminalId === "dev_local")));
});

test("real task Application execution resolves server-side and stamps immutable task/terminal trace context", () => {
  const invocations = [];
  const resolution = {
    state: "waiting_approval", reason: "capability_requires_approval", terminalId: "dev_local",
    capability: { name: "app.office.apply", displayName: "Update workbook", applicationId: "app_office", riskLevel: "medium" },
    approval: { required: true },
    readiness: { runtime: "ready", credential: { configured: true, scopeMatch: true, expired: false } },
  };
  const { service } = harness({
    resolveApplicationCapability: () => resolution,
    issueApplicationApprovalGrant: (input, actor) => {
      assert.deepEqual(input, { action: "wrapper:apply", targetId: "app_office" });
      assert.equal(actor.userId, "usr_a");
      return { ok: true, status: 201, body: { token: "grant-1", expiresAt: "2026-07-24T00:05:00.000Z" } };
    },
    invokeResolvedCapability: (name, input) => {
      assert.equal(name, "app.office.apply");
      assert.equal(input.projectId, "prj_a");
      assert.equal(input.approvalToken, "grant-1");
      const invocation = { id: "inv-app-1", status: "queued", options: { metadata: {} } };
      invocations.push(invocation);
      return { status: 202, body: { invocation } };
    },
  });
  let item = service.createWorkItem({
    projectId: "prj_a", title: "Update workbook",
    inputAssets: [{
      id: "asset-1", path: "input.xlsx", family: "excel", terminalId: "dev_local",
      hash: "sha256:x", version: "v1", capabilities: ["edit"], readiness: { state: "ready" },
    }],
    requiredCapabilities: ["edit"],
  }, ACTOR_A).body.workItem;
  assert.equal(item.queueReadiness.state, "waiting_approval");
  const blocked = service.startApplicationExecution({
    workItemId: item.id, expectedRevision: item.revision, assetVerb: "edit", assetFamily: "excel",
  }, ACTOR_A);
  assert.equal(blocked.body.error, "approval_required");
  const approval = service.requestApplicationExecutionApproval({
    workItemId: item.id, expectedRevision: item.revision, assetVerb: "edit", assetFamily: "excel",
  }, ACTOR_A);
  assert.equal(approval.status, 201);
  assert.equal(approval.body.approvalToken, "grant-1");
  const started = service.startApplicationExecution({
    workItemId: item.id, expectedRevision: item.revision, assetVerb: "edit", assetFamily: "excel",
    approvalToken: "grant-1", parameters: { operation: "update" },
  }, ACTOR_A);
  assert.equal(started.status, 202);
  assert.equal(invocations[0].options.metadata.applicationExecution.taskId, item.id);
  assert.equal(invocations[0].options.metadata.applicationExecution.terminalId, "dev_local");
  assert.equal(invocations[0].options.metadata.applicationExecution.principalId, "usr_a");
  assert.match(invocations[0].options.metadata.applicationExecution.contractFingerprint, /^sha256:/);
  assert.equal(started.body.workItem.executionBindings.at(-1).id, "inv-app-1");
});

test("task Application execution rejects caller capability overrides before resolution", () => {
  let resolved = false;
  const { service } = harness({
    resolveApplicationCapability: () => { resolved = true; return null; },
  });
  const item = service.createWorkItem({ projectId: "prj_a", title: "Unsafe" }, ACTOR_A).body.workItem;
  const result = service.startApplicationExecution({
    workItemId: item.id, expectedRevision: item.revision, intent: "edit",
    parameters: { command: "rm", applicationId: "attacker-choice" },
  }, ACTOR_A);
  assert.equal(result.body.error, "invalid_application_execution_parameters");
  assert.equal(resolved, false);
});

test("human attention queue aggregates conflicts, approvals, and failed evidence", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a", title: "Needs a human", status: "review", acceptanceCriteria: ["Ship safely"],
  }, ACTOR_A).body.workItem;
  state.workItems[0].externalBindings = [{
    kind: "github_issue", number: 3, conflict: { detectedAt: "2026-07-24T01:00:00.000Z", fields: ["title"] },
  }];
  state.workItems[0].executionBindings = [{ kind: "auto_run", targetId: "ar_3" }];
  state.autoRuns = [{
    id: "ar_3", status: "awaiting_approval", createdAt: "2026-07-24T00:30:00.000Z",
  }];
  state.workItems[0].verificationRecords = [{
    id: "wvr_bad", status: "failed", summary: "Tests failed", recordedAt: "2026-07-24T00:45:00.000Z",
  }];
  state.planningProjects = [{
    id: "plan_1", name: "Release", ownerTeamId: "team_a",
    recommendedActionApprovalRequests: [{
      id: "par_1", code: "recover_schedule", status: "pending",
      requestedAt: "2026-07-24T00:15:00.000Z",
    }],
  }];
  const attention = service.listAttention({}, ACTOR_A).body;
  assert.equal(attention.count, 5);
  assert.deepEqual(new Set(attention.items.slice(0, 4).map((row) => row.kind)), new Set([
    "github_conflict", "verification_failed", "execution_approval", "recommended_action_approval",
  ]));
  assert.equal(attention.items[4].kind, "acceptance_blocked");
  assert.equal(service.listAttention({}, ACTOR_B).body.count, 0);
  assert.equal(attention.items.filter((row) => row.workItemId).every((row) => row.workItemId === item.id), true);
  assert.equal(service.listAttention({ kind: "recommended_action_approval" }, ACTOR_A).body.items[0].planningProjectId, "plan_1");
  assert.equal(attention.items.every((row) => row.dueAt && row.slaStatus && Array.isArray(row.history)), true);
  assert.equal(attention.metrics.backlog, 5);
  assert.equal(attention.metrics.pendingApprovals, 1);
  assert.equal(service.listAttention({ kind: "github_conflict" }, ACTOR_A).body.count, 1);
  const attentionId = attention.items[0].id;
  const claimed = service.updateAttention({
    attentionIds: [attentionId], action: "claim", leaseSeconds: 600, idempotencyKey: "claim-1",
  }, ACTOR_A);
  assert.equal(claimed.body.updated[0].handling.actorId, "usr_a");
  assert.equal(claimed.body.updated[0].handling.expiresAt, "2026-07-24T00:10:00.000Z");
  assert.equal(service.listAttention({ handler: "mine" }, ACTOR_A).body.items.some((row) => row.id === attentionId), true);
  const unclaimedView = service.listAttention({ handler: "unclaimed" }, ACTOR_A).body;
  assert.equal(unclaimedView.items.some((row) => row.id === attentionId), false);
  assert.equal(unclaimedView.metrics.backlog, 5);
  assert.equal(service.updateAttention({
    attentionIds: [attentionId], action: "claim",
  }, ACTOR_C).status, 409);
  assert.equal(service.updateAttention({
    attentionIds: [attentionId], action: "renew", leaseSeconds: 1_200,
  }, ACTOR_A).body.updated[0].handling.expiresAt, "2026-07-24T00:20:00.000Z");
  const resolvedOnce = service.updateAttention({
    attentionIds: [attentionId], action: "resolve", note: "Handled", idempotencyKey: "resolve-1",
  }, ACTOR_A);
  const resolvedReplay = service.updateAttention({
    attentionIds: [attentionId], action: "resolve", note: "Handled", idempotencyKey: "resolve-1",
  }, ACTOR_A);
  assert.equal(resolvedOnce.status, 200);
  assert.equal(resolvedReplay.body.replayed, true);
  assert.equal(service.listAttention({}, ACTOR_A).body.items.some((row) => row.id === attentionId), false);
  const resolved = service.listAttention({ includeResolved: "1" }, ACTOR_A).body.items.find((row) => row.id === attentionId);
  assert.equal(resolved.resolution.note, "Handled");
});

test("stale business records remain actionable until refreshed", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Refresh customer material" }, ACTOR_A).body.workItem;
  const stored = state.workItems.find((candidate) => candidate.id === item.id);
  stored.recordBindings = [{
    id: "binding_customer",
    direction: "input",
    role: "required",
    record: { title: "Acme" },
    resolution: { state: "stale" },
  }];
  state.workItemActivities.unshift({
    id: "wia_stale",
    workItemId: item.id,
    action: "record_bindings_freshness_changed",
    actorId: "system_record_freshness",
    createdAt: "2026-07-24T00:00:00.000Z",
  });
  const attention = service.listAttention({ kind: "record_binding_stale" }, ACTOR_A).body;
  assert.equal(attention.count, 1);
  assert.equal(attention.metrics.staleRecords, 1);
  assert.equal(attention.items[0].severity, "high");
  assert.deepEqual(attention.items[0].details, {
    workItemRevision: 1,
    bindingIds: ["binding_customer"],
    bindingCount: 1,
    states: ["stale"],
    executionBlocked: true,
    postingBlocked: true,
    refreshable: true,
  });
  assert.equal(service.updateAttention({
    attentionIds: [attention.items[0].id], action: "resolve",
  }, ACTOR_A).body.error, "work_item_record_binding_attention_requires_refresh");

  stored.executionBindings = [{ kind: "auto_run", targetId: "aur_started" }];
  assert.equal(service.listAttention({ kind: "record_binding_stale" }, ACTOR_A).body.items[0].details.refreshable, false);
  stored.recordBindings[0].resolution.state = "resolved";
  assert.equal(service.listAttention({ kind: "record_binding_stale" }, ACTOR_A).body.count, 0);
});

test("adds and removes scoped local content references without copying bytes", async () => {
  const contentId = `lc_${"a".repeat(32)}`;
  const resolutions = [];
  const { service } = harness({
    resolveLocalContentReference: async (input, actor) => {
      resolutions.push({ input, actor });
      return {
        ok: true,
        sha256: `sha256:${"b".repeat(64)}`,
        originalName: "reference.md",
        record: { id: contentId, title: "Reference", kind: "article" },
      };
    },
  });
  const created = service.createWorkItem({ projectId: "prj_a", title: "Reference task" }, ACTOR_A).body.workItem;
  assert.deepEqual(created.localContentRefs, []);
  const added = await service.addContentReference({
    workItemId: created.id,
    contentId,
    expectedRevision: created.revision,
    purpose: "required_input",
    selectedFingerprint: `sha256:${"b".repeat(64)}`,
  }, ACTOR_A);
  assert.equal(added.status, 201);
  assert.equal(added.body.reference.contentId, contentId);
  assert.equal(added.body.reference.fingerprintPinned, true);
  assert.equal(Object.hasOwn(added.body.reference, "selectedFingerprint"), false);
  assert.equal(added.body.workItem.localContentRefs.length, 1);
  assert.equal(added.body.workItem.materialChangesPending, true);
  assert.deepEqual(resolutions[0].input, { contentId, projectId: "prj_a" });

  const replay = await service.addContentReference({
    workItemId: created.id,
    contentId,
    expectedRevision: added.body.workItem.revision,
  }, ACTOR_A);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.workItem.localContentRefs.length, 1);

  const removed = service.removeContentReference({
    workItemId: created.id,
    referenceId: added.body.reference.id,
    expectedRevision: replay.body.workItem.revision,
  }, ACTOR_A);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.workItem.localContentRefs, []);
});

test("binds a structured work resource to a task without copying connector rows", async () => {
  const resourceId = `wres_${"c".repeat(32)}`;
  let currentVersion = "4";
  const { service, state } = harness({
    resolveWorkResourceReference: async () => ({
      status: 200,
      body: {
        resourceId,
        projectId: "prj_a",
        title: "客户台账",
        resourceKind: "table",
        businessRole: "contact",
        locality: "remote",
        sourceLabel: "CRM",
        currentVersion,
        contentId: null,
        allowedPurposes: ["query_source", "reference"],
      },
    }),
  });
  const created = service.createWorkItem({ projectId: "prj_a", title: "检查客户状态" }, ACTOR_A).body.workItem;
  const added = await service.addResourceReference({
    workItemId: created.id,
    resourceId,
    expectedRevision: created.revision,
    purpose: "query_source",
  }, ACTOR_A);

  assert.equal(added.status, 201);
  assert.equal(added.body.reference.resourceId, resourceId);
  assert.equal(added.body.reference.locality, "remote");
  assert.equal(added.body.reference.versionPinned, true);
  assert.equal(Object.hasOwn(added.body.reference, "selectedVersion"), false);
  assert.equal(added.body.workItem.taskResourceRefs.length, 1);
  assert.equal(state.workItems[0].taskResourceRefs[0].sourceLabel, "CRM");
  assert.equal(Object.hasOwn(state.workItems[0].taskResourceRefs[0], "rows"), false);

  currentVersion = "5";
  const drifted = await service.inspectResourceReferences({ workItemId: created.id }, ACTOR_A);
  assert.equal(drifted.status, 200);
  assert.equal(drifted.body.preflight.executable, false);
  assert.deepEqual(drifted.body.preflight.counts, { ready: 0, changed: 1, unavailable: 0, unknown: 0, blocking: 1 });
  assert.equal(drifted.body.preflight.references[0].canAcceptCurrentVersion, true);
  assert.equal(Object.hasOwn(drifted.body.preflight.references[0], "currentVersion"), false);
  const refreshed = await service.refreshResourceReference({
    workItemId: created.id,
    referenceId: added.body.reference.id,
    expectedRevision: added.body.workItem.revision,
  }, ACTOR_A);
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.reference.versionPinned, true);
  assert.equal(Object.hasOwn(refreshed.body.reference, "selectedVersion"), false);
  assert.equal(state.workItems[0].taskResourceRefs[0].selectedVersion, "5");
  assert.equal(state.workItemActivities.some((activity) => activity.action === "work_resource_reference_refreshed"), true);
  const ready = await service.inspectResourceReferences({ workItemId: created.id }, ACTOR_A);
  assert.equal(ready.body.preflight.executable, true);
  assert.equal(ready.body.preflight.references[0].status, "ready");

  const removed = service.removeResourceReference({
    workItemId: created.id,
    referenceId: added.body.reference.id,
    expectedRevision: refreshed.body.workItem.revision,
  }, ACTOR_A);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.workItem.taskResourceRefs, []);
});

test("keeps a writable local ledger as a governed resource instead of downgrading it to a file reference", async () => {
  const resourceId = `wres_${"d".repeat(32)}`;
  const { service, state } = harness({
    resolveWorkResourceReference: async () => ({
      status: 200,
      body: {
        resourceId,
        projectId: "prj_a",
        title: "客户台账.xlsx",
        resourceKind: "table",
        businessRole: "contact",
        locality: "local",
        sourceLabel: "客户台账.xlsx",
        currentVersion: "sha256:v1",
        contentId: `lc_${"e".repeat(32)}`,
        capabilities: ["read", "query", "propose_change", "commit_change"],
        allowedPurposes: ["query_source", "change_target", "reference"],
      },
    }),
  });
  const created = service.createWorkItem({ projectId: "prj_a", title: "更新客户台账" }, ACTOR_A).body.workItem;
  const added = await service.addResourceReference({
    workItemId: created.id,
    resourceId,
    expectedRevision: created.revision,
    purpose: "change_target",
  }, ACTOR_A);

  assert.equal(added.status, 201);
  assert.equal(added.body.workItem.localContentRefs.length, 0);
  assert.equal(added.body.workItem.taskResourceRefs[0].purpose, "change_target");
  assert.ok(state.workItems[0].taskResourceRefs[0].capabilities.includes("commit_change"));
});

test("AI execution input is exposed as input work instead of an approval for any route", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Clarify scope" }, ACTOR_A).body.workItem;
  state.workItems[0].executionBindings = [{ kind: "auto_run", targetId: "ar_question" }];
  state.autoRuns = [{
    id: "ar_question",
    status: "needs_input",
    phase: "waiting_for_input",
    createdAt: "2026-07-24T00:30:00.000Z",
    decision: { path: "office", clarifyingQuestions: ["Include archived projects?"] },
  }];

  const attention = service.listAttention({}, ACTOR_A).body;
  const input = attention.items.find((row) => row.workItemId === item.id && row.kind === "execution_input");
  assert.ok(input);
  assert.deepEqual(input.details.questions, ["Include archived projects?"]);
  assert.equal(attention.items.some((row) => row.kind === "execution_approval"), false);
  const detail = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body;
  assert.equal(detail.observability.nextAction, "answer_ai");
  assert.equal(detail.workItem.executionState, "claimed");
});

test("detail exposes one unified execution review for a running direct task", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Prepare a workbook summary" }, ACTOR_A).body.workItem;
  const stored = state.workItems.find((candidate) => candidate.id === item.id);
  stored.executionBindings = [{
    kind: "application_invocation",
    targetId: "inv_execution_review",
    createdAt: "2026-07-24T00:30:00.000Z",
  }];
  state.invocations = [{
    id: "inv_execution_review",
    status: "running",
    agentId: "agt_office",
    startedAt: "2026-07-24T00:30:01.000Z",
    updatedAt: "2026-07-24T00:30:02.000Z",
  }];
  state.agents = [{ id: "agt_office", name: "Office assistant" }];

  const detail = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body;
  assert.equal(detail.observability.executionReview.state, "working");
  assert.equal(detail.observability.executionReview.stage, "working");
  assert.equal(detail.observability.executionReview.targetId, "inv_execution_review");
  assert.equal(detail.observability.executionReview.agentName, "Office assistant");
  assert.equal(detail.observability.executionReview.verification.status, "pending");
  assert.equal(detail.observability.executionReview.impact.status, "none");
  assert.equal(detail.observability.executionReview.recommendedAction.kind, "open_details");
  assert.equal(detail.observability.executionReview.recommendedAction.nextOwner, "ai");
  assert.deepEqual(detail.observability.executionReview.riskReasons, []);
});

test("attention leases expire and batch claims fail atomically on contention", () => {
  let currentTime = "2026-07-24T00:00:00.000Z";
  const { service, state } = harness({ clock: () => currentTime });
  const first = service.createWorkItem({ projectId: "prj_a", title: "First" }, ACTOR_A).body.workItem;
  const second = service.createWorkItem({ projectId: "prj_a", title: "Second" }, ACTOR_A).body.workItem;
  for (const item of state.workItems) {
    item.externalBindings = [{
      kind: "github_issue", number: item.localNumber,
      conflict: { detectedAt: currentTime, fields: ["title"] },
    }];
  }
  const [firstAttention, secondAttention] = service.listAttention({}, ACTOR_A).body.items;
  service.updateAttention({
    attentionIds: [secondAttention.id], action: "claim", leaseSeconds: 60,
  }, ACTOR_C);
  const contended = service.updateAttention({
    attentionIds: [firstAttention.id, secondAttention.id], action: "claim",
  }, ACTOR_A);
  assert.equal(contended.status, 409);
  assert.equal(service.listAttention({ handler: "unclaimed" }, ACTOR_A).body.items.some(
    (row) => row.id === firstAttention.id,
  ), true);
  currentTime = "2026-07-24T00:01:01.000Z";
  const claimedAfterExpiry = service.updateAttention({
    attentionIds: [firstAttention.id, secondAttention.id], action: "claim",
    idempotencyKey: "batch-claim-1",
  }, ACTOR_A);
  assert.equal(claimedAfterExpiry.status, 200);
  assert.equal(claimedAfterExpiry.body.count, 2);
  assert.equal(service.updateAttention({
    attentionIds: [firstAttention.id, secondAttention.id], action: "claim",
    idempotencyKey: "batch-claim-1",
  }, ACTOR_A).body.replayed, true);
  assert.equal(first.id !== second.id, true);
});

test("GitHub webhook sync is idempotent and ignores stale deliveries", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Before" }, ACTOR_A).body.workItem;
  service.bindGithubIssue({
    workItemId: item.id, expectedRevision: item.revision,
    remote: {
      number: 8, title: "Before", body: "", state: "open", labels: [],
      repository: "acme/repo", updatedAt: "2026-07-24T00:00:00.000Z",
    },
  }, ACTOR_A);
  const payload = {
    repository: { full_name: "acme/repo" },
    issue: {
      number: 8, title: "From webhook", body: "", state: "open", labels: [],
      milestone: { title: "M4" }, assignees: [{ login: "octocat" }],
      html_url: "https://github.test/acme/repo/issues/8", updated_at: "2026-07-24T01:00:00.000Z",
    },
  };
  const first = service.ingestGithubWebhook({ deliveryId: "delivery-1", event: "issues", payload });
  assert.equal(first.body.synced, 1);
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.title, "From webhook");
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.milestone, "M4");
  assert.deepEqual(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.assigneeIds, ["octocat"]);
  assert.equal(service.ingestGithubWebhook({
    deliveryId: "delivery-1", event: "issues", payload,
  }).body.replayed, true);
  const stale = service.ingestGithubWebhook({
    deliveryId: "delivery-2", event: "issues",
    payload: { ...payload, issue: { ...payload.issue, title: "Stale", updated_at: "2026-07-23T00:00:00.000Z" } },
  });
  assert.equal(stale.body.stale, 1);
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.title, "From webhook");
  assert.equal(service.githubSyncDiagnostics(ACTOR_A).body.boundIssues, 1);
  assert.equal(service.githubSyncDiagnostics(ACTOR_A).body.recentDeliveries.length, 2);
  assert.equal(service.githubSyncDiagnostics(ACTOR_B).body.recentDeliveries.length, 0);
  const replay = service.replayGithubWebhook({ deliveryId: "delivery-1" }, ACTOR_A);
  assert.equal(replay.status, 202);
  assert.equal(replay.body.outcome, "stale");
  assert.equal(replay.body.replayOf, "delivery-1");
  assert.equal(service.replayGithubWebhook({ deliveryId: "delivery-1" }, ACTOR_B).status, 404);
  service.recordGithubWebhookFailure({
    deliveryId: "bad-delivery", event: "issues", reason: "invalid_signature",
  });
  assert.notEqual(service.githubSyncDiagnostics(ACTOR_A).body.health, "healthy");
  assert.equal(service.githubSyncDiagnostics(ACTOR_A).body.recentFailures[0].reason, "invalid_signature");
  assert.equal(service.githubSyncDiagnostics(ACTOR_A).body.failureRate > 0, true);
  const comment = service.ingestGithubWebhook({
    deliveryId: "comment-1", event: "issue_comment",
    payload: {
      action: "created", repository: { full_name: "acme/repo" }, issue: { number: 8 },
      comment: {
        id: 55, body: "Remote note", user: { login: "reviewer" },
        created_at: "2026-07-24T02:00:00.000Z", updated_at: "2026-07-24T02:00:00.000Z",
      },
    },
  });
  assert.equal(comment.body.syncedComments, 1);
  assert.equal(service.listComments({ workItemId: item.id }, ACTOR_A).body.comments[0].body, "Remote note");
  const deleted = service.ingestGithubWebhook({
    deliveryId: "deleted-1", event: "issues",
    payload: {
      action: "deleted", repository: { full_name: "acme/repo" },
      issue: { number: 8, updated_at: "2026-07-24T03:00:00.000Z" },
    },
  });
  assert.equal(deleted.body.deleted, 1);
  assert.equal(service.listAttention({ kind: "github_deleted" }, ACTOR_A).body.count, 1);
});

test("GitHub webhook event storms stay bounded and cannot regress newer state", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Initial" }, ACTOR_A).body.workItem;
  service.bindGithubIssue({
    workItemId: item.id, expectedRevision: item.revision,
    remote: {
      number: 9, title: "Initial", body: "", state: "open", labels: [],
      repository: "acme/repo", updatedAt: "2026-07-24T00:00:00.000Z",
    },
  }, ACTOR_A);
  const payload = (title, updatedAt) => ({
    repository: { full_name: "acme/repo" },
    issue: {
      number: 9, title, body: "", state: "open", labels: [],
      html_url: "https://github.test/acme/repo/issues/9", updated_at: updatedAt,
    },
  });
  service.ingestGithubWebhook({
    deliveryId: "newest", event: "issues", payload: payload("Newest", "2026-07-24T02:00:00.000Z"),
  });
  for (let index = 0; index < 1_005; index += 1) {
    service.ingestGithubWebhook({
      deliveryId: `storm-${index}`, event: "issues",
      payload: payload(`Old ${index}`, "2026-07-24T01:00:00.000Z"),
    });
  }
  assert.equal(state.githubWorkItemWebhookDeliveries.length, 1_000);
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.title, "Newest");
  assert.equal(state.githubWorkItemWebhookDeliveries[0].result.outcome, "stale");
});

test("SLA and Webhook failure alerts are dispatched once per health transition", () => {
  const { service, state, alerts, events } = harness({
    clock: () => "2026-07-25T00:00:00.000Z",
  });
  const item = service.createWorkItem({ projectId: "prj_a", title: "Alert me" }, ACTOR_A).body.workItem;
  state.workItems[0].externalBindings = [{
    kind: "github_issue", number: 1,
    conflict: { detectedAt: "2026-07-24T00:00:00.000Z", fields: ["title"] },
  }];
  service.recordGithubWebhookFailure({
    deliveryId: "failed-alert", event: "issues", reason: "invalid_signature",
  });
  assert.equal(service.sweepOperationalAlerts().changed, 2);
  assert.deepEqual(new Set(alerts.map((alert) => alert.kind)), new Set([
    "work_item_sla_breach", "github_work_item_webhook_failures",
  ]));
  assert.equal(service.sweepOperationalAlerts().changed, 0);
  assert.equal(alerts.length, 2);
  state.workItems[0].externalBindings = [];
  state.githubWorkItemWebhookFailures = [];
  assert.equal(service.sweepOperationalAlerts().changed, 2);
  assert.equal(events.filter((event) => event.type === "work_item_operational_recovered").length, 2);
  assert.equal(item.id, state.workItems[0].id);
});

test("webhook bookkeeping and alert transitions commit once without debounce writes", () => {
  let commits = 0;
  const { service } = harness({
    store: { transaction: (fn) => { commits += 1; return fn(); } },
    persistStateSoon: () => assert.fail("store-backed writes must not use the debounce"),
  });

  service.recordGithubWebhookFailure({
    deliveryId: "failed-transaction", event: "issues", reason: "invalid_signature",
  });
  assert.equal(commits, 1);

  service.ingestGithubWebhook({
    deliveryId: "delivery-transaction",
    event: "issues",
    payload: {
      repository: { full_name: "acme/repo" },
      issue: {
        number: 7, title: "No binding", state: "open", labels: [],
        updated_at: "2026-07-24T00:00:00.000Z",
      },
    },
  });
  assert.equal(commits, 2);

  assert.equal(service.sweepOperationalAlerts().changed, 1);
  assert.equal(commits, 3);
  assert.equal(service.sweepOperationalAlerts().changed, 0);
  assert.equal(commits, 3);
});

test("team scoping hides foreign work items and foreign projects", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "A" }, ACTOR_A).body.workItem;
  assert.equal(service.listWorkItems({}, ACTOR_A).body.count, 1);
  assert.equal(service.listWorkItems({}, ACTOR_B).body.count, 0);
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_B).status, 404);
  assert.equal(service.createWorkItem({ projectId: "prj_b", title: "No" }, ACTOR_A).status, 404);
});

test("home workbench is assignee-scoped, tenant-safe, and timezone validated", () => {
  const { service } = harness();
  const own = service.createWorkItem({
    projectId: "prj_a", title: "Customer homepage", requesterRelation: "customer",
    requesterName: "Alex", waitingOn: "me", dueDate: "2026-07-24",
  }, ACTOR_A).body.workItem;
  const unassigned = service.createWorkItem({
    projectId: "prj_a", title: "Unassigned but local", assigneeIds: [], requesterRelation: "child",
  }, ACTOR_A).body.workItem;
  service.createWorkItem({ projectId: "prj_b", title: "Foreign homepage" }, ACTOR_B);

  const result = service.getHomeWorkbench({ assigneeId: "mine", timezoneOffset: -480 }, ACTOR_A);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.items.map((item) => item.workItemId), [own.id]);
  assert.equal(result.body.items[0].requester.relation, "customer");
  assert.equal(result.body.summary.waitingMe, 1);
  const all = service.getHomeWorkbench({ assigneeId: "all", timezoneOffset: -480 }, ACTOR_A);
  assert.deepEqual(new Set(all.body.items.map((item) => item.workItemId)), new Set([own.id, unassigned.id]));
  assert.equal(all.body.summary.byRelation.child, 1);
  assert.equal(service.getHomeWorkbench({ timezoneOffset: "invalid" }, ACTOR_A).status, 400);
});

test("priority accepts friendly aliases normalized to p0–p3", () => {
  const { service } = harness();
  const medium = service.createWorkItem({ projectId: "prj_a", title: "M", priority: "medium" }, ACTOR_A).body.workItem;
  assert.equal(medium.priority, "p2");
  const urgent = service.createWorkItem({ projectId: "prj_a", title: "U", priority: "URGENT" }, ACTOR_A).body.workItem;
  assert.equal(urgent.priority, "p0");
  const high = service.updateWorkItem({ workItemId: medium.id, expectedRevision: medium.revision, priority: "high" }, ACTOR_A).body.workItem;
  assert.equal(high.priority, "p1");
  // Genuinely invalid values still reject.
  assert.equal(service.createWorkItem({ projectId: "prj_a", title: "X", priority: "nope" }, ACTOR_A).status, 400);
});

test("review detail uses the immutable Run contract and maps criterion evidence without adopting later task edits", () => {
  const { state, service } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "Frozen review basis",
    acceptanceCriteria: ["Original criterion"],
    verificationSop: ["Run the original verification"],
  }, ACTOR_A).body.workItem;
  const internal = state.workItems.find((item) => item.id === created.id);
  internal.executionBindings.push({ kind: "auto_run", targetId: "aur_frozen", createdAt: "2026-07-24T00:01:00.000Z" });
  internal.acceptanceResults = [{
    criterion: "Original criterion",
    status: "passed",
    note: "Verified before review",
    verificationId: "wvr_frozen",
    updatedAt: "2026-07-24T00:02:00.000Z",
  }];
  internal.verificationRecords = [{
    id: "wvr_frozen",
    kind: "test",
    status: "passed",
    command: "pnpm test",
    summary: "All tests passed",
    evidence: [{ kind: "commit", ref: "abc123", summary: "Verified commit" }],
    sourceAutoRunId: "aur_frozen",
    recordedAt: "2026-07-24T00:02:00.000Z",
    recordedBy: "usr_autorun",
  }];
  state.autoRuns = [{
    id: "aur_frozen",
    status: "done",
    createdAt: "2026-07-24T00:01:00.000Z",
    executionContract: {
      schemaVersion: "execution-contract-v2",
      id: "contract:aur_frozen",
      workItemId: created.id,
      workItemRevision: 1,
      autoRunId: "aur_frozen",
      acceptanceCriteria: ["Original criterion"],
      verificationSop: ["Run the original verification"],
      confirmedBy: "user",
      confirmedAt: "2026-07-24T00:00:30.000Z",
      digest: "frozen-digest",
      readOnly: true,
    },
  }];
  internal.acceptanceCriteria = ["Later edited criterion"];
  internal.verificationSop = ["Later edited verification"];

  const detail = service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem;
  assert.deepEqual(detail.reviewContract.acceptanceCriteria, ["Original criterion"]);
  assert.deepEqual(detail.reviewContract.verificationSop, ["Run the original verification"]);
  assert.equal(detail.reviewContract.digest, "frozen-digest");
  assert.deepEqual(detail.reviewEvidence, [{
    criterion: "Original criterion",
    status: "passed",
    note: "Verified before review",
    verificationId: "wvr_frozen",
    command: "pnpm test",
    verificationSummary: "All tests passed",
    evidence: [{ kind: "commit", ref: "abc123", summary: "Verified commit" }],
    sourceAutoRunId: "aur_frozen",
    reviewedBy: "usr_autorun",
    reviewedAt: "2026-07-24T00:02:00.000Z",
  }]);
});

test("legacy confirmed contracts migrate once to a read-only legacy-v1 snapshot", () => {
  let persisted = 0;
  const first = harness();
  const created = first.service.createWorkItem({
    projectId: "prj_a",
    title: "Legacy confirmed task",
    acceptanceCriteria: ["Legacy criterion"],
    verificationSop: ["Legacy verification"],
  }, ACTOR_A).body.workItem;
  const migrated = createWorkItemService({
    state: first.state,
    now: () => "2026-07-25T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_migration`,
    persistStateSoon: () => { persisted += 1; },
  });

  const detail = migrated.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem;
  assert.equal(detail.reviewContract.schemaVersion, "legacy-v1");
  assert.equal(detail.reviewContract.readOnly, true);
  assert.deepEqual(detail.reviewContract.acceptanceCriteria, ["Legacy criterion"]);
  assert.match(detail.reviewContract.digest, /^[a-f0-9]{64}$/);
  assert.equal(persisted, 1);

  createWorkItemService({
    state: first.state,
    now: () => "2026-07-26T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_replay`,
    persistStateSoon: () => { persisted += 1; },
  });
  assert.equal(persisted, 1, "the durable migration is not repeated");
});

test("validates automatic execution policy and normalizes the hard not-before boundary", () => {
  const { service } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "Run when allowed",
    executionPolicy: "auto",
    notBefore: "2026-08-09T08:30:00+08:00",
  }, ACTOR_A);
  assert.equal(created.status, 201);
  assert.equal(created.body.workItem.executionPolicy, "auto");
  assert.equal(created.body.workItem.notBefore, "2026-08-09T00:30:00.000Z");
  assert.equal(service.createWorkItem({
    projectId: "prj_a", title: "Bad policy", executionPolicy: "sometimes",
  }, ACTOR_A).body.error, "invalid_work_item_execution_policy");
  assert.equal(service.createWorkItem({
    projectId: "prj_a", title: "Bad boundary", notBefore: "2026-08-09",
  }, ACTOR_A).body.error, "invalid_work_item_not_before");
});

test("updates are revision-gated and validate structured fields", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "A" }, ACTOR_A).body.workItem;
  assert.equal(service.updateWorkItem({ workItemId: item.id, title: "B" }, ACTOR_A).body.error, "expected_revision_required");
  assert.equal(service.updateWorkItem({ workItemId: item.id, expectedRevision: 9, title: "B" }, ACTOR_A).status, 409);
  assert.equal(service.updateWorkItem({ workItemId: item.id, expectedRevision: 1, priority: "nope" }, ACTOR_A).status, 400);
  const updated = service.updateWorkItem({
    workItemId: item.id,
    expectedRevision: 1,
    title: "B",
    status: "ready",
    labels: ["local", "local"],
    acceptanceCriteria: ["It persists"],
  }, ACTOR_A);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.workItem.revision, 2);
  assert.deepEqual(updated.body.workItem.labels, ["local"]);
});

test("refreshing a changed task goal replaces stale acceptance and invalidates prior passes", () => {
  const { service, state } = harness();
  let item = service.createWorkItem({
    projectId: "prj_a",
    title: "Prepare a short release note",
    body: "Summarize the bug fix in 200 words.",
    acceptanceCriteria: ["The release note is no longer than 200 words"],
    verificationSop: ["Count the words in the release note"],
  }, ACTOR_A).body.workItem;
  item = service.recordVerification({
    workItemId: item.id,
    expectedRevision: item.revision,
    kind: "review",
    status: "passed",
    summary: "The old 200-word goal passed.",
    acceptanceResults: [{
      criterion: "The release note is no longer than 200 words",
      status: "passed",
      note: "188 words",
    }],
  }, ACTOR_A).body.workItem;
  assert.equal(item.completionGate.ready, true);
  const stored = state.workItems.find((candidate) => candidate.id === item.id);
  stored.status = "review";
  stored.executionContractSnapshot = {
    schemaVersion: "execution-contract-v2",
    id: "contract_old_goal",
    workItemId: item.id,
    workItemRevision: item.revision,
    autoRunId: "run_old_goal",
    acceptanceCriteria: ["The release note is no longer than 200 words"],
    verificationSop: ["Count the words in the release note"],
    confirmedAt: "2026-07-24T00:00:00.000Z",
    digest: "digest_old_goal",
  };

  const refreshed = service.updateWorkItem({
    workItemId: item.id,
    expectedRevision: item.revision,
    body: "Write a detailed migration guide with examples.",
    refreshExecutionContract: true,
  }, ACTOR_A);

  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
  const changed = refreshed.body.workItem;
  assert.equal(changed.executionContractSource, "assisted");
  assert.equal(changed.status, "ready");
  assert.ok(changed.acceptanceCriteria.length >= 1);
  assert.ok(changed.verificationSop.length >= 1);
  assert.ok(changed.acceptanceCriteria.every((criterion) => !criterion.includes("200 words")));
  assert.ok(changed.verificationSop.every((step) => !step.includes("Count the words")));
  assert.deepEqual(changed.acceptanceResults, []);
  assert.equal(changed.completionGate.ready, false);
  assert.equal(changed.completionGate.verificationRequired, true);
  assert.equal(changed.reviewContract.supersededByGoalRevision, true);
  assert.equal(refreshed.body.executionContractRefreshed, true);
});

test("a goal refresh keeps explicit new acceptance while regenerating an omitted verification plan", () => {
  const { service } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a",
    title: "Prepare release notes",
    body: "Write a short release note.",
    acceptanceCriteria: ["The old short note exists"],
    verificationSop: ["Review the old short note"],
  }, ACTOR_A).body.workItem;

  const refreshed = service.updateWorkItem({
    workItemId: item.id,
    expectedRevision: item.revision,
    body: "Write a detailed migration guide with runnable examples.",
    refreshExecutionContract: true,
    acceptanceCriteria: ["The migration guide contains two runnable examples"],
  }, ACTOR_A);

  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
  assert.deepEqual(refreshed.body.workItem.acceptanceCriteria, ["The migration guide contains two runnable examples"]);
  assert.ok(refreshed.body.workItem.verificationSop.length >= 1);
  assert.ok(refreshed.body.workItem.verificationSop.every((step) => !step.includes("old short note")));
  assert.equal(refreshed.body.workItem.executionContractSource, "manual");
});

test("assigning an unowned work item to self is revision-gated and cannot steal assigned work", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Available", assigneeIds: [] }, ACTOR_A).body.workItem;
  assert.deepEqual(item.assigneeIds, []);
  assert.equal(service.assignWorkItemToSelf({ workItemId: item.id }, ACTOR_A).body.error, "expected_revision_required");
  assert.equal(service.assignWorkItemToSelf({ workItemId: item.id, expectedRevision: 9 }, ACTOR_A).body.error, "work_item_revision_conflict");

  const assigned = service.assignWorkItemToSelf({ workItemId: item.id, expectedRevision: 1 }, ACTOR_A);
  assert.equal(assigned.status, 200);
  assert.deepEqual(assigned.body.workItem.assigneeIds, ["usr_a"]);
  assert.equal(assigned.body.workItem.revision, 2);

  const replayed = service.assignWorkItemToSelf({ workItemId: item.id, expectedRevision: 2 }, ACTOR_A);
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(service.assignWorkItemToSelf({ workItemId: item.id, expectedRevision: 2 }, ACTOR_C).body.error, "work_item_already_assigned");
  assert.equal(service.assignWorkItemToSelf({ workItemId: item.id, expectedRevision: 2 }, ACTOR_B).status, 404);
});

test("planning fields validate and bulk updates are atomic", () => {
  const { service } = harness();
  const first = service.createWorkItem({
    projectId: "prj_a", title: "First", dueDate: "2026-08-01", milestone: "M3", estimatePoints: 5,
  }, ACTOR_A).body.workItem;
  const second = service.createWorkItem({ projectId: "prj_a", title: "Second" }, ACTOR_A).body.workItem;
  assert.equal(first.dueDate, "2026-08-01");
  assert.equal(first.milestone, "M3");
  assert.equal(first.estimatePoints, 5);
  assert.equal(service.updateWorkItem({
    workItemId: first.id, expectedRevision: 1, dueDate: "08/01/2026",
  }, ACTOR_A).status, 400);
  const conflict = service.bulkUpdateWorkItems({
    items: [{ id: first.id, expectedRevision: 1 }, { id: second.id, expectedRevision: 9 }],
    changes: { status: "ready" },
  }, ACTOR_A);
  assert.equal(conflict.status, 409);
  assert.equal(service.getWorkItem({ workItemId: first.id }, ACTOR_A).body.workItem.status, "backlog");
  const updated = service.bulkUpdateWorkItems({
    items: [{ id: first.id, expectedRevision: 1 }, { id: second.id, expectedRevision: 1 }],
    changes: { status: "ready", milestone: "M4", estimatePoints: 8 },
  }, ACTOR_A);
  assert.equal(updated.body.count, 2);
  assert.equal(updated.body.workItems.every((item) =>
    item.status === "ready" && item.milestone === "M4" && item.estimatePoints === 8), true);
  assert.equal(service.updateWorkItem({
    workItemId: first.id, expectedRevision: 2, estimatePoints: -1,
  }, ACTOR_A).status, 400);
});

test("dependencies expose blocking state and reject cycles", () => {
  const { service } = harness();
  const foundation = service.createWorkItem({ projectId: "prj_a", title: "Foundation" }, ACTOR_A).body.workItem;
  const delivery = service.createWorkItem({ projectId: "prj_a", title: "Delivery" }, ACTOR_A).body.workItem;
  const linked = service.updateWorkItem({
    workItemId: delivery.id,
    expectedRevision: 1,
    dependencyIds: [foundation.id],
  }, ACTOR_A);
  assert.equal(linked.status, 200);
  assert.equal(linked.body.workItem.blockedBy[0].resolved, false);
  assert.equal(service.getWorkItem({ workItemId: foundation.id }, ACTOR_A).body.workItem.blocks[0].id, delivery.id);

  const cycle = service.updateWorkItem({
    workItemId: foundation.id,
    expectedRevision: 1,
    dependencyIds: [delivery.id],
  }, ACTOR_A);
  assert.equal(cycle.status, 409);
  assert.equal(cycle.body.error, "work_item_dependency_cycle");

  service.updateWorkItem({
    workItemId: foundation.id,
    expectedRevision: 1,
    status: "done",
  }, ACTOR_A);
  assert.equal(service.getWorkItem({ workItemId: delivery.id }, ACTOR_A).body.workItem.blockedBy[0].resolved, true);
});

test("parent and sub-issues expose progress and reject hierarchy cycles", () => {
  const { service, state } = harness();
  state.projects.push({ id: "prj_c", ownerTeamId: "team_a" });
  const parent = service.createWorkItem({
    projectId: "prj_a", title: "Parent", type: "initiative",
  }, ACTOR_A).body.workItem;
  const first = service.createWorkItem({
    projectId: "prj_a", title: "Child one", parentId: parent.id,
  }, ACTOR_A).body.workItem;
  const second = service.createWorkItem({
    projectId: "prj_a", title: "Child two", parentId: parent.id, status: "done",
  }, ACTOR_A).body.workItem;
  assert.equal(first.parent.id, parent.id);
  const detail = service.getWorkItem({ workItemId: parent.id }, ACTOR_A).body.workItem;
  assert.equal(detail.subIssuesSummary.total, 2);
  assert.equal(detail.subIssuesSummary.completed, 1);
  assert.equal(detail.subIssuesSummary.percentCompleted, 50);
  assert.deepEqual(detail.subIssues.map((item) => item.id).sort(), [first.id, second.id].sort());
  assert.equal(service.updateWorkItem({
    workItemId: parent.id, expectedRevision: 1, parentId: first.id,
  }, ACTOR_A).status, 409);
  assert.equal(service.createWorkItem({
    projectId: "prj_c", title: "Wrong project", parentId: parent.id,
  }, ACTOR_A).status, 400);
});

test("explicit intent groups independent tasks without creating hierarchy or dependencies", () => {
  const { service } = harness();
  const article = service.createWorkItem({
    projectId: "prj_a",
    title: "写深度文章",
    intentId: "intent_content_1",
    intentStatement: "基于资料写文章和漫画",
    taskKind: "content_article",
    creationBasis: "explicit_user_intent",
  }, ACTOR_A);
  const comic = service.createWorkItem({
    projectId: "prj_a",
    title: "制作漫画",
    intentId: "intent_content_1",
    intentStatement: "基于资料写文章和漫画",
    taskKind: "content_comic",
    creationBasis: "explicit_user_intent",
  }, ACTOR_A);
  assert.equal(article.status, 201);
  assert.equal(comic.status, 201);
  const detail = service.getWorkItem({ workItemId: article.body.workItem.id }, ACTOR_A).body.workItem;
  assert.equal(detail.parent, null);
  assert.deepEqual(detail.dependencyIds, []);
  assert.equal(detail.intentPeers.length, 1);
  assert.equal(detail.intentPeers[0].id, comic.body.workItem.id);
  assert.equal(detail.intentPeers[0].taskKind, "content_comic");
});

test("one work goal keeps atomic tasks connected by real artifact dependencies", () => {
  const { service, state } = harness();
  state.workGoals = [{
    id: "goal_daily_coding", ownerTeamId: "team_a", projectId: "prj_a",
    title: "把今天编码成果整理并发布", statement: "整理成文章和图片后发布",
    outcome: "形成并发布内容", status: "active", planVersion: 1, platforms: [], taskIds: [], artifacts: [],
  }];
  const digest = service.createWorkItem({
    projectId: "prj_a", title: "编码成果整理", workGoalId: "goal_daily_coding",
    intentId: "goal_daily_coding", intentStatement: "整理成文章和图片后发布",
    taskKind: "coding_digest", artifactContract: { consumes: [], produces: ["coding_digest"] },
  }, ACTOR_A).body.workItem;
  const article = service.createWorkItem({
    projectId: "prj_a", title: "文章创作", workGoalId: "goal_daily_coding",
    intentId: "goal_daily_coding", intentStatement: "整理成文章和图片后发布",
    taskKind: "content_article", dependencyIds: [digest.id],
    artifactContract: { consumes: ["coding_digest"], produces: ["article_draft"] },
  }, ACTOR_A).body.workItem;
  assert.deepEqual(article.dependencyIds, [digest.id]);
  state.workItems.find((item) => item.id === digest.id).outputAssets = [{
    id: "digest_md", path: "outputs/coding-digest.md", family: "text", mimeType: "text/markdown",
    terminalId: "dev_local", size: 128, resourceClass: "small", hash: "digest-hash", version: null,
    worktreeId: null, capabilities: [], readiness: { state: "ready", reason: "task_output" },
  }];
  const completed = service.updateWorkItem({
    workItemId: digest.id, expectedRevision: digest.revision, status: "done",
  }, ACTOR_A);
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  const detail = service.getWorkItem({ workItemId: article.id }, ACTOR_A).body.workItem;
  assert.equal(detail.workGoal.id, "goal_daily_coding");
  assert.equal(detail.goalTasks.length, 2);
  assert.equal(detail.workGoal.userSummary.progress.total, 2);
  assert.match(detail.workGoal.userSummary.nextStep, /文章创作/);
  assert.equal(detail.inputAssets[0].id, "digest_md");
  assert.equal(detail.artifactHandoffs[0].status, "attached");
  assert.equal(detail.blockedBy[0].resolved, true);
});

test("delivery report files become typed goal artifacts before a dependent task is unlocked", () => {
  const { service, state } = harness();
  state.workGoals = [{
    id: "goal_delivery_artifacts", ownerTeamId: "team_a", projectId: "prj_a",
    title: "整理编码成果并写文章", statement: "先整理再写文章",
    outcome: "得到文章", status: "active", planVersion: 1, platforms: [], taskIds: [], artifacts: [],
  }];
  const digest = service.createWorkItem({
    projectId: "prj_a", title: "编码成果整理", workGoalId: "goal_delivery_artifacts",
    intentId: "goal_delivery_artifacts", intentStatement: "先整理再写文章",
    taskKind: "coding_digest", artifactContract: { consumes: [], produces: ["coding_digest"] },
  }, ACTOR_A).body.workItem;
  const article = service.createWorkItem({
    projectId: "prj_a", title: "文章创作", workGoalId: "goal_delivery_artifacts",
    intentId: "goal_delivery_artifacts", intentStatement: "先整理再写文章",
    taskKind: "content_article", dependencyIds: [digest.id],
    artifactContract: { consumes: ["coding_digest"], produces: ["article_draft"] },
  }, ACTOR_A).body.workItem;
  const storedDigest = state.workItems.find((item) => item.id === digest.id);
  storedDigest.executionBindings = [{ kind: "auto_run", targetId: "run_digest", worktreeId: "wt_digest" }];
  state.autoRuns = [{
    id: "run_digest", localIssueId: digest.id, updatedAt: "2026-07-24T00:00:00.000Z",
    deliveryReport: { changedFiles: ["outputs/coding-digest.md"], changedFilesBaseCommit: "base-1" },
  }];

  const completed = service.updateWorkItem({
    workItemId: digest.id, expectedRevision: storedDigest.revision, status: "done",
  }, ACTOR_A);
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  const storedArticle = state.workItems.find((item) => item.id === article.id);
  assert.equal(storedDigest.outputAssets[0].path, "outputs/coding-digest.md");
  assert.equal(storedDigest.outputAssets[0].family, "markdown");
  assert.equal(storedArticle.inputAssets[0].path, "outputs/coding-digest.md");
  assert.equal(storedArticle.artifactHandoffs[0].status, "attached");
});

test("artifact manifests keep a dependent blocked when quantity or format is invalid", () => {
  const { service, state } = harness();
  state.workGoals = [{
    id: "goal_images", ownerTeamId: "team_a", projectId: "prj_a", title: "制作配图并适配",
    statement: "做3张配图", outcome: "得到平台包", status: "active", planVersion: 1,
    platforms: [], taskIds: [], artifacts: [],
  }];
  const images = service.createWorkItem({
    projectId: "prj_a", title: "制作3张配图", workGoalId: "goal_images",
    intentId: "goal_images", intentStatement: "做3张配图", taskKind: "content_image",
    artifactContract: {
      consumes: [], produces: ["image_set"],
      requirements: [{ kind: "image_set", minCount: 3, extensions: [".png", ".jpg"], families: ["image"] }],
    },
  }, ACTOR_A).body.workItem;
  const adaptation = service.createWorkItem({
    projectId: "prj_a", title: "平台适配", workGoalId: "goal_images",
    intentId: "goal_images", intentStatement: "做3张配图", taskKind: "platform_adaptation",
    dependencyIds: [images.id], artifactContract: { consumes: ["image_set"], produces: ["platform_package"] },
  }, ACTOR_A).body.workItem;
  const storedImages = state.workItems.find((item) => item.id === images.id);
  storedImages.outputAssets = [
    { id: "img_1", path: "outputs/one.png", family: "image", terminalId: "dev_local" },
    { id: "wrong_2", path: "outputs/two.md", family: "markdown", terminalId: "dev_local" },
  ];
  const completed = service.updateWorkItem({
    workItemId: images.id, expectedRevision: storedImages.revision, status: "done",
  }, ACTOR_A);
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(storedImages.artifactManifest[0].status, "invalid");
  assert.equal(storedImages.artifactManifest[0].actualCount, 1);
  const storedAdaptation = state.workItems.find((item) => item.id === adaptation.id);
  assert.equal(storedAdaptation.inputAssets.length, 0);
  assert.equal(storedAdaptation.artifactHandoffs[0].status, "awaiting_artifact");
  assert.match(storedAdaptation.artifactHandoffs[0].validationErrors[0], /至少 3 个/);
});

test("a publication asks for approval only after its final platform package is attached", () => {
  const { service, state } = harness();
  state.workGoals = [{
    id: "goal_publish", ownerTeamId: "team_a", projectId: "prj_a", title: "发布文章",
    statement: "发布到公众号", outcome: "完成发布", status: "active", planVersion: 1,
    platforms: [{ id: "wechat_official", label: "公众号" }], taskIds: [], artifacts: [],
  }];
  const adaptation = service.createWorkItem({
    projectId: "prj_a", title: "公众号适配", workGoalId: "goal_publish",
    intentId: "goal_publish", intentStatement: "发布到公众号", taskKind: "platform_adaptation",
    artifactContract: {
      consumes: [], produces: ["platform_package"],
      requirements: [{ kind: "platform_package", minCount: 1, extensions: [".md"] }],
    },
  }, ACTOR_A).body.workItem;
  const publish = service.createWorkItem({
    projectId: "prj_a", title: "发布到公众号", workGoalId: "goal_publish",
    intentId: "goal_publish", intentStatement: "发布到公众号", taskKind: "content_publish",
    platformTarget: { id: "wechat_official", label: "公众号" }, dependencyIds: [adaptation.id],
    artifactContract: { consumes: ["platform_package"], produces: ["publication_receipt"] },
  }, ACTOR_A).body.workItem;
  state.channelTaskRequests = [{
    id: "ctr_publish", workItemId: publish.id, threadId: "cth_publish", status: "waiting_artifacts",
  }];
  state.channelTaskThreads = [{
    id: "cth_publish", workItemId: publish.id, status: "waiting_upstream", statusHistory: [],
  }];
  const storedAdaptation = state.workItems.find((item) => item.id === adaptation.id);
  storedAdaptation.outputAssets = [{
    id: "wechat_final", path: "outputs/wechat-final.md", family: "markdown", hash: "hash-final", version: "v1", terminalId: "dev_local",
  }];
  const completed = service.updateWorkItem({
    workItemId: adaptation.id, expectedRevision: storedAdaptation.revision, status: "done",
  }, ACTOR_A);
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(state.channelTaskRequests[0].status, "pending");
  assert.equal(state.channelTaskRequests[0].approvalSnapshot.platform.id, "wechat_official");
  assert.equal(state.channelTaskRequests[0].approvalSnapshot.artifacts[0].id, "wechat_final");
  assert.equal(state.channelTaskThreads[0].status, "waiting_approval");
  assert.equal(state.channelTaskThreads[0].waitingFor, "publication_review");

  const firstDigest = state.channelTaskRequests[0].previewDigest;
  const revised = service.updateWorkItem({
    workItemId: adaptation.id,
    expectedRevision: storedAdaptation.revision,
    status: "done",
    outputAssets: [{
      id: "wechat_final_v2", path: "outputs/wechat-final-v2.md", family: "markdown",
      hash: "hash-final-v2", version: "v2", terminalId: "dev_local",
    }],
  }, ACTOR_A);
  assert.equal(revised.status, 200, JSON.stringify(revised.body));
  assert.notEqual(state.channelTaskRequests[0].previewDigest, firstDigest);
  assert.deepEqual(state.workItems.find((item) => item.id === publish.id).inputAssets.map((asset) => asset.id), ["wechat_final_v2"]);
  assert.equal(state.channelTaskThreads[0].previousRiskPreviewDigest, firstDigest);
  assert.match(state.channelTaskThreads[0].artifactVersionChangeNotice, /发布内容已更新/);
});

test("suggestions cannot be persisted as work items and intent metadata is immutable", () => {
  const { service } = harness();
  const suggested = service.createWorkItem({
    projectId: "prj_a",
    title: "Maybe write an article",
    planningHorizon: "suggested",
  }, ACTOR_A);
  assert.equal(suggested.status, 400);
  assert.equal(suggested.body.error, "invalid_work_item_planning_horizon");

  const created = service.createWorkItem({ projectId: "prj_a", title: "Committed task" }, ACTOR_A).body.workItem;
  const changed = service.updateWorkItem({
    workItemId: created.id,
    expectedRevision: created.revision,
    intentId: "intent_retrofit",
  }, ACTOR_A);
  assert.equal(changed.status, 400);
  assert.equal(changed.body.error, "work_item_intent_fields_immutable");
});

test("execution admission creates the Run before its contract and rejects duplicate auto-runs", () => {
  const { service, state } = harness();
  const blocked = service.createWorkItem({ projectId: "prj_a", title: "Not planned" }, ACTOR_A).body.workItem;
  const missingContract = service.beginExecution({ workItemId: blocked.id, kind: "auto_run" }, ACTOR_A);
  assert.equal(missingContract.status, 201);
  service.abortExecution({
    workItemId: blocked.id,
    operationId: missingContract.body.operation.id,
    reason: "test cleanup",
  }, ACTOR_A);

  const item = service.createWorkItem({
    projectId: "prj_a",
    title: "Run once",
    acceptanceCriteria: ["The requested behavior works"],
  }, ACTOR_A).body.workItem;
  assert.equal(item.executionContractGate.ready, true);

  const admitted = service.beginExecution({
    workItemId: item.id,
    kind: "auto_run",
    agentId: "agt_a",
  }, ACTOR_A);
  assert.equal(admitted.status, 201);
  assert.equal(admitted.body.claim.claimedBy, "usr_a");
  assert.equal(admitted.body.operation.contextSnapshot.schemaVersion, 2);
  assert.equal(admitted.body.operation.contextSnapshot.workItemRevision, item.revision);
  assert.equal(admitted.body.operation.contextSnapshot.intentContract.status, "ready");
  assert.equal(admitted.body.operation.contextSnapshot.intentContract.goal, "Run once");
  assert.equal(service.beginExecution({
    workItemId: item.id,
    kind: "auto_run",
  }, ACTOR_A).body.error, "work_item_execution_in_progress");
  assert.equal(service.beginExecution({
    workItemId: item.id,
    kind: "auto_run",
  }, ACTOR_C).body.error, "work_item_execution_in_progress");

  state.autoRuns = [{ id: "aur_once", status: "running" }];
  const recorded = service.recordExecutionBinding({
    workItemId: item.id,
    kind: "auto_run",
    targetId: "aur_once",
    worktreeId: "wtr_once",
    operationId: admitted.body.operation.id,
  }, ACTOR_A);
  assert.equal(recorded.status, 200);
  assert.equal(recorded.body.workItem.executionOperation, null);
  assert.equal(recorded.body.binding.contextSnapshot.digest, admitted.body.operation.contextSnapshot.digest);
  admitted.body.operation.contextSnapshot.sources.push({ sourceId: "late_mutation" });
  admitted.body.operation.contextSnapshot.intentContract.goal = "late mutation";
  assert.equal(recorded.body.binding.contextSnapshot.sources.length, 0);
  assert.equal(recorded.body.binding.contextSnapshot.intentContract.goal, "Run once");
  assert.equal(service.beginExecution({
    workItemId: item.id,
    kind: "auto_run",
  }, ACTOR_A).body.error, "work_item_auto_run_active");
});

test("delivery admission serializes side effects and completes by operation id", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({ projectId: "prj_a", title: "Serialize delivery" }, ACTOR_A).body.workItem;
  state.autoRuns = [{
    id: "aur_delivery_lock",
    status: "done",
    link: { type: "local_issue", number: created.localNumber },
    localDelivery: { worktreeId: "wtr_lock", branchName: "local-lock" },
  }];
  service.recordExecutionBinding({
    workItemId: created.id,
    kind: "auto_run",
    targetId: "aur_delivery_lock",
    worktreeId: "wtr_lock",
  }, ACTOR_A);
  const item = service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem;
  const admitted = service.beginDelivery({
    workItemId: item.id,
    expectedRevision: item.revision,
    mode: "local_merge",
    autoRunId: "aur_delivery_lock",
  }, ACTOR_A);
  assert.equal(admitted.status, 201);
  assert.equal(service.updateWorkItem({
    workItemId: item.id,
    expectedRevision: admitted.body.workItem.revision,
    title: "Must wait",
  }, ACTOR_A).body.error, "work_item_delivery_in_progress");
  assert.equal(service.beginDelivery({
    workItemId: item.id,
    expectedRevision: admitted.body.workItem.revision,
    mode: "local_merge",
    autoRunId: "aur_delivery_lock",
  }, ACTOR_A).body.error, "work_item_delivery_in_progress");

  const completed = service.completeDelivery({
    workItemId: item.id,
    mode: "local_merge",
    autoRunId: "aur_delivery_lock",
    operationId: admitted.body.operation.id,
    result: { baseBranch: "main", commit: "locked123" },
  }, ACTOR_A);
  assert.equal(completed.status, 200);
  assert.equal(completed.body.workItem.state, "closed");
  assert.equal(completed.body.delivery.deliveredCommit, "locked123");
});

test("agent claims renew, conflict, expire, transfer, and release safely", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Claim me" }, ACTOR_A).body.workItem;
  const claimed = service.claimWorkItem({
    workItemId: item.id, agentId: "agt_a", leaseMinutes: 30, idempotencyKey: "claim-1",
  }, ACTOR_A);
  assert.equal(claimed.status, 201);
  assert.equal(claimed.body.claim.claimedBy, "usr_a");
  const renewed = service.claimWorkItem({
    workItemId: item.id, agentId: "agt_a", leaseMinutes: 60, idempotencyKey: "claim-1",
  }, ACTOR_A);
  assert.equal(renewed.status, 200);
  assert.equal(service.claimWorkItem({ workItemId: item.id }, ACTOR_C).status, 409);
  state.workItems[0].claim.leaseExpiresAt = "2026-07-23T00:00:00.000Z";
  const takeover = service.claimWorkItem({ workItemId: item.id, agentId: "agt_c" }, ACTOR_C);
  assert.equal(takeover.status, 201);
  assert.equal(takeover.body.claim.claimedBy, "usr_c");
  assert.equal(service.releaseWorkItemClaim({ workItemId: item.id }, ACTOR_A).status, 409);
  assert.equal(service.releaseWorkItemClaim({ workItemId: item.id }, ACTOR_C).body.released, true);
  assert.equal(service.releaseWorkItemClaim({ workItemId: item.id }, ACTOR_C).body.released, false);
});

test("detail returns an authoritative per-item observability snapshot", () => {
  const { service, state } = harness({
    budgetStatusFor: () => ({
      exists: true, budgetId: "bud_a", limitUsd: 1, spentUsd: 0.25, finalizedUsd: 0.25,
      estimatedUsd: 0, reservedUsd: 0.1, admissionUsd: 0.35, remainingUsd: 0.75,
      policy: "block", currency: "USD", over: false, admissionOver: false,
    }),
  });
  const item = service.createWorkItem({ projectId: "prj_a", title: "Observe me" }, ACTOR_A).body.workItem;
  service.claimWorkItem({ workItemId: item.id, agentId: "agt_a", leaseMinutes: 30 }, ACTOR_A);
  state.autoRuns = [{
    id: "aur_1", projectId: "prj_a", status: "awaiting_approval",
    updatedAt: "2026-07-24T00:01:00.000Z",
    decision: { path: "develop", confidence: 0.8, via: "agent" },
    routingOverride: {
      recommendedPath: "develop", actualPath: "design", reason: "Needs a wireframe",
      actorId: "usr_a", recordedAt: "2026-07-24T00:01:10.000Z", revision: 1,
    },
  }];
  state.workItems[0].executionBindings = [{ kind: "auto_run", targetId: "aur_1", worktreeId: "wtr_1", createdAt: "2026-07-24T00:00:00.000Z" }];
  state.ledgerEntries = [{
    id: "led_1", localIssueId: item.id, projectId: "prj_a", autoRunId: "aur_1",
    model: "gpt-test", budgetPoolId: "bud_a", amountUsd: 0.25, billable: true, status: "final",
    createdAt: "2026-07-24T00:01:30.000Z",
  }];
  state.budgets = [{ id: "bud_a", projectId: "prj_a", limitUsd: 1, policy: "block" }];
  state.alertOutbox = [{
    id: "aob_1", alert: { data: { autoRunId: "aur_1" } }, status: "queued",
    createdAt: "2026-07-24T00:01:40.000Z",
  }];

  const detail = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body;
  assert.equal(detail.observability.executionChainId, item.id);
  assert.ok(detail.observability.timeline.some((entry) => entry.source === "issue"));
  assert.ok(detail.observability.timeline.some((entry) => entry.source === "cost"));
  assert.ok(detail.observability.timeline.some((entry) => entry.source === "alert"));
  assert.equal(detail.observability.timeline[0].stage, "creation");
  assert.equal(detail.observability.routingExplanation.selectedPath, "develop");
  assert.equal(detail.observability.routingExplanation.humanCorrection.actualPath, "design");
  assert.equal(detail.observability.nextAction, "review_approval");
  assert.equal(detail.observability.latestRun.id, "aur_1");
  assert.equal(detail.observability.activeClaim.actorId, "usr_a");
  assert.deepEqual(detail.observability.cost, {
    knownUsd: 0.25,
    unknownEntries: 0,
    entryCount: 1,
    byAutoRun: [{ autoRunId: "aur_1", knownUsd: 0.25, unknownEntries: 0, entryCount: 1 }],
    byModel: [{ model: "gpt-test", knownUsd: 0.25, unknownEntries: 0, entryCount: 1 }],
    byBudgetPool: [{ budgetPoolId: "bud_a", knownUsd: 0.25, unknownEntries: 0, entryCount: 1 }],
    projectBudget: {
      exists: true, budgetId: "bud_a", limitUsd: 1, spentUsd: 0.25, finalizedUsd: 0.25,
      estimatedUsd: 0, reservedUsd: 0.1, admissionUsd: 0.35, remainingUsd: 0.75,
      policy: "block", currency: "USD", over: false, admissionOver: false,
    },
    teamBudget: null,
  });
  assert.deepEqual(detail.observability.alerts, {
    queued: 1,
    failed: 0,
    sent: 0,
    skipped: 0,
    items: [{
      id: "aob_1",
      kind: "unknown",
      status: "queued",
      attempts: 0,
      nextAttemptAt: null,
      sentAt: null,
      lastError: null,
    }],
  });
});

test("extracts explicit Markdown acceptance criteria before execution", () => {
  assert.deepEqual(extractAcceptanceCriteriaFromBody([
    "## Context",
    "Keep this text out.",
    "## Acceptance",
    "- [ ] Uses the terminal timezone",
    "- Preview and apply agree",
    "## Notes",
    "- Not a criterion",
  ].join("\n")), ["Uses the terminal timezone", "Preview and apply agree"]);
  const { service } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a",
    title: "Timezone scheduling",
    body: "## Acceptance\n- [ ] Preview uses the terminal timezone",
  }, ACTOR_A).body.workItem;
  assert.deepEqual(item.acceptanceCriteria, ["Preview uses the terminal timezone"]);
  assert.equal(item.executionContractSource, "body_extracted");
  assert.equal(item.executionContractGate.ready, true);
  assert.ok(item.verificationSop.length > 0);
});

test("AI handoff prepares a missing execution contract in one governed service action", () => {
  const { service } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a",
    title: "Prepare a customer update",
    body: "Summarize the current delivery status and the open risks for the customer.",
  }, ACTOR_A).body.workItem;
  assert.equal(item.executionContractGate.ready, false);

  const prepared = service.prepareExecutionContract({
    workItemId: item.id,
    expectedRevision: item.revision,
  }, ACTOR_A);
  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.workItem.executionContractSource, "assisted");
  assert.equal(prepared.body.workItem.executionContractGate.ready, true);
  assert.ok(prepared.body.workItem.acceptanceCriteria.length > 0);
  assert.ok(prepared.body.workItem.verificationSop.length > 0);

  const replayed = service.prepareExecutionContract({
    workItemId: item.id,
    expectedRevision: prepared.body.workItem.revision,
  }, ACTOR_A);
  assert.equal(replayed.body.replayed, true);
});

test("AI handoff can prepare a clarification draft without confirming it", () => {
  const { service } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a",
    title: "Choose the compatibility behavior",
    body: "The product owner must decide whether legacy clients fall back or fail closed.",
  }, ACTOR_A).body.workItem;
  const prepared = service.prepareExecutionContract({
    workItemId: item.id,
    expectedRevision: item.revision,
    confirm: false,
  }, ACTOR_A);

  assert.equal(prepared.status, 200);
  assert.ok(prepared.body.workItem.acceptanceCriteria.length > 0);
  assert.ok(prepared.body.workItem.verificationSop.length > 0);
  assert.equal(prepared.body.workItem.executionContractConfirmedAt, null);
  assert.equal(prepared.body.workItem.executionContractGate.ready, false);
  assert.equal(prepared.body.draft.confirmedAt, null);

  const replayed = service.prepareExecutionContract({
    workItemId: item.id,
    expectedRevision: item.revision,
    confirm: false,
  }, ACTOR_A);
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.workItem.revision, prepared.body.workItem.revision);
});

test("AI handoff confirms and schedules the reviewed contract atomically and idempotently", () => {
  const { service } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a",
    title: "Prepare a customer update",
    body: "Summarize the current delivery status and open risks.",
  }, ACTOR_A).body.workItem;
  const prepared = service.prepareExecutionContract({
    workItemId: item.id,
    expectedRevision: item.revision,
    confirm: false,
  }, ACTOR_A).body.workItem;

  const confirmed = service.confirmExecutionContractAndSchedule({
    workItemId: item.id,
    expectedRevision: prepared.revision,
  }, ACTOR_A);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.replayed, false);
  assert.equal(confirmed.body.workItem.executionContractGate.ready, true);
  assert.equal(confirmed.body.workItem.executionPolicy, "auto");
  assert.equal(confirmed.body.workItem.waitingOn, "ai");
  assert.equal(confirmed.body.workItem.status, "ready");
  assert.equal(confirmed.body.workItem.revision, prepared.revision + 1);
  assert.equal(confirmed.body.workItem.executionStartReceipt.status, "queued");
  assert.equal(confirmed.body.workItem.executionStartReceipt.reasonCode, "waiting_for_turn");
  assert.ok(confirmed.body.workItem.executionStartReceipt.id.startsWith("wsr_"));
  assert.equal(confirmed.body.workItem.intentContract.status, "ready");
  assert.equal(confirmed.body.workItem.intentContract.readOnly, true);
  assert.match(confirmed.body.workItem.intentContract.digest, /^[a-f0-9]{64}$/);

  const replayed = service.confirmExecutionContractAndSchedule({
    workItemId: item.id,
    expectedRevision: prepared.revision,
  }, ACTOR_A);
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.workItem.revision, confirmed.body.workItem.revision);
});

test("AI handoff refuses an intent conflict and returns one key clarification", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "只读分析客户台账",
    acceptanceCriteria: ["给出分析结论"],
    verificationSop: ["核对分析范围"],
    channelTaskContract: {
      source: "channel",
      operationIntent: {
        schemaVersion: 1,
        accessMode: "read_only",
        action: "query_data",
        resource: "tabular_files",
        explicitReadOnly: true,
      },
    },
  }, ACTOR_A).body.workItem;
  state.workItems[0].taskResourceRefs = [{
    id: "wrr_ledger", resourceId: "res_ledger", title: "客户台账",
    purpose: "change_target", locality: "local",
    capabilities: ["read", "query", "propose_change", "commit_change"],
  }];

  const conflict = service.confirmExecutionContractAndSchedule({
    workItemId: created.id,
    expectedRevision: created.revision,
  }, ACTOR_A);

  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "work_item_intent_conflict");
  assert.equal(conflict.body.clarification.code, "read_only_with_change_targets");
  assert.equal(conflict.body.intentContract.conflicts.length, 1);
  assert.equal(state.workItems[0].executionStartRequest, undefined);
});

test("a queued AI start can be cancelled without discarding its reviewed plan", () => {
  const { service } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a",
    title: "Prepare a cancellable start",
    acceptanceCriteria: ["The result is complete."],
    verificationSop: ["Review the result."],
  }, ACTOR_A).body.workItem;
  const prepared = service.prepareExecutionContract({
    workItemId: item.id,
    expectedRevision: item.revision,
    confirm: false,
  }, ACTOR_A).body.workItem;
  const confirmed = service.confirmExecutionContractAndSchedule({
    workItemId: item.id,
    expectedRevision: prepared.revision,
  }, ACTOR_A).body.workItem;

  const cancelled = service.cancelExecutionStart({
    workItemId: item.id,
    expectedRevision: confirmed.revision,
  }, ACTOR_A);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.workItem.executionStartReceipt.status, "cancelled");
  assert.equal(cancelled.body.workItem.executionPolicy, "paused");
  assert.equal(cancelled.body.workItem.waitingOn, "none");
  assert.deepEqual(cancelled.body.workItem.acceptanceCriteria, confirmed.acceptanceCriteria);
  assert.deepEqual(cancelled.body.workItem.verificationSop, confirmed.verificationSop);

  const replayed = service.cancelExecutionStart({
    workItemId: item.id,
    expectedRevision: confirmed.revision,
  }, ACTOR_A);
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.workItem.revision, cancelled.body.workItem.revision);
});

test("an intent-affecting context change after cancellation requires a fresh confirmation", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a",
    title: "更新客户台账",
    acceptanceCriteria: ["状态正确"],
    verificationSop: ["核对变更"],
  }, ACTOR_A).body.workItem;
  state.workItems[0].taskResourceRefs = [{
    id: "wrr_ledger", resourceId: "res_ledger", title: "客户台账",
    purpose: "query_source", locality: "local",
    capabilities: ["read", "query", "propose_change", "commit_change"],
    allowedPurposes: ["reference", "query_source", "change_target"],
  }];
  const confirmed = service.confirmExecutionContractAndSchedule({
    workItemId: item.id,
    expectedRevision: item.revision,
  }, ACTOR_A).body.workItem;
  const cancelled = service.cancelExecutionStart({
    workItemId: item.id,
    expectedRevision: confirmed.revision,
  }, ACTOR_A).body.workItem;
  const changed = service.updateTaskContext({
    workItemId: item.id,
    expectedRevision: cancelled.revision,
    materialRoles: [{ id: "wrr_ledger", role: "change_target" }],
  }, ACTOR_A).body.workItem;

  assert.equal(changed.executionContractGate.ready, false);
  assert.equal(changed.executionContractGate.intentChanged, true);
  assert.ok(changed.executionContractGate.missing.includes("intent_changed"));
  assert.equal(changed.intentContract.confirmationStale, true);

  const reconfirmed = service.confirmExecutionContractAndSchedule({
    workItemId: item.id,
    expectedRevision: changed.revision,
  }, ACTOR_A).body.workItem;
  assert.equal(reconfirmed.executionContractGate.ready, true);
  assert.equal(reconfirmed.intentContract.materials.changeTargets.length, 1);
  assert.notEqual(reconfirmed.intentContract.digest, confirmed.intentContract.digest);
});

test("AI start outcomes are durable, idempotent, and become started with the execution binding", () => {
  const { service } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a",
    title: "Track scheduler handoff",
    acceptanceCriteria: ["The handoff is visible."],
    verificationSop: ["Inspect the handoff."],
  }, ACTOR_A).body.workItem;
  const prepared = service.prepareExecutionContract({
    workItemId: item.id,
    expectedRevision: item.revision,
    confirm: false,
  }, ACTOR_A).body.workItem;
  const confirmed = service.confirmExecutionContractAndSchedule({
    workItemId: item.id,
    expectedRevision: prepared.revision,
  }, ACTOR_A).body.workItem;

  const blocked = service.recordExecutionStartOutcome({
    workItemId: item.id,
    status: "blocked",
    reasonCode: "repository_agent_unavailable",
    reasonDetail: "repository_agent_unavailable",
  }, ACTOR_A);
  assert.equal(blocked.body.workItem.executionStartReceipt.status, "blocked");
  assert.equal(blocked.body.workItem.executionStartReceipt.reasonCode, "repository_agent_unavailable");
  const replayed = service.recordExecutionStartOutcome({
    workItemId: item.id,
    status: "blocked",
    reasonCode: "repository_agent_unavailable",
    reasonDetail: "repository_agent_unavailable",
  }, ACTOR_A);
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.workItem.revision, blocked.body.workItem.revision);

  const rechecked = service.recheckExecutionStart({
    workItemId: item.id,
    expectedRevision: blocked.body.workItem.revision,
  }, ACTOR_A);
  assert.equal(rechecked.status, 200);
  assert.equal(rechecked.body.workItem.executionStartReceipt.status, "queued");
  assert.equal(rechecked.body.workItem.executionStartReceipt.reasonCode, "waiting_for_turn");

  const admission = service.beginExecution({ workItemId: item.id, kind: "auto_run", agentId: "agt_a" }, ACTOR_A);
  assert.equal(admission.body.workItem.executionStartReceipt.status, "starting");
  const bound = service.recordExecutionBinding({
    workItemId: item.id,
    kind: "auto_run",
    targetId: "aur_start_receipt",
    operationId: admission.body.operation.id,
  }, ACTOR_A);
  assert.equal(bound.status, 200);
  assert.equal(bound.body.workItem.executionStartReceipt.status, "blocked", "a missing execution target is surfaced honestly");
  assert.equal(bound.body.workItem.executionStartReceipt.targetId, "aur_start_receipt");
  assert.equal(bound.body.workItem.executionStartReceipt.canCancel, false);
  assert.ok(confirmed.executionStartReceipt.contractDigest);
});

test("AI start receipt reflects a changed execution policy and recheck resumes it", () => {
  const { service } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a",
    title: "Resume a start after settings changed",
    acceptanceCriteria: ["The handoff resumes."],
    verificationSop: ["Inspect the start receipt."],
  }, ACTOR_A).body.workItem;
  const prepared = service.prepareExecutionContract({
    workItemId: item.id,
    expectedRevision: item.revision,
    confirm: false,
  }, ACTOR_A).body.workItem;
  const confirmed = service.confirmExecutionContractAndSchedule({
    workItemId: item.id,
    expectedRevision: prepared.revision,
  }, ACTOR_A).body.workItem;
  const disabled = service.updateWorkItem({
    workItemId: item.id,
    expectedRevision: confirmed.revision,
    executionPolicy: "manual",
  }, ACTOR_A).body.workItem;

  assert.equal(disabled.executionStartReceipt.status, "blocked");
  assert.equal(disabled.executionStartReceipt.reasonCode, "automatic_execution_disabled");

  const rechecked = service.recheckExecutionStart({
    workItemId: item.id,
    expectedRevision: disabled.revision,
  }, ACTOR_A);
  assert.equal(rechecked.status, 200);
  assert.equal(rechecked.body.replayed, false);
  assert.equal(rechecked.body.workItem.executionPolicy, "auto");
  assert.equal(rechecked.body.workItem.executionStartReceipt.status, "queued");
  assert.equal(rechecked.body.workItem.executionStartReceipt.reasonCode, "waiting_for_turn");
});

test("AI start receipt resolves legacy office invocation binding ids", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a",
    title: "Track an office execution",
    acceptanceCriteria: ["The document is ready."],
    verificationSop: ["Open the document."],
  }, ACTOR_A).body.workItem;
  const prepared = service.prepareExecutionContract({
    workItemId: item.id,
    expectedRevision: item.revision,
    confirm: false,
  }, ACTOR_A).body.workItem;
  service.confirmExecutionContractAndSchedule({
    workItemId: item.id,
    expectedRevision: prepared.revision,
  }, ACTOR_A);
  const stored = state.workItems.find((candidate) => candidate.id === item.id);
  stored.executionBindings = [{
    kind: "application_invocation",
    id: "inv_legacy_office",
    terminalId: stored.terminalId,
    createdAt: "2026-08-27T03:00:00.000Z",
  }];
  state.invocations = [{ id: "inv_legacy_office", status: "running", agentId: "agt_office" }];

  const detail = service.getWorkItem({ workItemId: item.id }, ACTOR_A);
  assert.equal(detail.body.workItem.executionStartReceipt.status, "started");
  assert.equal(detail.body.workItem.executionStartReceipt.executionKind, "application_invocation");
  assert.equal(detail.body.workItem.executionStartReceipt.targetId, "inv_legacy_office");
  assert.equal(detail.body.workItem.executionStartReceipt.phase, "running");
});

test("AI handoff prefers a validated decision-agent execution-plan draft", () => {
  const { service } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a",
    title: "Use model-produced acceptance",
    body: "A configured decision agent has enough context to produce the execution basis.",
  }, ACTOR_A).body.workItem;
  const prepared = service.prepareExecutionContract({
    workItemId: item.id,
    expectedRevision: item.revision,
    draftOverride: {
      taskUnderstanding: "Make the behavior observable to the user.",
      acceptanceCriteria: ["The user can observe the new behavior."],
      verificationSop: ["Run the focused integration test."],
      risks: ["Existing clients may require compatibility coverage."],
      evidence: { generator: "decision_agent", modelVersion: "test-model" },
    },
  }, ACTOR_A);

  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.workItem.executionContractSource, "agent_assisted");
  assert.deepEqual(prepared.body.workItem.acceptanceCriteria, ["The user can observe the new behavior."]);
  assert.deepEqual(prepared.body.workItem.verificationSop, ["Run the focused integration test."]);
  assert.equal(prepared.body.draft.taskUnderstanding, "Make the behavior observable to the user.");
  assert.equal(prepared.body.draft.evidence.generator, "decision_agent");
});

test("a contract confirmed after a historical run cannot approve that older result", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Legacy result" }, ACTOR_A).body.workItem;
  state.autoRuns = [{ id: "aur_legacy", status: "done", createdAt: "2026-07-23T00:00:00.000Z" }];
  const bound = service.recordExecutionBinding({
    workItemId: item.id,
    kind: "auto_run",
    targetId: "aur_legacy",
    worktreeId: "wtr_legacy",
  }, ACTOR_A).body.workItem;
  const prepared = service.updateWorkItem({
    workItemId: item.id,
    expectedRevision: bound.revision,
    acceptanceCriteria: ["The legacy result matches the goal"],
    verificationSop: ["Review the legacy result"],
  }, ACTOR_A).body.workItem;
  assert.equal(prepared.executionContractGate.ready, false);
  assert.deepEqual(prepared.executionContractGate.missing, ["confirmed_before_execution"]);
});

test("detail only exposes run history after a failure or rerun", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Keep retry evidence" }, ACTOR_A).body.workItem;
  state.autoRuns = [{
    id: "aur_history", projectId: "prj_a", status: "done", invocationId: "inv_first",
    createdAt: "2026-07-24T00:01:00.000Z", updatedAt: "2026-07-24T00:02:00.000Z",
  }];
  state.workItems[0].executionBindings = [{
    kind: "auto_run", targetId: "aur_history", worktreeId: "wtr_history",
    createdAt: "2026-07-24T00:01:00.000Z",
  }];
  state.invocations = [{
    id: "inv_first", status: "succeeded", createdAt: "2026-07-24T00:01:00.000Z",
    completedAt: "2026-07-24T00:02:00.000Z",
    options: { metadata: { autoRunId: "aur_history" } },
    result: { summary: "Completed normally" },
  }];

  let detail = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body;
  assert.deepEqual(detail.observability.runHistory, []);

  state.invocations[0].status = "failed";
  state.invocations[0].result = { summary: "The first attempt failed", errorCode: "transport_closed" };
  detail = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body;
  assert.equal(detail.observability.runHistory.length, 1);
  assert.deepEqual(detail.observability.runHistory[0], {
    invocationId: "inv_first",
    autoRunId: "aur_history",
    attempt: 1,
    status: "failed",
    createdAt: "2026-07-24T00:01:00.000Z",
    startedAt: null,
    completedAt: "2026-07-24T00:02:00.000Z",
    errorCode: "transport_closed",
    summary: "The first attempt failed",
    verification: null,
    current: true,
  });

  state.autoRuns[0].status = "running";
  state.autoRuns[0].invocationId = "inv_retry";
  state.autoRuns[0].updatedAt = "2026-07-24T00:03:00.000Z";
  state.invocations.push({
    id: "inv_retry", status: "running", createdAt: "2026-07-24T00:03:00.000Z",
    startedAt: "2026-07-24T00:03:01.000Z",
    options: { metadata: { autoRunId: "aur_history" } },
  });
  state.invocationEvents = [{
    id: "evt_old", invocationId: "inv_first", type: "invocation_failed",
    createdAt: "2026-07-24T00:02:00.000Z", message: "First attempt failed", data: {},
  }];
  detail = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body;
  assert.deepEqual(detail.observability.runHistory.map((run) => ({
    invocationId: run.invocationId, attempt: run.attempt, current: run.current,
  })), [
    { invocationId: "inv_first", attempt: 1, current: false },
    { invocationId: "inv_retry", attempt: 2, current: true },
  ]);
  assert.ok(detail.observability.timeline.some((entry) => entry.id === "evt_old"));
});

test("detail exposes the readable delivery report and independent AI review", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Review timezone delivery" }, ACTOR_A).body.workItem;
  state.autoRuns = [{
    id: "aur_delivery_review",
    projectId: "prj_a",
    status: "done",
    invocationId: "inv_delivery",
    link: { type: "local_issue", number: item.localNumber },
    localDelivery: { worktreeId: "wtr_delivery", branchName: "local-timezone" },
    deliveryReport: {
      summary: "Propagated the terminal timezone.",
      verification: { passed: true, verified: true, summary: "Regression tests passed." },
      changedFiles: ["apps/server/src/routes/agents.mjs"],
      completedAt: "2026-07-24T00:02:00.000Z",
    },
    deliveryReview: {
      status: "completed",
      invocationId: "inv_delivery_review",
      verdict: "changes_requested",
      summary: "Persistence is missing.",
      findings: [],
    },
    updatedAt: "2026-07-24T00:02:00.000Z",
  }];
  state.workItems[0].executionBindings = [{
    kind: "auto_run", targetId: "aur_delivery_review", worktreeId: "wtr_delivery",
    createdAt: "2026-07-24T00:01:00.000Z",
  }];
  state.worktrees = [{ id: "wtr_delivery", branchName: "local-timezone" }];
  state.worktreeReviews = [{
    id: "wrv_ai",
    worktreeId: "wtr_delivery",
    verdict: "changes_requested",
    summary: "Persistence is missing.",
    comments: [{ path: "apps/server/src/routes/agents.mjs", line: 170, severity: "high", body: "Persist the changed timezone." }],
    reviewedCommit: "abc123",
    reviewedBy: "usr_autorun_review",
    source: "ai",
    reviewerName: "Codex",
    reviewInvocationId: "inv_delivery_review",
    createdAt: "2026-07-24T00:03:00.000Z",
  }];
  state.invocations = [
    { id: "inv_delivery", status: "succeeded", options: { metadata: { autoRunId: "aur_delivery_review" } } },
    { id: "inv_delivery_review", status: "succeeded", options: { metadata: { autoRunId: "aur_delivery_review", role: "delivery_review" } } },
  ];

  const detail = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.observability;
  assert.equal(detail.delivery.report.summary, "Propagated the terminal timezone.");
  assert.deepEqual(detail.delivery.report.changedFiles, ["apps/server/src/routes/agents.mjs"]);
  assert.equal(detail.delivery.aiReview.verdict, "changes_requested");
  assert.equal(detail.delivery.review.source, "ai");
  assert.equal(detail.delivery.review.reviewerName, "Codex");
  assert.equal(detail.delivery.review.comments[0].severity, "high");
  assert.equal(detail.deliveryEvidence.status, "changes_requested");
  assert.equal(detail.deliveryEvidence.review.findingCounts.high, 1);
  assert.equal(detail.deliveryEvidence.verification.status, "passed");
  assert.equal(detail.deliveryEvidence.actionPreview.canProceed, false);
  assert.deepEqual(detail.runHistory, [], "the independent review is not presented as another execution attempt");

  state.autoRuns[0].deliveryReview = { ...state.autoRuns[0].deliveryReview, status: "queued", verdict: null };
  state.invocations[1].status = "running";
  state.worktreeReviews = [];
  const running = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.observability;
  assert.equal(running.delivery.aiReview.status, "running", "an acknowledged review is no longer shown as merely queued");
});

test("detail reconciles the frozen plan with material, result, delivery, and verification receipts", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "更新客户台账" }, ACTOR_A).body.workItem;
  const intentContract = {
    goal: "更新客户台账",
    expectedOutput: "客户台账.xlsx",
    method: { kind: "template", definitionId: "rtd_customer", familyId: "family_customer", version: 2, name: "客户更新" },
    action: { accessMode: "write", operation: "update" },
    delivery: { destination: "task" },
    verificationSop: ["运行工作簿检查"],
  };
  const stored = state.workItems[0];
  stored.executionIntentContractSnapshot = intentContract;
  stored.taskContextControl = { deliveryDestination: "task" };
  stored.executionBindings = [{
    kind: "auto_run", targetId: "aur_plan_actual", worktreeId: "wtr_plan_actual",
    createdAt: "2026-07-24T00:01:00.000Z",
  }];
  state.autoRuns = [{
    id: "aur_plan_actual", projectId: "prj_a", status: "done", invocationId: "inv_plan_actual",
    link: { type: "local_issue", number: item.localNumber },
    executionContract: {
      intentContract,
      dataContextSnapshot: { digest: "context-v1", sourceCount: 1, sources: [{ name: "原始客户台账" }] },
    },
    inputMaterialization: {
      receipts: [{ referenceId: "wrr_customer", status: "ready" }],
      executionContextSnapshot: { declarationDigest: "context-v1" },
    },
    localDelivery: { worktreeId: "wtr_plan_actual", branchName: "customer-update" },
    deliveryReport: {
      summary: "已生成更新后的客户台账。",
      verification: { passed: true, verified: true, command: "pnpm check:workbook", exitCode: 0, summary: "工作簿检查通过。" },
      changedFiles: ["客户台账.xlsx"],
      completedAt: "2026-07-24T00:02:00.000Z",
    },
    deliveryReview: { status: "completed", verdict: "approved", structured: true, findings: [], summary: "结果符合范围。" },
    updatedAt: "2026-07-24T00:02:00.000Z",
  }];
  state.worktrees = [{ id: "wtr_plan_actual", projectId: "prj_a", branchName: "customer-update" }];
  state.invocations = [{
    id: "inv_plan_actual", status: "succeeded",
    options: { metadata: { autoRunId: "aur_plan_actual" } },
    completedAt: "2026-07-24T00:02:00.000Z",
  }];

  const observability = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.observability;
  const planActual = observability.planActual;

  assert.equal(planActual.status, "matched");
  assert.equal(planActual.planned.method.name, "客户更新");
  assert.equal(planActual.actual.materializedCount, 1);
  assert.deepEqual(planActual.actual.resultFiles, ["客户台账.xlsx"]);
  assert.equal(planActual.checks.every((check) => check.status === "matched"), true);
  assert.equal(observability.completionAssessment.status, "ready_to_complete");
  assert.equal(observability.completionAssessment.evidenceComplete, true);
  assert.equal(observability.journey.stage, "ready_to_complete");
  assert.equal(observability.journey.nextAction.kind, "review_result");

  stored.status = "done";
  stored.state = "closed";
  const completedObservability = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.observability;
  assert.equal(completedObservability.completionAssessment.status, "completed");
  assert.equal(completedObservability.completionAssessment.falseCompletion, false);
  assert.equal(completedObservability.journey.stage, "completed");
});

test("completion quality metrics use task truth and durable action receipts without counting normal sign-off", () => {
  const { service, state } = harness();
  const completed = service.createWorkItem({ projectId: "prj_a", title: "Verified manual result" }, ACTOR_A).body.workItem;
  const waiting = service.createWorkItem({ projectId: "prj_a", title: "Needs an exception decision" }, ACTOR_A).body.workItem;
  const completedRow = state.workItems.find((item) => item.id === completed.id);
  completedRow.status = "done";
  completedRow.state = "closed";
  const waitingRow = state.workItems.find((item) => item.id === waiting.id);
  waitingRow.channelOrigin = { channelId: "chn_metrics", conversationId: "cnv_metrics", threadId: "cth_metrics" };
  waitingRow.status = "in_progress";
  waitingRow.waitingOn = "me";
  waitingRow.executionBindings = [{ kind: "auto_run", targetId: "aur_metrics", createdAt: "2026-07-24T00:00:00.000Z" }];
  state.autoRuns = [{
    id: "aur_metrics", projectId: "prj_a", teamId: "team_a", status: "running",
    updatedAt: "2026-07-24T00:00:00.000Z",
    executionActionReceipts: [{
      id: "ear_metrics", status: "succeeded", externalActionAttemptCount: 1,
      deliveryCheckpoint: { operationId: "wdo_metrics" },
      deliveryRecovery: {
        requiredAt: "2026-07-24T00:00:00.000Z",
        attempts: 1,
        recoveredAt: "2026-07-24T00:01:00.000Z",
      },
    }],
  }];

  const result = service.getCompletionMetrics({ projectId: "prj_a" }, ACTOR_A);
  assert.equal(result.status, 200);
  assert.equal(result.body.scope.trackedWorkItems, 2);
  assert.equal(result.body.scope.origin, "all");
  assert.equal(result.body.metrics.completion.completionRate, 1);
  assert.equal(result.body.metrics.recovery.successRate, 1);
  assert.equal(result.body.metrics.humanIntervention.count, 1);
  assert.equal(result.body.metrics.externalActions.duplicateCount, 0);
  const channelOnly = service.getCompletionMetrics({ projectId: "prj_a", origin: "channel" }, ACTOR_A);
  assert.equal(channelOnly.body.scope.origin, "channel");
  assert.equal(channelOnly.body.scope.trackedWorkItems, 1);
  assert.equal(channelOnly.body.metrics.humanIntervention.count, 1);
  const taskOnly = service.getCompletionMetrics({ projectId: "prj_a", origin: "task" }, ACTOR_A);
  assert.equal(taskOnly.body.scope.trackedWorkItems, 1);
  assert.equal(service.getCompletionMetrics({ origin: "mail" }, ACTOR_A).status, 400);
  assert.equal(service.getCompletionMetrics({ projectId: "prj_b" }, ACTOR_A).status, 404);
});

test("plan/actual corrections are digest-bound, replay-safe, and do not rewrite task history", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "整理报价单" }, ACTOR_A).body.workItem;
  const stored = state.workItems[0];
  const intentContract = {
    goal: "整理报价单",
    expectedOutput: "报价单.xlsx",
    method: { kind: "template", definitionId: "rtd_quote", familyId: "family_quote", version: 2, name: "报价单" },
    action: { accessMode: "read_only", operation: "read" },
    delivery: { destination: "task" },
    verificationSop: ["检查报价单"],
  };
  stored.myTemplateBinding = { definitionId: "rtd_quote", familyId: "family_quote", version: 2 };
  stored.executionIntentContractSnapshot = intentContract;
  stored.taskContextControl = { deliveryDestination: "task" };
  stored.executionBindings = [{ kind: "auto_run", targetId: "aur_quote", createdAt: "2026-07-24T00:01:00.000Z" }];
  state.autoRuns = [{
    id: "aur_quote", projectId: "prj_a", status: "done", invocationId: "inv_quote",
    executionContract: { intentContract, dataContextSnapshot: { sourceCount: 0, sources: [] } },
    deliveryReport: {
      summary: "已生成报价结果。",
      verification: { passed: true, verified: true, command: "check quote", exitCode: 0 },
      changedFiles: ["报价单.csv"],
      completedAt: "2026-07-24T00:02:00.000Z",
    },
    updatedAt: "2026-07-24T00:02:00.000Z",
  }];
  state.invocations = [{ id: "inv_quote", status: "succeeded", options: { metadata: { autoRunId: "aur_quote" } } }];
  const beforeRevision = stored.revision;
  const planActual = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.observability.planActual;
  assert.equal(planActual.status, "attention");

  const recorded = service.recordPlanActualFeedback({
    workItemId: item.id,
    expectedPlanActualDigest: planActual.digest,
    decisions: [{ code: "output_format_mismatch", resolution: "keep_plan" }],
    note: "以后仍需 Excel 报价单",
  }, ACTOR_A);

  assert.equal(recorded.status, 201);
  assert.equal(recorded.body.feedback.decisions[0].preferredValue, "报价单.xlsx");
  assert.equal(state.workItemPlanActualFeedback[0].template.familyId, "family_quote");
  assert.equal(stored.revision, beforeRevision, "feedback does not rewrite or revise the completed task");
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.observability.planActual.feedback.id, recorded.body.feedback.id);
  const futureDraft = service.suggestWorkItemDraft({
    projectId: "prj_a", title: "再次整理报价单", body: "沿用之前的报价要求。",
  }, ACTOR_A).body.draft;
  assert.deepEqual(futureDraft.preferenceHints, [{
    kind: "template", preference: "报价单.xlsx", resolution: "keep_plan",
    requiresConfirmation: false, learnedFrom: "plan_actual_correction",
  }]);
  assert.match(futureDraft.risks.join(" "), /结果类型/);

  const replay = service.recordPlanActualFeedback({
    workItemId: item.id,
    expectedPlanActualDigest: planActual.digest,
    decisions: [{ code: "output_format_mismatch", resolution: "keep_plan" }],
    note: "以后仍需 Excel 报价单",
  }, ACTOR_A);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(state.workItemPlanActualFeedback.length, 1);

  const listed = service.listPlanActualFeedback({ projectId: "prj_a" }, ACTOR_A);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.count, 1);
  assert.equal(listed.body.feedback[0].editable, true);
  assert.equal(listed.body.feedback[0].workItem.localRef, item.localRef);
  assert.deepEqual(listed.body.feedback[0].decisions[0].options, [
    { resolution: "keep_plan", preferredValue: "报价单.xlsx" },
    { resolution: "prefer_actual", preferredValue: "报价单.csv" },
  ]);
  assert.equal(service.listPlanActualFeedback({ projectId: "prj_a" }, ACTOR_B).status, 404);

  const updated = service.recordPlanActualFeedback({
    workItemId: item.id,
    expectedPlanActualDigest: planActual.digest,
    expectedFeedbackRevision: recorded.body.feedback.revision,
    decisions: [{ code: "output_format_mismatch", resolution: "prefer_actual" }],
    note: "以后接受 CSV 报价结果",
  }, ACTOR_A);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.feedback.revision, 2);
  assert.equal(updated.body.feedback.decisions[0].preferredValue, "报价单.csv");
  assert.equal(service.recordPlanActualFeedback({
    workItemId: item.id,
    expectedPlanActualDigest: planActual.digest,
    expectedFeedbackRevision: 1,
    decisions: [{ code: "output_format_mismatch", resolution: "keep_plan" }],
  }, ACTOR_A).body.error, "plan_actual_feedback_changed");

  const stale = service.recordPlanActualFeedback({
    workItemId: item.id,
    expectedPlanActualDigest: "a".repeat(64),
    decisions: [{ code: "output_format_mismatch", resolution: "keep_plan" }],
  }, ACTOR_A);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "plan_actual_changed");
  assert.equal(service.recordPlanActualFeedback({
    workItemId: item.id,
    expectedPlanActualDigest: planActual.digest,
    decisions: [{ code: "output_format_mismatch", resolution: "keep_plan" }],
  }, ACTOR_B).status, 404);
  assert.equal(service.removePlanActualFeedback({ feedbackId: recorded.body.feedback.id }, ACTOR_B).status, 404);
  const removed = service.removePlanActualFeedback({ feedbackId: recorded.body.feedback.id }, ACTOR_A);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.affectsFutureMatchesOnly, true);
  assert.equal(service.listPlanActualFeedback({}, ACTOR_A).body.count, 0);
  assert.equal(stored.revision, beforeRevision, "managing the preference still does not revise task history");
});

test("detail projects the current Ledger batch instead of a stale channel snapshot", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "更新客户台账", taskKind: "business_spreadsheet" }, ACTOR_A).body.workItem;
  const storedItem = state.workItems[0];
  storedItem.channelTaskContract = {
    goal: "更新客户台账",
    dataMutationPreview: { operation: "update", estimatedAffectedRows: 2, requiredFields: ["status"] },
    ledgerMutationPreview: { kind: "batch", id: "lbp_live", state: "pending", revision: 1, children: [] },
  };
  storedItem.executionBindings = [{ kind: "auto_run", targetId: "aur_office", worktreeId: "wtr_office", createdAt: "2026-07-24T00:01:00.000Z" }];
  state.autoRuns = [{
    id: "aur_office", projectId: "prj_a", status: "done", invocationId: "inv_office",
    link: { type: "local_issue", number: item.localNumber },
    decision: { path: "office", workKind: "office" },
    localDelivery: { worktreeId: "wtr_office", branchName: "office-ledger" },
    deliveryReport: { summary: "Prepared ledger update.", verification: { passed: true, verified: true, summary: "Workbook validated." }, changedFiles: ["客户台账.xlsx"] },
    deliveryReview: { status: "completed", verdict: "approved", summary: "Result structure is valid.", findings: [] },
    updatedAt: "2026-07-24T00:02:00.000Z",
  }];
  state.worktrees = [{ id: "wtr_office", projectId: "prj_a", branchName: "office-ledger" }];
  state.ledgerBatchUpsertPreviews = [{
    id: "lbp_live", ownerTeamId: "team_a", projectId: "prj_a", state: "partial", revision: 4,
    childPreviewIds: ["lup_1", "lup_2", "lup_missing"], targetCount: 3, operationCount: 3,
  }];
  state.ledgerUpsertPreviews = [
    { id: "lup_1", ownerTeamId: "team_a", projectId: "prj_a", state: "rolled_back", businessKey: "CUS-001", action: "update", changedCells: [{ field: "status" }] },
    { id: "lup_2", ownerTeamId: "team_a", projectId: "prj_a", state: "invalidated", businessKey: "CUS-002", action: "update", changedCells: [{ field: "status" }] },
  ];
  state.ledgerBatchMutationJournals = [{
    id: "lbj_live", batchPreviewId: "lbp_live", ownerTeamId: "team_a", projectId: "prj_a", status: "partial",
    appliedPreviewIds: ["lup_1"], snapshots: [{ restored: true }, { restored: false, blockedReason: "target_changed" }],
    rollback: { restoredTargets: 1, blockedTargets: 1 }, updatedAt: "2026-07-24T00:03:00.000Z",
  }];

  const evidence = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.observability.deliveryEvidence;
  assert.equal(evidence.status, "office_batch_attention");
  assert.equal(evidence.actionPreview.officeDetails.batch.state, "partial");
  assert.equal(evidence.actionPreview.officeDetails.batch.successCount, 0);
  assert.equal(evidence.actionPreview.officeDetails.batch.restoredCount, 1);
  assert.equal(evidence.actionPreview.officeDetails.batch.failedCount, 1);
  assert.equal(evidence.actionPreview.officeDetails.batch.unknownCount, 1);
  assert.equal(evidence.actionPreview.officeDetails.batch.details[1].businessKey, "CUS-002");
  assert.equal(evidence.actionPreview.officeDetails.batch.details[2].state, "unknown");

  state.autoRuns[0].localDelivery.deliveredAt = "2026-07-24T00:04:00.000Z";
  state.ledgerBatchUpsertPreviews[0] = {
    ...state.ledgerBatchUpsertPreviews[0],
    state: "rolled_back",
    childPreviewIds: ["lup_1", "lup_2"],
    targetCount: 2,
    operationCount: 2,
  };
  state.ledgerUpsertPreviews = state.ledgerUpsertPreviews.map((preview) => ({ ...preview, state: "rolled_back" }));
  state.ledgerBatchMutationJournals[0].rollback = { restoredTargets: 2, blockedTargets: 0 };
  const rolledBack = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.observability;
  assert.equal(rolledBack.delivery, null, "an applied office batch is no longer waiting for delivery review");
  assert.equal(rolledBack.deliveryEvidence.status, "office_batch_rolled_back");
  assert.equal(rolledBack.executionReview.impact.status, "rolled_back");
  assert.ok(rolledBack.executionReview.riskReasons.some((reason) => reason.code === "office_batch_rolled_back"));
});

test("AI issue assistance returns an editable draft without creating work", () => {
  const { service, state } = harness();
  const result = service.suggestWorkItemDraft({
    projectId: "prj_a",
    title: "Fix login crash",
    body: "Users cannot sign in after upgrading.",
  }, ACTOR_A);
  assert.equal(result.status, 200);
  assert.equal(result.body.draft.type, "bug");
  assert.equal(result.body.draft.suggestedRoute, "clarify");
  assert.ok(result.body.draft.acceptanceCriteria.length >= 2);
  assert.equal(state.workItems.length, 0);
  assert.equal(service.suggestWorkItemDraft({
    projectId: "prj_b", title: "Foreign", body: "",
  }, ACTOR_A).status, 404);
});

test("channel task contracts are normalized, traceable, and fail closed", () => {
  const { service, state, events } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "帮我整理客户报价",
    body: "根据客户询价资料生成报价单。",
    channelTaskContract: {
      source: "channel",
      domain: "office",
      riskLevel: "external_communication",
      goal: "根据客户资料生成报价单",
      outputExpectation: "报价单.xlsx",
      dataSources: [{ kind: "channel_attachment", id: "asset_1", name: "询价.pdf", version: "v2", hash: "sha256:1" }],
      templateMatch: {
        state: "matched",
        decision: "auto_apply",
        definitionId: "rtd_quote",
        familyId: "family_quote",
        version: 3,
        reasons: ["期望结果匹配"],
      },
      workMode: {
        schemaVersion: 1,
        state: "matched",
        source: "my_template",
        name: "客户报价",
        version: 3,
        confidence: "high",
        goal: "根据客户资料生成报价单",
        expectedOutput: "报价单.xlsx",
        data: { status: "not_required", requirements: [], sources: [], relations: [], relationStatus: "not_required" },
        mutation: { required: false, status: "not_required", targetCount: 0 },
        confirmationRequired: true,
        trace: { templateDefinitionId: "rtd_quote", templateFamilyId: "family_quote", templateVersion: 3, dataPlanDigest: "plan-digest-1" },
        candidates: [],
        digest: "work-mode-digest-1",
      },
      executionPreview: {
        action: "对外发送或发布",
        target: "客户",
        targetStatus: "inferred",
        impact: "可能向外部对象发送或发布内容",
        unknownFields: ["最终发送内容和附件"],
        inputs: [{ name: "询价.pdf", family: "pdf" }],
        digest: "preview-digest-1",
      },
      dataRelationPreview: {
        status: "ready",
        relations: [{
          id: "rel_customer_order",
          state: "ready",
          fromRequirementId: "customers",
          fromField: "customer_id",
          toRequirementId: "orders",
          toField: "customer_id",
          matchedRows: 3,
          unmatchedRows: 0,
        }],
        digest: "relation-digest-1",
      },
      dataRelationConfirmation: {
        id: "drc_1",
        status: "verified",
        confirmationMode: "user_confirmation",
        planDigest: "plan-digest-1",
        relationDigest: "relation-digest-1",
        objectSnapshotCount: 3,
        confirmedAt: "2026-08-17T00:00:01.000Z",
        confirmedBy: "usr_local",
      },
      generatedAt: "2026-08-17T00:00:00.000Z",
    },
  }, ACTOR_A);

  assert.equal(created.status, 201);
  assert.equal(created.body.workItem.channelTaskContract.domain, "office");
  assert.equal(created.body.workItem.channelTaskContract.riskLevel, "external_communication");
  assert.equal(created.body.workItem.channelTaskContract.dataSources[0].name, "询价.pdf");
  assert.equal(created.body.workItem.channelTaskContract.workMode.name, "客户报价");
  assert.equal(created.body.workItem.channelTaskContract.workMode.trace.dataPlanDigest, "plan-digest-1");
  assert.equal(created.body.workItem.channelTaskContract.executionPreview.target, "客户");
  assert.equal(created.body.workItem.channelTaskContract.executionPreview.digest, "preview-digest-1");
  assert.equal(created.body.workItem.channelTaskContract.dataRelationConfirmation.status, "verified");
  assert.equal(created.body.workItem.channelTaskContract.dataRelationConfirmation.confirmationMode, "user_confirmation");
  assert.equal(created.body.workItem.channelTaskContract.dataRelationConfirmation.objectSnapshotCount, 3);
  assert.equal(state.workItemActivities[0].details.channelTaskContract.dataSourceCount, 1);
  assert.equal(events.at(-1).data.channelTaskContract.templateMatchState, "matched");

  const invalidDomain = service.createWorkItem({
    projectId: "prj_a",
    title: "不应创建",
    channelTaskContract: { domain: "unknown" },
  }, ACTOR_A);
  assert.equal(invalidDomain.status, 400);
  assert.equal(invalidDomain.body.error, "invalid_channel_task_domain");

  const invalidRisk = service.createWorkItem({
    projectId: "prj_a",
    title: "不应创建",
    channelTaskContract: { riskLevel: "unknown" },
  }, ACTOR_A);
  assert.equal(invalidRisk.status, 400);
  assert.equal(invalidRisk.body.error, "invalid_channel_task_risk_level");
});

test("data context snapshots expose source versions and require confirmation after drift", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "根据资料整理结果",
    inputAssets: [{
      id: "asset_quote",
      path: "inbox/quote.pdf",
      terminalId: "dev_local",
      family: "file",
      hash: "sha256:quote-v1",
      version: "v1",
    }],
  }, ACTOR_A);
  assert.equal(created.status, 201);
  const item = created.body.workItem;
  assert.equal(item.dataContext.status, "current");
  assert.equal(item.dataContext.snapshot.sources[0].version, "v1");
  assert.equal(item.dataContext.snapshot.sources[0].origin, "work_item_input");

  const changed = service.updateWorkItem({
    workItemId: item.id,
    expectedRevision: item.revision,
    inputAssets: [{
      id: "asset_quote",
      path: "inbox/quote.pdf",
      terminalId: "dev_local",
      family: "file",
      hash: "sha256:quote-v2",
      version: "v2",
    }],
  }, ACTOR_A);
  assert.equal(changed.status, 200);
  assert.equal(changed.body.workItem.dataContext.status, "stale");
  assert.equal(changed.body.workItem.dataContext.requiresConfirmation, true);
  assert.equal(changed.body.workItem.dataContext.changes[0].kind, "changed");

  const refused = service.captureDataContextSnapshot({
    workItemId: item.id,
    expectedRevision: changed.body.workItem.revision,
  }, ACTOR_A);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "data_context_confirmation_required");

  const refreshed = service.captureDataContextSnapshot({
    workItemId: item.id,
    expectedRevision: changed.body.workItem.revision,
    confirm: true,
  }, ACTOR_A);
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.refreshed, true);
  assert.equal(refreshed.body.workItem.dataContext.status, "current");
  assert.equal(refreshed.body.workItem.dataContext.snapshot.sources[0].version, "v2");
  assert.equal(state.workItems[0].dataContextSnapshotHistory.length, 1);
});

test("AI issue assistance uses attached business documents to select a template and draft business acceptance", () => {
  const { service, state } = harness({
    inspectTaskMaterialDraft: () => ({
      status: 200,
      body: { draft: {
        id: "draft_device", projectId: "prj_a", revision: 2,
        assets: [{ originalName: "气体腐蚀试验箱设备技术协议.pdf", mimeType: "application/pdf", hash: "sha256:device" }],
      } },
    }),
  });
  state.routineDefinitions = [{
    id: "rtd_device", familyId: "family_device", projectId: "managed_templates", ownerTeamId: "team_a",
    templateScope: "team", state: "published", version: 2, name: "设备技术协议生成采购清单",
    description: "根据设备技术协议生成采购清单", triggerDocumentTypes: ["other_reference"],
    templateContract: {
      inputFormats: ["pdf"], outputFileName: "采购清单.xlsx",
      outputColumns: ["序号", "产品名称", "规格型号", "数量"],
      uncertainFields: ["报价单价", "报价总价"],
    },
    steps: [
      { kind: "extract", label: "读取设备技术协议 PDF", configuration: { inputSummary: "设备技术协议 PDF" } },
      { kind: "generate", label: "生成采购清单 Excel", configuration: { expectedOutput: "采购清单 Excel" } },
    ],
  }];

  const result = service.suggestWorkItemDraft({
    projectId: "prj_a", title: "帮我把这个设备协议整理成采购表",
    materialDraftId: "draft_device", materialDraftRevision: 2,
  }, ACTOR_A);

  assert.equal(result.status, 200);
  assert.equal(result.body.draft.templateMatch.state, "matched");
  assert.equal(result.body.draft.templateMatch.selected.definitionId, "rtd_device");
  assert.match(result.body.draft.templateMatch.selected.reasons.join(" "), /PDF/);
  assert.deepEqual(result.body.draft.acceptanceCriteria, [
    "生成并可正常打开采购清单.xlsx",
    "结果保留模版约定的 4 个字段，字段名称和顺序一致",
    "输入材料中能够确认的信息已准确写入结果",
    "报价单价、报价总价无法确认时保持空白，不得猜测",
  ]);
  assert.doesNotMatch(result.body.draft.verificationSop.join(" "), /代码|Pull Request|类型检查/);
});

test("learned template routing prioritizes the requested result and refuses weak matches", () => {
  const quotation = {
    id: "rtd_quote", familyId: "family_quote", projectId: "prj_a", state: "published", version: 2,
    name: "客户询价报价", description: "根据客户询价生成报价单", triggerDocumentTypes: ["inquiry"],
    steps: [{ kind: "generate", label: "生成报价单", configuration: { output: "报价单 Excel" } }],
  };
  const summary = {
    id: "rtd_summary", familyId: "family_summary", projectId: "prj_a", state: "published", version: 1,
    name: "询价汇总", description: "整理询价内容", triggerDocumentTypes: ["inquiry"],
    steps: [{ kind: "generate", label: "生成询价汇总表", configuration: { output: "询价汇总表" } }],
  };
  const matched = matchPublishedMyTemplate({
    definitions: [quotation, summary],
    projectId: "prj_a",
    intent: "根据客户询价生成报价单 Excel",
  });
  assert.equal(matched.state, "matched");
  assert.deepEqual(matched.decision, { kind: "auto_apply", confidence: "high", reason: "explicit_result_match" });
  assert.equal(matched.selected.definitionId, "rtd_quote");
  assert.match(matched.selected.reasons.join(" "), /期望结果/);

  const correctedPlanMatch = matchPublishedMyTemplate({
    definitions: [quotation, summary],
    projectId: "prj_a",
    intent: "处理客户询价",
    planActualFeedback: [{
      intentTerms: ["询价"],
      template: { familyId: "family_quote" },
      decisions: [{ correctionTarget: "template", resolution: "keep_plan" }],
    }],
  });
  assert.equal(correctedPlanMatch.state, "matched");
  assert.equal(correctedPlanMatch.selected.definitionId, "rtd_quote");
  assert.match(correctedPlanMatch.selected.reasons.join(" "), /参考了你之前对相似任务的纠正/);

  const changedResultRequiresConfirmation = matchPublishedMyTemplate({
    definitions: [quotation, summary],
    projectId: "prj_a",
    intent: "处理客户询价",
    planActualFeedback: [{
      intentTerms: ["询价"],
      template: { familyId: "family_quote" },
      decisions: [{ correctionTarget: "template", resolution: "prefer_actual" }],
    }],
  });
  assert.equal(changedResultRequiresConfirmation.state, "ambiguous");
  assert.equal(changedResultRequiresConfirmation.selected, null);
  assert.equal(changedResultRequiresConfirmation.decision.reason, "learned_preference_conflict");

  const deviceChecklist = {
    id: "rtd_device_checklist", familyId: "family_device_checklist", projectId: "prj_a",
    templateScope: "team", state: "published", version: 1,
    name: "设备技术协议生成采购清单", description: "收到：设备技术协议 PDF\n得到：采购清单 Excel",
    triggerDocumentTypes: ["other_reference"],
    templateContract: { inputFormats: ["pdf"] },
    steps: [
      { kind: "extract", label: "读取设备技术协议 PDF", configuration: { inputSummary: "设备技术协议 PDF" } },
      { kind: "generate", label: "生成采购清单 Excel", configuration: { expectedOutput: "采购清单 Excel" } },
    ],
  };
  const dominantMatchIgnoresIncidentalOutputWords = matchPublishedMyTemplate({
    definitions: [deviceChecklist, quotation],
    projectId: "prj_a",
    intent: "根据设备技术协议生成采购清单 Excel，报价单价和报价总价无法确认时留空，不要猜测。",
  });
  assert.equal(dominantMatchIgnoresIncidentalOutputWords.state, "matched");
  assert.equal(dominantMatchIgnoresIncidentalOutputWords.selected.definitionId, "rtd_device_checklist");
  assert.equal(dominantMatchIgnoresIncidentalOutputWords.decision.reason, "strong_template_match");

  const naturalBusinessPhrase = matchPublishedMyTemplate({
    definitions: [deviceChecklist, quotation],
    projectId: "prj_a",
    intent: "帮我把这个设备协议整理成采购表",
    attachments: [{ originalName: "气体腐蚀试验箱.pdf", mimeType: "application/pdf" }],
  });
  assert.equal(naturalBusinessPhrase.state, "matched");
  assert.equal(naturalBusinessPhrase.selected.definitionId, "rtd_device_checklist");
  assert.equal(naturalBusinessPhrase.decision.confidence, "high");
  assert.match(naturalBusinessPhrase.selected.reasons.join(" "), /PDF/);

  const teamScoped = matchPublishedMyTemplate({
    definitions: [{ ...quotation, projectId: "managed_template_project", templateScope: "team" }],
    projectId: "prj_a",
    intent: "根据客户询价生成报价单 Excel",
  });
  assert.equal(teamScoped.state, "matched");
  assert.equal(teamScoped.selected.definitionId, "rtd_quote");

  const legacySingleCaseTemplate = matchPublishedMyTemplate({
    definitions: [{ ...quotation, templateScope: "team", templateMaturity: "trial" }],
    projectId: "prj_a",
    intent: "根据客户询价生成报价单 Excel",
  });
  assert.equal(legacySingleCaseTemplate.state, "matched", "one confirmed case can auto-match without a trial gate");
  assert.equal(legacySingleCaseTemplate.decision.kind, "auto_apply");

  const crossLanguage = matchPublishedMyTemplate({
    definitions: [{
      ...quotation,
      name: "Inquiry to quotation",
      steps: [{ key: "quotation_generation", kind: "generate", label: "Prepare quotation", configuration: {} }],
    }],
    projectId: "prj_a",
    intent: "根据客户询价生成报价单",
  });
  assert.equal(crossLanguage.state, "matched");
  assert.equal(crossLanguage.selected.definitionId, "rtd_quote");
  assert.match(crossLanguage.selected.reasons.join(" "), /期望结果/);

  const ambiguous = matchPublishedMyTemplate({
    definitions: [quotation, summary],
    projectId: "prj_a",
    intent: "根据询价生成报价单 Excel 或询价汇总表",
  });
  assert.equal(ambiguous.state, "ambiguous");
  assert.equal(ambiguous.selected, null);
  assert.equal(ambiguous.clarification.kind, "desired_output");
  assert.deepEqual(new Set(ambiguous.clarification.options.map((option) => option.label)), new Set(["报价单 Excel", "询价汇总表"]));

  const learnedConflict = matchPublishedMyTemplate({
    definitions: [quotation, summary],
    routingFeedback: [
      { intentTerms: ["询价"], selectedFamilyId: "family_quote", selectedOutput: "报价单 Excel" },
      { intentTerms: ["询价"], selectedFamilyId: "family_summary", selectedOutput: "询价汇总表" },
    ],
    projectId: "prj_a",
    intent: "处理这份客户询价",
  });
  assert.equal(learnedConflict.state, "ambiguous");
  assert.deepEqual(learnedConflict.decision, {
    kind: "confirm_output", confidence: "low", reason: "learned_preference_conflict",
  });
  assert.equal(learnedConflict.clarification.reason, "learned_preference_conflict");
  assert.match(learnedConflict.clarification.message, /以前.*不同结果/);
  assert.deepEqual(new Set(learnedConflict.clarification.learnedChoices.map((choice) => choice.label)),
    new Set(["报价单 Excel", "询价汇总表"]));

  const confirmedConflictChoice = matchPublishedMyTemplate({
    definitions: [quotation, summary],
    routingFeedback: [
      { intentTerms: ["询价"], selectedFamilyId: "family_quote", rejectedFamilyId: "family_summary", selectedOutput: "报价单 Excel" },
      { intentTerms: ["询价"], selectedFamilyId: "family_summary", rejectedFamilyId: "family_quote", selectedOutput: "询价汇总表" },
      { kind: "confirmation", intentTerms: ["询价"], selectedFamilyId: "family_quote", rejectedFamilyId: null, selectedOutput: "报价单 Excel" },
    ],
    projectId: "prj_a",
    intent: "处理这份客户询价",
  });
  assert.equal(confirmedConflictChoice.state, "matched");
  assert.equal(confirmedConflictChoice.selected.definitionId, "rtd_quote");
  assert.equal(confirmedConflictChoice.decision.reason, "consistent_learned_preference");

  const explicitWinsOverLearningConflict = matchPublishedMyTemplate({
    definitions: [quotation, summary],
    routingFeedback: [
      { intentTerms: ["询价"], selectedFamilyId: "family_quote", selectedOutput: "报价单 Excel" },
      { intentTerms: ["询价"], selectedFamilyId: "family_summary", selectedOutput: "询价汇总表" },
    ],
    projectId: "prj_a",
    intent: "处理客户询价并生成报价单 Excel",
  });
  assert.equal(explicitWinsOverLearningConflict.state, "matched");
  assert.equal(explicitWinsOverLearningConflict.selected.definitionId, "rtd_quote");
  assert.equal(explicitWinsOverLearningConflict.decision.reason, "explicit_result_match");

  const sameResult = matchPublishedMyTemplate({
    definitions: [quotation, { ...quotation, id: "rtd_quote_backup", familyId: "family_quote_backup", name: "备用报价流程" }],
    projectId: "prj_a",
    intent: "根据客户询价生成报价单 Excel",
  });
  assert.equal(sameResult.state, "matched", "users are not asked to distinguish templates that produce the same result");

  const contractMatched = matchPublishedMyTemplate({
    definitions: [{
      id: "rtd_purchase_list",
      familyId: "family_purchase_list",
      projectId: "managed_template_project",
      templateScope: "team",
      state: "published",
      version: 1,
      name: "设备技术协议生成采购清单",
      description: "收到：设备技术协议 PDF\n得到：采购清单 Excel",
      triggerDocumentTypes: ["other_reference"],
      steps: [
        { kind: "extract", label: "读取并理解设备技术协议 PDF", configuration: { inputSummary: "设备技术协议 PDF" } },
        { kind: "generate", label: "生成采购清单 Excel", configuration: { expectedOutput: "采购清单 Excel" } },
      ],
    }],
    projectId: "prj_a",
    intent: "请根据这两份设备技术协议生成采购清单",
  });
  assert.equal(contractMatched.state, "matched");
  assert.equal(contractMatched.selected.definitionId, "rtd_purchase_list");
  assert.match(contractMatched.selected.reasons.join(" "), /输入材料/);

  const missing = matchPublishedMyTemplate({
    definitions: [quotation, summary],
    projectId: "prj_a",
    intent: "帮我处理一下这个文件",
  });
  assert.equal(missing.state, "missing");
  assert.deepEqual(missing.decision, { kind: "no_match", confidence: "low", reason: "insufficient_evidence" });
});

test("result feedback conservatively governs template matching and can recover", () => {
  const rows = (outcomes) => outcomes.map((outcome, index) => ({
    familyId: "family_quote", outcome, updatedAt: `2026-08-11T00:0${index}:00.000Z`,
  }));
  const oneWrong = evaluateMyTemplateGovernance({
    familyId: "family_quote", outcomeFeedback: rows(["wrong_result"]),
  });
  assert.equal(oneWrong.state, "learning", "one bad result never penalizes or pauses a template");
  assert.equal(oneWrong.autoMatchAllowed, true);

  const qualityOnly = evaluateMyTemplateGovernance({
    familyId: "family_quote", outcomeFeedback: rows(["needs_quality_adjustment", "needs_quality_adjustment", "needs_quality_adjustment"]),
  });
  assert.equal(qualityOnly.matchingFeedbackCount, 0, "content quality is not a routing failure");
  assert.equal(qualityOnly.state, "learning");

  const watchFeedback = rows(["wrong_result", "met_expectations", "wrong_result"]);
  const watch = evaluateMyTemplateGovernance({ familyId: "family_quote", outcomeFeedback: watchFeedback });
  assert.equal(watch.state, "watch");
  assert.equal(watch.scoreAdjustment, -3);
  assert.equal(watch.requiresConfirmation, true);

  const definition = {
    id: "rtd_quote", familyId: "family_quote", projectId: "prj_a", state: "published", version: 2,
    name: "客户询价报价", description: "根据客户询价生成报价单", triggerDocumentTypes: ["inquiry"],
    steps: [{ kind: "generate", label: "生成报价单", configuration: { output: "报价单 Excel" } }],
  };
  const watchedMatch = matchPublishedMyTemplate({
    definitions: [definition], outcomeFeedback: watchFeedback, projectId: "prj_a", intent: "根据询价生成报价单 Excel",
  });
  assert.equal(watchedMatch.state, "ambiguous");
  assert.equal(watchedMatch.decision.reason, "outcome_feedback_watch");
  assert.equal(watchedMatch.candidates[0].governance.state, "watch");

  const pausedFeedback = rows(["wrong_result", "met_expectations", "wrong_result", "met_expectations", "wrong_result"]);
  const pausedMatch = matchPublishedMyTemplate({
    definitions: [definition], outcomeFeedback: pausedFeedback, projectId: "prj_a", intent: "根据询价生成报价单 Excel",
  });
  assert.equal(pausedMatch.state, "ambiguous", "a paused automatic match remains available for explicit use");
  assert.equal(pausedMatch.decision.reason, "outcome_feedback_paused");
  assert.equal(pausedMatch.candidates[0].governance.autoMatchAllowed, false);

  const recovered = evaluateMyTemplateGovernance({
    familyId: "family_quote",
    outcomeFeedback: rows(["wrong_result", "wrong_result", "wrong_result", ...Array(5).fill("met_expectations")]),
  });
  assert.equal(recovered.autoMatchAllowed, true);
  assert.equal(recovered.requiresConfirmation, false);

  const intervention = {
    id: "mtgi_resume", familyId: "family_quote", action: "resume_observation",
    feedbackIds: pausedFeedback.map((entry, index) => ({ ...entry, id: `feedback_${index}` })).map((entry) => entry.id),
    reason: "user_reviewed_governance_details", createdAt: "2026-08-11T01:00:00.000Z", createdBy: "usr_a",
  };
  const identifiablePausedFeedback = pausedFeedback.map((entry, index) => ({ ...entry, id: `feedback_${index}` }));
  const manuallyResumed = evaluateMyTemplateGovernance({
    familyId: "family_quote", outcomeFeedback: identifiablePausedFeedback, interventions: [intervention],
  });
  assert.equal(manuallyResumed.state, "watch");
  assert.equal(manuallyResumed.manualObservation, true);
  assert.equal(manuallyResumed.historicalFeedbackCount, 5);
  assert.equal(manuallyResumed.matchingFeedbackCount, 0);
  const resumedMatch = matchPublishedMyTemplate({
    definitions: [definition], outcomeFeedback: identifiablePausedFeedback,
    governanceInterventions: [intervention], projectId: "prj_a", intent: "根据询价生成报价单 Excel",
  });
  assert.equal(resumedMatch.state, "ambiguous", "manual observation requires confirmation before using the template again");
  assert.equal(resumedMatch.decision.reason, "manual_resume_observation");
  const repeatedFailure = evaluateMyTemplateGovernance({
    familyId: "family_quote",
    outcomeFeedback: [
      ...identifiablePausedFeedback,
      ...rows(["wrong_result", "met_expectations", "wrong_result", "met_expectations", "wrong_result"])
        .map((entry, index) => ({ ...entry, id: `new_feedback_${index}` })),
    ],
    interventions: [intervention],
  });
  assert.equal(repeatedFailure.state, "paused", "new failures can trigger governance again after a manual reset");
});

test("a new local Issue automatically pins a strong template match without a client-side template choice", () => {
  const { service, state } = harness();
  state.routineDefinitions = [{
    id: "rtd_quote", familyId: "family_quote", projectId: "prj_a", ownerTeamId: "team_a",
    state: "published", version: 3, name: "客户询价报价", description: "根据询价生成报价单",
    triggerDocumentTypes: ["inquiry"],
    steps: [{ key: "output", kind: "generate", label: "生成报价单", required: true,
      configuration: { output: "报价单 Excel" } }],
  }];

  const result = service.createWorkItem({
    projectId: "prj_a",
    title: "根据客户询价生成报价单 Excel",
    body: "使用客户发来的询价资料，最后交付报价单。",
  }, ACTOR_A);

  assert.equal(result.status, 201);
  assert.equal(result.body.workItem.myTemplateBinding.definitionId, "rtd_quote");
  assert.equal(result.body.workItem.myTemplateBinding.version, 3);
  assert.deepEqual(result.body.workItem.myTemplateBinding.snapshot.steps.map((step) => step.key), ["output"]);
});

test("a governed template is not silently pinned when outcome feedback requires confirmation", () => {
  const { service, state } = harness();
  state.routineDefinitions = [{
    id: "rtd_governed", familyId: "family_governed", projectId: "prj_a", ownerTeamId: "team_a",
    state: "published", version: 1, name: "客户询价报价", description: "根据询价生成报价单",
    triggerDocumentTypes: ["inquiry"],
    steps: [{ key: "output", kind: "generate", label: "生成报价单", required: true,
      configuration: { output: "报价单 Excel" } }],
  }];
  state.myTemplateOutcomeFeedback = ["wrong_result", "met_expectations", "wrong_result"].map((outcome, index) => ({
    id: `mtof_governed_${index}`, ownerTeamId: "team_a", projectId: "prj_a",
    familyId: "family_governed", workItemId: `lwi_old_${index}`, outcome,
    createdAt: `2026-08-11T00:0${index}:00.000Z`, updatedAt: `2026-08-11T00:0${index}:00.000Z`,
  }));

  const suggestion = service.suggestWorkItemDraft({
    projectId: "prj_a", title: "根据客户询价生成报价单 Excel",
  }, ACTOR_A);
  assert.equal(suggestion.body.draft.templateMatch.state, "ambiguous");
  assert.equal(suggestion.body.draft.templateMatch.decision.reason, "outcome_feedback_watch");

  const created = service.createWorkItem({
    projectId: "prj_a", title: "根据客户询价生成报价单 Excel",
  }, ACTOR_A);
  assert.equal(created.status, 201);
  assert.equal(created.body.workItem.myTemplateBinding, undefined);
});

test("a local Issue pins the selected learned-template version and server-owned snapshot", () => {
  const { service, state } = harness();
  state.routineDefinitions = [{
    id: "rtd_quote", familyId: "family_quote", projectId: "prj_a", ownerTeamId: "team_a",
    state: "published", version: 2, name: "客户询价报价", description: "根据询价生成报价单",
    triggerDocumentTypes: ["inquiry"],
    steps: [{ key: "output", kind: "generate", label: "生成报价单", required: true,
      configuration: { output: "报价单 Excel" } }],
  }];
  const result = service.createWorkItem({
    projectId: "prj_a",
    title: "根据客户询价生成报价单",
    myTemplateBinding: {
      definitionId: "rtd_quote",
      familyId: "family_quote",
      version: 2,
      matchReasons: ["期望结果与报价单一致"],
    },
  }, ACTOR_A);
  assert.equal(result.status, 201);
  assert.deepEqual(result.body.workItem.myTemplateBinding, {
    schemaVersion: 1,
    definitionId: "rtd_quote",
    familyId: "family_quote",
    version: 2,
    name: "客户询价报价",
    expectedOutput: "报价单 Excel",
    matchReasons: ["期望结果与报价单一致"],
    snapshot: {
      name: "客户询价报价",
      description: "根据询价生成报价单",
      expectedOutput: "报价单 Excel",
      steps: [{ key: "output", kind: "generate", label: "生成报价单", required: true }],
    },
    snapshotHash: result.body.workItem.myTemplateBinding.snapshotHash,
    matchedAt: "2026-07-24T00:00:00.000Z",
  });
  assert.equal(result.body.workItem.myTemplateBinding.snapshotHash.length, 64);

  const ordinary = service.createWorkItem({
    projectId: "prj_a",
    title: "先记录，稍后交给 AI",
  }, ACTOR_A).body.workItem;
  const boundLater = service.updateWorkItem({
    workItemId: ordinary.id,
    expectedRevision: ordinary.revision,
    myTemplateBinding: {
      definitionId: "rtd_quote",
      familyId: "family_quote",
      version: 2,
      matchReasons: ["首次交给 AI 时自动匹配"],
    },
  }, ACTOR_A);
  assert.equal(boundLater.status, 200);
  assert.equal(boundLater.body.workItem.myTemplateBinding.definitionId, "rtd_quote");
  assert.equal(boundLater.body.workItem.myTemplateBinding.version, 2);
  state.workItems.find((item) => item.id === ordinary.id).executionBindings = [{
    kind: "auto_run", targetId: "aur_template_started", createdAt: "2026-07-24T00:01:00.000Z",
  }];
  assert.equal(service.updateWorkItem({
    workItemId: ordinary.id,
    expectedRevision: boundLater.body.workItem.revision,
    myTemplateBinding: {
      definitionId: "rtd_quote",
      familyId: "family_quote",
      version: 2,
      matchReasons: ["尝试覆盖"],
    },
  }, ACTOR_A).body.error, "work_item_my_template_binding_immutable");
});

test("correcting an unstarted task result teaches later similar Issues while preserving executed bindings", () => {
  const { service, state } = harness();
  state.routineDefinitions = [
    {
      id: "rtd_quote", familyId: "family_quote", projectId: "prj_a", ownerTeamId: "team_a",
      state: "published", version: 1, name: "报价处理", description: "处理客户询价",
      triggerDocumentTypes: ["inquiry"],
      steps: [{ key: "quote", kind: "generate", label: "生成报价单", required: true, configuration: { output: "报价单 Excel" } }],
    },
    {
      id: "rtd_summary", familyId: "family_summary", projectId: "prj_a", ownerTeamId: "team_a",
      state: "published", version: 1, name: "询价汇总", description: "汇总客户询价",
      triggerDocumentTypes: ["inquiry"],
      steps: [{ key: "summary", kind: "generate", label: "生成询价汇总", required: true, configuration: { output: "询价汇总表" } }],
    },
  ];
  const original = service.createWorkItem({
    projectId: "prj_a",
    title: "处理新的客户询价",
    body: "请根据收到的客户询价继续处理。",
    myTemplateBinding: {
      definitionId: "rtd_quote", familyId: "family_quote", version: 1,
      matchReasons: ["系统最初判断需要报价单"],
    },
  }, ACTOR_A).body.workItem;

  const corrected = service.updateWorkItem({
    workItemId: original.id,
    expectedRevision: original.revision,
    myTemplateBinding: {
      definitionId: "rtd_summary", familyId: "family_summary", version: 1,
      matchReasons: ["你确认这次需要询价汇总表"],
    },
  }, ACTOR_A);
  assert.equal(corrected.status, 200);
  assert.equal(corrected.body.workItem.myTemplateBinding.definitionId, "rtd_summary");
  assert.equal(state.myTemplateRoutingFeedback.length, 1);
  assert.deepEqual(state.myTemplateRoutingFeedback[0].intentTerms, ["询价"]);
  assert.equal(state.myTemplateRoutingFeedback[0].rejectedFamilyId, "family_quote");
  assert.equal(state.myTemplateRoutingFeedback[0].selectedFamilyId, "family_summary");
  assert.ok(state.workItemActivities.some((activity) =>
    activity.workItemId === original.id && activity.action === "my_template_match_corrected"));

  const later = service.createWorkItem({
    projectId: "prj_a",
    title: "处理另一份客户询价",
    body: "请根据收到的客户询价继续处理。",
  }, ACTOR_A).body.workItem;
  assert.equal(later.myTemplateBinding.definitionId, "rtd_summary");
  assert.match(later.myTemplateBinding.matchReasons.join(" "), /之前.*纠正/);

  const listed = service.listMyTemplateRoutingFeedback({ projectId: "prj_a" }, ACTOR_A);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.count, 1);
  assert.equal(listed.body.feedback[0].workItem.localRef, original.localRef);
  assert.equal(listed.body.feedback[0].selectedOutput, "询价汇总表");
  assert.equal(service.listMyTemplateRoutingFeedback({}, ACTOR_B).body.count, 0);
  assert.equal(service.removeMyTemplateRoutingFeedback({
    feedbackId: listed.body.feedback[0].id,
  }, ACTOR_B).status, 404);

  const removed = service.removeMyTemplateRoutingFeedback({
    feedbackId: listed.body.feedback[0].id,
  }, ACTOR_A);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.affectsFutureMatchesOnly, true);
  assert.equal(state.myTemplateRoutingFeedback.length, 0);
  assert.equal(state.workItems.find((item) => item.id === later.id).myTemplateBinding.definitionId, "rtd_summary");
  assert.ok(state.workItemActivities.some((activity) =>
    activity.workItemId === original.id && activity.action === "my_template_learning_removed"));

  const confirmed = service.createWorkItem({
    projectId: "prj_a",
    title: "处理第三份客户询价",
    body: "请根据收到的客户询价继续处理。",
    myTemplateBinding: {
      definitionId: "rtd_summary", familyId: "family_summary", version: 1,
      matchReasons: ["你确认这次需要“询价汇总表”"],
      userConfirmedResult: true,
    },
  }, ACTOR_A).body.workItem;
  assert.equal(state.myTemplateRoutingFeedback.length, 1);
  assert.equal(state.myTemplateRoutingFeedback[0].kind, "confirmation");
  assert.equal(state.myTemplateRoutingFeedback[0].rejectedOutput, null);
  assert.equal(state.myTemplateRoutingFeedback[0].selectedOutput, "询价汇总表");
  assert.ok(state.workItemActivities.some((activity) =>
    activity.workItemId === confirmed.id && activity.action === "my_template_match_confirmed"));
});

test("learned choice management exposes only actionable result conflicts", () => {
  const { service, state } = harness();
  state.myTemplateRoutingFeedback = [
    { id: "mtf_quote", ownerTeamId: "team_a", projectId: "prj_a", workItemId: "missing_quote", intentTerms: ["询价"], selectedOutput: "报价单 Excel", rejectedOutput: "询价汇总表", createdAt: "2026-08-11T00:00:00.000Z" },
    { id: "mtf_summary", ownerTeamId: "team_a", projectId: "prj_a", workItemId: "missing_summary", intentTerms: ["询价"], selectedOutput: "询价汇总表", rejectedOutput: "报价单 Excel", createdAt: "2026-08-11T00:01:00.000Z" },
  ];
  const conflicted = service.listMyTemplateRoutingFeedback({ projectId: "prj_a" }, ACTOR_A).body.feedback;
  assert.ok(conflicted.every((feedback) => feedback.state === "conflict"));
  assert.deepEqual(new Set(conflicted[0].conflictingOutputs), new Set(["报价单 Excel", "询价汇总表"]));

  state.myTemplateRoutingFeedback.push(
    { ...state.myTemplateRoutingFeedback[0], id: "mtf_quote_2" },
    { ...state.myTemplateRoutingFeedback[0], id: "mtf_quote_3" },
  );
  const established = service.listMyTemplateRoutingFeedback({ projectId: "prj_a" }, ACTOR_A).body.feedback;
  assert.ok(established.every((feedback) => feedback.state === "active"));
});

test("completed template tasks record result effectiveness without treating technical failures as matching feedback", () => {
  const { service, state } = harness();
  state.routineDefinitions = [{
    id: "rtd_outcome", familyId: "family_outcome", projectId: "prj_a", ownerTeamId: "team_a",
    state: "published", version: 1, name: "询价摘要", description: "生成询价摘要",
    triggerDocumentTypes: ["inquiry"],
    steps: [{ key: "summary", kind: "generate", label: "生成摘要", required: true, configuration: { output: "询价摘要" } }],
  }];
  const item = service.createWorkItem({
    projectId: "prj_a", title: "生成客户询价摘要",
    myTemplateBinding: {
      definitionId: "rtd_outcome", familyId: "family_outcome", version: 1,
      matchReasons: ["期望结果一致"],
    },
  }, ACTOR_A).body.workItem;
  assert.equal(service.recordMyTemplateOutcomeFeedback({
    workItemId: item.id, outcome: "met_expectations",
  }, ACTOR_A).body.error, "work_item_result_feedback_requires_completion");

  state.workItems.find((candidate) => candidate.id === item.id).status = "done";
  const positive = service.recordMyTemplateOutcomeFeedback({
    workItemId: item.id, outcome: "met_expectations",
  }, ACTOR_A);
  assert.equal(positive.status, 200);
  assert.equal(positive.body.feedback.outcome, "met_expectations");
  assert.equal(positive.body.workItem.myTemplateOutcomeFeedback.outcome, "met_expectations");
  assert.equal(state.myTemplateOutcomeFeedback.length, 1);
  assert.equal(service.recordMyTemplateOutcomeFeedback({
    workItemId: item.id, outcome: "met_expectations",
  }, ACTOR_A).body.replayed, true);
  assert.equal(state.myTemplateOutcomeFeedback.length, 1);

  const changed = service.recordMyTemplateOutcomeFeedback({
    workItemId: item.id, outcome: "wrong_result", note: "需要的是报价单",
  }, ACTOR_A);
  assert.equal(changed.body.feedback.revision, 2);
  assert.equal(changed.body.feedback.outcome, "wrong_result");
  const summary = service.listMyTemplateOutcomeFeedback({ projectId: "prj_a" }, ACTOR_A);
  assert.equal(summary.body.count, 1);
  assert.deepEqual(summary.body.summaries[0], {
    familyId: "family_outcome", total: 1, metExpectations: 0, wrongResult: 1,
    needsQualityAdjustment: 0, state: "needs_attention",
    governance: {
      state: "learning", windowSize: 1, matchingFeedbackCount: 1, metExpectations: 0,
      wrongResult: 1, needsQualityAdjustment: 0, wrongResultRate: 1,
      autoMatchAllowed: true, requiresConfirmation: false, scoreAdjustment: 0,
      manualObservation: false, historicalFeedbackCount: 0, latestIntervention: null,
      reason: "insufficient_outcome_feedback",
    },
  });
  assert.equal(service.listMyTemplateOutcomeFeedback({}, ACTOR_B).body.count, 0);
  assert.ok(state.workItemActivities.some((activity) =>
    activity.workItemId === item.id
    && activity.action === "my_template_outcome_feedback_recorded"
    && activity.details.matchingSignal === "negative"
    && activity.details.technicalFailure === false));
});

test("a completed ordinary task seeds a new learning My template without rebinding or auto-enabling it", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "整理客户回访表",
    inputAssets: [{
      id: "asset_input", path: "客户回访.xlsx", family: "spreadsheet", terminalId: "dev_local",
      hash: "hash-input", version: "v1", capabilities: [], readiness: { state: "ready", reason: "available" },
    }],
  }, ACTOR_A).body.workItem;
  const stored = state.workItems.find((item) => item.id === created.id);
  stored.status = "done";

  const missingEvidence = service.previewMyTemplateDraft({ workItemId: created.id }, ACTOR_A);
  assert.equal(missingEvidence.body.eligible, false);
  assert.deepEqual(missingEvidence.body.reasons, ["task_result_evidence_required"]);

  stored.outputAssets = [{
    id: "asset_output", path: "客户回访汇总.xlsx", family: "spreadsheet", terminalId: "dev_local",
    hash: "hash-output", version: "v1",
  }];
  const preview = service.previewMyTemplateDraft({ workItemId: created.id }, ACTOR_A);
  assert.equal(preview.body.eligible, true);
  assert.equal(preview.body.suggestion.typicalInput, "客户回访.xlsx");
  assert.equal(preview.body.suggestion.expectedOutput, "客户回访汇总.xlsx");
  assert.equal(service.previewMyTemplateDraft({ workItemId: created.id }, ACTOR_B).status, 404);
  assert.equal(service.createMyTemplateDraft({
    workItemId: created.id, expectedRevision: created.revision, confirm: false,
  }, ACTOR_A).body.error, "my_template_draft_confirmation_required");

  const saved = service.createMyTemplateDraft({
    workItemId: created.id,
    expectedRevision: created.revision,
    confirm: true,
    name: "客户回访汇总",
    typicalInput: "客户回访表",
    expectedOutput: "客户回访汇总表",
    idempotencyKey: "save-template-1",
  }, ACTOR_A);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.draft.state, "needs_review");
  assert.equal(saved.body.draft.caseCount, 1);
  assert.equal(saved.body.draft.casesRequired, 1);
  assert.equal(saved.body.workItem.myTemplateBinding, undefined);
  assert.equal(saved.body.workItem.revision, created.revision, "saving a template does not rewrite the source task");
  assert.equal(state.myTemplateDrafts.length, 1);
  assert.equal(state.myTemplateLearningCases.length, 1);
  assert.equal(state.myTemplateLearningCases[0].snapshot.outputAssets[0].path, "客户回访汇总.xlsx");
  assert.equal(Object.hasOwn(state.myTemplateLearningCases[0].snapshot, "body"), false);

  const replay = service.createMyTemplateDraft({
    workItemId: created.id, expectedRevision: 999, confirm: true, name: "重复提交",
  }, ACTOR_A);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.draft.id, saved.body.draft.id);
  assert.equal(state.myTemplateDrafts.length, 1);
  assert.equal(service.listMyTemplateDrafts({}, ACTOR_A).body.count, 1);
  assert.equal(service.listMyTemplateDrafts({}, ACTOR_B).body.count, 0);
});

test("a task that used an existing My template cannot seed a duplicate new template", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "已有模版任务" }, ACTOR_A).body.workItem;
  const stored = state.workItems.find((candidate) => candidate.id === item.id);
  stored.status = "done";
  stored.outputAssets = [{ id: "result", path: "result.pdf" }];
  stored.myTemplateBinding = { definitionId: "definition", familyId: "family", version: 1 };
  const preview = service.previewMyTemplateDraft({ workItemId: item.id }, ACTOR_A);
  assert.equal(preview.body.eligible, false);
  assert.ok(preview.body.reasons.includes("task_already_used_my_template"));
  assert.equal(service.createMyTemplateDraft({
    workItemId: item.id, expectedRevision: item.revision, confirm: true,
  }, ACTOR_A).body.error, "work_item_not_eligible_for_my_template");
});

test("learning My templates recommend similar completed tasks and add only user-confirmed cases", () => {
  const { service, state } = harness();
  const makeCompleted = ({ title, input, output, projectId = "prj_a", actor = ACTOR_A }) => {
    const created = service.createWorkItem({
      projectId,
      title,
      inputAssets: [{
        id: `input-${title}`, path: input, family: "spreadsheet", terminalId: "dev_local",
        capabilities: [], readiness: { state: "ready", reason: "available" },
      }],
    }, actor).body.workItem;
    const stored = state.workItems.find((item) => item.id === created.id);
    stored.status = "done";
    stored.outputAssets = [{ id: `output-${title}`, path: output, family: "spreadsheet" }];
    return stored;
  };
  const origin = makeCompleted({ title: "客户回访汇总", input: "客户回访-七月.xlsx", output: "客户回访汇总-七月.xlsx" });
  const saved = service.createMyTemplateDraft({
    workItemId: origin.id, expectedRevision: origin.revision, confirm: true,
    name: "客户回访汇总", typicalInput: "客户回访表", expectedOutput: "客户回访汇总表.xlsx",
  }, ACTOR_A).body.draft;
  const august = makeCompleted({ title: "客户回访汇总 八月", input: "客户回访-八月.xlsx", output: "客户回访汇总-八月.xlsx" });
  const september = makeCompleted({ title: "客户回访汇总 九月", input: "客户回访-九月.xlsx", output: "客户回访汇总-九月.xlsx" });
  makeCompleted({ title: "合同风险审查", input: "采购合同.docx", output: "合同风险报告.pdf" });
  makeCompleted({ title: "客户回访汇总 外部团队", input: "客户回访.xlsx", output: "客户回访汇总.xlsx", projectId: "prj_b", actor: ACTOR_B });

  const suggestions = service.listSimilarMyTemplateWorkItems({ draftId: saved.id }, ACTOR_A);
  assert.equal(suggestions.status, 200);
  assert.equal(suggestions.body.cases.length, 1);
  assert.deepEqual(suggestions.body.suggestions.map((entry) => entry.workItem.id).sort(), [august.id, september.id].sort());
  assert.ok(suggestions.body.suggestions.every((entry) => entry.reasons.includes("交付结果相似")));
  assert.equal(service.listSimilarMyTemplateWorkItems({ draftId: saved.id }, ACTOR_B).status, 404);
  assert.equal(service.addMyTemplateLearningCase({
    draftId: saved.id, workItemId: august.id,
    expectedDraftRevision: saved.revision, expectedWorkItemRevision: august.revision, confirm: false,
  }, ACTOR_A).body.error, "my_template_learning_case_confirmation_required");

  const second = service.addMyTemplateLearningCase({
    draftId: saved.id, workItemId: august.id,
    expectedDraftRevision: saved.revision, expectedWorkItemRevision: august.revision, confirm: true,
  }, ACTOR_A);
  assert.equal(second.status, 201);
  assert.equal(second.body.draft.caseCount, 2);
  assert.equal(second.body.draft.state, "needs_review");
  assert.equal(second.body.readyForReview, true);
  assert.equal(state.workItems.find((item) => item.id === august.id).myTemplateBinding, undefined);
  assert.equal(service.addMyTemplateLearningCase({
    draftId: saved.id, workItemId: september.id,
    expectedDraftRevision: saved.revision, expectedWorkItemRevision: september.revision, confirm: true,
  }, ACTOR_A).body.error, "my_template_draft_revision_conflict");

  const replay = service.addMyTemplateLearningCase({
    draftId: saved.id, workItemId: august.id,
    expectedDraftRevision: 999, expectedWorkItemRevision: 999, confirm: true,
  }, ACTOR_A);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  const third = service.addMyTemplateLearningCase({
    draftId: saved.id, workItemId: september.id,
    expectedDraftRevision: second.body.draft.revision, expectedWorkItemRevision: september.revision, confirm: true,
  }, ACTOR_A);
  assert.equal(third.status, 201);
  assert.equal(third.body.draft.caseCount, 3);
  assert.equal(third.body.draft.state, "needs_review");
  assert.equal(third.body.readyForReview, true);
  assert.equal(service.listSimilarMyTemplateWorkItems({ draftId: saved.id }, ACTOR_A).body.cases.length, 3);
  assert.ok(state.workItemActivities.some((activity) =>
    activity.workItemId === september.id
    && activity.action === "my_template_learning_case_added"
      && activity.details.participatesInMatching === false));
});

test("one confirmed task case can be reviewed, corrected, and explicitly enabled for future matching", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "整理客户回访表",
    inputAssets: [{
      id: "activation-input", path: "客户回访.xlsx", family: "spreadsheet", terminalId: "dev_local",
      capabilities: [], readiness: { state: "ready", reason: "available" },
    }],
  }, ACTOR_A).body.workItem;
  const sourceItem = state.workItems.find((item) => item.id === created.id);
  sourceItem.status = "done";
  sourceItem.outputAssets = [{ id: "activation-output", path: "客户回访汇总.xlsx", family: "spreadsheet" }];
  const saved = service.createMyTemplateDraft({
    workItemId: created.id,
    expectedRevision: created.revision,
    confirm: true,
    name: "客户回访汇总",
    typicalInput: "客户回访表",
    expectedOutput: "客户回访汇总表",
  }, ACTOR_A).body.draft;

  assert.equal(saved.state, "needs_review");
  assert.equal(saved.casesRequired, 1);
  const review = service.reviewMyTemplateDraft({ draftId: saved.id }, ACTOR_A);
  assert.equal(review.status, 200);
  assert.equal(review.body.readiness.canEnable, true);
  assert.equal(review.body.readiness.confidence, "initial");
  assert.equal(review.body.cases.length, 1);
  assert.equal(review.body.futureBehavior.participatesInMatching, false);
  assert.equal(service.reviewMyTemplateDraft({ draftId: saved.id }, ACTOR_B).status, 404);
  assert.equal(service.activateMyTemplateDraft({
    draftId: saved.id, expectedDraftRevision: saved.revision, confirm: false,
  }, ACTOR_A).body.error, "my_template_activation_confirmation_required");

  const activated = service.activateMyTemplateDraft({
    draftId: saved.id,
    expectedDraftRevision: saved.revision,
    confirm: true,
    name: "客户回访分析",
    typicalInput: "客户回访表或回访记录",
    expectedOutput: "客户回访汇总表",
  }, ACTOR_A);
  assert.equal(activated.status, 201);
  assert.equal(activated.body.draft.state, "ready");
  assert.equal(activated.body.draft.name, "客户回访分析");
  assert.equal(activated.body.review.futureBehavior.participatesInMatching, true);
  assert.equal(activated.body.definition.state, "published");
  assert.equal(activated.body.definition.origin.draftId, saved.id);
  assert.equal(state.routineDefinitions.length, 1);
  assert.equal(sourceItem.myTemplateBinding, undefined, "activation never rewrites the historical source task");
  const suggested = service.suggestWorkItemDraft({
    projectId: "prj_a",
    title: "客户回访分析",
    body: "请根据新的客户回访记录生成客户回访汇总表",
  }, ACTOR_A);
  assert.equal(activated.body.definition.templateMaturity, "stable");
  assert.equal(suggested.body.draft.templateMatch.state, "matched");
  assert.equal(suggested.body.draft.templateMatch.selected.definitionId, activated.body.definition.id);
  const replay = service.activateMyTemplateDraft({
    draftId: saved.id, expectedDraftRevision: 999, confirm: true,
  }, ACTOR_A);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(state.routineDefinitions.length, 1);
  assert.ok(state.workItemActivities.some((activity) =>
    activity.workItemId === sourceItem.id
    && activity.action === "my_template_activated"
    && activity.details.participatesInMatching === true));
});

test("governance details identify source tasks and a confirmed manual resume preserves history", () => {
  const { service, state } = harness();
  state.routineDefinitions = [{
    id: "rtd_resume", familyId: "family_resume", projectId: "prj_a", ownerTeamId: "team_a",
    state: "published", version: 1, name: "询价报价", description: "生成报价",
    triggerDocumentTypes: ["inquiry"], steps: [],
  }];
  state.workItems = [0, 1, 2, 3, 4].map((index) => ({
    id: `lwi_resume_${index}`, localRef: `LOC-${index}`, title: `历史报价 ${index}`,
    ownerTeamId: "team_a", projectId: "prj_a", status: "done",
  }));
  state.myTemplateOutcomeFeedback = ["wrong_result", "met_expectations", "wrong_result", "met_expectations", "wrong_result"]
    .map((outcome, index) => ({
      id: `mtof_resume_${index}`, ownerTeamId: "team_a", projectId: "prj_a",
      familyId: "family_resume", definitionId: "rtd_resume", workItemId: `lwi_resume_${index}`,
      version: 1, outcome, note: "", createdAt: `2026-08-11T00:0${index}:00.000Z`, updatedAt: `2026-08-11T00:0${index}:00.000Z`,
    }));

  const before = service.listMyTemplateOutcomeFeedback({ projectId: "prj_a" }, ACTOR_A);
  assert.equal(before.body.summaries[0].governance.state, "paused");
  assert.equal(before.body.feedback[0].workItem.localRef, "LOC-0");
  assert.equal(before.body.feedback.find((entry) => entry.outcome === "wrong_result").governanceImpact, "negative");
  assert.equal(service.resumeMyTemplateGovernanceObservation({
    familyId: "family_resume", projectId: "prj_a", confirm: false,
  }, ACTOR_A).status, 400);
  assert.equal(service.resumeMyTemplateGovernanceObservation({
    familyId: "family_resume", projectId: "prj_a", confirm: true,
  }, ACTOR_B).status, 404);

  const resumed = service.resumeMyTemplateGovernanceObservation({
    familyId: "family_resume", projectId: "prj_a", confirm: true,
  }, ACTOR_A);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.intervention.priorState, "paused");
  assert.equal(resumed.body.governance.state, "watch");
  assert.equal(resumed.body.governance.manualObservation, true);
  assert.equal(state.myTemplateGovernanceInterventions.length, 1);

  const after = service.listMyTemplateOutcomeFeedback({ projectId: "prj_a" }, ACTOR_A);
  assert.ok(after.body.feedback.every((entry) => entry.governanceImpact === "historical_baseline"));
  assert.equal(after.body.summaries[0].governance.matchingFeedbackCount, 0);
  assert.equal(service.resumeMyTemplateGovernanceObservation({
    familyId: "family_resume", projectId: "prj_a", confirm: true,
  }, ACTOR_A).status, 409, "a second reset is not silently accumulated");
});

test("linked alert retries are ownership checked", () => {
  let retriedId = null;
  const { service, state } = harness({
    retryAlert: (id) => {
      retriedId = id;
      return { id, status: "queued" };
    },
  });
  const item = service.createWorkItem({ projectId: "prj_a", title: "Retry delivery" }, ACTOR_A).body.workItem;
  state.autoRuns = [{ id: "aur_retry", projectId: "prj_a", status: "failed" }];
  state.workItems[0].executionBindings = [{
    kind: "auto_run", targetId: "aur_retry", worktreeId: null, createdAt: "2026-07-24T00:00:00.000Z",
  }];
  state.alertOutbox = [{
    id: "aob_retry", alert: { data: { autoRunId: "aur_retry" } }, status: "failed",
  }];
  assert.equal(service.retryWorkItemAlert({
    workItemId: item.id, alertId: "aob_retry",
  }, ACTOR_A).body.alert.status, "queued");
  assert.equal(retriedId, "aob_retry");
  state.alertOutbox[0].status = "sent";
  assert.equal(service.retryWorkItemAlert({
    workItemId: item.id, alertId: "aob_retry",
  }, ACTOR_A).status, 409);
  assert.equal(service.retryWorkItemAlert({
    workItemId: item.id, alertId: "aob_retry",
  }, ACTOR_B).status, 404);
});

test("agent create idempotency prevents duplicate local issues", () => {
  const { service, state } = harness();
  const first = service.createWorkItem({
    projectId: "prj_a", title: "Exactly once", idempotencyKey: "create-1",
  }, ACTOR_A);
  const replay = service.createWorkItem({
    projectId: "prj_a", title: "", idempotencyKey: "create-1",
  }, ACTOR_A);
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.workItem.id, first.body.workItem.id);
  assert.equal(state.workItems.length, 1);
  const otherActor = service.createWorkItem({
    projectId: "prj_a", title: "Separate actor", idempotencyKey: "create-1",
  }, ACTOR_C);
  assert.equal(otherActor.status, 201);
  assert.equal(state.workItems.length, 2);
});

test("routine-bound local issues pin a published version and dedupe across team actors", () => {
  const { service, state } = harness();
  state.workflowSources = [{
    id: "wfs_1", ownerTeamId: "team_a", projectId: "prj_a", state: "active",
  }];
  state.workflowArtifacts = [{
    id: "wfa_1", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_1",
    availability: "available",
  }];
  state.routineDefinitions = [{
    id: "rtd_1", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_1",
    version: 2, state: "published",
  }];
  state.businessCases = [{
    id: "bcs_1", ownerTeamId: "team_a", projectId: "prj_a", sourceId: "wfs_1",
    businessKey: "RFQ-2026-001", state: "confirmed",
  }];
  const input = {
    projectId: "prj_a",
    title: "Process inquiry RFQ-2026-001",
    routineDefinitionId: "rtd_1",
    routineVersion: 2,
    businessCaseId: "bcs_1",
    businessKey: "RFQ-2026-001",
    triggerArtifactIds: ["wfa_1"],
  };
  const first = service.createWorkItem(input, ACTOR_A);
  const replay = service.createWorkItem({ ...input, title: "Ignored duplicate" }, ACTOR_C);
  assert.equal(first.status, 201);
  assert.equal(first.body.workItem.type, "task");
  assert.equal(first.body.workItem.routineDefinitionId, "rtd_1");
  assert.equal(first.body.workItem.routineVersion, 2);
  assert.equal(first.body.workItem.routineBindingSchemaVersion, 1);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.workItem.id, first.body.workItem.id);
  assert.equal(state.workItems.length, 1);

  assert.equal(service.updateWorkItem({
    workItemId: first.body.workItem.id,
    expectedRevision: 1,
    businessCaseId: "bcs_other",
  }, ACTOR_A).body.error, "work_item_routine_binding_immutable");
  assert.equal(service.createWorkItem({ ...input, routineVersion: 1 }, ACTOR_A).body.error,
    "work_item_routine_definition_not_published_or_version_mismatch");
  state.businessCases[0].state = "proposed";
  assert.equal(service.createWorkItem({ ...input, businessKey: "RFQ-2026-002" }, ACTOR_A).body.error,
    "work_item_business_key_mismatch");
  assert.equal(service.createWorkItem({ ...input, title: "Unconfirmed case", idempotencyKey: "new" }, ACTOR_A).body.error,
    "work_item_business_case_not_confirmed");
  state.businessCases[0].state = "confirmed";
  state.workflowSources[0].state = "revoked";
  assert.equal(service.createWorkItem({ ...input, title: "Retry after revoke" }, ACTOR_C).body.replayed, true);
  assert.equal(service.createWorkItem({ ...input, businessKey: "RFQ-2026-002" }, ACTOR_A).body.error,
    "work_item_business_key_mismatch");
});

test("planning automation adds matching work items once", () => {
  const { service, state } = harness();
  state.planningProjects = [{
    id: "ppj_1", ownerTeamId: "team_a", name: "Urgent bugs", archivedAt: null,
    automationRules: [{ id: "par_1", status: "", priority: "p0", type: "bug", label: "release" }],
  }];
  state.planningProjectItems = [];
  const item = service.createWorkItem({
    projectId: "prj_a", title: "Ship blocker", type: "bug", priority: "p0", labels: ["release"],
  }, ACTOR_A).body.workItem;
  assert.equal(state.planningProjectItems.length, 1);
  assert.equal(state.planningProjectItems[0].workItemId, item.id);
  assert.equal(state.planningProjects[0].activity[0].action, "item_auto_added");
  service.updateWorkItem({
    workItemId: item.id, expectedRevision: 1, status: "ready",
  }, ACTOR_A);
  assert.equal(state.planningProjectItems.length, 1);
  assert.equal(service.listActivity({ workItemId: item.id }, ACTOR_A).body.activities
    .some((row) => row.action === "planning_auto_added"), true);
});

test("close, reopen, archive and restore preserve the record", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "A" }, ACTOR_A).body.workItem;
  const closed = service.transitionWorkItem({ workItemId: item.id, expectedRevision: 1, action: "close" }, ACTOR_A);
  assert.equal(closed.body.workItem.state, "closed");
  assert.ok(closed.body.workItem.completedAt);
  assert.equal(closed.body.workItem.waitingOn, "none");
  const archived = service.transitionWorkItem({ workItemId: item.id, expectedRevision: 2, action: "archive" }, ACTOR_A);
  assert.ok(archived.body.workItem.archivedAt);
  assert.equal(service.listWorkItems({}, ACTOR_A).body.count, 0);
  const restored = service.transitionWorkItem({ workItemId: item.id, expectedRevision: 3, action: "restore" }, ACTOR_A);
  assert.equal(restored.body.workItem.archivedAt, null);
  const reopened = service.transitionWorkItem({ workItemId: item.id, expectedRevision: 4, action: "reopen" }, ACTOR_A);
  assert.equal(reopened.body.workItem.state, "open");
  assert.equal(reopened.body.workItem.completedAt, null);
});

test("list supports project, status, type, assignee and text filters", () => {
  const { service, state } = harness();
  state.projects.find((project) => project.id === "prj_a").name = "Customer delivery";
  service.createWorkItem({
    projectId: "prj_a",
    title: "Repair release",
    type: "bug",
    status: "blocked",
    assigneeIds: ["usr_a"],
    labels: ["release"],
  }, ACTOR_A);
  service.createWorkItem({ projectId: "prj_a", title: "Write docs" }, ACTOR_A);
  assert.equal(service.listWorkItems({ q: "release" }, ACTOR_A).body.count, 1);
  assert.equal(service.listWorkItems({ q: "customer delivery" }, ACTOR_A).body.count, 2);
  assert.equal(service.listWorkItems({ status: "blocked", type: "bug", assigneeId: "usr_a" }, ACTOR_A).body.count, 1);
  assert.equal(service.listWorkItems({ status: "done" }, ACTOR_A).body.count, 0);
});

test("work item and attention lists support opaque cursors and incremental windows", () => {
  const { service, state } = harness();
  service.createWorkItem({ projectId: "prj_a", title: "First" }, ACTOR_A);
  service.createWorkItem({ projectId: "prj_a", title: "Second" }, ACTOR_A);
  state.workItems.find((item) => item.title === "First").updatedAt = "2026-07-24T00:01:00.000Z";
  state.workItems.find((item) => item.title === "Second").updatedAt = "2026-07-24T00:02:00.000Z";
  const firstPage = service.listWorkItems({ limit: "1" }, ACTOR_A).body;
  assert.equal(firstPage.workItems[0].title, "Second");
  assert.equal(firstPage.hasMore, true);
  const secondPage = service.listWorkItems({ limit: "1", cursor: firstPage.nextCursor }, ACTOR_A).body;
  assert.equal(secondPage.workItems[0].title, "First");
  assert.equal(secondPage.hasMore, false);
  assert.equal(service.listWorkItems({
    updatedSince: "2026-07-24T00:01:30.000Z",
  }, ACTOR_A).body.workItems[0].title, "Second");
  assert.equal(service.listWorkItems({ cursor: "invalid" }, ACTOR_A).status, 400);
});

test("list filters by planning project and returns reverse memberships", () => {
  const { service, state } = harness();
  const first = service.createWorkItem({ projectId: "prj_a", title: "In roadmap" }, ACTOR_A).body.workItem;
  service.createWorkItem({ projectId: "prj_a", title: "Unplanned" }, ACTOR_A);
  state.planningProjects = [{
    id: "ppj_1", ownerTeamId: "team_a", name: "Roadmap", archivedAt: null,
  }];
  state.planningProjectItems = [{
    id: "ppi_1", ownerTeamId: "team_a", planningProjectId: "ppj_1", workItemId: first.id,
  }];
  const result = service.listWorkItems({ planningProjectId: "ppj_1" }, ACTOR_A);
  assert.equal(result.body.count, 1);
  assert.equal(result.body.workItems[0].planningProjects[0].name, "Roadmap");
  assert.equal(service.getWorkItem({ workItemId: first.id }, ACTOR_A).body.workItem.planningProjects[0].id, "ppj_1");
});

test("work items survive a persistent-state restart", () => {
  const root = join(tmpdir(), `myagenttool-work-items-${Date.now()}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state.json");
  mkdirSync(projectPath, { recursive: true });
  try {
    const now = () => "2026-07-24T00:00:00.000Z";
    const first = createServerState({ defaultProjectPath: projectPath, now });
    first.state.workItems.push({
      id: "lwi_1", localNumber: 1, localRef: "LOCAL-1",
      ownerTeamId: "team_local", projectId: first.defaultProject.id,
      title: "Persist me", body: "", type: "task", status: "backlog", priority: "p2",
      labels: [], assigneeIds: [], acceptanceCriteria: [], dueDate: "2026-08-15", milestone: "M3",
      nextFollowUpAt: "2026-07-24T00:00:00.000Z", followUpScheduleRevision: 1,
      revision: 1, state: "open",
      archivedAt: null, externalBindings: [], executionBindings: [], createdAt: now(), updatedAt: now(),
      createdBy: "usr_local", lastModifiedBy: "usr_local",
    });
    first.state.workItemComments.push({
      id: "wic_1", workItemId: "lwi_1", ownerTeamId: "team_local",
      projectId: first.defaultProject.id, body: "Still here", revision: 1,
      createdAt: now(), updatedAt: now(), createdBy: "usr_local",
      lastModifiedBy: "usr_local", deletedAt: null,
    });
    first.state.workItemActivities.push({
      id: "wia_1", workItemId: "lwi_1", ownerTeamId: "team_local",
      projectId: first.defaultProject.id, action: "commented", actorId: "usr_local",
      createdAt: now(), details: { commentId: "wic_1" },
    });
    first.state.workItemReportDrafts.push({
      id: "wrd_1", workItemId: "lwi_1", ownerTeamId: "team_local",
      projectId: first.defaultProject.id, status: "draft", revision: 1,
      audience: { relation: "unknown", name: null, organization: null, userId: null },
      tone: "concise", content: "Persisted report draft", source: { workItemRevision: 1 },
      createdAt: now(), updatedAt: now(), createdBy: "usr_local", updatedBy: "usr_local",
    });
    first.state.workItemFollowUpReminders.push({
      id: "wfr_1", schemaVersion: 1, dedupeKey: "lwi_1:1",
      workItemId: "lwi_1", ownerTeamId: "team_local", projectId: first.defaultProject.id,
      scheduleRevision: 1, sourceRevision: 1, scheduledFor: "2026-07-24T00:00:00.000Z",
      status: "due", createdAt: now(), createdBy: "usr_follow_up_reminder",
      resolvedAt: null, resolvedBy: null, resolution: null,
    });
    first.state.workItemAttentionOperations.push({
      attentionId: "github_conflict:lwi_1", ownerTeamId: "team_local",
      handling: { actorId: "usr_local", claimedAt: now(), expiresAt: "2026-07-24T00:15:00.000Z" },
      resolution: null, history: [],
    });
    first.state.githubWorkItemWebhookDeliveries.push({
      id: "delivery-persisted", event: "issues", receivedAt: now(),
      repository: "acme/repo", issueNumber: 1, teamIds: ["team_local"],
      result: { outcome: "synced" },
    });
    first.state.githubWorkItemWebhookFailures.push({
      id: "delivery-failed", event: "issues", reason: "invalid_signature", receivedAt: now(),
    });
    first.state.planningProjects.push({
      id: "ppj_1", ownerTeamId: "team_local", name: "Roadmap", description: "",
      color: "indigo", revision: 1, archivedAt: null, createdAt: now(), updatedAt: now(),
      createdBy: "usr_local", lastModifiedBy: "usr_local",
    });
    first.state.planningProjectItems.push({
      id: "ppi_1", ownerTeamId: "team_local", planningProjectId: "ppj_1",
      workItemId: "lwi_1", position: 2000, addedAt: now(), addedBy: "usr_local",
    });
    createPersistenceRuntime({
      state: first.state, enabled: true, stateStorePath, schemaVersion: 1,
      now, defaultProject: first.defaultProject, sameProjectPath,
    }).savePersistentState();

    const second = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({
      state: second.state, enabled: true, stateStorePath, schemaVersion: 1,
      now, defaultProject: second.defaultProject, sameProjectPath,
    }).restorePersistentState();
    assert.equal(second.state.workItems.length, 1);
    assert.equal(second.state.workItems[0].localRef, "LOCAL-1");
    assert.equal(second.state.workItems[0].dueDate, "2026-08-15");
    assert.equal(second.state.workItems[0].milestone, "M3");
    assert.equal(second.state.workItems[0].terminalId, second.state.devices[0].id);
    assert.equal(second.state.planningProjectItems[0].position, 2000);
    assert.equal(second.state.workItemComments[0].body, "Still here");
    assert.equal(second.state.workItemActivities[0].action, "commented");
    assert.equal(second.state.workItemReportDrafts[0].content, "Persisted report draft");
    assert.equal(second.state.workItemFollowUpReminders[0].dedupeKey, "lwi_1:1");
    assert.equal(second.state.workItemAttentionOperations[0].handling.actorId, "usr_local");
    assert.equal(second.state.githubWorkItemWebhookDeliveries[0].id, "delivery-persisted");
    assert.equal(second.state.githubWorkItemWebhookFailures[0].reason, "invalid_signature");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("comments support create, edit and soft-delete with revision conflicts", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Discuss" }, ACTOR_A).body.workItem;
  const created = service.createComment({ workItemId: item.id, body: " First note " }, ACTOR_A);
  assert.equal(created.status, 201);
  assert.equal(created.body.comment.body, "First note");
  assert.equal(service.createComment({ workItemId: item.id, body: " " }, ACTOR_A).status, 400);
  assert.equal(service.updateComment({
    workItemId: item.id, commentId: created.body.comment.id, expectedRevision: 9, body: "No",
  }, ACTOR_A).status, 409);
  const updated = service.updateComment({
    workItemId: item.id, commentId: created.body.comment.id, expectedRevision: 1, body: "Edited",
  }, ACTOR_A);
  assert.equal(updated.body.comment.revision, 2);
  assert.equal(updated.body.comment.body, "Edited");
  const deleted = service.deleteComment({
    workItemId: item.id, commentId: created.body.comment.id, expectedRevision: 2,
  }, ACTOR_A);
  assert.equal(deleted.body.comment.body, null);
  assert.ok(deleted.body.comment.deletedAt);
  assert.equal(service.updateComment({
    workItemId: item.id, commentId: created.body.comment.id, expectedRevision: 3, body: "Restore",
  }, ACTOR_A).status, 404);
});

test("comments and activity are team scoped and form a dedicated timeline", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Timeline" }, ACTOR_A).body.workItem;
  service.updateWorkItem({ workItemId: item.id, expectedRevision: 1, status: "ready" }, ACTOR_A);
  service.createComment({ workItemId: item.id, body: "Ready to start" }, ACTOR_A);
  const activity = service.listActivity({ workItemId: item.id }, ACTOR_A);
  assert.deepEqual(new Set(activity.body.activities.map((row) => row.action)), new Set(["created", "updated", "commented"]));
  assert.equal(service.listComments({ workItemId: item.id }, ACTOR_A).body.count, 1);
  assert.equal(service.listActivity({ workItemId: item.id }, ACTOR_B).status, 404);
  assert.equal(service.listComments({ workItemId: item.id }, ACTOR_B).status, 404);
});

test("execution bindings attach worktrees and auto-runs to the local issue", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Execute locally" }, ACTOR_A).body.workItem;
  const worktree = service.recordExecutionBinding({
    workItemId: item.id, kind: "worktree", targetId: "wtr_1", worktreeId: "wtr_1",
  }, ACTOR_A);
  assert.equal(worktree.status, 200);
  assert.equal(worktree.body.binding.terminalId, "dev_local");
  assert.equal(worktree.body.workItem.executionBindings.length, 1);
  const run = service.recordExecutionBinding({
    workItemId: item.id, kind: "auto_run", targetId: "aur_1", worktreeId: "wtr_2",
  }, ACTOR_A);
  assert.equal(run.body.binding.terminalId, "dev_local");
  assert.equal(run.body.workItem.executionBindings.length, 2);
  assert.equal(service.listActivity({ workItemId: item.id }, ACTOR_A).body.activities[0].action, "auto_run_started");
  assert.equal(service.recordExecutionBinding({
    workItemId: item.id, kind: "auto_run", targetId: "aur_evil",
  }, ACTOR_B).status, 404);
});

test("report drafts capture bounded progress, support editing, and require explicit confirmation", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "Prepare customer rollout",
    status: "review",
    requesterRelation: "customer",
    requesterName: "A. Customer",
    requesterOrganization: "Example Co",
    waitingOn: "requester",
  }, ACTOR_A).body.workItem;
  const progressed = service.recordWorkItemProgress({
    workItemId: created.id,
    expectedRevision: created.revision,
    idempotencyKey: "progress-before-report",
    summary: "The rollout checklist passed staging review.",
    nextFollowUpAt: "2026-07-25T09:00:00.000Z",
  }, ACTOR_A).body.workItem;

  const generated = service.generateReportDraft({
    workItemId: created.id,
    expectedWorkItemRevision: progressed.revision,
    idempotencyKey: "report-generate-1",
    tone: "formal",
  }, ACTOR_A);
  assert.equal(generated.status, 201);
  assert.equal(generated.body.reportDraft.schemaVersion, 1);
  assert.equal(generated.body.reportDraft.status, "draft");
  assert.equal(generated.body.reportDraft.audience.relation, "customer");
  assert.match(generated.body.reportDraft.content, /rollout checklist passed staging review/);
  assert.equal(generated.body.reportDraft.source.progressActivities.length, 1);
  assert.equal(generated.body.reportDraft.source.executionResults.length, 0);
  assert.equal(generated.body.reportDraft.generation.generator, "structured");
  assert.equal(generated.body.reportDraft.generation.modelVersion, null);
  assert.equal(generated.body.reportDraft.generation.locale, "en-US");
  assert.equal(Object.hasOwn(generated.body.reportDraft, "command"), false);

  const replayed = service.generateReportDraft({
    workItemId: created.id,
    expectedWorkItemRevision: progressed.revision,
    idempotencyKey: "report-generate-1",
    tone: "formal",
  }, ACTOR_A);
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.reportDraft.id, generated.body.reportDraft.id);

  const edited = service.updateReportDraft({
    workItemId: created.id,
    draftId: generated.body.reportDraft.id,
    expectedRevision: generated.body.reportDraft.revision,
    content: "Staging is complete. We are ready for the customer checkpoint.",
    tone: "concise",
  }, ACTOR_A);
  assert.equal(edited.status, 200);
  assert.equal(edited.body.reportDraft.revision, 2);

  const beforeConfirm = service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem;
  const confirmed = service.confirmReportDraft({
    workItemId: created.id,
    draftId: edited.body.reportDraft.id,
    expectedRevision: edited.body.reportDraft.revision,
    idempotencyKey: "report-confirm-1",
  }, ACTOR_A);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.reportDraft.status, "confirmed");
  assert.equal(confirmed.body.reportDraft.confirmedSnapshot.content, edited.body.reportDraft.content);
  assert.equal(confirmed.body.reportDraft.confirmedSnapshot.confirmedBy, ACTOR_A.userId);
  assert.equal(Object.hasOwn(confirmed.body.reportDraft, "confirmationCommand"), false);
  const afterConfirm = service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem;
  assert.equal(afterConfirm.revision, beforeConfirm.revision);
  assert.equal(afterConfirm.status, "review");
  assert.equal(afterConfirm.state, "open");
  assert.equal(service.updateReportDraft({
    workItemId: created.id,
    draftId: edited.body.reportDraft.id,
    expectedRevision: confirmed.body.reportDraft.revision,
    content: "Mutate confirmed snapshot",
  }, ACTOR_A).status, 409);
  assert.deepEqual(
    state.workItemActivities.slice(0, 3).map((activity) => activity.action),
    ["report_draft_confirmed", "report_draft_updated", "report_draft_generated"],
  );
});

test("report generation follows the requested supported locale and records it", () => {
  const { service } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a",
    title: "确认客户发布计划",
    requesterRelation: "customer",
    requesterName: "张总",
    waitingOn: "requester",
  }, ACTOR_A).body.workItem;
  const progressed = service.recordWorkItemProgress({
    workItemId: created.id,
    expectedRevision: created.revision,
    idempotencyKey: "report-locale-progress",
    summary: "灰度验证已经通过。",
  }, ACTOR_A).body.workItem;

  const generated = service.generateReportDraft({
    workItemId: created.id,
    expectedWorkItemRevision: progressed.revision,
    idempotencyKey: "report-locale-zh",
    locale: "zh-CN",
    tone: "formal",
  }, ACTOR_A);

  assert.equal(generated.status, 201);
  assert.equal(generated.body.reportDraft.generation.locale, "zh-CN");
  assert.match(generated.body.reportDraft.content, /张总进展更新 — 确认客户发布计划/);
  assert.match(generated.body.reportDraft.content, /当前进展：灰度验证已经通过。/);
  assert.match(generated.body.reportDraft.content, /当前等待：提出者回复。/);
  assert.doesNotMatch(generated.body.reportDraft.content, /Current progress|Waiting on/);
  assert.equal(service.generateReportDraft({
    workItemId: created.id,
    expectedWorkItemRevision: progressed.revision,
    idempotencyKey: "report-locale-unsupported",
    locale: "fr-FR",
  }, ACTOR_A).body.error, "invalid_work_item_report_locale");
});

test("self report audiences cannot retain hidden identity fields", () => {
  const { service } = harness();
  const created = service.createWorkItem({ projectId: "prj_a", title: "Personal checkpoint" }, ACTOR_A).body.workItem;
  const generated = service.generateReportDraft({
    workItemId: created.id,
    expectedWorkItemRevision: created.revision,
    idempotencyKey: "report-self-audience",
    audience: { relation: "self", name: "Another user", organization: "Hidden org", userId: "usr_other" },
  }, ACTOR_A);

  assert.deepEqual(generated.body.reportDraft.audience, {
    relation: "self",
    name: null,
    organization: null,
    userId: null,
  });
  assert.doesNotMatch(generated.body.reportDraft.content, /Another user|Hidden org/);
});

test("report drafts are tenant scoped, stale after source changes, and regenerate safely", () => {
  const { service } = harness();
  const created = service.createWorkItem({ projectId: "prj_a", title: "Manager status" }, ACTOR_A).body.workItem;
  const generated = service.generateReportDraft({
    workItemId: created.id,
    expectedWorkItemRevision: created.revision,
    idempotencyKey: "report-stale-1",
    audience: { relation: "manager", name: "M. Manager" },
  }, ACTOR_A).body.reportDraft;
  assert.equal(service.listReportDrafts({ workItemId: created.id }, ACTOR_B).status, 404);
  assert.equal(service.getReportDraft({ workItemId: created.id, draftId: generated.id }, ACTOR_B).status, 404);
  assert.equal(service.generateReportDraft({
    workItemId: created.id,
    expectedWorkItemRevision: created.revision,
    idempotencyKey: "report-stale-1",
    audience: { relation: "manager", name: "M. Manager" },
    tone: "warm",
  }, ACTOR_A).body.error, "work_item_report_idempotency_conflict");

  const changed = service.recordWorkItemProgress({
    workItemId: created.id,
    expectedRevision: created.revision,
    idempotencyKey: "report-stale-progress",
    summary: "A new dependency changed the delivery plan.",
  }, ACTOR_A).body.workItem;
  assert.equal(service.getReportDraft({ workItemId: created.id, draftId: generated.id }, ACTOR_A).body.reportDraft.stale, true);
  assert.equal(service.confirmReportDraft({
    workItemId: created.id,
    draftId: generated.id,
    expectedRevision: generated.revision,
    idempotencyKey: "report-stale-confirm",
  }, ACTOR_A).body.error, "work_item_report_source_stale");

  const regenerated = service.generateReportDraft({
    workItemId: created.id,
    expectedWorkItemRevision: changed.revision,
    idempotencyKey: "report-stale-2",
    audience: { relation: "manager", name: "M. Manager" },
  }, ACTOR_A);
  assert.equal(regenerated.status, 201);
  assert.match(regenerated.body.reportDraft.content, /new dependency changed the delivery plan/i);
  assert.equal(service.getReportDraft({ workItemId: created.id, draftId: generated.id }, ACTOR_A).body.reportDraft.status, "superseded");
  assert.equal(service.listReportDrafts({ workItemId: created.id }, ACTOR_A).body.count, 2);
});

test("report draft discard is revision gated and idempotent without touching work state", () => {
  const { service } = harness();
  const created = service.createWorkItem({ projectId: "prj_a", title: "Internal update" }, ACTOR_A).body.workItem;
  const draft = service.generateReportDraft({
    workItemId: created.id,
    expectedWorkItemRevision: created.revision,
    idempotencyKey: "report-discard-generate",
  }, ACTOR_A).body.reportDraft;
  const discarded = service.discardReportDraft({
    workItemId: created.id,
    draftId: draft.id,
    expectedRevision: draft.revision,
    idempotencyKey: "report-discard-1",
  }, ACTOR_A);
  assert.equal(discarded.status, 200);
  assert.equal(discarded.body.reportDraft.status, "discarded");
  const replayed = service.discardReportDraft({
    workItemId: created.id,
    draftId: draft.id,
    expectedRevision: draft.revision,
    idempotencyKey: "report-discard-1",
  }, ACTOR_A);
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  const item = service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem;
  assert.equal(item.revision, created.revision);
  assert.equal(item.status, "backlog");
  assert.equal(item.state, "open");
});

test("confirmed reports require recipient preview and an issued grant before durable delivery receipts", () => {
  const queued = [];
  const approvals = [];
  const { service, state } = harness({
    enqueueChannelDeliveryBatch: (input) => {
      queued.push(input);
      return { ok: true, deliveryIds: input.contents.map((_, index) => `chd_report_${index + 1}`) };
    },
    validateApprovalToken: (token, context) => {
      approvals.push({ token, context });
      return token === "issued-grant"
        ? { approved: true, mode: "grant", grantId: "apg_report" }
        : { approved: false, reason: "grant_required" };
    },
  });
  state.channels = [{
    id: "chn_customer",
    ownerTeamId: ACTOR_A.teamId,
    provider: "wecom",
    name: "Customer updates",
    status: "enabled",
  }];
  state.channelConversations = [{
    id: "ccv_alex",
    channelId: "chn_customer",
    ownerTeamId: ACTOR_A.teamId,
    externalUserId: "wx_alex",
  }];
  state.channelDeliveries = [];

  const item = service.createWorkItem({ projectId: "prj_a", title: "Launch update" }, ACTOR_A).body.workItem;
  const generated = service.generateReportDraft({
    workItemId: item.id,
    expectedWorkItemRevision: item.revision,
    idempotencyKey: "delivery-generate",
    audience: { relation: "customer", name: "Alex" },
  }, ACTOR_A).body.reportDraft;
  const edited = service.updateReportDraft({
    workItemId: item.id,
    draftId: generated.id,
    expectedRevision: generated.revision,
    content: "报".repeat(2_000),
  }, ACTOR_A).body.reportDraft;
  const confirmed = service.confirmReportDraft({
    workItemId: item.id,
    draftId: edited.id,
    expectedRevision: edited.revision,
    idempotencyKey: "delivery-confirm",
  }, ACTOR_A).body.reportDraft;

  const previewed = service.previewReportDelivery({
    workItemId: item.id,
    draftId: confirmed.id,
    channelId: "chn_customer",
    conversationId: "ccv_alex",
    idempotencyKey: "delivery-preview",
  }, ACTOR_A);
  assert.equal(previewed.status, 201);
  assert.equal(previewed.body.reportDelivery.status, "preview");
  assert.equal(previewed.body.reportDelivery.target.recipientId, "wx_alex");
  assert.ok(previewed.body.reportDelivery.chunkCount > 1);
  assert.equal(service.listReportDeliveries({ workItemId: item.id, draftId: confirmed.id }, ACTOR_B).status, 404);
  const replayedPreview = service.previewReportDelivery({
    workItemId: item.id,
    draftId: confirmed.id,
    channelId: "chn_customer",
    conversationId: "ccv_alex",
    idempotencyKey: "delivery-preview",
  }, ACTOR_A);
  assert.equal(replayedPreview.body.replayed, true);

  const delivery = previewed.body.reportDelivery;
  const refused = service.sendReportDelivery({
    workItemId: item.id,
    draftId: confirmed.id,
    deliveryId: delivery.id,
    expectedRevision: delivery.revision,
    idempotencyKey: "delivery-send",
  }, ACTOR_A);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "approval_required");
  assert.equal(queued.length, 0);

  state.channelConversations[0].externalUserId = "wx_alex_changed";
  const changedTarget = service.sendReportDelivery({
    workItemId: item.id,
    draftId: confirmed.id,
    deliveryId: delivery.id,
    expectedRevision: delivery.revision,
    idempotencyKey: "delivery-send",
    approvalToken: "issued-grant",
  }, ACTOR_A);
  assert.equal(changedTarget.status, 409);
  assert.equal(changedTarget.body.error, "work_item_report_delivery_target_changed");
  assert.equal(queued.length, 0);
  state.channelConversations[0].externalUserId = "wx_alex";

  const sent = service.sendReportDelivery({
    workItemId: item.id,
    draftId: confirmed.id,
    deliveryId: delivery.id,
    expectedRevision: delivery.revision,
    idempotencyKey: "delivery-send",
    approvalToken: "issued-grant",
  }, ACTOR_A);
  assert.equal(sent.status, 202);
  assert.equal(sent.body.reportDelivery.status, "queued");
  assert.equal(queued.length, 1);
  assert.equal(queued[0].contents.join(""), "报".repeat(2_000));
  assert.deepEqual(queued[0].sourceContext, {
    kind: "work_item_report",
    workItemId: item.id,
    reportDraftId: confirmed.id,
    reportDeliveryId: delivery.id,
    contentDigest: delivery.contentDigest,
  });
  assert.equal(approvals.at(-1).context.action, "work_item.report.deliver");
  assert.equal(approvals.at(-1).context.targetId, delivery.id);
  assert.equal(approvals.at(-1).context.allowLegacy, false);
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.state, "open");

  state.channelDeliveries.push(...sent.body.reportDelivery.channelDeliveryIds.map((id, index) => ({
    id,
    ownerTeamId: ACTOR_A.teamId,
    status: "delivered",
    attempts: 1,
    providerReceiptId: `provider_${index + 1}`,
    lastErrorCode: null,
    updatedAt: "2026-07-24T00:01:00.000Z",
  })));
  const receipt = service.getReportDelivery({
    workItemId: item.id,
    draftId: confirmed.id,
    deliveryId: delivery.id,
  }, ACTOR_A).body.reportDelivery;
  assert.equal(receipt.status, "delivered");
  assert.equal(receipt.receipt.deliveredChunks, receipt.chunkCount);
  assert.equal(receipt.receipt.providerReceiptIds.length, receipt.chunkCount);
  state.channelDeliveries[0].status = "failed_terminal";
  state.channelDeliveries[0].lastErrorCode = "provider_rejected";
  const failedReceipt = service.getReportDelivery({
    workItemId: item.id,
    draftId: confirmed.id,
    deliveryId: delivery.id,
  }, ACTOR_A).body.reportDelivery;
  assert.equal(failedReceipt.status, "failed");
  assert.equal(failedReceipt.receipt.failedChunks, 1);
  assert.deepEqual(failedReceipt.receipt.lastErrorCodes, ["provider_rejected"]);
  const replayedSend = service.sendReportDelivery({
    workItemId: item.id,
    draftId: confirmed.id,
    deliveryId: delivery.id,
    expectedRevision: delivery.revision,
    idempotencyKey: "delivery-send",
    approvalToken: "already-consumed",
  }, ACTOR_A);
  assert.equal(replayedSend.status, 200);
  assert.equal(replayedSend.body.replayed, true);
  assert.equal(queued.length, 1);
  assert.deepEqual(
    state.workItemActivities.slice(0, 2).map((activity) => activity.action),
    ["report_delivery_sent", "report_delivery_previewed"],
  );
});

test("report generation includes bounded result summaries but excludes transcripts and side-effect fields", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({ projectId: "prj_a", title: "Safe report context" }, ACTOR_A).body.workItem;
  state.workItems[0].executionBindings = [{ kind: "auto_run", targetId: "run_report" }];
  state.autoRuns = [{
    id: "run_report",
    projectId: "prj_a",
    teamId: "team_a",
    status: "done",
    resultSummary: "Verified the bounded rollout result.",
    transcript: "RAW_TRANSCRIPT_SECRET",
    credential: "CREDENTIAL_SECRET",
  }];
  const generated = service.generateReportDraft({
    workItemId: created.id,
    expectedWorkItemRevision: created.revision,
    idempotencyKey: "report-safe-context",
  }, ACTOR_A);
  assert.equal(generated.status, 201);
  assert.match(generated.body.reportDraft.content, /bounded rollout result/);
  assert.equal(generated.body.reportDraft.source.executionResults[0].id, "run_report");
  assert.doesNotMatch(JSON.stringify(generated.body.reportDraft), /RAW_TRANSCRIPT_SECRET|CREDENTIAL_SECRET/);
  assert.equal(service.generateReportDraft({
    workItemId: created.id,
    expectedWorkItemRevision: created.revision,
    idempotencyKey: "report-forbidden-send",
    send: true,
  }, ACTOR_A).body.error, "invalid_work_item_report_generate_fields");
  assert.equal(service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem.state, "open");
});

test("report generation excludes execution summaries outside the work item project and tenant", () => {
  const { service, state } = harness();
  state.projects.push({ id: "prj_c", ownerTeamId: "team_a" });
  const created = service.createWorkItem({ projectId: "prj_a", title: "Scoped report context" }, ACTOR_A).body.workItem;
  state.workItems[0].executionBindings = [
    { kind: "application_invocation", id: "inv_local" },
    { kind: "auto_run", targetId: "run_foreign_project" },
    { kind: "auto_run", targetId: "run_same_team_other_project" },
    { kind: "auto_run", targetId: "run_foreign_team" },
    { kind: "application_invocation", id: "inv_foreign" },
    { kind: "application_invocation", id: "inv_projectless" },
    { kind: "worktree", targetId: "run_wrong_binding_kind" },
  ];
  state.autoRuns = [{
    id: "run_foreign_project",
    projectId: "prj_b",
    teamId: "team_b",
    status: "done",
    resultSummary: "FOREIGN_PROJECT_SECRET",
  }, {
    id: "run_same_team_other_project",
    projectId: "prj_c",
    teamId: "team_a",
    status: "done",
    resultSummary: "OTHER_PROJECT_SECRET",
  }, {
    id: "run_foreign_team",
    projectId: "prj_a",
    teamId: "team_b",
    status: "done",
    resultSummary: "FOREIGN_TEAM_SECRET",
  }, {
    id: "run_wrong_binding_kind",
    projectId: "prj_a",
    teamId: "team_a",
    status: "done",
    resultSummary: "WRONG_BINDING_KIND_SECRET",
  }];
  state.invocations = [{
    id: "inv_local",
    options: { metadata: { projectId: "prj_a", teamId: "team_a" } },
    status: "succeeded",
    result: { summary: "Included same-project result." },
  }, {
    id: "inv_foreign",
    options: { metadata: { projectId: "prj_b", teamId: "team_b" } },
    status: "succeeded",
    result: { summary: "FOREIGN_INVOCATION_SECRET" },
  }, {
    id: "inv_projectless",
    requestedBy: "usr_a",
    status: "succeeded",
    result: { summary: "PROJECTLESS_INVOCATION_SECRET" },
  }];

  const generated = service.generateReportDraft({
    workItemId: created.id,
    expectedWorkItemRevision: created.revision,
    idempotencyKey: "report-scoped-context",
  }, ACTOR_A);

  assert.equal(generated.status, 201);
  assert.deepEqual(generated.body.reportDraft.source.executionResults.map((entry) => entry.id), ["inv_local"]);
  assert.match(generated.body.reportDraft.content, /same-project result/i);
  assert.doesNotMatch(
    JSON.stringify(generated.body.reportDraft),
    /FOREIGN_PROJECT_SECRET|OTHER_PROJECT_SECRET|FOREIGN_TEAM_SECRET|FOREIGN_INVOCATION_SECRET|PROJECTLESS_INVOCATION_SECRET|WRONG_BINDING_KIND_SECRET/,
  );
});

test("external issue funnel reports stages and actionable stalls without crossing tenants", () => {
  const { service, state } = harness({ clock: () => "2026-07-26T12:00:00.000Z" });
  const imported = service.createWorkItemFromExternal({
    projectId: "prj_a", provider: "gitlab",
    remote: { number: 71, title: "Stalled intake", body: "", state: "open", labels: [], repository: "a/repo", updatedAt: "2026-07-24T00:00:00.000Z" },
  }, ACTOR_A).body.workItem;
  const stored = state.workItems.find((item) => item.id === imported.id);
  stored.createdAt = "2026-07-24T00:00:00.000Z";
  stored.externalBindings[0].linkedAt = "2026-07-24T00:00:00.000Z";
  service.createWorkItemFromExternal({
    projectId: "prj_b", provider: "gitea",
    remote: { number: 72, title: "Foreign", body: "", state: "open", labels: [], repository: "b/repo", updatedAt: "2026-07-24T00:00:00.000Z" },
  }, ACTOR_B);

  const result = service.getExternalIssueFunnel({}, ACTOR_A);
  assert.equal(result.body.metrics.total, 1);
  assert.equal(result.body.metrics.notStarted, 1);
  assert.equal(result.body.metrics.stalled, 1);
  assert.equal(result.body.stalls[0].kind, "imported_not_started");
  assert.equal(result.body.stalls[0].workItemId, imported.id);
});
