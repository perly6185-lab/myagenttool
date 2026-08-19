import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createServerRuntimeServices } from "../../src/runtime/service-composer.mjs";
import { createServerState } from "../../src/runtime/state-factory.mjs";

const NOW = "2026-08-17T00:00:00.000Z";
const OWNER = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

test("P4.10 personal Channel previews, confirms, commits, and audits one CSV row", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "myagenttool-p410-channel-ledger-"));
  await mkdir(join(projectPath, "ledgers"), { recursive: true });
  const ledgerContent = "Customer ID,Customer,Status\n1001,Old Name,待处理\n";
  await writeFile(join(projectPath, "ledgers", "customers.csv"), ledgerContent, "utf8");
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
  const { httpDependencies: deps } = createServerRuntimeServices({
    namespace: "p410-test",
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
  state.workflowSources.push({
    id: "wfs_p410_customers",
    ownerTeamId: OWNER.teamId,
    projectId: defaultProject.id,
    relativePath: ".",
    state: "active",
  });
  state.workflowArtifacts.push({
    id: "wfa_p410_customers",
    ownerTeamId: OWNER.teamId,
    projectId: defaultProject.id,
    sourceId: "wfs_p410_customers",
    relativePath: "ledgers/customers.csv",
    availability: "available",
    exclusion: false,
  });
  const definitionResult = deps.createLedgerDefinition({
    projectId: defaultProject.id,
    sourceId: "wfs_p410_customers",
    name: "Customers ledger",
    documentType: "inquiry_ledger",
    format: "csv",
    relativePath: "ledgers/customers.csv",
    businessKeyField: "customer_id",
    fieldMappings: { customer_id: "Customer ID", customer: "Customer", status: "Status" },
    requiredFields: ["customer_id", "customer"],
    writePolicy: { approval: "always", allowInsert: false, allowUpdate: true },
  }, OWNER);
  assert.equal(definitionResult.status, 201);
  const definition = definitionResult.body.ledgerDefinition;
  assert.equal((await deps.activateLedgerDefinition({
    ledgerDefinitionId: definition.id,
    expectedRevision: definition.revision,
  }, OWNER)).status, 200);
  state.channelObjectFileSources.push({
    id: "csrc_p410_customers",
    ownerTeamId: OWNER.teamId,
    projectId: defaultProject.id,
    fileName: "customers.csv",
    format: "csv",
    revision: 1,
    rowCount: 1,
    contentHash: createHash("sha256").update(ledgerContent).digest("hex"),
    status: "active",
  });
  const binding = deps.upsertChannelMutationBinding({
    projectId: defaultProject.id,
    fileSourceId: "csrc_p410_customers",
    ledgerDefinitionId: definition.id,
  }, OWNER);
  assert.equal(binding.status, 201);

  const registered = deps.registerChannel({ provider: "wecom", name: "P4.10" }, OWNER);
  const channel = state.channels.find((candidate) => candidate.id === registered.body.channel.id);
  assert.ok(channel);
  channel.operationMode = "personal";
  channel.taskAutoRoute = true;
  channel.allowSelfApprove = true;
  channel.taskProjectId = defaultProject.id;
  channel.taskTerminalId = (state.devices ?? [])[0]?.id ?? "dev_local";
  assert.equal(deps.enableChannel({ channelId: channel.id, approvalToken: "ok" }, OWNER).status, 200);
  assert.equal(deps.mapChannelIdentity({ channelId: channel.id, externalUserId: "wx_p410", userId: OWNER.userId }, OWNER).ok, true);

  const task = await deps.importChannelEvent({
    channelId: channel.id,
    providerMessageId: "p410-task",
    externalUserId: "wx_p410",
    content: "/task 把 customers.csv 里的 1001 的 客户 改成 Acme",
  });
  assert.equal(task.ok, true);
  const taskEvent = state.channelEvents.find((event) => event.id === task.eventId);
  assert.match(taskEvent.replyText, /文件修改预览/);
  const workItem = state.workItems.find((item) => item.channelOrigin?.messageId === task.eventId);
  assert.ok(workItem);
  assert.ok(workItem.channelTaskContract.ledgerMutationPreview);
  assert.equal(workItem.channelTaskContract.ledgerMutationPreview.changedCells[0].field, "customer");
  assert.equal(workItem.channelTaskContract.dataMutationPreview.status, "ready");

  const confirmation = await deps.importChannelEvent({
    channelId: channel.id,
    providerMessageId: "p410-confirm",
    externalUserId: "wx_p410",
    content: "确认执行",
  });
  assert.equal(confirmation.ok, true);
  const confirmationEvent = state.channelEvents.find((event) => event.id === confirmation.eventId);
  assert.match(confirmationEvent.replyText, /已完成文件修改/);
  assert.equal(state.channelTaskThreads.at(-1).status, "succeeded");
  assert.equal(state.channelTaskRequests.at(-1).status, "completed");
  assert.equal(state.ledgerMutationAudits.length, 1);
  assert.match(await readFile(join(projectPath, "ledgers", "customers.csv"), "utf8"), /1001,Acme,待处理/);
});

