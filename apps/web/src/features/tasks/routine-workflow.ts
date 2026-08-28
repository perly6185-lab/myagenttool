import { request } from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

export type RoutineStepState =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "awaiting_condition"
  | "succeeded"
  | "skipped"
  | "failed"
  | "cancelled";

export type QuotationReview = {
  status: "needs_input" | "ready" | "generated";
  fields: {
    key: string;
    label: string;
    state: "confirmed" | "missing" | "conflict";
    value: string | null;
    conflictingValues: string[];
    sourceSummaries: string[];
    evidenceArtifactIds: string[];
  }[];
  templateOptions: {
    artifactId: string;
    label: string;
    format: string;
    supported: boolean;
    reason: string | null;
    placeholderKeys: string[];
  }[];
  selectedTemplate: {
    artifactId: string;
    label: string;
    format: string;
  } | null;
  plannedOutputPath: string | null;
  draftRevision: number;
  draftPreview: string | null;
};

export type RoutineWorkExecution = {
  workItemId: string;
  sourceId?: string;
  definition: { id: string; name: string; version: number };
  run: {
    id: string;
    status: "planned" | "running" | "awaiting_approval" | "awaiting_condition"
      | "succeeded" | "failed" | "cancelled";
    revision: number;
    waitingReason: string | null;
    cancellationRequestedAt: string | null;
    capacity: {
      limit: number;
      active: number;
      state: "ready" | "waiting";
      position: number | null;
      waitingSince: string | null;
    };
  };
  assistance?: {
    kind: "needs_input" | "needs_review" | "awaiting_approval" | "awaiting_condition"
      | "ledger_write" | "failed" | "waiting" | "manual_step" | "cancelled";
    reason: string;
    action: string;
    stepKey: string | null;
    stepLabel: string | null;
  } | null;
  recovery?: {
    kind: "retry_after_source_review";
    stepKey: string;
    requestedAt: string;
  } | null;
  availableLedgers?: {
    id: string;
    name: string;
    documentType: "inquiry_ledger" | "quotation_ledger" | "order_ledger";
    format: "csv" | "xlsx";
    relativePath: string;
    sheet: string | null;
  }[];
  availableOrderTriggers: { artifactId: string; label: string }[];
  steps: {
    key: string;
    label: string;
    kind: "extract" | "retrieve" | "generate" | "ledger_upsert"
      | "human_approval" | "condition" | "create_issue";
    required: boolean;
    dependsOn: string[];
    configuration: Record<string, unknown>;
    run: {
      state: RoutineStepState;
      attempts: number;
      errorCode: string | null;
      conditionOutcome: boolean | null;
      quotationReview?: QuotationReview | null;
      outputRefs: {
        kind: "artifact" | "file" | "note";
        artifactId?: string | null;
        relativePath?: string | null;
        summary: string;
      }[];
    };
  }[];
};

export type LedgerUpsertPreview = {
  id: string;
  ledgerDefinitionId: string;
  routineRunId: string | null;
  routineStepKey: string | null;
  businessKey: string;
  action: "insert" | "update" | "no_op";
  rowNumber: number | null;
  changedCells: {
    field: string;
    column: string;
    before: string | number | boolean | null;
    after: string | number | boolean | null;
  }[];
  warnings: string[];
  approvalRequired: boolean;
  state: "pending" | "waiting" | "committed" | "expired" | "invalidated";
  waitingReason: string | null;
  waitingSince: string | null;
  queue: {
    state: "ready" | "waiting";
    position: number | null;
    waitingSince: string | null;
  };
  expiresAt: string;
  revision: number;
};

export type RoutineQueueItem = {
  workItemId: string;
  localRef: string;
  title: string;
  projectId: string;
  sourceId: string;
  businessKey: string;
  definitionName: string;
  routineVersion: number;
  status: RoutineWorkExecution["run"]["status"];
  revision: number;
  waitingReason: string | null;
  ledgerQueuePosition: number | null;
  capacity: RoutineWorkExecution["run"]["capacity"];
  progress: { completed: number; total: number };
  currentStep: {
    key: string;
    label: string;
    kind: RoutineWorkExecution["steps"][number]["kind"];
    state: RoutineStepState;
  } | null;
  nextAction: "wait_capacity" | "wait_ledger" | "review_approval" | "decide_condition"
    | "retry_step" | "review_ledger" | "continue_step" | "start";
  updatedAt: string;
};

