import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BrainCircuit, Check, Clock3, ExternalLink, FlaskConical, Loader2, ShieldCheck, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, Textarea } from "@/components/ui/input";
import {
  workflowMemoryApi,
  type AdaptiveLearningPublicationReview,
  type AdaptiveWorkPolicyMode,
  type AdaptiveWorkSuggestion,
} from "@/features/workflow-memory/workflow-memory-api";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

const COPY = {
  en: {
    title: "Role assistant",
    hint: "Turns newly recognized local files into explainable daily-work suggestions.",
    mode: "Assistance level",
    observe: "Observe — suggest only",
    assist: "Assist — prepare local tasks",
    execute: "Execute — local low-risk work only",
    boundary: "Local boundary: never sends externally, overwrites files, or edits source documents.",
    empty: "No new recognized work is waiting in this folder.",
    loading: "Reading new work…",
    failed: "Role suggestions could not be loaded.",
    retry: "Retry",
    detected: "Recognized as",
    confidence: "confidence",
    why: "Why this was suggested",
    actions: "Proposed work",
    history: "Similar confirmed history",
    noHistory: "No confirmed same-type history yet.",
    create: "Confirm and create local Issue",
    creating: "Creating…",
    open: "Open task",
    needsConfirmation: "Confirm the file type before creating a task.",
    helpful: "Useful",
    notHelpful: "Not useful",
    accepted: "Recorded as useful",
    rejected: "Recorded as not useful",
    policyFailed: "The assistance level could not be changed.",
    actionFailed: "The local task could not be created.",
    confirmCreate: "Create one local Issue from this suggestion? No file will be sent or changed.",
    reasonDetected: "The file content matches this business document type.",
    reasonLearnedMapping: "A published correction rule mapped the detected file type to this result.",
    reasonMissing: "No business document classification exists yet.",
    reasonConfirmed: "The document type was confirmed by a person.",
    reasonNeedsConfirmation: "The document type still needs human confirmation.",
    reasonHistory: "This folder has {count} confirmed same-type examples.",
    reasonNoHistory: "No confirmed same-type example exists yet.",
    metrics: "Today’s suggestions",
    readyMetric: "ready",
    createdMetric: "local tasks",
    acceptedMetric: "accepted",
    refresh: "Reconcile now",
    reconciling: "Reconciling…",
    observeHint: "Switch this folder to Assist before creating a task.",
    autoEligible: "Eligible for local automation",
    feedbackReason: "Feedback reason",
    reasonNotRelevant: "Not part of my work",
    reasonWrongType: "Wrong document type",
    reasonMissingActions: "Suggested steps are incomplete",
    reasonDuplicate: "Already handled",
    confirmExecute: "Enable local execute mode for this folder? Only suggestions that pass the displayed safety gate can create local Issues automatically.",
    monitor: "Folder monitoring",
    monitorOn: "Monitoring on",
    monitorOff: "Monitoring off",
    interval: "Scan interval",
    minutes: "min",
    confirmMonitor: "Enable background monitoring for this local folder? New files will be analyzed locally at the selected interval.",
    runMonitorNow: "Check folder now",
    runningMonitor: "Checking folder…",
    learning: "Learning rules",
    generateDraft: "Generate draft",
    evaluate: "Run shadow evaluation",
    publish: "Publish passed draft",
    reviewPublication: "Review publication",
    rollback: "Roll back rule",
    passed: "Gate passed",
    waitingGate: "Waiting for gate",
    evidence: "feedback samples",
    learningProgress: "Learning readiness: {current}/{required} feedback samples",
    evaluationProgress: "Shadow gate needs {required} samples",
    notifications: "Notifications",
    markRead: "Mark read",
    completedMetric: "completed",
    operationFailed: "The requested assistant operation failed.",
    confirmPublish: "Publish this passed learning draft for the current folder?",
    confirmRollback: "Roll back the active learning rule to its previous version?",
    correctedType: "Correct document type",
    correctedActions: "Correct work steps (one per line)",
    confirmCorrection: "I confirm this correction reflects my actual work.",
    correctionRequired: "Confirm the correction before submitting it as learning evidence.",
    shadowTitle: "Shadow comparison (does not affect actual work)",
    currentResult: "Current result",
    candidateResult: "Candidate result",
    preferCurrent: "Current is better",
    preferCandidate: "Candidate is better",
    preferNeither: "Neither",
    shadowRecorded: "Comparison preference recorded",
    confirmShadowPreference: "Confirm this comparison choice as evaluation evidence?",
    publicationReview: "Publication review",
    reviewGate: "Gate",
    reviewChanges: "Rule changes",
    reviewImpact: "Expected impact",
    reviewRollback: "Rollback point",
    reviewBoundary: "Safety boundary",
    affectedSuggestions: "affected suggestions",
    automationEligibleReview: "automation eligible",
    noPreviousRule: "No previous rule; the new rule can still be disabled.",
    localOnlyReview: "Candidate is not active yet. Publication only changes local Issue suggestions and never delivers externally.",
    addedActions: "Added",
    removedActions: "Removed",
    gateInsufficientFeedback: "More confirmed feedback samples are required.",
    gateAcceptanceLow: "The suggestion acceptance rate is below the release threshold.",
    gateCompletionLow: "The completed-Issue rate is below the release threshold.",
    gateInsufficientShadow: "More human shadow comparisons are required.",
    gateCandidateRegression: "Reviewers preferred the current result over the candidate.",
    gateCandidateNotPreferred: "Reviewers did not prefer the candidate result.",
    gateShadowRequired: "Run a shadow evaluation before publication.",
  },
  zh: {
    title: "岗位助手",
    hint: "识别目录中新文件对应的日常工作，并说明判断依据。",
    mode: "协助级别",
    observe: "观察：只给建议",
    assist: "协助：准备本地任务",
    execute: "执行：仅限本地低风险工作",
    boundary: "本地边界：不会自动外发、覆盖文件或修改原始资料。",
    empty: "当前目录没有待处理的新工作建议。",
    loading: "正在识别新工作……",
    failed: "岗位建议加载失败。",
    retry: "重新加载",
    detected: "识别为",
    confidence: "置信度",
    why: "判断依据",
    actions: "建议完成的工作",
    history: "同类已确认历史",
    noHistory: "暂时没有同类已确认历史。",
    create: "确认并创建本地 Issue",
    creating: "正在创建……",
    open: "打开任务",
    needsConfirmation: "请先确认文件类型，再创建任务。",
    helpful: "有用",
    notHelpful: "不合适",
    accepted: "已记录为有用",
    rejected: "已记录为不合适",
    policyFailed: "协助级别更新失败。",
    actionFailed: "本地任务创建失败。",
    confirmCreate: "确认根据这条建议创建一个本地 Issue？不会外发或修改文件。",
    reasonDetected: "文件内容符合该类业务单据特征。",
    reasonLearnedMapping: "已发布的人工纠正规则将原识别类型映射为当前结果。",
    reasonMissing: "尚未形成业务文件分类。",
    reasonConfirmed: "文件类型已经人工确认。",
    reasonNeedsConfirmation: "文件类型仍需人工确认。",
    reasonHistory: "同目录已有 {count} 个同类已确认案例可参考。",
    reasonNoHistory: "尚无同类已确认历史案例。",
    metrics: "今日岗位建议",
    readyMetric: "可处理",
    createdMetric: "已建本地任务",
    acceptedMetric: "已采纳",
    refresh: "立即协调",
    reconciling: "正在协调……",
    observeHint: "请先把当前目录切换为“协助”，再创建任务。",
    autoEligible: "符合本地自动处理门禁",
    feedbackReason: "反馈原因",
    reasonNotRelevant: "不属于我的工作",
    reasonWrongType: "文件类型识别错误",
    reasonMissingActions: "建议步骤不完整",
    reasonDuplicate: "已经处理过",
    confirmExecute: "确认为当前目录启用本地执行模式？只有通过界面所示安全门禁的建议才会自动创建本地 Issue。",
    monitor: "目录监控",
    monitorOn: "监控已开启",
    monitorOff: "监控已关闭",
    interval: "扫描间隔",
    minutes: "分钟",
    confirmMonitor: "确认开启当前本地目录的后台监控？系统会按所选间隔在本地识别新文件。",
    runMonitorNow: "立即检查目录",
    runningMonitor: "正在检查目录……",
    learning: "学习规则",
    generateDraft: "生成学习草稿",
    evaluate: "运行影子评测",
    publish: "发布通过门禁的草稿",
    reviewPublication: "生成发布评审",
    rollback: "回滚规则",
    passed: "门禁已通过",
    waitingGate: "等待通过门禁",
    evidence: "条反馈样本",
    learningProgress: "学习准备度：{current}/{required} 条反馈样本",
    evaluationProgress: "影子评测需至少 {required} 条样本",
    notifications: "通知",
    markRead: "标为已读",
    completedMetric: "已完成",
    operationFailed: "岗位助手操作失败。",
    confirmPublish: "确认将已通过门禁的学习草稿发布到当前目录？",
    confirmRollback: "确认把当前学习规则回滚到上一版本？",
    correctedType: "正确的文件类型",
    correctedActions: "正确的工作步骤（每行一项）",
    confirmCorrection: "我确认以上纠正符合实际工作方式。",
    correctionRequired: "请确认纠正内容后，再将其作为学习证据提交。",
    shadowTitle: "影子对比（不会影响实际工作）",
    currentResult: "当前结果",
    candidateResult: "候选结果",
    preferCurrent: "当前结果更好",
    preferCandidate: "候选结果更好",
    preferNeither: "都不合适",
    shadowRecorded: "已记录对比选择",
    confirmShadowPreference: "确认把本次对比选择作为评测证据？",
    publicationReview: "发布评审",
    reviewGate: "评测门禁",
    reviewChanges: "规则变化",
    reviewImpact: "预计影响",
    reviewRollback: "回滚点",
    reviewBoundary: "安全边界",
    affectedSuggestions: "条建议受影响",
    automationEligibleReview: "条符合自动处理门禁",
    noPreviousRule: "尚无上一版规则；新规则仍可停用。",
    localOnlyReview: "候选规则尚未生效；发布仅影响本地 Issue 建议，不会对外发送。",
    addedActions: "新增",
    removedActions: "移除",
    gateInsufficientFeedback: "还需要更多已确认的反馈样本。",
    gateAcceptanceLow: "建议采纳率低于发布门槛。",
    gateCompletionLow: "本地 Issue 完成率低于发布门槛。",
    gateInsufficientShadow: "还需要更多人工影子对比。",
    gateCandidateRegression: "评审者更偏好当前结果，候选规则存在回退。",
    gateCandidateNotPreferred: "评审者没有明确偏好候选结果。",
    gateShadowRequired: "发布前需要先运行影子评测。",
  },
} as const;

