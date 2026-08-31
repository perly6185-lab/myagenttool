import { api } from "@/data/use-console-actions";
import { ApiError } from "@/lib/api-client";
import type { AutoRunReadiness } from "./auto-run-readiness-ui";
import type { ExecutionActionReceipt } from "./execution-review-card";
import type { SummaryCopy } from "./work-item-summary-copy";
import { createWorkItemReviewActionController } from "./work-item-review-action-controller";
import type {
  LocalWorkItem,
  LocalWorkItemAutoRun,
  LocalWorkItemObservability,
  WorkItemExecutionReview,
} from "./task-view-types";

export type TaskTemplateCandidate = {
  templateId: string;
  definitionId: string;
  version: number;
  name: string;
  expectedOutput: string;
  reasons: string[];
};

export type PendingTemplateClarification = {
  acceptanceCriteria: string[];
  verificationSop: string[];
  risks?: string[];
  evidence?: Record<string, unknown>;
  candidates: TaskTemplateCandidate[];
  reason?: string;
};

export type ExecutionActionKind =
  | "retry_execution"
  | "fix_with_ai"
  | "rerun_verification"
  | "answer_ai"
  | "create_pull_request"
  | "update_pull_request"
  | "apply_local_changes"
  | "apply_office_result";

export type ExecutionPendingAction =
  | "start"
  | "cancel-start"
  | "recheck-start"
  | "changes"
  | "policy"
  | "reverify"
  | "reconcile";

type Language = "zh" | "en";

type ExecutionClient = Pick<typeof api,
  | "suggestWorkItemDraft"
  | "updateWorkItem"
  | "prepareWorkItemExecutionContract"
  | "confirmWorkItemExecutionContract"
  | "createWorkItemComment"
  | "retryAutoRun"
  | "startWorkItemAutoRun"
  | "reverifyAutoRun"
  | "answerClarify"
  | "cancelAutoRun"
  | "cancelWorkItemExecutionStart"
  | "recheckWorkItemExecutionStart"
  | "retryLegacyWorkItemExecution"
  | "reconcileAutoRunExecutionAction"
>;

type ControllerEffects = {
  setItem: (item: LocalWorkItem) => void;
  setReadiness: (readiness: AutoRunReadiness | null) => void;
  setPending: (pending: ExecutionPendingAction | null) => void;
  setActionError: (error: string | null) => void;
  setNotice: (notice: string | null) => void;
  setReceipt: (receipt: ExecutionActionReceipt | null | ((current: ExecutionActionReceipt | null) => ExecutionActionReceipt | null)) => void;
  refresh: () => void;
  setStartConfirmationOpen: (open: boolean) => void;
  setPendingTemplateClarification: (clarification: PendingTemplateClarification | null) => void;
  setChangeRequest: (value: string) => void;
  setChangeRequestOpen: (open: boolean) => void;
  setResultExpanded: (expanded: boolean) => void;
  setReportOpen: (open: boolean) => void;
  setMaterialNotice: (notice: string | null) => void;
  setClarifyAnswer: (answer: string) => void;
  setClarifyPending: (pending: boolean) => void;
  setClarifyStopPending: (pending: boolean) => void;
  setClarifyError: (error: string | null) => void;
  setRetryOpen: (open: boolean) => void;
  setRetryPending: (pending: boolean) => void;
  setRetryError: (error: string | null) => void;
};

type ReviewHandlers = {
  runPrimaryAction: () => void;
  openReviewResult: (targetId?: string) => void;
  openDetails: () => void;
  viewChanges: () => void;
  viewBatchDetails: () => void;
  openPullRequestConfirmation: () => void;
  openDeliveryConfirmation: () => void;
};

