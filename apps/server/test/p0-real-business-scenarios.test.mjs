import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createServerRuntimeServices } from "../src/runtime/service-composer.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createChannelObjectImportService } from "../src/services/channel-object-imports.mjs";
import { createChannelObjectRegistryService } from "../src/services/channel-object-registry.mjs";
import { buildPaymentReconciliationPreview } from "../src/services/channel-payment-reconciliation.mjs";

const NOW = "2026-08-17T00:00:00.000Z";
const OWNER = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

function financialImportHarness() {
  const state = {
    projects: [{ id: "prj_payment", ownerTeamId: OWNER.teamId }],
    businessEntities: [],
    channelObjectRecords: [],
    channelObjectImports: [],
    channelObjectSyncs: [],
  };
  let counter = 0;
  const options = {
    state,
    now: () => NOW,
    nextId: (prefix) => `${prefix}_payment_${++counter}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
  };
  const registry = createChannelObjectRegistryService(options);
  const imports = createChannelObjectImportService({
    ...options,
    upsertChannelObject: registry.upsertChannelObject,
    setChannelObjectStatus: registry.setChannelObjectStatus,
  });
  return { state, imports };
}

function base64(value) { return Buffer.from(value).toString("base64"); }

async function mutationHarness({ files, definitions, routineDefinition = null }) {
  const projectPath = await mkdtemp(join(tmpdir(), "myagenttool-p0-real-"));
  const clock = { value: new Date(NOW) };
  await mkdir(join(projectPath, "ledgers"), { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    await writeFile(join(projectPath, relativePath), content, "utf8");
  }
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
  const { httpDependencies: deps } = createServerRuntimeServices({
    namespace: "p0-real",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: projectPath,
    persistenceEnabled: false,
    stateStorePath: join(projectPath, "state.json"),
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now: () => clock.value.toISOString(),
  });
  const sourceId = "wfs_p0_real";
  state.workflowSources.push({
    id: sourceId,
    ownerTeamId: OWNER.teamId,
    projectId: defaultProject.id,
    relativePath: ".",
    state: "active",
  });
  for (const [index, [relativePath, content]] of Object.entries(files).entries()) {
    state.workflowArtifacts.push({
      id: `wfa_p0_real_${index}`,
      ownerTeamId: OWNER.teamId,
      projectId: defaultProject.id,
      sourceId,
      relativePath,
      availability: "available",
      exclusion: false,
    });
    const fileName = relativePath.split("/").at(-1);
    state.channelObjectFileSources.push({
      id: `csrc_p0_real_${index}`,
      ownerTeamId: OWNER.teamId,
      projectId: defaultProject.id,
      kind: definitions.find((definition) => definition.relativePath === relativePath)?.kind ?? "file",
      fileName,
      format: "csv",
      revision: 1,
      rowCount: content.trim().split("\n").length - 1,
      contentHash: createHash("sha256").update(content).digest("hex"),
      status: "active",
    });
  }
  for (const artifact of state.workflowArtifacts) {
    const definitionInput = definitions.find((definition) => definition.relativePath === artifact.relativePath);
    if (definitionInput?.documentType === "order_ledger") {
      state.businessDocumentClassifications.push({
        id: `bdc_p0_real_${artifact.id}`,
        ownerTeamId: OWNER.teamId,
        projectId: defaultProject.id,
        sourceId,
        artifactId: artifact.id,
        documentType: "order",
        confirmationState: "confirmed",
      });
    }
  }
  const bindings = [];
  for (const definitionInput of definitions) {
    const created = deps.createLedgerDefinition({
      projectId: defaultProject.id,
      sourceId,
      name: definitionInput.name,
      documentType: definitionInput.documentType,
      format: "csv",
      relativePath: definitionInput.relativePath,
      businessKeyField: definitionInput.businessKeyField,
      fieldMappings: definitionInput.fieldMappings,
      requiredFields: definitionInput.requiredFields,
      writePolicy: {
        approval: "always",
        allowInsert: false,
        allowUpdate: true,
        ...(definitionInput.writePolicy ?? {}),
      },
    }, OWNER);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const definition = created.body.ledgerDefinition;
    assert.equal((await deps.activateLedgerDefinition({
      ledgerDefinitionId: definition.id,
      expectedRevision: definition.revision,
    }, OWNER)).status, 200);
    const source = state.channelObjectFileSources.find((candidate) => candidate.fileName === definitionInput.relativePath.split("/").at(-1));
    const binding = deps.upsertChannelMutationBinding({
      projectId: defaultProject.id,
      fileSourceId: source.id,
      ledgerDefinitionId: definition.id,
    }, OWNER);
    assert.equal(binding.status, 201, JSON.stringify(binding.body));
    bindings.push({ definition, source });
  }
  const routineDefinitions = Array.isArray(routineDefinition)
    ? routineDefinition
    : routineDefinition ? [routineDefinition] : [];
  for (const [index, definitionInput] of routineDefinitions.entries()) state.routineDefinitions.push({
    id: index === 0 ? "rtd_p0_real" : `rtd_p0_real_${index}`,
    familyId: index === 0 ? "family_p0_real" : `family_p0_real_${index}`,
    ownerTeamId: OWNER.teamId,
    projectId: defaultProject.id,
    templateScope: "personal",
    state: "published",
    version: 1,
    steps: [],
    ...definitionInput,
  });
  const registered = deps.registerChannel({ provider: "wecom", name: "P0 real" }, OWNER);
  const channel = state.channels.find((candidate) => candidate.id === registered.body.channel.id);
  channel.operationMode = "personal";
  channel.taskAutoRoute = false;
  channel.allowSelfApprove = true;
  channel.taskProjectId = defaultProject.id;
  channel.taskTerminalId = state.devices?.[0]?.id ?? "dev_local";
  assert.equal(deps.enableChannel({ channelId: channel.id, approvalToken: "ok" }, OWNER).status, 200);
  assert.equal(deps.mapChannelIdentity({ channelId: channel.id, externalUserId: "wx_p0_real", userId: OWNER.userId }, OWNER).ok, true);
  return {
    projectPath,
    state,
    deps,
    defaultProject,
    channel,
    bindings,
    clock,
    advanceTime(days) {
      clock.value = new Date(clock.value.getTime() + Number(days) * 86_400_000);
    },
  };
}

test("P0 real quotation follow-up uses a quotation ledger and reports a safe business preview", async () => {
  const h = await mutationHarness({
    files: { "ledgers/quotations.csv": "报价单号,客户,报价金额,跟进状态\nQ-1001,海棠科技,12800,待跟进\n" },
    definitions: [{
      kind: "quotation",
      name: "报价跟进",
      documentType: "quotation_ledger",
      relativePath: "ledgers/quotations.csv",
      businessKeyField: "quotation_number",
      fieldMappings: { quotation_number: "报价单号", customer: "客户", amount: "报价金额", status: "跟进状态" },
      requiredFields: ["quotation_number", "customer"],
    }],
  });
  const filed = await h.deps.importChannelEvent({
    channelId: h.channel.id,
    providerMessageId: "p0-quotation",
    externalUserId: "wx_p0_real",
    content: "请在 quotations.csv 里把 Q-1001 的 跟进状态改成 已跟进",
  });
  assert.equal(filed.ok, true, JSON.stringify(filed));
  const event = h.state.channelEvents.find((candidate) => candidate.id === filed.eventId);
  assert.match(event.replyText, /已收到/);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const draftConfirmation = await h.deps.importChannelEvent({
    channelId: h.channel.id,
    providerMessageId: "p0-quotation-draft-confirm",
    externalUserId: "wx_p0_real",
    content: "确认",
  });
  assert.equal(draftConfirmation.ok, true, JSON.stringify(draftConfirmation));
  const draftEvent = h.state.channelEvents.find((candidate) => candidate.id === draftConfirmation.eventId);
  assert.match(draftEvent.replyText, /安全写回预览/, JSON.stringify({ reply: draftEvent.replyText, thread: h.state.channelTaskThreads.at(-1), request: h.state.channelTaskRequests.at(-1), workItem: h.state.workItems.at(-1)?.channelTaskContract }));
  assert.match(draftEvent.replyText, /quotations\.csv/);
  assert.match(draftEvent.replyText, /status/);
  assert.match(draftEvent.replyText, /待跟进/);
  assert.match(draftEvent.replyText, /已跟进/);
  const workItem = h.state.workItems.at(-1);
  assert.equal(workItem.channelTaskContract.ledgerMutationPreview.changedCells[0].field, "status");
  assert.match(await readFile(join(h.projectPath, "ledgers/quotations.csv"), "utf8"), /Q-1001,海棠科技,12800,待跟进/);

  const approved = await h.deps.importChannelEvent({
    channelId: h.channel.id,
    providerMessageId: "p0-quotation-execute",
    externalUserId: "wx_p0_real",
    content: "确认执行",
  });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  const approvalEvent = h.state.channelEvents.find((candidate) => candidate.id === approved.eventId);
  assert.match(approvalEvent.replyText, /已完成安全写回/);
  assert.match(await readFile(join(h.projectPath, "ledgers/quotations.csv"), "utf8"), /Q-1001,海棠科技,12800,已跟进/);
  assert.equal(h.state.ledgerMutationAudits.length, 1);
});

test("P0 real shipping exception scopes order and shipment changes into one batch", async () => {
  const h = await mutationHarness({
    files: {
      "ledgers/orders.csv": "订单号,客户,订单状态\nO-2001,海棠科技,已确认\n",
      "ledgers/shipments.csv": "订单号,物流单号,发货状态,异常原因\nO-2001,SF-2001,待发货,缺货\n",
    },
    definitions: [
      {
        kind: "order",
        name: "订单台账",
        documentType: "inquiry_ledger",
        relativePath: "ledgers/orders.csv",
        businessKeyField: "order_number",
        fieldMappings: { order_number: "订单号", customer: "客户", status: "订单状态" },
        requiredFields: ["order_number", "customer"],
      },
      {
        kind: "shipment",
        name: "发货台账",
        documentType: "inquiry_ledger",
        relativePath: "ledgers/shipments.csv",
        businessKeyField: "order_number",
        fieldMappings: { order_number: "订单号", delivery_status: "发货状态", status: "异常原因" },
        requiredFields: ["order_number"],
      },
    ],
    routineDefinition: {
      name: "orders.csv",
      description: "更新 orders.csv 和 shipments.csv 中的记录",
      triggerDocumentTypes: ["order"],
      dataRequirements: [
        { id: "orders", kind: "order", label: "订单文件", fields: ["order_number"], required: true },
        { id: "shipments", kind: "shipment", label: "发货文件", fields: ["order_number"], required: true },
      ],
      mutationPolicy: {
        operations: ["update"],
        targetRequirementIds: ["orders", "shipments"],
        keyFields: ["order_number"],
        mutableFields: ["status", "delivery_status"],
        allowMultipleSources: true,
        allowMultipleRows: true,
        maxRows: 20,
        requireUserConfirmation: true,
        writeMode: "safe_copy_replace",
      },
    },
  });
  const filed = await h.deps.importChannelEvent({
    channelId: h.channel.id,
    providerMessageId: "p0-shipping",
    externalUserId: "wx_p0_real",
    content: "物流缺货，请把 orders.csv 里的 O-2001 的 订单状态改成 待处理；把 shipments.csv 里的 O-2001 的 发货状态改成 异常",
  });
  assert.equal(filed.ok, true, JSON.stringify(filed));
  const event = h.state.channelEvents.find((candidate) => candidate.id === filed.eventId);
  assert.match(event.replyText, /已收到/);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const draftConfirmation = await h.deps.importChannelEvent({
    channelId: h.channel.id,
    providerMessageId: "p0-shipping-draft-confirm",
    externalUserId: "wx_p0_real",
    content: "确认",
  });
  assert.equal(draftConfirmation.ok, true, JSON.stringify(draftConfirmation));
  const draftEvent = h.state.channelEvents.find((candidate) => candidate.id === draftConfirmation.eventId);
  assert.match(draftEvent.replyText, /多文件/);
  const workItem = h.state.workItems.find((item) => item.channelOrigin?.messageId === filed.eventId);
  const channelWorkItem = h.state.workItems.at(-1);
  assert.equal(workItem, undefined);
  assert.equal(channelWorkItem.channelTaskContract.ledgerMutationPreview?.kind, "batch", JSON.stringify({ contract: channelWorkItem.channelTaskContract, classifications: h.state.businessDocumentClassifications, artifacts: h.state.workflowArtifacts, definitions: h.bindings.map((binding) => ({ id: binding.definition.id, documentType: binding.definition.documentType, relativePath: binding.definition.relativePath })) }));
  assert.equal(channelWorkItem.channelTaskContract.ledgerMutationPreview.operationCount, 2);
  assert.match(draftEvent.replyText, /orders\.csv/);
  assert.match(draftEvent.replyText, /shipments\.csv/);
  assert.match(await readFile(join(h.projectPath, "ledgers/orders.csv"), "utf8"), /O-2001,海棠科技,已确认/);

  const committed = await h.deps.importChannelEvent({
    channelId: h.channel.id,
    providerMessageId: "p0-shipping-execute",
    externalUserId: "wx_p0_real",
    content: "确认执行",
  });
  assert.equal(committed.ok, true, JSON.stringify(committed));
  const committedEvent = h.state.channelEvents.find((candidate) => candidate.id === committed.eventId);
  assert.match(committedEvent.replyText, /已完成/, JSON.stringify({
    reply: committedEvent.replyText,
    thread: h.state.channelTaskThreads.at(-1),
    requests: h.state.channelTaskRequests,
    workItems: h.state.workItems.map((item) => ({ id: item.id, status: item.status, ledger: item.channelTaskContract?.ledgerMutationPreview?.kind })),
  }));
  assert.match(await readFile(join(h.projectPath, "ledgers/orders.csv"), "utf8"), /O-2001,海棠科技,待处理/);
  assert.match(await readFile(join(h.projectPath, "ledgers/shipments.csv"), "utf8"), /O-2001,SF-2001,异常,缺货/);
  assert.equal(h.state.ledgerMutationAudits.length, 2);
});

test("P0 real payment reconciliation returns an explainable read-only difference report", async () => {
  const imported = financialImportHarness();
  const receivableImport = await imported.imports.previewChannelObjectImport({
    projectId: "prj_payment",
    kind: "receivable",
    format: "csv",
    fileName: "receivables.csv",
    content: base64("备注,客户,金额,日期\nAR-1001,海棠科技,12800,2026-08-15\nAR-1002,松林制造,5000,2026-08-16\n"),
  }, OWNER);
  const transactionImport = await imported.imports.previewChannelObjectImport({
    projectId: "prj_payment",
    kind: "bank_transaction",
    format: "csv",
    fileName: "bank-transactions.csv",
    content: base64("备注,金额,日期\nAR-1001,12800,2026-08-15\nUNKNOWN,3000,2026-08-16\n"),
  }, OWNER);
  assert.equal(receivableImport.body.import.errorRows, 0);
  assert.equal(transactionImport.body.import.errorRows, 0);
  const receivables = imported.imports.confirmChannelObjectImport({ importId: receivableImport.body.import.id }, OWNER);
  const transactions = imported.imports.confirmChannelObjectImport({ importId: transactionImport.body.import.id }, OWNER);
  assert.equal(receivables.status, 200);
  assert.equal(transactions.status, 200);

  const report = buildPaymentReconciliationPreview({
    receivables: receivables.body.objects,
    bankTransactions: transactions.body.objects,
  });
  assert.equal(report.status, "needs_review");
  assert.equal(report.matched.length, 1);
  assert.deepEqual(report.unmatchedReceivables.map((row) => row.reference), ["AR-1002"]);
  assert.deepEqual(report.unmatchedTransactions.map((row) => row.reference), ["UNKNOWN"]);
  assert.equal(report.summary.matchedCount, 1);
  assert.equal(report.summary.differenceCount, 2);
});

test("P0 real payment reconciliation is returned from a natural Channel request without file writeback", async () => {
  const h = await mutationHarness({
    files: {
      "ledgers/receivables.csv": "备注,客户,金额,日期\nAR-1001,海棠科技,12800,2026-08-15\nAR-1002,松林制造,5000,2026-08-16\n",
      "ledgers/bank-transactions.csv": "备注,金额,日期\nAR-1001,12800,2026-08-15\nUNKNOWN,3000,2026-08-16\n",
    },
    definitions: [
      {
        kind: "receivable",
        name: "应收账款",
        documentType: "inquiry_ledger",
        relativePath: "ledgers/receivables.csv",
        businessKeyField: "reference",
        fieldMappings: { reference: "备注", customer: "客户", amount: "金额", date: "日期" },
        requiredFields: ["reference", "amount"],
      },
      {
        kind: "bank_transaction",
        name: "银行流水",
        documentType: "inquiry_ledger",
        relativePath: "ledgers/bank-transactions.csv",
        businessKeyField: "reference",
        fieldMappings: { reference: "备注", amount: "金额", date: "日期" },
        requiredFields: ["reference", "amount"],
      },
    ],
    routineDefinition: {
      name: "汇款对账",
      description: "应收账款与银行流水对账",
      triggerDocumentTypes: ["payment_reconciliation"],
      dataRequirements: [
        { id: "receivables", kind: "receivable", label: "应收文件", fields: ["reference", "amount"], required: true },
        { id: "bank", kind: "bank_transaction", label: "银行流水文件", fields: ["reference", "amount"], required: true },
      ],
    },
  });
  const sources = new Map(h.state.channelObjectFileSources.map((source) => [source.fileName, source]));
  for (const [fileName, kind, content] of [
    ["receivables.csv", "receivable", "备注,客户,金额,日期\nAR-1001,海棠科技,12800,2026-08-15\nAR-1002,松林制造,5000,2026-08-16\n"],
    ["bank-transactions.csv", "bank_transaction", "备注,金额,日期\nAR-1001,12800,2026-08-15\nUNKNOWN,3000,2026-08-16\n"],
  ]) {
    const preview = await h.deps.previewChannelObjectImport({
      projectId: h.defaultProject.id,
      kind,
      format: "csv",
      fileName,
      sourceId: sources.get(fileName).id,
      content: base64(content),
    }, OWNER);
    assert.equal(preview.status, 201, JSON.stringify(preview));
    assert.equal(h.deps.confirmChannelObjectImport({ importId: preview.body.import.id }, OWNER).status, 200);
  }
  const originalReceivables = await readFile(join(h.projectPath, "ledgers/receivables.csv"), "utf8");
  const originalTransactions = await readFile(join(h.projectPath, "ledgers/bank-transactions.csv"), "utf8");
  const filed = await h.deps.importChannelEvent({
    channelId: h.channel.id,
    providerMessageId: "p0-payment-channel",
    externalUserId: "wx_p0_real",
    content: "帮我做汇款对账",
  });
  assert.equal(filed.ok, true, JSON.stringify(filed));
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const confirmed = await h.deps.importChannelEvent({
    channelId: h.channel.id,
    providerMessageId: "p0-payment-channel-confirm",
    externalUserId: "wx_p0_real",
    content: "确认",
  });
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  const event = h.state.channelEvents.find((candidate) => candidate.id === confirmed.eventId);
  assert.match(event.replyText, /对账已完成/);
  assert.match(event.replyText, /已匹配 1 条/);
  assert.match(event.replyText, /AR-1002/);
  assert.match(event.replyText, /UNKNOWN/);
  const thread = h.state.channelTaskThreads.at(-1);
  assert.equal(thread.status, "succeeded");
  assert.equal(h.state.channelTaskRequests.filter((request) => request.status === "pending").length, 0, JSON.stringify({
    requests: h.state.channelTaskRequests,
    thread,
    contract: h.state.workItems.at(-1)?.channelTaskContract,
  }));
  assert.equal(h.state.workItems.at(-1).status, "done");
  assert.equal(await readFile(join(h.projectPath, "ledgers/receivables.csv"), "utf8"), originalReceivables);
  assert.equal(await readFile(join(h.projectPath, "ledgers/bank-transactions.csv"), "utf8"), originalTransactions);
});

test("P0 lifecycle scenario follows one customer from quotation through payment, after-sales, and closure across time", async () => {
  const h = await mutationHarness({
    files: {
      "ledgers/quotations.csv": "报价单号,客户,报价金额,跟进状态\nQ-3001,海棠科技,12800,待跟进\n",
      "ledgers/orders.csv": "订单号,客户,订单状态\nO-3001,海棠科技,待下单\n",
      "ledgers/shipments.csv": "订单号,物流单号,发货状态\nO-3001,SF-3001,待发货\n",
      "ledgers/receivables.csv": "备注,客户,金额,日期,回款状态,回款日期\nAR-3001,海棠科技,12800,2026-08-17,待回款,\n",
      "ledgers/bank-transactions.csv": "备注,金额,日期\nAR-3001,12800,2026-08-20\n",
      "ledgers/after-sales.csv": "售后单号,订单号,客户,售后状态,问题,处理结果\nAS-3001,O-3001,海棠科技,待处理,设备异常,\n",
    },
    definitions: [
      {
        kind: "quotation", name: "报价跟进", documentType: "quotation_ledger", relativePath: "ledgers/quotations.csv",
        businessKeyField: "quotation_number", fieldMappings: { quotation_number: "报价单号", customer: "客户", amount: "报价金额", status: "跟进状态" }, requiredFields: ["quotation_number", "customer"],
        writePolicy: { fieldTransitions: { status: { "待跟进": ["已报价"], "已报价": ["已转订单"] } } },
      },
      {
        kind: "order", name: "订单台账", documentType: "inquiry_ledger", relativePath: "ledgers/orders.csv",
        businessKeyField: "order_number", fieldMappings: { order_number: "订单号", customer: "客户", status: "订单状态" }, requiredFields: ["order_number", "customer"],
        writePolicy: { fieldTransitions: { status: { "待下单": ["已下单"], "已下单": ["已发货"], "已发货": ["已完成"] } } },
      },
      {
        kind: "shipment", name: "发货台账", documentType: "inquiry_ledger", relativePath: "ledgers/shipments.csv",
        businessKeyField: "order_number", fieldMappings: { order_number: "订单号", delivery_status: "发货状态" }, requiredFields: ["order_number"],
        writePolicy: { fieldTransitions: { delivery_status: { "待发货": ["已发货"] } } },
      },
      {
        kind: "receivable", name: "应收账款", documentType: "inquiry_ledger", relativePath: "ledgers/receivables.csv",
        businessKeyField: "reference", fieldMappings: { reference: "备注", customer: "客户", amount: "金额", date: "日期", payment_status: "回款状态", payment_date: "回款日期" }, requiredFields: ["reference", "amount"],
        writePolicy: { fieldTransitions: { payment_status: { "待回款": ["已回款"] } } },
      },
      {
        kind: "bank_transaction", name: "银行流水", documentType: "inquiry_ledger", relativePath: "ledgers/bank-transactions.csv",
        businessKeyField: "reference", fieldMappings: { reference: "备注", amount: "金额", date: "日期" }, requiredFields: ["reference", "amount"],
      },
      {
        kind: "after_sales", name: "售后台账", documentType: "inquiry_ledger", relativePath: "ledgers/after-sales.csv",
        businessKeyField: "case_number", fieldMappings: { case_number: "售后单号", order_number: "订单号", customer: "客户", status: "售后状态", issue: "问题", resolution: "处理结果" }, requiredFields: ["case_number", "order_number"],
        writePolicy: { fieldTransitions: { status: { "待处理": ["处理中"], "处理中": ["已关闭"] } } },
      },
    ],
    routineDefinition: [
      {
        name: "报价跟进", description: "报价跟进并更新报价台账", triggerDocumentTypes: ["quotation"],
        dataRequirements: [{ id: "quotation", kind: "quotation", label: "报价文件", fields: ["quotation_number"], required: true }],
        mutationPolicy: { operations: ["update"], targetRequirementIds: ["quotation"], keyFields: ["quotation_number"], mutableFields: ["status"], allowMultipleSources: false, allowMultipleRows: false, maxRows: 1, requireUserConfirmation: true, writeMode: "safe_copy_replace" },
      },
      {
        name: "订单转化", description: "报价转订单", triggerDocumentTypes: ["order"],
        steps: [{ kind: "ledger_upsert", label: "订单转化" }],
        dataRequirements: [
          { id: "orders", kind: "order", label: "订单文件", fields: ["order_number", "customer"], required: true },
          { id: "quotations", kind: "quotation", label: "报价文件", fields: ["quotation_number", "customer"], required: true },
        ],
        relations: [{ id: "order_quote_customer", type: "join", fromRequirementId: "orders", fromField: "customer", toRequirementId: "quotations", toField: "customer", required: true }],
        mutationPolicy: { operations: ["update"], targetRequirementIds: ["orders", "quotations"], keyFields: ["order_number", "quotation_number"], mutableFields: ["status"], allowMultipleSources: true, allowMultipleRows: true, maxRows: 10, requireUserConfirmation: true, writeMode: "safe_copy_replace" },
      },
      {
        name: "发货跟踪", description: "订单发货跟踪", triggerDocumentTypes: ["shipment"],
        steps: [{ kind: "ledger_upsert", label: "发货跟踪" }],
        dataRequirements: [
          { id: "orders", kind: "order", label: "订单文件", fields: ["order_number"], required: true },
          { id: "shipments", kind: "shipment", label: "发货文件", fields: ["order_number"], required: true },
        ],
        relations: [{ id: "shipment_order", type: "join", fromRequirementId: "shipments", fromField: "order_number", toRequirementId: "orders", toField: "order_number", required: true }],
        mutationPolicy: { operations: ["update"], targetRequirementIds: ["orders", "shipments"], keyFields: ["order_number"], mutableFields: ["status", "delivery_status"], allowMultipleSources: true, allowMultipleRows: true, maxRows: 10, requireUserConfirmation: true, writeMode: "safe_copy_replace" },
      },
      {
        name: "回款对账", description: "应收账款与银行流水回款对账", triggerDocumentTypes: ["payment_reconciliation"],
        dataRequirements: [
          { id: "receivables", kind: "receivable", label: "应收文件", fields: ["reference", "amount"], required: true },
          { id: "bank", kind: "bank_transaction", label: "银行流水文件", fields: ["reference", "amount"], required: true },
        ],
      },
      {
        name: "回款确认", description: "回款到账后确认应收状态", triggerDocumentTypes: ["payment_confirmation"],
        steps: [{ kind: "ledger_upsert", label: "回款确认" }],
        dataRequirements: [{ id: "receivables", kind: "receivable", label: "应收文件", fields: ["reference", "amount"], required: true }],
        mutationPolicy: { operations: ["update"], targetRequirementIds: ["receivables"], keyFields: ["reference"], mutableFields: ["payment_status", "payment_date"], allowMultipleSources: false, allowMultipleRows: false, maxRows: 1, requireUserConfirmation: true, writeMode: "safe_copy_replace" },
      },
      {
        name: "售后处理", description: "售后问题跟进与处理", triggerDocumentTypes: ["after_sales"],
        steps: [{ kind: "ledger_upsert", label: "售后处理" }],
        dataRequirements: [{ id: "after_sales", kind: "after_sales", label: "售后文件", fields: ["case_number"], required: true }],
        mutationPolicy: { operations: ["update"], targetRequirementIds: ["after_sales"], keyFields: ["case_number"], mutableFields: ["status", "resolution"], allowMultipleSources: false, allowMultipleRows: false, maxRows: 1, requireUserConfirmation: true, writeMode: "safe_copy_replace" },
      },
      {
        name: "售后完结", description: "售后解决后关闭售后单并完成订单", triggerDocumentTypes: ["after_sales"],
        steps: [{ kind: "ledger_upsert", label: "售后完结" }],
        dataRequirements: [
          { id: "after_sales", kind: "after_sales", label: "售后文件", fields: ["case_number", "order_number"], required: true },
          { id: "orders", kind: "order", label: "订单文件", fields: ["order_number"], required: true },
        ],
        relations: [{ id: "after_sales_order", type: "join", fromRequirementId: "after_sales", fromField: "order_number", toRequirementId: "orders", toField: "order_number", required: true }],
        mutationPolicy: { operations: ["update"], targetRequirementIds: ["after_sales", "orders"], keyFields: ["case_number", "order_number"], mutableFields: ["status"], allowMultipleSources: true, allowMultipleRows: true, maxRows: 10, requireUserConfirmation: true, writeMode: "safe_copy_replace" },
      },
    ],
  });
  const eventReply = (eventId) => h.state.channelEvents.find((candidate) => candidate.id === eventId)?.replyText ?? "";
  const send = async (key, content) => h.deps.importChannelEvent({ channelId: h.channel.id, providerMessageId: key, externalUserId: "wx_p0_real", content });
  const mutate = async (key, description) => {
    const filed = await send(`${key}-draft`, description);
    assert.equal(filed.ok, true, JSON.stringify(filed));
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const confirmed = await send(`${key}-confirm`, "确认");
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
    const latestThread = h.state.channelTaskThreads.at(-1);
    const latestWorkItem = h.state.workItems.find((item) => item.id === latestThread?.workItemId);
    assert.match(eventReply(confirmed.eventId), /安全写回预览|多文件/, JSON.stringify({
      reply: eventReply(confirmed.eventId),
      thread: latestThread,
      contract: latestWorkItem?.channelTaskContract,
      dataMutationPreview: latestWorkItem?.channelTaskContract?.dataMutationPreview,
      ledgerMutationPreparation: latestWorkItem?.channelTaskContract?.ledgerMutationPreparation,
    }));
    const approved = await send(`${key}-execute`, "确认执行");
    assert.equal(approved.ok, true, JSON.stringify(approved));
    assert.match(eventReply(approved.eventId), /已完成安全写回/);
  };

  const initialSources = new Map(h.state.channelObjectFileSources.map((source) => [source.fileName, source]));
  for (const [fileName, kind, content] of [
    ["quotations.csv", "quotation", "报价单号,客户,报价金额,跟进状态\nQ-3001,海棠科技,12800,待跟进\n"],
    ["orders.csv", "order", "订单号,客户,订单状态\nO-3001,海棠科技,待下单\n"],
    ["shipments.csv", "shipment", "订单号,物流单号,发货状态\nO-3001,SF-3001,待发货\n"],
    ["after-sales.csv", "after_sales", "售后单号,订单号,客户,售后状态,问题,处理结果\nAS-3001,O-3001,海棠科技,待处理,设备异常,\n"],
  ]) {
    const preview = await h.deps.previewChannelObjectImport({
      projectId: h.defaultProject.id,
      kind,
      format: "csv",
      fileName,
      sourceId: initialSources.get(fileName).id,
      content: base64(content),
    }, OWNER);
    assert.equal(preview.status, 201, JSON.stringify(preview));
    assert.equal(h.deps.confirmChannelObjectImport({ importId: preview.body.import.id }, OWNER).status, 200);
  }

  await mutate("quotation", "请做报价跟进，把 quotations.csv 里的 Q-3001 的 跟进状态改成 已报价");
  h.advanceTime(2);
  await mutate("order-conversion", "客户已确认下单，请做订单转化：把 orders.csv 里的 O-3001 的 订单状态改成 已下单；把 quotations.csv 里的 Q-3001 的 跟进状态改成 已转订单");
  h.advanceTime(1);
  await mutate("shipment", "请做发货跟踪，把 orders.csv 里的 O-3001 的 订单状态改成 已发货；把 shipments.csv 里的 O-3001 的 发货状态改成 已发货");
  h.advanceTime(2);

  const beforePayment = await send("payment-before-sync", "请做回款对账");
  assert.equal(beforePayment.ok, true, JSON.stringify(beforePayment));
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const paymentBeforeConfirm = await send("payment-before-sync-confirm", "确认");
  assert.equal(paymentBeforeConfirm.ok, true, JSON.stringify(paymentBeforeConfirm));
  assert.match(eventReply(paymentBeforeConfirm.eventId), /对账已完成/);
  assert.match(eventReply(paymentBeforeConfirm.eventId), /已匹配 0 条/);

  const sources = new Map(h.state.channelObjectFileSources.map((source) => [source.fileName, source]));
  for (const [fileName, kind, content] of [
    ["receivables.csv", "receivable", "备注,客户,金额,日期,回款状态,回款日期\nAR-3001,海棠科技,12800,2026-08-17,待回款,\n"],
    ["bank-transactions.csv", "bank_transaction", "备注,金额,日期\nAR-3001,12800,2026-08-20\n"],
  ]) {
    const preview = await h.deps.previewChannelObjectImport({ projectId: h.defaultProject.id, kind, format: "csv", fileName, sourceId: sources.get(fileName).id, content: base64(content) }, OWNER);
    assert.equal(preview.status, 201, JSON.stringify(preview));
    assert.equal(h.deps.confirmChannelObjectImport({ importId: preview.body.import.id }, OWNER).status, 200);
  }
  h.advanceTime(1);
  const paymentAfterSync = await send("payment-after-sync", "请重新做回款对账");
  assert.equal(paymentAfterSync.ok, true, JSON.stringify(paymentAfterSync));
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const paymentAfterSyncConfirm = await send("payment-after-sync-confirm", "确认");
  assert.equal(paymentAfterSyncConfirm.ok, true, JSON.stringify(paymentAfterSyncConfirm));
  assert.match(eventReply(paymentAfterSyncConfirm.eventId), /已匹配 1 条/);

  await mutate("payment-confirmation", "回款已到账，请确认回款：把 receivables.csv 里的 AR-3001 的 回款状态改成 已回款");

  h.advanceTime(3);
  await mutate("after-sales", "客户反馈设备异常，请做售后处理：把 after-sales.csv 里的 AS-3001 的 售后状态改成 处理中");
  h.advanceTime(2);
  await mutate("closure", "售后已解决，请做售后完结：把 after-sales.csv 里的 AS-3001 的 售后状态改成 已关闭；把 orders.csv 里的 O-3001 的 订单状态改成 已完成");

  assert.match(await readFile(join(h.projectPath, "ledgers/quotations.csv"), "utf8"), /Q-3001,海棠科技,12800,已转订单/);
  assert.match(await readFile(join(h.projectPath, "ledgers/orders.csv"), "utf8"), /O-3001,海棠科技,已完成/);
  assert.match(await readFile(join(h.projectPath, "ledgers/shipments.csv"), "utf8"), /O-3001,SF-3001,已发货/);
  assert.match(await readFile(join(h.projectPath, "ledgers/after-sales.csv"), "utf8"), /AS-3001,O-3001,海棠科技,已关闭/);
  assert.match(await readFile(join(h.projectPath, "ledgers/receivables.csv"), "utf8"), /AR-3001,海棠科技,12800,2026-08-17,已回款/);
  assert.equal(h.state.channelTaskThreads.filter((thread) => thread.status === "succeeded").length, 8);
  assert.equal(h.state.ledgerMutationAudits.length, 9);
  assert.ok(h.state.channelEvents.every((event) => event.status === "dispatched"));
});

test("P0 lifecycle rejects stale confirmation and resumes after the latest local file snapshot is imported", async () => {
  const h = await mutationHarness({
    files: { "ledgers/quotations.csv": "报价单号,客户,报价金额,跟进状态\nQ-3010,海棠科技,8600,待跟进\n" },
    definitions: [{
      kind: "quotation",
      name: "报价跟进",
      documentType: "quotation_ledger",
      relativePath: "ledgers/quotations.csv",
      businessKeyField: "quotation_number",
      fieldMappings: { quotation_number: "报价单号", customer: "客户", amount: "报价金额", status: "跟进状态" },
      requiredFields: ["quotation_number", "customer"],
    }],
    routineDefinition: {
      name: "报价跟进",
      description: "报价跟进",
      triggerDocumentTypes: ["quotation"],
      steps: [{ kind: "ledger_upsert", label: "报价跟进" }],
      dataRequirements: [{ id: "quotations", kind: "quotation", label: "报价文件", fields: ["quotation_number"], required: true }],
      mutationPolicy: { operations: ["update"], targetRequirementIds: ["quotations"], keyFields: ["quotation_number"], mutableFields: ["status"], requireUserConfirmation: true, writeMode: "safe_copy_replace" },
    },
  });
  const send = async (key, content) => h.deps.importChannelEvent({ channelId: h.channel.id, providerMessageId: key, externalUserId: "wx_p0_real", content });
  const reply = (eventId) => h.state.channelEvents.find((event) => event.id === eventId)?.replyText ?? "";
  const request = await send("stale-draft", "请跟进报价，把 quotations.csv 里的 Q-3010 的 跟进状态改成 已报价");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const preview = await send("stale-confirm", "确认");
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.match(reply(preview.eventId), /安全写回预览/);

  await writeFile(join(h.projectPath, "ledgers/quotations.csv"), "报价单号,客户,报价金额,跟进状态\nQ-3010,海棠科技,8600,外部已修改\n", "utf8");
  const stale = await send("stale-execute", "确认执行");
  assert.equal(stale.ok, true, JSON.stringify(stale));
  assert.match(reply(stale.eventId), /文件已被其他操作修改|原预览已失效/);
  assert.equal(h.state.ledgerMutationAudits.length, 0);
  assert.match(await readFile(join(h.projectPath, "ledgers/quotations.csv"), "utf8"), /外部已修改/);

  const source = h.state.channelObjectFileSources.find((candidate) => candidate.fileName === "quotations.csv");
  const imported = await h.deps.previewChannelObjectImport({
    projectId: h.defaultProject.id,
    kind: "quotation",
    format: "csv",
    fileName: "quotations.csv",
    sourceId: source.id,
    content: base64("报价单号,客户,报价金额,跟进状态\nQ-3010,海棠科技,8600,外部已修改\n"),
  }, OWNER);
  assert.equal(imported.status, 201, JSON.stringify(imported));
  assert.equal(h.deps.confirmChannelObjectImport({ importId: imported.body.import.id }, OWNER).status, 200);

  const resumed = await send("resumed-draft", "请重新跟进报价，把 quotations.csv 里的 Q-3010 的 跟进状态改成 已跟进");
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const resumedPreview = await send("resumed-confirm", "确认");
  assert.match(reply(resumedPreview.eventId), /安全写回预览/, JSON.stringify({
    reply: reply(resumedPreview.eventId),
    source: h.state.channelObjectFileSources.find((candidate) => candidate.fileName === "quotations.csv"),
    binding: h.state.channelMutationBindings.find((candidate) => candidate.fileName === "quotations.csv"),
    contract: h.state.workItems.at(-1)?.channelTaskContract,
  }));
  const resumedExecution = await send("resumed-execute", "确认执行");
  assert.equal(resumedExecution.ok, true, JSON.stringify(resumedExecution));
  assert.match(reply(resumedExecution.eventId), /已完成安全写回/);
  assert.match(await readFile(join(h.projectPath, "ledgers/quotations.csv"), "utf8"), /已跟进/);
  assert.equal(h.state.ledgerMutationAudits.length, 1);
});

test("P0 missing ledger record gives a next-step explanation instead of silently inserting", async () => {
  const h = await mutationHarness({
    files: { "ledgers/quotations.csv": "报价单号,客户,报价金额,跟进状态\nQ-3020,海棠科技,8600,待跟进\n" },
    definitions: [{
      kind: "quotation",
      name: "报价跟进",
      documentType: "quotation_ledger",
      relativePath: "ledgers/quotations.csv",
      businessKeyField: "quotation_number",
      fieldMappings: { quotation_number: "报价单号", customer: "客户", amount: "报价金额", status: "跟进状态" },
      requiredFields: ["quotation_number", "customer"],
    }],
    routineDefinition: {
      name: "报价跟进",
      description: "报价跟进",
      triggerDocumentTypes: ["quotation"],
      steps: [{ kind: "ledger_upsert", label: "报价跟进" }],
      dataRequirements: [{ id: "quotations", kind: "quotation", label: "报价文件", fields: ["quotation_number"], required: true }],
      mutationPolicy: { operations: ["update"], targetRequirementIds: ["quotations"], keyFields: ["quotation_number"], mutableFields: ["status"], requireUserConfirmation: true, writeMode: "safe_copy_replace" },
    },
  });
  const send = async (key, content) => h.deps.importChannelEvent({ channelId: h.channel.id, providerMessageId: key, externalUserId: "wx_p0_real", content });
  const reply = (eventId) => h.state.channelEvents.find((event) => event.id === eventId)?.replyText ?? "";
  const filed = await send("missing-ledger-draft", "请跟进报价，把 quotations.csv 里的 Q-9999 的 跟进状态改成 已报价");
  assert.equal(filed.ok, true, JSON.stringify(filed));
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const confirmed = await send("missing-ledger-confirm", "确认");
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  assert.match(reply(confirmed.eventId), /没有找到对应的现有记录|先导入或建立/);
  assert.equal(h.state.ledgerMutationAudits.length, 0);
  assert.match(await readFile(join(h.projectPath, "ledgers/quotations.csv"), "utf8"), /Q-3020,海棠科技,8600,待跟进/);
});
