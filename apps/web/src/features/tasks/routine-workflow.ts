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

export type RoutineWorkExecution = {
  workItemId: string;
  definition: { id: string; name: string; version: number };
  run: {
    id: string;
    status: "planned" | "running" | "awaiting_approval" | "awaiting_condition"
      | "succeeded" | "failed" | "cancelled";
    revision: number;
    waitingReason: string | null;
    cancellationRequestedAt: string | null;
  };
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
      outputRefs: { kind: "artifact" | "file" | "note"; summary: string }[];
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
  state: "pending" | "committed" | "expired";
  expiresAt: string;
  revision: number;
};

function actionKey(action: string, stepKey = "") {
  const nonce = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${action}:${stepKey}:${nonce}`.slice(0, 200);
}

export const routineWorkApi = {
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
    reject: "Reject",
    orderReceived: "Confirmed order received",
    noOrder: "No order received",
    selectOrder: "Confirmed order document",
    complete: "Mark step complete",
    reviewLedger: "Review ledger change",
    commitLedger: "Approve ledger change",
    confirmNoLedgerChange: "Confirm no change",
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
    interruptedRecovery: "A running step was interrupted. Retry that step to continue.",
    refreshRecovery: "The task changed. Refresh it before trying again.",
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
    reject: "退回",
    orderReceived: "已确认收到订单",
    noOrder: "尚未收到订单",
    selectOrder: "已确认的订单文件",
    complete: "标记本步骤完成",
    reviewLedger: "预览台账变更",
    commitLedger: "确认并写入台账",
    confirmNoLedgerChange: "确认无需修改",
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
    interruptedRecovery: "上次运行被中断，请重试失败的步骤后继续。",
    refreshRecovery: "任务状态已变化，请刷新后重试。",
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