export function createWorkItemExecutionController({
  item,
  observability,
  executionReview,
  effectiveReceipt,
  pendingTemplateClarification,
  actionPending,
  executionContractDefined,
  canStartAi,
  changeRequest,
  feedbackMode,
  canRerunVerification,
  canAskAiToFix,
  askAiFixFeedback,
  clarifyAnswer,
  clarifyPending,
  clarifyStopPending,
  retryPending,
  hasRetryableExecution,
  retryableLegacyExecution,
  retryableRun,
  language,
  copy,
  effects,
  reviewHandlers,
  client = api,
}: {
  item: LocalWorkItem;
  observability: LocalWorkItemObservability | null;
  executionReview: WorkItemExecutionReview | null;
  effectiveReceipt: ExecutionActionReceipt | null;
  pendingTemplateClarification: PendingTemplateClarification | null;
  actionPending: string | null;
  executionContractDefined: boolean;
  canStartAi: boolean;
  changeRequest: string;
  feedbackMode: "revision" | "follow_up";
  canRerunVerification: boolean;
  canAskAiToFix: boolean;
  askAiFixFeedback: string;
  clarifyAnswer: string;
  clarifyPending: boolean;
  clarifyStopPending: boolean;
  retryPending: boolean;
  hasRetryableExecution: boolean;
  retryableLegacyExecution: boolean;
  retryableRun: LocalWorkItemAutoRun | null;
  language: Language;
  copy: SummaryCopy;
  effects: ControllerEffects;
  reviewHandlers: ReviewHandlers;
  client?: ExecutionClient;
}) {
  const actionRequest = (kind: ExecutionActionKind) => ({
    idempotencyKey: `work-item:${item.id}:${kind}:${item.revision}:${effectiveReceipt?.id ?? "none"}:${effectiveReceipt?.status ?? "none"}:${effectiveReceipt?.updatedAt ?? "none"}:${executionReview?.targetId ?? observability?.latestRun?.id ?? "none"}:${executionReview?.targetStatus ?? observability?.latestRun?.status ?? "none"}`.slice(0, 200),
    expectedWorkItemRevision: item.revision,
    expectedTargetStatus: executionReview?.targetStatus ?? observability?.latestRun?.status ?? undefined,
  });

  const uncertainReceipt = (message: string): ExecutionActionReceipt => ({
    status: "unknown",
    message,
    impact: "none",
    nextOwner: "me",
  });

  const receiptFromError = (error: unknown): ExecutionActionReceipt | null => {
    if (!(error instanceof ApiError) || !error.details?.actionReceipt || typeof error.details.actionReceipt !== "object") return null;
    return error.details.actionReceipt as ExecutionActionReceipt;
  };

  const executionActionStatus = effectiveReceipt?.status ?? null;
  const executionActionLocked = executionActionStatus === "accepted"
    || executionActionStatus === "running"
    || executionActionStatus === "unknown";

  const notifyStateChange = (source: string, detail: Record<string, unknown> = {}) => {
    window.dispatchEvent(new CustomEvent("myagenttool:state-change", {
      detail: { source, workItemId: item.id, ...detail },
    }));
  };

  const planChanged = (error: unknown) => error instanceof ApiError
    && ["work_item_revision_conflict", "work_item_record_bindings_stale"].includes(error.code);

  const prepareReviewExecutionPlan = async () => {
    if (actionPending || executionContractDefined) return;
    effects.setPending("start");
    effects.setActionError(null);
    try {
      const assisted = await client.suggestWorkItemDraft({ projectId: item.projectId, title: item.title, body: item.body }) as {
        draft: { acceptanceCriteria: string[]; verificationSop: string[] };
      };
      const prepared = await client.updateWorkItem(item.id, {
        expectedRevision: item.revision,
        acceptanceCriteria: assisted.draft.acceptanceCriteria,
        verificationSop: assisted.draft.verificationSop,
      }) as { workItem: LocalWorkItem };
      effects.setItem(prepared.workItem);
      effects.setNotice(language === "zh"
        ? "重新执行所需的完成标准和检查步骤已建立。请先核对内容，再选择“让 AI 继续修改”启动新一轮执行；旧结果仍不能据此确认通过。"
        : "The criteria and verification steps for a new run are ready. Review them, then choose Ask AI to revise to start a new run. The old result still cannot be approved against these later requirements.");
    } catch (caught) {
      const changed = planChanged(caught);
      effects.setActionError(changed
        ? (language === "zh" ? "任务或资料刚刚发生变化，已为你刷新，请按最新内容重新核对。" : "The task or its materials just changed. Review the refreshed content before continuing.")
        : (language === "zh" ? "执行方案暂时无法生成，请稍后重试。" : "The execution plan could not be prepared. Try again later."));
      if (changed) effects.refresh();
    } finally {
      effects.setPending(null);
    }
  };

  const prepareStartExecutionPlan = async () => {
    if (actionPending || executionContractDefined) return;
    effects.setPending("start");
    effects.setActionError(null);
    try {
      const assisted = await client.suggestWorkItemDraft({ projectId: item.projectId, title: item.title, body: item.body }) as {
        draft: {
          taskUnderstanding?: string;
          acceptanceCriteria: string[];
          verificationSop: string[];
          risks?: string[];
          evidence?: Record<string, unknown>;
          templateMatch?: {
            state: "matched" | "ambiguous" | "missing";
            candidates: TaskTemplateCandidate[];
            selected: TaskTemplateCandidate | null;
            clarification?: { reason?: string };
          };
        };
      };
      if (!assisted.draft.acceptanceCriteria?.length || !assisted.draft.verificationSop?.length) {
        throw new Error("execution_plan_incomplete");
      }
      if (assisted.draft.templateMatch?.state === "ambiguous") {
        effects.setPendingTemplateClarification({
          acceptanceCriteria: assisted.draft.acceptanceCriteria,
          verificationSop: assisted.draft.verificationSop,
          risks: assisted.draft.risks,
          evidence: assisted.draft.evidence,
          candidates: assisted.draft.templateMatch.candidates,
          reason: assisted.draft.templateMatch.clarification?.reason,
        });
        const reason = assisted.draft.templateMatch.clarification?.reason;
        effects.setNotice(reason === "manual_resume_observation"
          ? (language === "zh"
              ? "这项处理方式已进入观察期。本次确认后才会使用，积累新的成功结果后才恢复自动采用。"
              : "You returned this template to observation. Confirm it for now; automatic use resumes after new successful results.")
          : reason === "outcome_feedback_paused"
            ? (language === "zh"
                ? "这项处理方式近期多次产生错误结果类型，已暂停自动采用。你仍可确认本次使用。"
                : "This template repeatedly produced the wrong result type, so automatic matching is paused. You can still confirm it for this task.")
            : reason === "outcome_feedback_watch"
              ? (language === "zh"
                  ? "这项处理方式近期出现过多次结果类型不符，系统已降低推荐优先级。本次确认后才会使用。"
                  : "This template recently produced several wrong result types. It will be used only after you confirm.")
              : reason === "learned_preference_conflict"
                ? (language === "zh"
                    ? "你以前对此类任务选择过不同结果。请确认这次想得到什么，系统不会擅自猜测。"
                    : "You previously chose different results for this kind of task. Confirm this result so the system does not guess.")
                : (language === "zh"
                    ? "系统找到了多种可能结果。请只确认这次想得到什么，不需要了解处理方式。"
                    : "Several results may fit. Confirm only the result you want; you do not need to choose a template."));
        return;
      }
      let latestItem = item;
      if (assisted.draft.templateMatch?.state === "matched" && assisted.draft.templateMatch.selected) {
        const selected = assisted.draft.templateMatch.selected;
        const bound = await client.updateWorkItem(item.id, {
          expectedRevision: item.revision,
          myTemplateBinding: {
            definitionId: selected.definitionId,
            familyId: selected.templateId,
            version: selected.version,
            matchReasons: selected.reasons,
          },
        }) as { workItem: LocalWorkItem };
        latestItem = bound.workItem;
      }
      const prepared = await client.prepareWorkItemExecutionContract(item.id, {
        expectedRevision: latestItem.revision,
        draftOverride: {
          taskUnderstanding: assisted.draft.taskUnderstanding,
          acceptanceCriteria: assisted.draft.acceptanceCriteria,
          verificationSop: assisted.draft.verificationSop,
          risks: assisted.draft.risks,
          evidence: assisted.draft.evidence,
        },
      }) as { workItem: LocalWorkItem };
      effects.setItem(prepared.workItem);
      effects.setStartConfirmationOpen(true);
      effects.setNotice(language === "zh"
        ? "执行方案已生成，请在确认页核对后决定是否开始。"
        : "The execution plan is ready. Review it in the confirmation before deciding whether to start.");
    } catch (caught) {
      const changed = planChanged(caught);
      effects.setActionError(changed
        ? (language === "zh" ? "任务或资料刚刚发生变化，已为你刷新，请按最新内容重新核对。" : "The task or its materials just changed. Review the refreshed content before continuing.")
        : (language === "zh" ? "执行方案暂时无法生成，请稍后重试。" : "The execution plan could not be prepared. Try again later."));
      if (changed) effects.refresh();
    } finally {
      effects.setPending(null);
    }
  };

  const choosePendingTemplateResult = async (candidate: TaskTemplateCandidate) => {
    if (actionPending || !pendingTemplateClarification) return;
    effects.setPending("start");
    effects.setActionError(null);
    try {
      const confirmation = language === "zh"
        ? `你确认这次需要“${candidate.expectedOutput}”`
        : `You confirmed the desired result is “${candidate.expectedOutput}”`;
      const bound = await client.updateWorkItem(item.id, {
        expectedRevision: item.revision,
        myTemplateBinding: {
          definitionId: candidate.definitionId,
          familyId: candidate.templateId,
          version: candidate.version,
          matchReasons: [...candidate.reasons, confirmation],
          userConfirmedResult: true,
        },
      }) as { workItem: LocalWorkItem };
      const prepared = await client.prepareWorkItemExecutionContract(item.id, {
        expectedRevision: bound.workItem.revision,
        draftOverride: {
          acceptanceCriteria: pendingTemplateClarification.acceptanceCriteria,
          verificationSop: pendingTemplateClarification.verificationSop,
          risks: pendingTemplateClarification.risks,
          evidence: pendingTemplateClarification.evidence,
        },
      }) as { workItem: LocalWorkItem };
      effects.setItem(prepared.workItem);
      effects.setPendingTemplateClarification(null);
      effects.setStartConfirmationOpen(true);
      effects.setNotice(language === "zh"
        ? `已确认最终得到“${candidate.expectedOutput}”。请在确认页核对执行方案。`
        : `The desired result is “${candidate.expectedOutput}”. Review the execution plan in the confirmation.`);
    } catch (caught) {
      const changed = planChanged(caught);
      effects.setActionError(changed
        ? (language === "zh" ? "任务或资料刚刚发生变化，已为你刷新，请重新选择结果。" : "The task or its materials just changed. Review the refresh and choose the result again.")
        : (language === "zh" ? "处理结果暂时无法确认，请重试。" : "The desired result could not be confirmed. Try again."));
      if (changed) effects.refresh();
    } finally {
      effects.setPending(null);
    }
  };

  const startAiWork = async () => {
    if (actionPending || !canStartAi) return;
    effects.setPending("start");
    effects.setActionError(null);
    try {
      const response = await client.confirmWorkItemExecutionContract(item.id, item.revision) as { workItem: LocalWorkItem };
      effects.setItem(response.workItem);
      effects.setStartConfirmationOpen(false);
      effects.setNotice(language === "zh"
        ? "AI 已接单。任务会按截止风险和优先级进入执行；排队或阻塞原因会显示在当前任务中。"
        : "AI accepted the task. Execution follows deadline risk and priority, with queue or blocking reasons shown here.");
      notifyStateChange("work-item-start-ai");
      effects.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.details?.readiness) {
        effects.setReadiness(caught.details.readiness as AutoRunReadiness);
        effects.setActionError(language === "zh" ? "启动条件发生变化，请按提示处理后再确认。" : "Start requirements changed. Resolve the issue shown and confirm again.");
      } else if (planChanged(caught)) {
        effects.setActionError(language === "zh"
          ? "任务或资料刚刚发生变化，本次没有启动。请核对刷新后的内容再确认。"
          : "The task or its materials just changed, so nothing started. Review the refreshed content and confirm again.");
        effects.refresh();
      } else {
        effects.setActionError(copy.aiStartFailed);
      }
    } finally {
      effects.setPending(null);
    }
  };

  const sendChangeRequest = async (bodyOverride?: string, modeOverride?: "revision" | "follow_up") => {
    const body = (bodyOverride ?? changeRequest).trim();
    const mode = modeOverride ?? feedbackMode;
    if (!body || actionPending || executionActionLocked) return;
    effects.setPending("changes");
    effects.setActionError(null);
    effects.setReceipt(null);
    let commentSaved = false;
    try {
      await client.createWorkItemComment(item.id, body);
      commentSaved = true;
      if (observability?.latestRun?.id) {
        const response = await client.retryAutoRun(observability.latestRun.id, body, actionRequest("fix_with_ai")) as { actionReceipt?: ExecutionActionReceipt };
        if (response.actionReceipt) effects.setReceipt(response.actionReceipt);
      } else {
        await client.startWorkItemAutoRun(item.id);
      }
      effects.setChangeRequest("");
      effects.setChangeRequestOpen(false);
      effects.setResultExpanded(false);
      effects.setReportOpen(false);
      const notice = mode === "follow_up"
        ? language === "zh" ? "问题已交给 AI。AI 会沿用当前任务和材料继续处理，并生成新版结果。" : "Your question was sent to AI. It will continue with the same task and materials and produce a new result."
        : copy.changesSent;
      effects.setNotice(notice);
      effects.setReceipt((current) => current ?? { message: notice, impact: "none", nextOwner: "ai" });
      if (bodyOverride) effects.setMaterialNotice(copy.materialReprocessStarted);
      notifyStateChange("work-item-request-changes");
      effects.refresh();
    } catch (error) {
      const errorReceipt = receiptFromError(error);
      effects.setActionError(error instanceof ApiError && error.code === "execution_action_stale"
        ? language === "zh"
          ? "任务刚刚发生变化，修改要求已保留，但没有重复启动 AI。请核对刷新后的状态。"
          : "The task just changed. Your feedback was kept, but AI was not started again. Review the refreshed status."
        : commentSaved ? copy.changesFailed : copy.commentFailed);
      if (errorReceipt) effects.setReceipt(errorReceipt);
      if (commentSaved) {
        if (!(error instanceof ApiError)) {
          effects.setReceipt(uncertainReceipt(language === "zh"
            ? "修改请求已发送，但暂时无法确认 AI 是否开始处理。"
            : "The fix request was sent, but it is not yet clear whether AI started."));
        }
        notifyStateChange("work-item-change-comment");
        effects.refresh();
      }
    } finally {
      effects.setPending(null);
    }
  };

  const rerunDeliveryVerification = async () => {
    const run = observability?.latestRun;
    if (!run || actionPending || executionActionLocked
      || !reviewActions.isEnabled("rerun_verification", canRerunVerification)) return;
    effects.setPending("reverify");
    effects.setActionError(null);
    effects.setReceipt(null);
    try {
      const response = await client.reverifyAutoRun(run.id, actionRequest("rerun_verification")) as { actionReceipt?: ExecutionActionReceipt };
      const notice = language === "zh" ? "验证已重新开始，完成后会刷新本次交付证据。" : "Verification has restarted. The delivery evidence will refresh when it finishes.";
      effects.setNotice(notice);
      effects.setReceipt(response.actionReceipt ?? { message: notice, impact: "none", nextOwner: "system" });
      effects.refresh();
      notifyStateChange("work-item-reverification-started", { autoRunId: run.id });
    } catch (error) {
      const errorReceipt = receiptFromError(error);
      effects.setActionError(error instanceof Error ? error.message : (language === "zh" ? "验证暂时无法重新执行，请稍后重试。" : "Verification could not be rerun. Try again later."));
      if (errorReceipt) {
        effects.setReceipt(errorReceipt);
        effects.refresh();
      } else if (!(error instanceof ApiError)) {
        effects.setReceipt(uncertainReceipt(language === "zh"
          ? "验证请求已发送，但暂时无法确认是否已经开始。"
          : "The verification request was sent, but its start is not yet confirmed."));
        effects.refresh();
      }
    } finally {
      effects.setPending(null);
    }
  };

  const askAiToFix = () => {
    if (!reviewActions.isEnabled("fix_with_ai", canAskAiToFix) || actionPending || executionActionLocked) return;
    void sendChangeRequest(askAiFixFeedback, "revision");
  };

  const answerAiClarification = async () => {
    const run = observability?.latestRun;
    const answer = clarifyAnswer.trim();
    if (!run || run.status !== "needs_input" || !answer || clarifyPending || executionActionLocked
      || !reviewActions.isEnabled("answer_ai", true)) return;
    effects.setClarifyPending(true);
    effects.setClarifyError(null);
    effects.setReceipt(null);
    try {
      const response = await client.answerClarify(run.id, { answers: answer, ...actionRequest("answer_ai") }) as {
        resumed?: boolean;
        waitingForInput?: boolean;
        alreadyDecided?: unknown;
        reason?: string;
        actionReceipt?: ExecutionActionReceipt;
      };
      if (response.resumed !== true && !response.alreadyDecided) {
        throw new Error(response.reason ?? "clarification_resume_failed");
      }
      effects.setClarifyAnswer("");
      const notice = response.waitingForInput
        ? language === "zh"
          ? "AI 已重新理解你的回答，但仍需要你确认一个问题。"
          : "AI reconsidered your answer and still needs one more decision."
        : language === "zh"
          ? "你的回答已交给 AI，AI 将在同一次任务运行中继续处理。"
          : "Your answer was sent to AI. It will continue in the same task run.";
      effects.setNotice(notice);
      effects.setReceipt(response.actionReceipt ?? { message: notice, impact: "none", nextOwner: response.waitingForInput ? "me" : "ai" });
      effects.refresh();
      notifyStateChange("work-item-clarification-answered", { autoRunId: run.id });
    } catch (error) {
      const errorReceipt = receiptFromError(error);
      effects.setClarifyError(language === "zh" ? "回答暂时无法提交，请稍后重试。" : "The answer could not be submitted. Try again later.");
      if (errorReceipt) {
        effects.setReceipt(errorReceipt);
        effects.refresh();
      } else if (!(error instanceof ApiError)) {
        effects.setReceipt(uncertainReceipt(language === "zh"
          ? "回答已发送，但暂时无法确认 AI 是否收到。"
          : "The answer was sent, but it is not yet clear whether AI received it."));
        effects.refresh();
      }
    } finally {
      effects.setClarifyPending(false);
    }
  };

  const setAutomaticExecution = async (executionPolicy: "auto" | "paused") => {
    if (actionPending) return;
    effects.setPending("policy");
    effects.setActionError(null);
    try {
      const response = await client.updateWorkItem(item.id, {
        expectedRevision: item.revision,
        executionPolicy,
        ...(executionPolicy === "auto" ? { waitingOn: "ai" } : {}),
      }) as { workItem: LocalWorkItem };
      effects.setItem(response.workItem);
      effects.setNotice(executionPolicy === "auto"
        ? language === "zh" ? "AI 自动处理已恢复；资源可用时会继续。" : "Automatic AI work resumed and will continue when capacity is available."
        : language === "zh" ? "已暂停后续 AI 自动处理；当前运行不会被强制中断。" : "Future automatic AI work is paused; a currently running task is not forcibly interrupted.");
      notifyStateChange("work-item-execution-policy");
    } catch {
      effects.setActionError(language === "zh" ? "自动处理设置更新失败，请重试。" : "The automatic-work setting could not be updated. Try again.");
    } finally {
      effects.setPending(null);
    }
  };

  const cancelPendingExecutionStart = async () => {
    const startReceipt = item.executionStartReceipt ?? null;
    if (actionPending || !startReceipt?.canCancel) return;
    effects.setPending("cancel-start");
    effects.setActionError(null);
    try {
      const response = await client.cancelWorkItemExecutionStart(item.id, item.revision) as { workItem: LocalWorkItem };
      effects.setItem(response.workItem);
      effects.setNotice(language === "zh"
        ? "本次启动已取消，AI 尚未开始执行。执行方案仍保留，需要时可以重新核对并启动。"
        : "This start was cancelled before AI began. The plan is preserved so you can review and start it later.");
      notifyStateChange("work-item-start-cancelled");
    } catch (caught) {
      const changed = caught instanceof ApiError && caught.code === "work_item_revision_conflict";
      effects.setActionError(changed
        ? (language === "zh" ? "任务状态刚刚发生变化，已刷新后请重新确认。" : "The task just changed. Review the refreshed status.")
        : (language === "zh" ? "AI 可能已经开始，暂时无法取消。请查看最新执行状态。" : "AI may have started, so this request could not be cancelled. Check the latest status."));
      effects.refresh();
    } finally {
      effects.setPending(null);
    }
  };

  const recheckPendingExecutionStart = async () => {
    const startReceipt = item.executionStartReceipt ?? null;
    if (actionPending || !startReceipt || !["queued", "blocked"].includes(startReceipt.status)) return;
    effects.setPending("recheck-start");
    effects.setActionError(null);
    try {
      const response = await client.recheckWorkItemExecutionStart(item.id, item.revision) as { workItem: LocalWorkItem };
      effects.setItem(response.workItem);
      effects.setReadiness(null);
      effects.setNotice(language === "zh"
        ? "已按最新状态重新检查并唤醒调度，启动结果会自动更新。"
        : "The latest state was rechecked and scheduling was awakened. The start result will update automatically.");
      effects.refresh();
    } catch {
      effects.setActionError(language === "zh" ? "重新检查失败，已刷新任务状态。" : "Recheck failed. The task status has been refreshed.");
      effects.refresh();
    } finally {
      effects.setPending(null);
    }
  };

  const stopAiClarification = async () => {
    const run = observability?.latestRun;
    if (!run || run.status !== "needs_input" || clarifyStopPending || clarifyPending) return;
    effects.setClarifyStopPending(true);
    effects.setClarifyError(null);
    try {
      await client.cancelAutoRun(run.id);
      effects.setNotice(language === "zh"
        ? "本次 AI 处理已停止，任务和已有信息仍会保留。"
        : "This AI run was stopped. The task and its existing information were kept.");
      effects.refresh();
      notifyStateChange("work-item-clarification-stopped", { autoRunId: run.id });
    } catch {
      effects.setClarifyError(language === "zh" ? "暂时无法停止 AI，请稍后重试。" : "AI could not be stopped. Try again shortly.");
    } finally {
      effects.setClarifyStopPending(false);
    }
  };

  const retryAiWork = async () => {
    if (!hasRetryableExecution || retryPending || executionActionLocked
      || !reviewActions.isEnabled("retry_execution", true)) return;
    effects.setRetryPending(true);
    effects.setRetryError(null);
    effects.setReceipt(null);
    try {
      if (!executionContractDefined) {
        const assisted = await client.suggestWorkItemDraft({ projectId: item.projectId, title: item.title, body: item.body }) as {
          draft: { acceptanceCriteria: string[]; verificationSop: string[] };
        };
        const prepared = await client.updateWorkItem(item.id, {
          expectedRevision: item.revision,
          acceptanceCriteria: assisted.draft.acceptanceCriteria,
          verificationSop: assisted.draft.verificationSop,
        }) as { workItem: LocalWorkItem };
        effects.setItem(prepared.workItem);
        effects.setRetryOpen(false);
        effects.setNotice(language === "zh"
          ? "执行方案已生成但尚未重试。请先核对完成标准和检查步骤，再次点击重试。"
          : "The execution plan is ready, but the retry has not started. Review the criteria and SOP, then retry again.");
        return;
      }
      const response = retryableLegacyExecution
        ? await client.retryLegacyWorkItemExecution(item.id, {
          expectedWorkItemRevision: item.revision,
          expectedTargetStatus: executionReview?.targetStatus ?? "failed",
          sourceTargetId: executionReview?.targetId ?? "",
          idempotencyKey: actionRequest("retry_execution").idempotencyKey,
        }) as { actionReceipt?: ExecutionActionReceipt }
        : await client.retryAutoRun(retryableRun!.id, undefined, actionRequest("retry_execution")) as { actionReceipt?: ExecutionActionReceipt };
      effects.setRetryOpen(false);
      effects.setNotice(copy.retrySucceeded);
      effects.setReceipt(response.actionReceipt ?? { message: copy.retrySucceeded, impact: "none", nextOwner: "ai" });
      notifyStateChange("work-item-retry");
      effects.refresh();
    } catch (error) {
      const errorReceipt = receiptFromError(error);
      if (errorReceipt) effects.setReceipt(errorReceipt);
      effects.setRetryError(copy.retryFailed);
      if (error instanceof ApiError && error.code === "execution_action_stale") {
        effects.setRetryError(language === "zh"
          ? "任务刚刚发生变化，本次没有重复执行。请核对刷新后的状态。"
          : "The task just changed, so this action was not repeated. Review the refreshed status.");
        effects.refresh();
      } else if (!(error instanceof ApiError)) {
        effects.setRetryError(language === "zh"
          ? "请求已发出，但连接中断，暂时无法确认是否已重新开始。请先检查任务状态，不要重复重试。"
          : "The request was sent, but the connection ended before confirmation. Check the task status before retrying.");
        effects.setReceipt(uncertainReceipt(language === "zh"
          ? "重试请求已发送，但暂时无法确认 AI 是否重新开始。"
          : "The retry request was sent, but it is not yet clear whether AI restarted."));
        effects.refresh();
      }
    } finally {
      effects.setRetryPending(false);
    }
  };

  const reconcileExecutionReviewAction = async () => {
    const run = observability?.latestRun;
    if (!run || actionPending) return;
    effects.setPending("reconcile");
    effects.setActionError(null);
    try {
      const response = await client.reconcileAutoRunExecutionAction(run.id) as {
        actionReceipt?: ExecutionActionReceipt | null;
        safeToRetry?: boolean;
      };
      const receipt = response.actionReceipt ?? (response.safeToRetry ? {
        status: "safe_to_retry" as const,
        messageCode: "safe_to_retry",
        impact: "none" as const,
        nextOwner: "me" as const,
      } : null);
      effects.setReceipt(receipt);
      effects.setNotice(receipt?.status === "safe_to_retry"
        ? language === "zh"
          ? "检查完成：没有发现新的执行，可以安全重试。"
          : "Check complete: no new execution was found, so it is safe to retry."
        : language === "zh"
          ? "操作状态已重新检查，页面会继续同步最新结果。"
          : "The action status was rechecked. This page will continue syncing the latest result.");
      effects.refresh();
    } catch {
      effects.setActionError(language === "zh"
        ? "暂时无法重新检查操作状态，请稍后再试；在确认前不要重复执行。"
        : "The action status could not be rechecked. Try again later and do not repeat the action yet.");
    } finally {
      effects.setPending(null);
    }
  };

  const reviewActions = createWorkItemReviewActionController({
    review: executionReview,
    handlers: {
      answer_ai: reviewHandlers.runPrimaryAction,
      retry_execution: reviewHandlers.runPrimaryAction,
      review_result: reviewHandlers.openReviewResult,
      view_result: reviewHandlers.openReviewResult,
      review_approval: reviewHandlers.openDetails,
      open_details: reviewHandlers.openDetails,
      view_changes: reviewHandlers.viewChanges,
      view_batch_details: reviewHandlers.viewBatchDetails,
      fix_with_ai: askAiToFix,
      rerun_verification: () => void rerunDeliveryVerification(),
      create_pull_request: reviewHandlers.openPullRequestConfirmation,
      update_pull_request: reviewHandlers.openPullRequestConfirmation,
      apply_local_changes: reviewHandlers.openDeliveryConfirmation,
      apply_office_result: reviewHandlers.openDeliveryConfirmation,
    },
    onUnknownAction: reviewHandlers.openDetails,
  });

  const runExecutionReviewAction = (requestedKind?: string) => {
    if (!executionReview) return;
    reviewActions.run(requestedKind ?? executionReview.recommendedAction.kind);
  };

  return {
    actionRequest,
    executionActionLocked,
    reviewActions,
    prepareReviewExecutionPlan,
    prepareStartExecutionPlan,
    choosePendingTemplateResult,
    startAiWork,
    sendChangeRequest,
    rerunDeliveryVerification,
    askAiToFix,
    answerAiClarification,
    setAutomaticExecution,
    cancelPendingExecutionStart,
    recheckPendingExecutionStart,
    stopAiClarification,
    retryAiWork,
    runExecutionReviewAction,
    reconcileExecutionReviewAction,
  };
}