test("P4.11.1 Channel creates one batch preview for two explicitly scoped files", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "myagenttool-p411-channel-ledger-"));
  await mkdir(join(projectPath, "ledgers"), { recursive: true });
  const customers = "Customer ID,Customer,Status\n1001,Old Name,待处理\n";
  const orders = "Order ID,Customer,Status\n2001,Acme,待处理\n";
  await writeFile(join(projectPath, "ledgers", "customers.csv"), customers, "utf8");
  await writeFile(join(projectPath, "ledgers", "orders.csv"), orders, "utf8");
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
  const { httpDependencies: deps } = createServerRuntimeServices({
    namespace: "p411-test",
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
  state.workflowSources.push({
    id: "wfs_p411_files", ownerTeamId: OWNER.teamId, projectId: defaultProject.id, relativePath: ".", state: "active",
  });
  for (const [id, relativePath] of [["customers", "ledgers/customers.csv"], ["orders", "ledgers/orders.csv"]]) {
    state.workflowArtifacts.push({
      id: `wfa_p411_${id}`, ownerTeamId: OWNER.teamId, projectId: defaultProject.id,
      sourceId: "wfs_p411_files", relativePath, availability: "available", exclusion: false,
    });
  }
  state.businessDocumentClassifications.push({
    id: "bdc_p411_order", ownerTeamId: OWNER.teamId, projectId: defaultProject.id,
    sourceId: "wfs_p411_files", artifactId: "wfa_p411_orders", documentType: "order",
    confirmationState: "confirmed",
  });
  state.channelObjectRecords.push({
    id: "ord_p411_2001", ownerTeamId: OWNER.teamId, projectId: defaultProject.id, kind: "order",
    sourceId: "csrc_p411_orders", label: "2001", businessKey: "2001", fields: { order_number: "2001", status: "待处理" },
    revision: 1, status: "active",
  });
  const customerDefinition = deps.createLedgerDefinition({
    projectId: defaultProject.id, sourceId: "wfs_p411_files", name: "Customers", documentType: "inquiry_ledger",
    format: "csv", relativePath: "ledgers/customers.csv", businessKeyField: "customer_id",
    fieldMappings: { customer_id: "Customer ID", customer: "Customer", status: "Status" },
    requiredFields: ["customer_id", "customer"], writePolicy: { approval: "always", allowInsert: false, allowUpdate: true },
  }, OWNER).body.ledgerDefinition;
  const orderDefinition = deps.createLedgerDefinition({
    projectId: defaultProject.id, sourceId: "wfs_p411_files", name: "Orders", documentType: "order_ledger",
    format: "csv", relativePath: "ledgers/orders.csv", businessKeyField: "order_id",
    fieldMappings: { order_id: "Order ID", customer: "Customer", status: "Status" },
    requiredFields: ["order_id", "customer"], writePolicy: { approval: "always", allowInsert: false, allowUpdate: true },
  }, OWNER).body.ledgerDefinition;
  for (const definition of [customerDefinition, orderDefinition]) {
    assert.equal((await deps.activateLedgerDefinition({ ledgerDefinitionId: definition.id, expectedRevision: definition.revision }, OWNER)).status, 200);
  }
  state.channelObjectFileSources.push(
    { id: "csrc_p411_customers", ownerTeamId: OWNER.teamId, projectId: defaultProject.id, kind: "contact", fileName: "customers.csv", format: "csv", revision: 1, rowCount: 1, status: "active", contentHash: createHash("sha256").update(customers).digest("hex") },
    { id: "csrc_p411_orders", ownerTeamId: OWNER.teamId, projectId: defaultProject.id, kind: "order", fileName: "orders.csv", format: "csv", revision: 1, rowCount: 1, status: "active", contentHash: createHash("sha256").update(orders).digest("hex") },
  );
  assert.equal(deps.upsertChannelMutationBinding({ projectId: defaultProject.id, fileSourceId: "csrc_p411_customers", ledgerDefinitionId: customerDefinition.id }, OWNER).status, 201);
  assert.equal(deps.upsertChannelMutationBinding({ projectId: defaultProject.id, fileSourceId: "csrc_p411_orders", ledgerDefinitionId: orderDefinition.id }, OWNER).status, 201);
  state.routineDefinitions.push({
    id: "rtd_p411_batch", familyId: "family_p411_batch", ownerTeamId: OWNER.teamId, projectId: defaultProject.id, state: "published", version: 1,
    name: "customers.csv", description: "更新 customers.csv 和 orders.csv 中的记录", triggerDocumentTypes: ["order"],
    dataRequirements: [
      { id: "customers", kind: "contact", label: "客户文件", fields: ["name"], required: true },
      { id: "orders", kind: "order", label: "订单文件", fields: ["status"], required: true },
    ],
    mutationPolicy: {
      operations: ["update"], targetRequirementIds: ["customers", "orders"], keyFields: ["customer_id", "order_id"],
      mutableFields: ["customer", "status"], allowMultipleSources: true, allowMultipleRows: true, maxRows: 20,
      requireUserConfirmation: true, writeMode: "safe_copy_replace",
    },
    steps: [],
  });
  const registered = deps.registerChannel({ provider: "wecom", name: "P4.11" }, OWNER);
  const channel = state.channels.find((candidate) => candidate.id === registered.body.channel.id);
  channel.operationMode = "personal";
  channel.taskAutoRoute = false;
  channel.allowSelfApprove = true;
  channel.taskProjectId = defaultProject.id;
  channel.taskTerminalId = state.devices?.[0]?.id ?? "dev_local";
  assert.equal(deps.enableChannel({ channelId: channel.id, approvalToken: "ok" }, OWNER).status, 200);
  assert.equal(deps.mapChannelIdentity({ channelId: channel.id, externalUserId: "wx_p411", userId: OWNER.userId }, OWNER).ok, true);
  const filed = await deps.importChannelEvent({
    channelId: channel.id,
    providerMessageId: "p411-task",
    externalUserId: "wx_p411",
    content: "/task 把 customers.csv 里的 1001 的 客户 改成 Acme；把 orders.csv 里的 2001 的 状态 改成 已完成",
  });
  assert.equal(filed.ok, true, JSON.stringify(filed));
  const workItem = state.workItems.find((item) => item.channelOrigin?.messageId === filed.eventId);
  assert.ok(workItem.channelTaskContract.ledgerMutationPreview, JSON.stringify({
    filed,
    dataMutationPreview: workItem.channelTaskContract.dataMutationPreview,
    dataMutationBinding: workItem.channelTaskContract.dataMutationBinding,
    templateMatch: workItem.channelTaskContract.templateMatch,
    ledgerMutationPreparation: workItem.channelTaskContract.ledgerMutationPreparation,
    objectValidation: workItem.channelTaskContract.executionPreview.objectValidation,
  }));
  assert.equal(workItem.channelTaskContract.ledgerMutationPreview.kind, "batch");
  assert.equal(workItem.channelTaskContract.ledgerMutationPreview.operationCount, 2);
  const committed = await deps.commitLedgerBatchUpsertPreview({
    batchPreviewId: workItem.channelTaskContract.ledgerMutationPreview.id,
    expectedRevision: workItem.channelTaskContract.ledgerMutationPreview.revision,
    approved: true,
  }, OWNER);
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  assert.match(await readFile(join(projectPath, "ledgers", "customers.csv"), "utf8"), /1001,Acme,待处理/);
  assert.match(await readFile(join(projectPath, "ledgers", "orders.csv"), "utf8"), /2001,Acme,已完成/);
});