type AdaptiveCopy = { [Key in keyof typeof COPY.en]: string };

const DOCUMENT_LABELS = {
  inquiry: { en: "Inquiry", zh: "询价单" },
  quotation: { en: "Quotation", zh: "报价单" },
  order: { en: "Order", zh: "订单" },
  inquiry_ledger: { en: "Inquiry ledger", zh: "询价台账" },
  quotation_ledger: { en: "Quotation ledger", zh: "报价台账" },
  order_ledger: { en: "Order ledger", zh: "订单台账" },
  price_list: { en: "Price list", zh: "价格表" },
  customer_reference: { en: "Customer reference", zh: "客户资料" },
  other_reference: { en: "Other reference", zh: "其他参考资料" },
} as const;

const DEFAULT_ACTIONS_BY_TYPE: Record<string, string[]> = {
  inquiry: ["核对询价信息", "生成报价单", "更新询价台账", "更新报价台账"],
  quotation: ["复核报价单", "更新报价台账", "跟进客户确认与下单"],
  order: ["核对订单信息", "创建订单处理任务", "更新订单台账"],
  inquiry_ledger: ["核对询价台账", "补齐缺失询价记录"],
  quotation_ledger: ["核对报价台账", "补齐缺失报价记录"],
  order_ledger: ["核对订单台账", "补齐缺失订单记录"],
  price_list: ["核对价格表版本", "将价格表作为报价参考资料"],
  customer_reference: ["核对客户资料", "将客户资料关联到后续商务任务"],
  other_reference: ["核对参考资料", "关联到对应商务任务"],
};