function actionKey(action: string, stepKey = "") {
  const nonce = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${action}:${stepKey}:${nonce}`.slice(0, 200);
}

export const routineWorkApi = {
  listQueue: (projectId?: string) => {
    const query = new URLSearchParams({ limit: "20" });
    if (projectId) query.set("projectId", projectId);
    return request<{
      items: RoutineQueueItem[];
      summary: { total: number; running: number; waiting: number; needsAction: number };
    }>("GET", `/api/workflow-memory/routine-work-queue?${query.toString()}`);
  },
  get: (workItemId: string) =>
    request<{ execution: RoutineWorkExecution }>(
      "GET",
      `/api/workflow-memory/routine-work-items/${encodeURIComponent(workItemId)}`,
    ),
  start: (workItemId: string, expectedRevision: number) =>
    request<{ execution: RoutineWorkExecution }>(
      "POST",
      `/api/workflow-memory/routine-work-items/${encodeURIComponent(workItemId)}/start`,
      { expectedRevision, idempotencyKey: actionKey("start") },
    ),
  cancel: (workItemId: string, expectedRevision: number) =>
    request<{ execution: RoutineWorkExecution }>(
      "POST",
      `/api/workflow-memory/routine-work-items/${encodeURIComponent(workItemId)}/cancel`,
      { expectedRevision, idempotencyKey: actionKey("cancel") },
    ),
  complete: (
    workItemId: string,
    stepKey: string,
    expectedRevision: number,
    succeeded = true,
  ) => request<{ execution: RoutineWorkExecution }>(
    "POST",
    `/api/workflow-memory/routine-work-items/${encodeURIComponent(workItemId)}/steps/${encodeURIComponent(stepKey)}/complete`,
    {
      expectedRevision,
      idempotencyKey: actionKey(succeeded ? "complete" : "fail", stepKey),
      succeeded,
      outputRefs: [],
    },
  ),
  executeStep: (workItemId: string, stepKey: string, expectedRevision: number) =>
    request<{ execution: RoutineWorkExecution; childWorkItem?: { id: string } | null }>(
      "POST",
      `/api/workflow-memory/routine-work-items/${encodeURIComponent(workItemId)}/steps/${encodeURIComponent(stepKey)}/execute`,
      { expectedRevision, idempotencyKey: actionKey("execute", stepKey) },
    ),
  confirmQuotationInputs: (
    workItemId: string,
    stepKey: string,
    expectedRevision: number,
    templateArtifactId: string,
    answers: Record<string, string>,
  ) => request<{ execution: RoutineWorkExecution }>(
    "POST",
    `/api/workflow-memory/routine-work-items/${encodeURIComponent(workItemId)}/steps/${encodeURIComponent(stepKey)}/quotation-inputs`,
    {
      expectedRevision,
      idempotencyKey: actionKey("quotation-inputs", stepKey),
      templateArtifactId,
      answers,
      confirmed: true,
    },
  ),
  bindLedger: (
    workItemId: string,
    stepKey: string,
    expectedRevision: number,
    ledgerDefinitionId: string,
  ) => request<{ execution: RoutineWorkExecution }>(
    "POST",
    `/api/workflow-memory/routine-work-items/${encodeURIComponent(workItemId)}/steps/${encodeURIComponent(stepKey)}/ledger-binding`,
    {
      expectedRevision,
      idempotencyKey: actionKey("bind-ledger", stepKey),
      ledgerDefinitionId,
    },
  ),
  requestSourceReview: (workItemId: string, stepKey: string, expectedRevision: number) =>
    request<{ execution: RoutineWorkExecution }>(
      "POST",
      `/api/workflow-memory/routine-work-items/${encodeURIComponent(workItemId)}/steps/${encodeURIComponent(stepKey)}/review-request`,
      { expectedRevision, idempotencyKey: actionKey("request-source-review", stepKey) },
    ),
  resumeRecovery: (workItemId: string, expectedRevision: number) =>
    request<{
      execution: RoutineWorkExecution;
      resumed: boolean;
      awaitingReview: boolean;
    }>(
      "POST",
      `/api/workflow-memory/routine-work-items/${encodeURIComponent(workItemId)}/resume`,
      { expectedRevision, idempotencyKey: actionKey("resume-recovery") },
    ),
  retry: (workItemId: string, stepKey: string, expectedRevision: number) =>
    request<{ execution: RoutineWorkExecution }>(
      "POST",
      `/api/workflow-memory/routine-work-items/${encodeURIComponent(workItemId)}/steps/${encodeURIComponent(stepKey)}/retry`,
      { expectedRevision, idempotencyKey: actionKey("retry", stepKey) },
    ),
  approve: (workItemId: string, stepKey: string, expectedRevision: number, approved: boolean) =>
    request<{ execution: RoutineWorkExecution }>(
      "POST",
      `/api/workflow-memory/routine-work-items/${encodeURIComponent(workItemId)}/steps/${encodeURIComponent(stepKey)}/approval`,
      { expectedRevision, idempotencyKey: actionKey(approved ? "approve" : "reject", stepKey), approved },
    ),
  condition: (
    workItemId: string,
    stepKey: string,
    expectedRevision: number,
    outcome: boolean,
    triggerArtifactIds: string[] = [],
  ) => request<{ execution: RoutineWorkExecution; childWorkItem?: { id: string } | null }>(
    "POST",
    `/api/workflow-memory/routine-work-items/${encodeURIComponent(workItemId)}/steps/${encodeURIComponent(stepKey)}/condition`,
    {
      expectedRevision,
      idempotencyKey: actionKey(outcome ? "condition-true" : "condition-false", stepKey),
      outcome,
      triggerArtifactIds,
    },
  ),
  previewLedger: (
    ledgerDefinitionId: string,
    routineRunId: string,
    routineStepKey: string,
  ) => request<{ preview: LedgerUpsertPreview }>(
    "POST",
    `/api/workflow-memory/ledger-definitions/${encodeURIComponent(ledgerDefinitionId)}/preview-upsert`,
    { routineRunId, routineStepKey },
  ),
  listLedgerPreviews: (routineRunId: string) =>
    request<{ previews: LedgerUpsertPreview[] }>(
      "GET",
      `/api/workflow-memory/ledger-upsert-previews?routineRunId=${encodeURIComponent(routineRunId)}&states=pending,waiting`,
    ),
  commitLedger: (previewId: string, expectedRevision: number) =>
    request<{
      preview: LedgerUpsertPreview;
      execution: RoutineWorkExecution | null;
      mutation: { id: string; action: "insert" | "update" | "no_op" };
    }>(
      "POST",
      `/api/workflow-memory/ledger-upsert-previews/${encodeURIComponent(previewId)}/commit`,
      { expectedRevision, approved: true },
    ),
};

const labels = {
  en: {
    title: "Daily work",
    version: "Work type version",
    primaryAction: "Process inquiry",
    continueAction: "Continue work",
    cancel: "Cancel work",
    approve: "Approve and continue",
    reviewResult: "Review result",
    reviewRecognizedInformation: "Review recognized information",
    chooseLedger: "Choose ledger",
    selectLedger: "Ledger to use",
    useLedger: "Use this ledger",
    noAvailableLedgers: "No ready ledger was found. Put the ledger you normally use in the authorized work folder, then review the recognized files. Return here after confirming it as a ledger.",
    findLedger: "Review files in the work folder",
    ledgerTypes: {
      inquiry_ledger: "Inquiry ledger",
      quotation_ledger: "Quotation ledger",
      order_ledger: "Order ledger",
    },
    reject: "Reject",
    orderReceived: "Confirmed order received",
    noOrder: "No order received",
    conditionYes: "Yes, this happened",
    conditionNo: "No, this has not happened",
    selectOrder: "Confirmed order document",
    complete: "Mark step complete",
    retrieveStep: "Load approved information",
    prepareResult: "Prepare this result",
    createFollowUp: "Create follow-up task",
    reviewQuotationInputs: "Review quotation details",
    generateQuotation: "Generate quotation draft",
    quotationInputDialogTitle: "Confirm quotation details",
    quotationInputDialogDescription: "Resolve missing or conflicting facts and choose an approved local template.",
    quotationTemplate: "Quotation template",
    unsupportedTemplate: "Unavailable until format preservation checks pass",
    plannedOutput: "Planned local output",
    missingFact: "Missing",
    conflictingFact: "Conflicting values",
    confirmedFact: "Confirmed",
    confirmQuotationInputs: "Confirm details",
    noQuotationTemplates: "No supported Markdown, Word, or Excel quotation template is available in this source.",
    factSources: "Sources",
    reviewLedger: "Review ledger change",
    reviewAndConfirm: "Review and confirm",
    commitLedger: "Approve ledger change",
    confirmNoLedgerChange: "Confirm no change",
    ledgerDialogTitle: "Confirm the ledger update",
    ledgerDialogDescription: "Review the exact row-level change before it is written to the local business ledger.",
    ledgerNextAction: "After confirmation, this ledger step will be completed and the task will continue to the next available step.",
    noLedgerChanges: "The existing row already matches this task. No file content will change.",
    approvalDialogTitle: "Review the quotation",
    approvalDialogDescription: "Check the prepared result before allowing the task to continue.",
    approvalNextAction: "After approval, the task will register the quotation and wait for a confirmed order before creating order work.",
    noApprovalOutputs: "No output summary is available. Go back and inspect the generated file before approving.",
    quotationDraftPreview: "Draft preview",
    back: "Go back",
    ledgerConfigurationMissing: "This ledger needs to be configured before the step can continue.",
    ledgerInsert: "Add row",
    ledgerUpdate: "Update row",
    ledgerNoOp: "No change needed",
    row: "Row",
    retry: "Retry step",
    attempts: "attempts",
    required: "Always",
    conditional: "When applicable",
    waitingCapacity: "Waiting for local device capacity. Completed steps are preserved.",
    waitingCapacityPosition: "Waiting position",
    waitingLedger: "Waiting for an earlier ledger update to finish. This task will refresh automatically.",
    waitingLedgerPosition: "Ledger wait position",
    batchTitle: "Inquiry batch",
    batchDescription: "See active inquiries and open the next item that needs you.",
    batchOpen: "Open",
    batchOpenNext: "Open next action",
    batchRunning: "Running",
    batchWaiting: "Waiting",
    batchNeedsAction: "Needs you",
    batchProgress: "Progress",
    interruptedRecovery: "A running step was interrupted. Retry that step to continue.",
    quotationFactsRequired: "Confirm the missing or conflicting quotation details before generating the draft.",
    helpTitle: "Needs you",
    helpBlockedAt: "Where it stopped",
    helpWhy: "Why you are needed",
    helpAction: "What to do",
    helpAfter: "What happens next",
    technicalDetails: "Technical details",
    technicalErrorCode: "Error code",
    technicalWaitingReason: "Waiting reason",
    help: {
      quotation: {
        title: "The quotation draft needs more information",
        why: "Some required quotation details are missing or conflict with the source files, so AI cannot choose safely.",
        action: "Fill in the highlighted details and choose an available quotation template.",
        after: "AI will generate the quotation draft and continue the remaining steps.",
      },
      approval: {
        title: "Please check the prepared result",
        why: "This result needs your confirmation before it can be used in the next business step.",
        action: "Open the result, then confirm it or send it back if it needs changes.",
        after: "AI will record your decision and continue along the matching path.",
      },
      condition: {
        title: "A business decision is needed",
        why: "The next step depends on something only you can confirm from the current business situation.",
        action: "Choose the option that matches what has actually happened.",
        after: "AI will follow the matching branch and continue the task.",
      },
      orderCondition: {
        title: "Please confirm whether the order was received",
        why: "AI must not create order work until a confirmed order document is selected.",
        action: "Select the order document if it was received, or choose that no order has arrived.",
        after: "AI will create the related order work when applicable, or keep this task from proceeding down that branch.",
      },
      ledgerReview: {
        title: "Please check the ledger change",
        why: "Writing to the business ledger changes an official local record and requires your confirmation.",
        action: "Preview the exact row and fields that will change, then confirm the update.",
        after: "AI will write the approved change and continue the remaining steps.",
      },
      ledgerConfiguration: {
        title: "The ledger destination is not ready",
        why: "AI does not know which approved local ledger this step is allowed to update.",
        action: "Choose a ready ledger below and use it for this task.",
        after: "The system will prepare the exact ledger change for your review, then AI will continue after you confirm it.",
      },
      extractionReview: {
        title: "Please confirm the information read from the source file",
        why: "The source file or its recognized business facts have not been confirmed, so AI cannot safely use them.",
        action: "Select Review recognized information, check this source file, and confirm the correct facts.",
        after: "When you return, this task checks the update and retries extraction once. If the facts are valid, AI continues automatically; otherwise it shows the remaining action.",
      },
      failed: {
        title: "This step did not finish",
        why: "AI stopped before completing this step, and later steps were left unchanged.",
        after: "AI will retry this step and continue from the saved progress if it succeeds.",
      },
      waiting: {
        title: "The task is temporarily paused",
        why: "AI cannot safely continue from the current state without checking this task again.",
        action: "No action is needed yet. The task refreshes automatically; reopen it only if this message remains for a long time.",
        after: "AI will continue from the last saved step when the blocking condition is cleared.",
      },
    },
    refreshRecovery: "The task changed. Refresh it before trying again.",
    refreshAction: "Refresh task",
    recoveries: {
      stale: "The preview is no longer current. Refresh the task and review the latest values before confirming again.",
      concurrent: "Another edit is in progress. Wait for it to finish, then refresh and try again.",
      disabled: "This work type or source is disabled. Ask its owner to enable it before starting new work.",
      insufficient: "There is not enough confirmed history yet. Add or confirm comparable examples, then run discovery again.",
      interrupted: "The previous run stopped before completion. Refresh the task, then retry the step marked as needing attention.",
      failed: "Nothing after the failed step was marked complete. Refresh the task and use Retry on that step.",
    },
    states: {
      pending: "Waiting",
      running: "In progress",
      awaiting_approval: "Needs your approval",
      awaiting_condition: "Needs a business decision",
      succeeded: "Completed",
      skipped: "Not applicable",
      failed: "Needs attention",
      cancelled: "Cancelled",
    },
  },
  zh: {
    title: "日常工作",
    version: "工作类型版本",
    primaryAction: "处理询价",
    continueAction: "继续处理",
    cancel: "取消处理",
    approve: "确认并继续",
    reviewResult: "检查结果",
    reviewRecognizedInformation: "检查识别信息",
    chooseLedger: "选择台账",
    selectLedger: "要使用的台账",
    useLedger: "使用这个台账",
    noAvailableLedgers: "当前没有可用台账。请把平时使用的台账文件放进授权工作目录，再检查识别结果并确认它是台账；完成后返回本任务。",
    findLedger: "检查工作目录里的文件",
    ledgerTypes: {
      inquiry_ledger: "询价台账",
      quotation_ledger: "报价台账",
      order_ledger: "订单台账",
    },
    reject: "退回",
    orderReceived: "已确认收到订单",
    noOrder: "尚未收到订单",
    conditionYes: "是，已经发生",
    conditionNo: "否，尚未发生",
    selectOrder: "已确认的订单文件",
    complete: "标记本步骤完成",
    retrieveStep: "读取已确认信息",
    prepareResult: "准备本次结果",
    createFollowUp: "创建后续任务",
    reviewQuotationInputs: "检查报价信息",
    generateQuotation: "生成报价草稿",
    quotationInputDialogTitle: "确认报价信息",
    quotationInputDialogDescription: "补齐缺失或冲突的信息，并选择已认可的本地模板。",
    quotationTemplate: "报价模板",
    unsupportedTemplate: "格式保存性检查通过前不可使用",
    plannedOutput: "计划生成到本地",
    missingFact: "缺失",
    conflictingFact: "存在冲突",
    confirmedFact: "已确认",
    confirmQuotationInputs: "确认这些信息",
    noQuotationTemplates: "当前来源中没有可用的 Markdown、Word 或 Excel 报价模板。",
    factSources: "来源",
    reviewLedger: "预览台账变更",
    reviewAndConfirm: "查看并确认",
    commitLedger: "确认并写入台账",
    confirmNoLedgerChange: "确认无需修改",
    ledgerDialogTitle: "确认台账更新",
    ledgerDialogDescription: "写入本地业务台账前，请检查将要变化的具体行和字段。",
    ledgerNextAction: "确认后，本台账步骤将完成，任务会继续执行下一个可用步骤。",
    noLedgerChanges: "现有记录已经与本任务一致，不会修改文件内容。",
    approvalDialogTitle: "检查报价结果",
    approvalDialogDescription: "允许任务继续前，请先检查已经生成的业务结果。",
    approvalNextAction: "确认后，任务会登记报价；只有收到已确认订单后，才会创建订单工作。",
    noApprovalOutputs: "暂时没有可显示的结果摘要，请返回并检查生成文件后再确认。",
    quotationDraftPreview: "报价草稿预览",
    back: "返回检查",
    ledgerConfigurationMissing: "需要先配置本步骤使用的台账，之后才能继续。",
    ledgerInsert: "新增一行",
    ledgerUpdate: "更新一行",
    ledgerNoOp: "无需修改",
    row: "第",
    retry: "重试本步骤",
    attempts: "次尝试",
    required: "每次都做",
    conditional: "符合条件时做",
    waitingCapacity: "正在等待本机可用容量，已完成步骤会保留。",
    waitingCapacityPosition: "排队位置",
    waitingLedger: "正在等待前一项台账更新完成，本任务会自动刷新。",
    waitingLedgerPosition: "台账排队位置",
    batchTitle: "询价批次",
    batchDescription: "集中查看正在处理的询价，并打开下一项需要你处理的工作。",
    batchOpen: "打开",
    batchOpenNext: "打开下一项",
    batchRunning: "进行中",
    batchWaiting: "等待中",
    batchNeedsAction: "需要你处理",
    batchProgress: "进度",
    interruptedRecovery: "上次运行被中断，请重试失败的步骤后继续。",
    quotationFactsRequired: "生成报价草稿前，请确认缺失或存在冲突的报价信息。",
    helpTitle: "需要你处理",
    helpBlockedAt: "卡在哪里",
    helpWhy: "为什么需要你",
    helpAction: "你要做什么",
    helpAfter: "完成后会继续什么",
    technicalDetails: "技术详情",
    technicalErrorCode: "错误代码",
    technicalWaitingReason: "等待原因",
    help: {
      quotation: {
        title: "报价草稿还缺少必要信息",
        why: "部分报价信息缺失或与来源文件冲突，AI 无法安全判断应该采用哪个值。",
        action: "补齐标记的信息，并选择一个可用的报价模板。",
        after: "AI 会生成报价草稿，并自动继续后续步骤。",
      },
      approval: {
        title: "请检查已经准备好的结果",
        why: "这个结果进入下一项业务步骤前，需要由你确认是否可用。",
        action: "打开结果进行检查；可以确认继续，也可以退回修改。",
        after: "AI 会记录你的决定，并沿对应路径继续处理。",
      },
      condition: {
        title: "需要你做一个业务判断",
        why: "下一步取决于当前业务是否已经发生，这件事只能由你确认。",
        action: "请选择与实际情况相符的选项。",
        after: "AI 会进入相应分支，并自动继续任务。",
      },
      orderCondition: {
        title: "请确认是否已经收到订单",
        why: "选择已确认的订单文件前，AI 不能安全地创建订单工作。",
        action: "如已收到订单，请选择订单文件；否则选择“尚未收到订单”。",
        after: "符合条件时 AI 会创建后续订单工作，否则不会进入该分支。",
      },
      ledgerReview: {
        title: "请检查台账变更",
        why: "写入业务台账会修改正式的本地记录，因此需要你确认。",
        action: "检查将要变化的行和字段，然后确认是否写入。",
        after: "AI 会写入你确认的变更，并自动继续后续步骤。",
      },
      ledgerConfiguration: {
        title: "台账位置还没有准备好",
        why: "AI 不知道本步骤被允许更新哪一本本地台账。",
        action: "请在下方选择一本可用台账，用于本任务。",
        after: "系统会先准备本次台账变更供你检查；确认后，AI 会继续后续步骤。",
      },
      extractionReview: {
        title: "请确认从来源文件识别出的信息",
        why: "来源文件或其中识别出的业务信息还没有确认，AI 不能直接采用。",
        action: "点击“检查识别信息”，核对这份来源文件并确认正确内容。",
        after: "返回任务时，系统会检查更新并自动重试一次识别；信息有效时 AI 会继续执行，否则会显示还需处理的内容。",
      },
      failed: {
        title: "这个步骤没有完成",
        why: "AI 在完成本步骤前停止，后续步骤没有被改动。",
        after: "重试成功后，AI 会从已保存的进度继续处理。",
      },
      waiting: {
        title: "任务暂时停下了",
        why: "AI 需要重新确认任务当前状态，才能安全地继续处理。",
        action: "暂时不需要操作；任务会自动刷新。如果长时间没有变化，再重新打开本任务。",
        after: "阻塞解除后，AI 会从上次保存的步骤继续。",
      },
    },
    refreshRecovery: "任务状态已变化，请刷新后重试。",
    refreshAction: "刷新任务",
    recoveries: {
      stale: "预览内容已经过期。请刷新任务，重新检查最新内容后再确认。",
      concurrent: "另一个修改正在进行。请等待其结束，然后刷新并重试。",
      disabled: "这个工作类型或来源已经停用，请联系其维护者启用后再开始新任务。",
      insufficient: "已确认的历史案例还不够。请添加或确认相似案例，然后重新识别。",
      interrupted: "上次执行在完成前中断。请刷新任务，再重试标记为需要处理的步骤。",
      failed: "失败步骤之后的工作没有被标记为完成。请刷新任务，并在该步骤上选择重试。",
    },
    states: {
      pending: "等待中",
      running: "进行中",
      awaiting_approval: "等待你的确认",
      awaiting_condition: "等待业务判断",
      succeeded: "已完成",
      skipped: "本次不适用",
      failed: "需要处理",
      cancelled: "已取消",
    },
  },
} as const;

export function useRoutineWorkLabels() {
  const { i18n } = useAppTranslation();
  return labels[i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en"];
}

export function routineRecoveryMessage(
  error: string,
  text: ReturnType<typeof useRoutineWorkLabels>,
) {
  const normalized = error.toLowerCase();
  if (/(preview|revision).*(expired|stale|changed|conflict)|changed_since_preview/.test(normalized)) {
    return text.recoveries.stale;
  }
  if (/locked|concurrent|edit_in_progress/.test(normalized)) return text.recoveries.concurrent;
  if (/disabled|revoked|not_active/.test(normalized)) return text.recoveries.disabled;
  if (/insufficient|not_enough|empty_source/.test(normalized)) return text.recoveries.insufficient;
  if (/interrupt|cancelled|aborted/.test(normalized)) return text.recoveries.interrupted;
  return text.recoveries.failed;
}
