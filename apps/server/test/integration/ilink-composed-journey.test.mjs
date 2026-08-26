import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createServerRuntimeServices } from "../../src/runtime/service-composer.mjs";
import { createServerState } from "../../src/runtime/state-factory.mjs";

const NOW = "2026-08-14T00:00:00.000Z";
const OWNER = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

test("composed iLink journey: poll → import → channel reply queue → provider send", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "myagenttool-ilink-composed-"));
  await writeFile(join(projectPath, "alpha.txt"), "alpha\n", "utf8");
  await writeFile(join(projectPath, "beta.txt"), "beta\n", "utf8");
  await writeFile(join(projectPath, "gamma.txt"), "gamma\n", "utf8");
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
  let firstPoll = true;
  const sent = [];
  const credentials = new Map([["ila_composed", { botToken: "secret", baseUrl: "https://example.test" }]]);
  const fakeClient = {
    notifyStart: async () => {},
    notifyStop: async () => {},
    getUpdates: async () => {
      if (!firstPoll) return new Promise(() => {});
      firstPoll = false;
      setTimeout(() => deps.stopIlink(), 0);
      return {
        ret: 0,
        get_updates_buf: "cursor-1",
        msgs: [{
          message_id: 101,
          from_user_id: "wx-composed",
          message_type: 1,
          context_token: "ctx-composed",
          item_list: [{ type: 1, text_item: { text: "/help" } }],
        }],
      };
    },
    sendMessage: async (payload) => {
      sent.push(payload);
      return { clientId: payload.clientId ?? "provider-receipt-1" };
    },
  };
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
    ilinkCredentialStore: {
      load: (id) => credentials.get(id) ?? null,
      save: (id, value) => credentials.set(id, value),
      remove: (id) => credentials.delete(id),
    },
    ilinkClientFactory: () => fakeClient,
  });

  const channel = {
    id: "chn_composed",
    provider: "wechat_ilink",
    ownerTeamId: "team_local",
    status: "enabled",
    operationMode: "personal",
    taskProjectId: defaultProject.id,
    taskTerminalId: (state.devices ?? [])[0]?.id ?? "dev_local",
  };
  state.channels.push(channel);
  state.ilinkAccounts.push({
    id: "ila_composed",
    channelId: channel.id,
    ownerTeamId: "team_local",
    ownerUserId: OWNER.userId,
    status: "connected",
    cursor: "",
    botId: "bot-composed",
  });
  const mapped = deps.mapChannelIdentity({ channelId: channel.id, externalUserId: "wx-composed", userId: OWNER.userId }, OWNER);
  assert.equal(mapped.ok, true);
  deps.setChannelDeliverySender("wechat_ilink", (payload) => deps.sendIlinkApplicationMessage(payload));

  // P4 object verification: the natural-language customer reference can only
  // pass an external-send preview when a same-team business record exists.
  state.businessEntities.push({
    id: "bent_composed_customer",
    ownerTeamId: "team_local",
    projectId: defaultProject.id,
    sourceId: "wfs_composed",
    entityType: "customer",
    businessKey: "客户",
    fields: { name: "客户" },
    revision: 1,
    status: "active",
  });

  deps.startIlink();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const imported = state.channelEvents.find((event) => event.providerMessageId === "101");
  assert.ok(imported);
  assert.equal(imported.status, "dispatched");
  assert.match(imported.replyText, /直接发送文字、图片、语音或文件/);
  assert.equal(state.channelDeliveries.length, 1);
  assert.equal(state.channelDeliveries[0].replyContext.contextToken, "ctx-composed");

  await deps.sweepChannelDeliveries();
  assert.equal(state.channelDeliveries[0].status, "sent_unconfirmed");
  assert.equal(state.channelDeliveries[0].providerReceiptId, null);
  assert.equal(state.channelDeliveries[0].providerClientId, state.channelDeliveries[0].id);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /直接发送文字、图片、语音或文件/);
  assert.equal(sent[0].contextToken, "ctx-composed");
  assert.equal(sent[0].clientId, state.channelDeliveries[0].id);

  const taskImported = await deps.importChannelEvent({
    channelId: channel.id,
    providerMessageId: "102",
    externalUserId: "wx-composed",
    content: "/task 请根据客户询价资料生成报价单",
  });
  assert.equal(taskImported.ok, true);
  const channelWorkItem = state.workItems.find((item) => item.channelOrigin?.messageId === taskImported.eventId);
  assert.ok(channelWorkItem);
  assert.equal(channelWorkItem.channelTaskContract.domain, "office");
  assert.equal(channelWorkItem.channelTaskContract.source, "channel");
  assert.ok(channelWorkItem.acceptanceCriteria.length >= 2);
  assert.ok(channelWorkItem.verificationSop.length >= 2);
  assert.equal(channelWorkItem.channelOrigin.channelId, channel.id);

  const filesBeforeReadOnlyTask = (await readdir(projectPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const contentsBeforeReadOnlyTask = await Promise.all(filesBeforeReadOnlyTask.map(async (name) => [
    name,
    await readFile(join(projectPath, name), "utf8"),
  ]));
  const readOnlyImported = await deps.importChannelEvent({
    channelId: channel.id,
    providerMessageId: "102-read-only",
    externalUserId: "wx-composed",
    content: "帮我只读取当前项目目录，列出 3 个文件，不要修改任何文件",
  });
  assert.equal(readOnlyImported.ok, true);
  const readOnlyEvent = state.channelEvents.find((event) => event.id === readOnlyImported.eventId);
  const readOnlyWorkItem = state.workItems.find((item) => item.channelOrigin?.messageId === readOnlyImported.eventId);
  const readOnlyThread = state.channelTaskThreads.find((thread) => thread.workItemId === readOnlyWorkItem?.id);
  assert.match(readOnlyEvent.replyText, /已按只读方式查看/);
  assert.match(readOnlyEvent.replyText, /没有修改任何文件/);
  assert.match(readOnlyEvent.replyText, /alpha\.txt/);
  assert.match(readOnlyEvent.replyText, /beta\.txt/);
  assert.match(readOnlyEvent.replyText, /gamma\.txt/);
  assert.doesNotMatch(readOnlyEvent.replyText, /\/private\/|\/var\/|## Result|What changed/);
  assert.equal(readOnlyWorkItem.channelTaskContract.operationIntent.accessMode, "read_only");
  assert.equal(readOnlyWorkItem.channelTaskContract.riskLevel, "low");
  assert.equal(readOnlyWorkItem.channelTaskContract.executionStrategy.strategy, "governed_bridge");
  assert.equal(readOnlyWorkItem.channelTaskContract.executionStrategy.safeToAutoRoute, true);
  assert.equal(readOnlyWorkItem.status, "done");
  assert.equal(readOnlyWorkItem.executionPolicy, "auto");
  assert.equal(readOnlyWorkItem.waitingOn, "none");
  assert.equal(readOnlyWorkItem.channelTaskContract.dataMutationPreview, null);
  assert.equal(readOnlyThread.status, "succeeded");
  assert.equal(readOnlyThread.waitingFor, null);
  assert.match(readOnlyThread.resultSummary, /找到以下 3 个文件/);
  assert.equal(state.channelIntentMetrics.experience.directLocalReadOnlyResults, 1);
  assert.equal(state.autoRuns.some((run) => run.localIssueId === readOnlyWorkItem.id), false);
  const filesAfterReadOnlyTask = (await readdir(projectPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const contentsAfterReadOnlyTask = await Promise.all(filesAfterReadOnlyTask.map(async (name) => [
    name,
    await readFile(join(projectPath, name), "utf8"),
  ]));
  assert.deepEqual(filesAfterReadOnlyTask, filesBeforeReadOnlyTask);
  assert.deepEqual(contentsAfterReadOnlyTask, contentsBeforeReadOnlyTask);

  // The user-visible terminal notification must wait until the AutoRun reaction
  // has projected the Invocation outcome. Otherwise an early "still running"
  // delivery claims the dedupe key and the real failure/completion is lost.
  const lifecycleThread = {
    id: "cth_composed_lifecycle",
    channelId: channel.id,
    conversationId: readOnlyEvent.conversationId,
    workItemId: "wi_composed_lifecycle",
    autoRunId: "aur_composed_lifecycle",
    invocationId: "inv_composed_lifecycle",
    status: "running",
    summary: "组合链路任务",
    createdAt: NOW,
    updatedAt: NOW,
    lastProgressAt: NOW,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const lifecycleAutoRun = {
    id: "aur_composed_lifecycle",
    status: "running",
    phase: "implementing",
    projectId: defaultProject.id,
    localIssueId: lifecycleThread.workItemId,
    executionChainId: lifecycleThread.workItemId,
    invocationId: "inv_composed_lifecycle",
    link: { type: "local_issue", number: 999, title: lifecycleThread.summary, state: "open" },
    channelOrigin: { channelId: channel.id, conversationId: readOnlyEvent.conversationId, threadId: lifecycleThread.id },
    createdAt: NOW,
    updatedAt: NOW,
  };
  const lifecycleInvocation = {
    id: "inv_composed_lifecycle",
    status: "running",
    requestedBy: OWNER.userId,
    options: { metadata: {
      autoRunId: lifecycleAutoRun.id,
      channel: {
        channelId: channel.id,
        conversationId: readOnlyEvent.conversationId,
        threadId: lifecycleThread.id,
        workItemId: lifecycleThread.workItemId,
        autoRunId: lifecycleAutoRun.id,
        projectId: defaultProject.id,
      },
    } },
    delivery: { state: "acknowledged" },
    cancellation: { state: "none" },
    createdAt: NOW,
    updatedAt: NOW,
  };
  state.channelTaskThreads.push(lifecycleThread);
  state.autoRuns.unshift(lifecycleAutoRun);
  state.invocations.unshift(lifecycleInvocation);
  deps.completeInvocation(lifecycleInvocation, { status: "failed", result: { summary: "执行检查失败" } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(lifecycleAutoRun.status, "failed");
  assert.equal(lifecycleThread.status, "failed");
  const terminalDelivery = state.channelDeliveries.find((delivery) =>
    delivery.taskContext?.threadId === lifecycleThread.id
    && delivery.taskContext?.notificationEvent === "failed");
  assert.ok(terminalDelivery);
  assert.doesNotMatch(terminalDelivery.content, /继续执行中/);
  await deps.sweepChannelDeliveries();
  assert.equal(terminalDelivery.status, "sent_unconfirmed");

  const highRiskImported = await deps.importChannelEvent({
    channelId: channel.id,
    providerMessageId: "103",
    externalUserId: "wx-composed",
    content: "/task 请把报价单发给客户",
  });
  assert.equal(highRiskImported.ok, true);
  const highRiskEvent = state.channelEvents.find((event) => event.id === highRiskImported.eventId);
  const highRiskWorkItem = state.workItems.find((item) => item.channelOrigin?.messageId === highRiskImported.eventId);
  assert.match(highRiskEvent.replyText, /执行前请确认这份预览/);
  assert.match(highRiskEvent.replyText, /对象：客户/);
  assert.equal(highRiskWorkItem.channelTaskContract.executionPreview.target, "客户");
  assert.equal(highRiskWorkItem.channelTaskContract.executionPreview.targetStatus, "inferred");
  assert.ok(highRiskWorkItem.channelTaskContract.executionPreview.digest);
  assert.equal(highRiskWorkItem.channelTaskContract.executionPreview.objectValidation.state, "verified");
  assert.deepEqual(highRiskWorkItem.channelTaskContract.executionPreview.objectValidation.verifiedObjects.map((object) => object.kind), ["contact"]);
  assert.equal(state.channelTaskThreads.at(-1).waitingFor, "channel_confirmation");
  // The object is rechecked at the confirmation boundary. A changed business
  // record invalidates the old preview and leaves the request pending.
  state.businessEntities.find((row) => row.id === "bent_composed_customer").revision = 2;
  const staleConfirm = await deps.importChannelEvent({
    channelId: channel.id,
    providerMessageId: "103-stale-confirm",
    externalUserId: "wx-composed",
    content: "确认执行",
  });
  const staleConfirmEvent = state.channelEvents.find((event) => event.id === staleConfirm.eventId);
  assert.match(staleConfirmEvent.replyText, /联系人、账户、文件或发布目标.*变化/);
  assert.equal(state.channelTaskRequests.find((request) => request.workItemId === highRiskWorkItem.id).status, "pending");

  const financialImported = await deps.importChannelEvent({
    channelId: channel.id,
    providerMessageId: "104",
    externalUserId: "wx-composed",
    content: "/task 请帮我汇款",
  });
  assert.equal(financialImported.ok, true);
  const financialEvent = state.channelEvents.find((event) => event.id === financialImported.eventId);
  assert.match(financialEvent.replyText, /请先补充/);
  const financialRequest = state.channelTaskRequests.at(-1);
  assert.equal(financialRequest.previewReady, false);
  const financialThread = state.channelTaskThreads.find((thread) => thread.workItemId === financialRequest.workItemId);
  const financialSelect = await deps.importChannelEvent({
    channelId: channel.id,
    providerMessageId: "105",
    externalUserId: "wx-composed",
    content: `继续 ${financialThread.shortRef}`,
  });
  assert.equal(financialSelect.ok, true);
  const financialConfirm = await deps.importChannelEvent({
    channelId: channel.id,
    providerMessageId: "106",
    externalUserId: "wx-composed",
    content: "确认执行",
  });
  const financialConfirmEvent = state.channelEvents.find((event) => event.id === financialConfirm.eventId);
  assert.match(financialConfirmEvent.replyText, /请先补充/);
  assert.equal(financialRequest.status, "pending");

  // P4.7: a ready relation is independently recorded before execution. The
  // record keeps only object ids/revisions, so a later review can distinguish
  // system verification from the task's human confirmation without storing
  // source values in the audit row.
  state.channelObjectFileSources.push(
    {
      id: "file_customer_relation",
      ownerTeamId: "team_local",
      projectId: defaultProject.id,
      kind: "contact",
      fileName: "customers.csv",
      revision: 1,
      status: "active",
    },
    {
      id: "file_order_relation",
      ownerTeamId: "team_local",
      projectId: defaultProject.id,
      kind: "order",
      fileName: "orders.csv",
      revision: 1,
      status: "active",
    },
  );
  state.channelObjectRecords.push(
    {
      id: "contact_relation_1",
      ownerTeamId: "team_local",
      projectId: defaultProject.id,
      kind: "contact",
      sourceId: "file_customer_relation",
      label: "客户A",
      businessKey: "客户A",
      fields: { name: "客户A" },
      revision: 1,
      status: "active",
    },
    {
      id: "order_relation_1",
      ownerTeamId: "team_local",
      projectId: defaultProject.id,
      kind: "order",
      sourceId: "file_order_relation",
      label: "订单A",
      businessKey: "订单A",
      fields: { customer: "客户A" },
      revision: 1,
      status: "active",
    },
  );
  state.routineDefinitions.push({
    id: "rtd_relation_quote",
    familyId: "family_relation_quote",
    ownerTeamId: "team_local",
    projectId: defaultProject.id,
    templateScope: "team",
    state: "published",
    version: 1,
    name: "客户报价单",
    description: "根据客户订单生成报价单",
    triggerDocumentTypes: ["unknown"],
    steps: [
      { key: "read_orders", kind: "extract", label: "客户订单", configuration: { inputSummary: "客户订单" } },
      { key: "write_quote", kind: "generate", label: "生成报价单", configuration: { expectedOutput: "报价单" } },
    ],
    dataRequirements: [
      { id: "customers", kind: "contact", label: "客户", fields: ["name"], required: true },
      { id: "orders", kind: "order", label: "订单", fields: ["customer"], required: true },
    ],
    relations: [{
      id: "customer_order",
      type: "lookup",
      fromRequirementId: "customers",
      fromField: "name",
      toRequirementId: "orders",
      toField: "customer",
      required: true,
    }],
  });
  const relationTask = await deps.importChannelEvent({
    channelId: channel.id,
    providerMessageId: "107",
    externalUserId: "wx-composed",
    content: "/task 请根据客户订单生成报价单",
  });
  assert.equal(relationTask.ok, true);
  const relationWorkItem = state.workItems.find((item) => item.channelOrigin?.messageId === relationTask.eventId);
  assert.ok(relationWorkItem);
  assert.equal(relationWorkItem.channelTaskContract.dataRelationPreview.status, "ready");
  assert.equal(relationWorkItem.channelTaskContract.dataRelationConfirmation.confirmationMode, "runtime_verified");
  const relationConfirmation = state.channelDataRelationConfirmations.find((record) => record.workItemId === relationWorkItem.id);
  assert.ok(relationConfirmation);
  assert.deepEqual(relationConfirmation.objectSnapshot, [
    { id: "contact_relation_1", sourceId: "file_customer_relation", revision: 1 },
    { id: "order_relation_1", sourceId: "file_order_relation", revision: 1 },
  ]);
  assert.equal(relationConfirmation.objectSnapshot[0].fields, undefined);

  const mutationTask = await deps.importChannelEvent({
    channelId: channel.id,
    providerMessageId: "108",
    externalUserId: "wx-composed",
    content: "/task 请批量修改 customers.csv 和 orders.csv 的客户字段",
  });
  assert.equal(mutationTask.ok, true);
  const mutationEvent = state.channelEvents.find((event) => event.id === mutationTask.eventId);
  const mutationWorkItem = state.workItems.find((item) => item.channelOrigin?.messageId === mutationTask.eventId);
  assert.ok(mutationWorkItem);
  assert.equal(mutationWorkItem.status, "backlog", "batch file writes must not auto-route");
  assert.equal(mutationWorkItem.channelTaskContract.dataMutationPreview.status, "needs_review");
  assert.equal(mutationWorkItem.channelTaskContract.executionPreview.previewReady, false);
  assert.match(mutationEvent.replyText, /修改 CSV\/Excel/);
  assert.match(mutationEvent.replyText, /哪几条记录/);
  assert.match(mutationEvent.replyText, /不会直接改原文件/);
  assert.doesNotMatch(mutationEvent.replyText, /模板|数据计划|Ledger|安全写回/);
  assert.equal(state.channelTaskRequests.find((request) => request.workItemId === mutationWorkItem.id).status, "pending");
  deps.stopIlink();
});