const ENGLISH_ACTIONS: Record<string, string> = {
  核对询价信息: "Verify inquiry details",
  生成报价单: "Prepare quotation",
  更新询价台账: "Update inquiry ledger",
  更新报价台账: "Update quotation ledger",
  复核报价单: "Review quotation",
  跟进客户确认与下单: "Follow customer confirmation and order",
  核对订单信息: "Verify order details",
  创建订单处理任务: "Create order-processing task",
  更新订单台账: "Update order ledger",
};

function reasonLabel(reason: string, suggestion: AdaptiveWorkSuggestion, copy: AdaptiveCopy) {
  if (reason === "document_type_detected") return copy.reasonDetected;
  if (reason === "learned_type_mapping_applied") return copy.reasonLearnedMapping;
  if (reason === "classification_missing") return copy.reasonMissing;
  if (reason === "classification_confirmed") return copy.reasonConfirmed;
  if (reason === "classification_needs_confirmation") return copy.reasonNeedsConfirmation;
  if (reason === "similar_history_found") {
    return copy.reasonHistory.replace("{count}", String(suggestion.history.length));
  }
  if (reason === "similar_history_missing") return copy.reasonNoHistory;
  return reason;
}

function gateReasonLabel(reason: string, copy: AdaptiveCopy) {
  if (reason === "insufficient_feedback_samples") return copy.gateInsufficientFeedback;
  if (reason === "acceptance_rate_below_gate") return copy.gateAcceptanceLow;
  if (reason === "completion_rate_below_gate") return copy.gateCompletionLow;
  if (reason === "insufficient_shadow_preferences") return copy.gateInsufficientShadow;
  if (reason === "shadow_candidate_regression") return copy.gateCandidateRegression;
  if (reason === "shadow_candidate_not_preferred") return copy.gateCandidateNotPreferred;
  if (reason === "shadow_evaluation_required") return copy.gateShadowRequired;
  return reason;
}

function SuggestionCard({
  suggestion,
  copy,
  language,
  policyMode,
  pending,
  onMaterialize,
  onFeedback,
  onOpenTask,
  onShadowPreference,
}: {
  suggestion: AdaptiveWorkSuggestion;
  copy: AdaptiveCopy;
  language: "en" | "zh";
  policyMode: AdaptiveWorkPolicyMode;
  pending: string | null;
  onMaterialize: (suggestion: AdaptiveWorkSuggestion) => void;
  onFeedback: (
    suggestion: AdaptiveWorkSuggestion,
    decision: "accepted" | "rejected",
    reason: string,
    correction?: {
      correctedDocumentType: string;
      correctedActions: string[];
      correctionConfirmed: true;
    },
  ) => void;
  onOpenTask: (workItemId: string) => void;
  onShadowPreference: (
    suggestion: AdaptiveWorkSuggestion,
    preferred: "current" | "candidate" | "neither",
  ) => void;
}) {
  const busy = pending === suggestion.id;
  const [feedbackReason, setFeedbackReason] = useState("not_relevant");
  const [correctedDocumentType, setCorrectedDocumentType] = useState(suggestion.documentType);
  const [correctedActions, setCorrectedActions] = useState(suggestion.actions.join("\n"));
  const [correctionConfirmed, setCorrectionConfirmed] = useState(false);
  const needsCorrection = ["wrong_document_type", "missing_actions"].includes(feedbackReason);
  const normalizedCorrectedActions = correctedActions.split("\n")
    .map((row) => row.trim()).filter(Boolean);
  const correctionHasChange = feedbackReason === "wrong_document_type"
    ? correctedDocumentType !== suggestion.documentType
    : feedbackReason === "missing_actions"
      ? normalizedCorrectedActions.length > 0
        && JSON.stringify(normalizedCorrectedActions) !== JSON.stringify(suggestion.actions)
      : true;
  return (
    <div className="rounded-lg border bg-background p-4" data-testid={`adaptive-suggestion-${suggestion.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{suggestion.artifact?.name ?? suggestion.documentType}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {copy.detected} <span className="font-medium text-foreground">
              {DOCUMENT_LABELS[suggestion.documentType as keyof typeof DOCUMENT_LABELS]?.[language]
                ?? suggestion.documentType}
            </span>
            {suggestion.confidence > 0 ? ` · ${copy.confidence} ${Math.round(suggestion.confidence * 100)}%` : ""}
          </p>
        </div>
        <Badge tone={suggestion.readiness === "ready" ? "success" : "warning"}>
          {suggestion.readiness === "ready" ? copy.create : copy.needsConfirmation}
        </Badge>
        {suggestion.automation.eligible ? <Badge tone="success">{copy.autoEligible}</Badge> : null}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{copy.why}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {suggestion.reasons.map((reason) => (
              <li key={reason}>• {reasonLabel(reason, suggestion, copy)}</li>
            ))}
          </ul>
        </section>
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{copy.actions}</p>
          <ol className="mt-2 space-y-1 text-sm">
            {suggestion.actions.map((action, index) => (
              <li key={action}>{index + 1}. {language === "en" ? ENGLISH_ACTIONS[action] ?? action : action}</li>
            ))}
          </ol>
        </section>
        <section>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{copy.history}</p>
          {suggestion.history.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {suggestion.history.map((history) => (
                <li key={history.classificationId}>• {history.artifact?.name ?? history.documentType}</li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-muted-foreground">{copy.noHistory}</p>}
        </section>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {suggestion.issue ? (
          <Button size="sm" onClick={() => onOpenTask(suggestion.issue!.id)}>
            <ExternalLink className="mr-1 size-3.5" />{suggestion.issue.localRef} · {copy.open}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={busy || suggestion.readiness !== "ready" || policyMode === "observe"}
            title={policyMode === "observe" ? copy.observeHint : undefined}
            onClick={() => onMaterialize(suggestion)}
          >
            {busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Check className="mr-1 size-3.5" />}
            {busy ? copy.creating : copy.create}
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => onFeedback(suggestion, "accepted", "useful_recommendation")}
        ><Check className="mr-1 size-3.5" />{copy.helpful}</Button>
        <Select
          className="h-8 w-auto min-w-40"
          aria-label={copy.feedbackReason}
          value={feedbackReason}
          disabled={busy}
          onChange={(event) => setFeedbackReason(event.target.value)}
        >
          <option value="not_relevant">{copy.reasonNotRelevant}</option>
          <option value="wrong_document_type">{copy.reasonWrongType}</option>
          <option value="missing_actions">{copy.reasonMissingActions}</option>
          <option value="already_handled">{copy.reasonDuplicate}</option>
        </Select>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || (needsCorrection && (!correctionConfirmed || !correctionHasChange))}
          title={needsCorrection && !correctionConfirmed ? copy.correctionRequired : undefined}
          onClick={() => onFeedback(
            suggestion,
            "rejected",
            feedbackReason,
            needsCorrection ? {
              correctedDocumentType,
              correctedActions: normalizedCorrectedActions,
              correctionConfirmed: true,
            } : undefined,
          )}
        ><X className="mr-1 size-3.5" />{copy.notHelpful}</Button>
        {suggestion.feedback ? (
          <span className="text-xs text-muted-foreground">
            {suggestion.feedback.decision === "accepted" ? copy.accepted : copy.rejected}
          </span>
        ) : null}
        {suggestion.outcome?.status === "completed" ? (
          <Badge tone="success">{copy.completedMetric}</Badge>
        ) : null}
      </div>
      {needsCorrection ? (
        <div className="mt-3 grid gap-3 rounded-md border border-dashed p-3 md:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            <span className="mb-1 block">{copy.correctedType}</span>
            <Select
              aria-label={copy.correctedType}
              value={correctedDocumentType}
              onChange={(event) => {
                const nextType = event.target.value;
                setCorrectedDocumentType(nextType);
                if (feedbackReason === "wrong_document_type") {
                  setCorrectedActions((DEFAULT_ACTIONS_BY_TYPE[nextType] ?? []).join("\n"));
                }
                setCorrectionConfirmed(false);
              }}
            >
              {Object.entries(DOCUMENT_LABELS).map(([value, labels]) => (
                <option key={value} value={value}>{labels[language]}</option>
              ))}
            </Select>
          </label>
          <label className="text-xs text-muted-foreground">
            <span className="mb-1 block">{copy.correctedActions}</span>
            <Textarea
              aria-label={copy.correctedActions}
              value={correctedActions}
              onChange={(event) => {
                setCorrectedActions(event.target.value);
                setCorrectionConfirmed(false);
              }}
            />
          </label>
          <label className="flex items-center gap-2 text-xs md:col-span-2">
            <input
              type="checkbox"
              checked={correctionConfirmed}
              onChange={(event) => setCorrectionConfirmed(event.target.checked)}
            />
            {copy.confirmCorrection}
          </label>
        </div>
      ) : null}
      {suggestion.shadow && Object.values(suggestion.shadow.differences).some(Boolean) ? (
        <div className="mt-3 rounded-md border border-dashed p-3 text-sm">
          <p className="font-medium">{copy.shadowTitle}</p>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            {[
              [copy.currentResult, suggestion.shadow.baseline],
              [copy.candidateResult, suggestion.shadow.candidate],
            ].map(([label, result]) => (
              <section key={String(label)} className="rounded bg-muted/40 p-2">
                <p className="text-xs font-semibold">{String(label)} · {DOCUMENT_LABELS[(result as typeof suggestion.shadow.baseline).documentType as keyof typeof DOCUMENT_LABELS]?.[language] ?? (result as typeof suggestion.shadow.baseline).documentType}</p>
                <ol className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {(result as typeof suggestion.shadow.baseline).actions.map((action, index) => <li key={`${action}-${index}`}>{index + 1}. {action}</li>)}
                </ol>
              </section>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onShadowPreference(suggestion, "current")}>{copy.preferCurrent}</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onShadowPreference(suggestion, "candidate")}>{copy.preferCandidate}</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onShadowPreference(suggestion, "neither")}>{copy.preferNeither}</Button>
            {suggestion.shadow.preference ? <span className="self-center text-xs text-muted-foreground">{copy.shadowRecorded}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AdaptiveWorkbench({
  projectId,
  sourceId,
  onOpenTask,
}: {
  projectId: string;
  sourceId: string;
  onOpenTask: (workItemId: string) => void;
}) {
  const { i18n } = useAppTranslation();
  const language = i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en";
  const copy = COPY[language];
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publicationReview, setPublicationReview] = useState<AdaptiveLearningPublicationReview | null>(null);
  const key = ["workflow-memory", "adaptive-workbench", projectId, sourceId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => workflowMemoryApi.getAdaptiveWorkWorkbench(projectId, sourceId),
    enabled: Boolean(projectId && sourceId),
  });
  const learningKey = ["workflow-memory", "adaptive-learning", projectId, sourceId];
  const learningQuery = useQuery({
    queryKey: learningKey,
    queryFn: () => workflowMemoryApi.getAdaptiveLearning(projectId, sourceId),
    enabled: Boolean(projectId && sourceId),
  });
  const notificationsKey = ["workflow-memory", "adaptive-notifications", projectId, sourceId];
  const notificationsQuery = useQuery({
    queryKey: notificationsKey,
    queryFn: () => workflowMemoryApi.getAdaptiveNotifications(projectId, sourceId),
    enabled: Boolean(projectId && sourceId),
  });
  const data = query.data;
  const learning = learningQuery.data;
  const notifications = notificationsQuery.data;
  const shadowDraft = learning?.drafts.find((row) => row.status === "shadow") ?? null;
  const activeRule = learning?.rules.find((row) => row.status === "active") ?? null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const refreshGovernance = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: key }),
    queryClient.invalidateQueries({ queryKey: learningKey }),
    queryClient.invalidateQueries({ queryKey: notificationsKey }),
  ]);
  const updatePolicy = async (mode: AdaptiveWorkPolicyMode) => {
    if (!data) return;
    if (mode === "execute" && !window.confirm(copy.confirmExecute)) return;
    setPending("policy");
    setError(null);
    try {
      await workflowMemoryApi.updateAdaptiveWorkPolicy({
        projectId,
        sourceId,
        expectedRevision: data.policy.revision,
        mode,
        ...(mode === "execute" ? { confirmed: true as const } : {}),
      });
      await refresh();
    } catch {
      setError(copy.policyFailed);
    } finally {
      setPending(null);
    }
  };
  const materialize = async (suggestion: AdaptiveWorkSuggestion) => {
    if (!window.confirm(copy.confirmCreate)) return;
    setPending(suggestion.id);
    setError(null);
    try {
      const result = await workflowMemoryApi.materializeAdaptiveWorkSuggestion(suggestion.id, {
        projectId,
        sourceId,
        confirmed: true,
      });
      await refresh();
      onOpenTask(result.workItem.id);
    } catch {
      setError(copy.actionFailed);
    } finally {
      setPending(null);
    }
  };
  const feedback = async (
    suggestion: AdaptiveWorkSuggestion,
    decision: "accepted" | "rejected",
    reason: string,
    correction?: {
      correctedDocumentType: string;
      correctedActions: string[];
      correctionConfirmed: true;
    },
  ) => {
    setPending(suggestion.id);
    setError(null);
    try {
      await workflowMemoryApi.recordAdaptiveWorkFeedback(suggestion.id, {
        projectId,
        sourceId,
        decision,
        reason,
        ...correction,
      });
      await refresh();
    } catch {
      setError(copy.actionFailed);
    } finally {
      setPending(null);
    }
  };
  const reconcile = async () => {
    setPending("reconcile");
    setError(null);
    try {
      await workflowMemoryApi.reconcileAdaptiveWork({ projectId, sourceId });
      await refresh();
    } catch {
      setError(copy.actionFailed);
    } finally {
      setPending(null);
    }
  };
  const runMonitorNow = async () => {
    setPending("monitor-run");
    setError(null);
    try {
      await workflowMemoryApi.runAdaptiveWorkMonitorNow({ projectId, sourceId });
      await refreshGovernance();
    } catch {
      setError(copy.operationFailed);
    } finally {
      setPending(null);
    }
  };
  const updateMonitor = async (enabled: boolean, intervalMinutes: number) => {
    if (!data?.monitor) return;
    if (enabled && !window.confirm(copy.confirmMonitor)) return;
    setPending("monitor");
    setError(null);
    try {
      await workflowMemoryApi.updateAdaptiveWorkMonitor({
        projectId,
        sourceId,
        expectedRevision: data.monitor.revision,
        enabled,
        intervalMinutes,
        ...(enabled ? { confirmed: true as const } : {}),
      });
      await refreshGovernance();
    } catch {
      setError(copy.operationFailed);
    } finally {
      setPending(null);
    }
  };
  const governanceAction = async (
    kind: "generate" | "evaluate" | "preview" | "publish" | "rollback",
  ) => {
    if (kind === "publish" && !window.confirm(copy.confirmPublish)) return;
    if (kind === "rollback" && !window.confirm(copy.confirmRollback)) return;
    setPending(kind);
    setError(null);
    try {
      if (kind === "generate") {
        await workflowMemoryApi.generateAdaptiveLearningDraft({ projectId, sourceId });
        setPublicationReview(null);
      } else if (kind === "evaluate") {
        await workflowMemoryApi.evaluateAdaptiveLearning({ projectId, sourceId });
        setPublicationReview(null);
      } else if (kind === "preview" && shadowDraft) {
        const result = await workflowMemoryApi.previewAdaptiveLearningPublication(shadowDraft.id);
        setPublicationReview(result.review);
      } else if (kind === "publish" && shadowDraft && publicationReview) {
        await workflowMemoryApi.publishAdaptiveLearningDraft(shadowDraft.id, {
          expectedRevision: shadowDraft.revision,
          reviewFingerprint: publicationReview.fingerprint,
          confirmed: true,
        });
        setPublicationReview(null);
      } else if (kind === "rollback" && activeRule) {
        await workflowMemoryApi.rollbackAdaptiveLearningRule(activeRule.id, {
          expectedRevision: activeRule.revision,
          confirmed: true,
        });
      }
      await refreshGovernance();
    } catch {
      setError(copy.operationFailed);
    } finally {
      setPending(null);
    }
  };
  const markNotificationRead = async (notificationId: string) => {
    setPending(notificationId);
    try {
      await workflowMemoryApi.readAdaptiveNotification(notificationId);
      await queryClient.invalidateQueries({ queryKey: notificationsKey });
    } catch {
      setError(copy.operationFailed);
    } finally {
      setPending(null);
    }
  };
  const recordShadowPreference = async (
    suggestion: AdaptiveWorkSuggestion,
    preferred: "current" | "candidate" | "neither",
  ) => {
    if (!shadowDraft || !window.confirm(copy.confirmShadowPreference)) return;
    setPending(suggestion.id);
    setError(null);
    try {
      await workflowMemoryApi.recordAdaptiveShadowPreference(
        shadowDraft.id,
        suggestion.id,
        {
          expectedRevision: shadowDraft.revision,
          preferred,
          reason: preferred === "neither" ? "both_incorrect" : "better_matches_actual_work",
          confirmed: true,
        },
      );
      setPublicationReview(null);
      await refreshGovernance();
    } catch {
      setError(copy.operationFailed);
    } finally {
      setPending(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BrainCircuit className="size-4" />{copy.title}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{copy.hint}</p>
          </div>
          {data ? (
            <label className="text-xs text-muted-foreground">
              <span className="mr-2">{copy.mode}</span>
              <Select
                aria-label={copy.mode}
                value={data.policy.mode}
                disabled={pending === "policy" || !data.permissions.canManage}
                onChange={(event) => void updatePolicy(event.target.value as AdaptiveWorkPolicyMode)}
              >
                <option value="observe">{copy.observe}</option>
                <option value="assist">{copy.assist}</option>
                <option value="execute">{copy.execute}</option>
              </Select>
            </label>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-2 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />{copy.boundary}
        </div>
        {data ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{copy.metrics}</span>
            <Badge>{data.metrics.total}</Badge>
            <span>{data.metrics.ready} {copy.readyMetric}</span>
            <span>{data.metrics.materialized} {copy.createdMetric}</span>
            <span>{data.metrics.accepted} {copy.acceptedMetric}</span>
            <span>{data.metrics.completed} {copy.completedMetric}</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending != null}
              onClick={() => void reconcile()}
            >
              {pending === "reconcile" ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
              {pending === "reconcile" ? copy.reconciling : copy.refresh}
            </Button>
          </div>
        ) : null}
        {data?.monitor ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
            <Clock3 className="size-4" />
            <span className="font-medium">{copy.monitor}</span>
            <Button
              size="sm"
              variant={data.monitor.enabled ? "primary" : "secondary"}
              disabled={pending != null || !data.permissions.canManage}
              onClick={() => void updateMonitor(!data.monitor!.enabled, data.monitor!.intervalMinutes)}
            >{data.monitor.enabled ? copy.monitorOn : copy.monitorOff}</Button>
            <label className="text-xs text-muted-foreground">
              <span className="mr-2">{copy.interval}</span>
              <Select
                aria-label={copy.interval}
                value={String(data.monitor.intervalMinutes)}
                disabled={pending != null || !data.permissions.canManage}
                onChange={(event) => void updateMonitor(data.monitor!.enabled, Number(event.target.value))}
              >
                {[5, 15, 30, 60].map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes} {copy.minutes}</option>
                ))}
              </Select>
            </label>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending != null || !data.monitor.enabled}
              onClick={() => void runMonitorNow()}
            >
              {pending === "monitor-run" ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
              {pending === "monitor-run" ? copy.runningMonitor : copy.runMonitorNow}
            </Button>
            {data.monitor.lastError ? <span className="text-xs text-destructive">{data.monitor.lastError}</span> : null}
          </div>
        ) : null}
        <div className="rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <FlaskConical className="size-4" />
            <span className="font-medium">{copy.learning}</span>
            <Button size="sm" variant="secondary" disabled={pending != null || !data?.permissions.canManage || !learning?.readiness.canGenerate} onClick={() => void governanceAction("generate")}>{copy.generateDraft}</Button>
            <Button size="sm" variant="secondary" disabled={pending != null || !shadowDraft || !data?.permissions.canManage || !learning?.readiness.canEvaluate} onClick={() => void governanceAction("evaluate")}>{copy.evaluate}</Button>
            <Button size="sm" variant="secondary" disabled={pending != null || !shadowDraft || !data?.permissions.canManage} onClick={() => void governanceAction("preview")}>{copy.reviewPublication}</Button>
            <Button
              size="sm"
              disabled={pending != null
                || !shadowDraft?.evaluation.passed
                || publicationReview?.draftId !== shadowDraft.id
                || publicationReview?.draftRevision !== shadowDraft.revision
                || !publicationReview.gate.passed}
              onClick={() => void governanceAction("publish")}
            >{copy.publish}</Button>
            <Button size="sm" variant="secondary" disabled={pending != null || !activeRule?.previousRuleId} onClick={() => void governanceAction("rollback")}>{copy.rollback}</Button>
          </div>
          {shadowDraft ? (
            <p className="mt-2 text-xs text-muted-foreground">
              v{shadowDraft.version} · {shadowDraft.evaluation.evidenceCount} {copy.evidence} · {shadowDraft.evaluation.passed ? copy.passed : copy.waitingGate}
            </p>
          ) : activeRule ? <p className="mt-2 text-xs text-muted-foreground">v{activeRule.version} · {copy.passed}</p> : learning?.readiness ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {copy.learningProgress
                .replace("{current}", String(learning.readiness.evidenceCount))
                .replace("{required}", String(learning.readiness.draftRequired))}
              {` · ${copy.evaluationProgress.replace("{required}", String(learning.readiness.evaluationRequired))}`}
            </p>
          ) : null}
          {publicationReview && shadowDraft
            && publicationReview.draftId === shadowDraft.id
            && publicationReview.draftRevision === shadowDraft.revision ? (
              <div className="mt-3 grid gap-3 rounded-md border border-dashed p-3 text-xs md:grid-cols-2" data-testid="adaptive-publication-review">
                <section>
                  <p className="font-semibold">{copy.publicationReview} · {copy.reviewGate}</p>
                  <p className="mt-1 text-muted-foreground">
                    {publicationReview.gate.passed ? copy.passed : copy.waitingGate}
                    {publicationReview.gate.reasons.length
                      ? ` · ${publicationReview.gate.reasons.map((reason) => gateReasonLabel(reason, copy)).join("；")}`
                      : ""}
                  </p>
                  <p className="mt-1 text-muted-foreground">{publicationReview.evidence.count} {copy.evidence}</p>
                </section>
                <section>
                  <p className="font-semibold">{copy.reviewImpact}</p>
                  <p className="mt-1 text-muted-foreground">
                    {publicationReview.impact.affectedSuggestions} {copy.affectedSuggestions} · {publicationReview.impact.automationEligible} {copy.automationEligibleReview}
                  </p>
                </section>
                <section>
                  <p className="font-semibold">{copy.reviewChanges}</p>
                  <ul className="mt-1 space-y-1 text-muted-foreground">
                    {publicationReview.changes.map((change) => (
                      <li key={change.documentType}>
                        {DOCUMENT_LABELS[change.documentType as keyof typeof DOCUMENT_LABELS]?.[language] ?? change.documentType}
                        {change.actionChanges.added.length ? ` · ${copy.addedActions}: ${change.actionChanges.added.join("、")}` : ""}
                        {change.actionChanges.removed.length ? ` · ${copy.removedActions}: ${change.actionChanges.removed.join("、")}` : ""}
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <p className="font-semibold">{copy.reviewRollback}</p>
                  <p className="mt-1 text-muted-foreground">
                    {publicationReview.rollback.available
                      ? `v${publicationReview.rollback.version}`
                      : copy.noPreviousRule}
                  </p>
                </section>
                <section className="md:col-span-2">
                  <p className="font-semibold">{copy.reviewBoundary}</p>
                  <p className="mt-1 text-muted-foreground">{copy.localOnlyReview}</p>
                </section>
              </div>
            ) : null}
        </div>
        {notifications?.notifications.length ? (
          <div className="rounded-md border p-3 text-sm">
            <p className="flex items-center gap-2 font-medium"><Bell className="size-4" />{copy.notifications} <Badge>{notifications.unread}</Badge></p>
            <ul className="mt-2 space-y-2">
              {notifications.notifications.slice(0, 5).map((notification) => (
                <li key={notification.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className={notification.state === "unread" ? "text-foreground" : "text-muted-foreground"}>{notification.message}</span>
                  {notification.state === "unread" ? <Button size="sm" variant="secondary" disabled={pending === notification.id} onClick={() => void markNotificationRead(notification.id)}>{copy.markRead}</Button> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {query.isLoading ? <p className="text-sm text-muted-foreground">{copy.loading}</p> : null}
        {query.isError ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            {copy.failed}<Button size="sm" variant="secondary" onClick={() => void query.refetch()}>{copy.retry}</Button>
          </div>
        ) : null}
        {data && !data.suggestions.length ? <p className="text-sm text-muted-foreground">{copy.empty}</p> : null}
        {data?.suggestions.map((suggestion) => (
          <SuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            copy={copy}
            language={language}
            policyMode={data.policy.mode}
            pending={pending}
            onMaterialize={(row) => void materialize(row)}
            onFeedback={(row, decision, reason, correction) => void feedback(row, decision, reason, correction)}
            onOpenTask={onOpenTask}
            onShadowPreference={(row, preferred) => void recordShadowPreference(row, preferred)}
          />
        ))}
      </CardContent>
    </Card>
  );
}
