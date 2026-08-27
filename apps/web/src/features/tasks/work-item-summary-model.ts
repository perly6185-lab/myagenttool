import type { WorkItemSection } from "@/store/ui-store";
import type { LocalWorkItem, LocalWorkItemAutoRun, WorkItemExecutionKind, WorkItemExecutionState } from "./task-view-types";
import type { WorkItemUserStatus } from "./work-item-user-status";
import { COPY } from "./work-item-summary-copy";

const AI_LABEL: Record<"zh" | "en", Record<WorkItemExecutionState, string>> = {
  zh: { unclaimed: "尚未执行", claimed: "已认领", running: "执行中", awaiting_approval: "等待审批", verifying: "验证中", failed: "执行失败", completed: "等待复核" },
  en: { unclaimed: "Not started", claimed: "Claimed", running: "Running", awaiting_approval: "Awaiting approval", verifying: "Verifying", failed: "Execution failed", completed: "Awaiting review" },
};

export function latestExecutionKind(item: LocalWorkItem): WorkItemExecutionKind | null {
  if (item.executionKind) return item.executionKind;
  return [...(item.executionBindings ?? [])].reverse().find((binding) =>
    ["auto_run", "application_invocation", "article_import", "article_derivative"].includes(binding.kind))?.kind as WorkItemExecutionKind | undefined ?? null;
}

export function resultPresentation(kind: WorkItemExecutionKind | null, language: "zh" | "en") {
  if (kind === "article_import") {
    return language === "zh" ? {
      title: "公众号导入结果",
      hint: "查看导入内容、验收结论和结果文件；技术证据仍完整保留。",
      originalNote: "原始导入说明",
      noSummary: "公众号内容已完成导入，结果文件已保存到当前任务。",
      executionLabel: "公众号导入",
      collaborationHint: "Local Issue 统一记录导入执行、结果文件和人工验收；它们始终属于同一个任务。",
      completedScope: "导入完成了什么",
    } : {
      title: "Article import result",
      hint: "Review the imported content, acceptance result, and output files; technical evidence remains available.",
      originalNote: "Original import note",
      noSummary: "The article import completed and its output files are attached to this task.",
      executionLabel: "Article import",
      collaborationHint: "The Local Issue keeps the import run, output files, and human acceptance together as one task.",
      completedScope: "What the import produced",
    };
  }
  return {
    title: COPY[language].deliverableTitle,
    hint: COPY[language].deliverableHint,
    originalNote: COPY[language].originalAiNote,
    noSummary: COPY[language].noDeliverableSummary,
    executionLabel: COPY[language].aiExecution,
    collaborationHint: COPY[language].collaborationHint,
    completedScope: COPY[language].completedScope,
  };
}

export function executionStateLabel(item: LocalWorkItem, language: "zh" | "en") {
  if (item.executionState === "completed" && (item.state === "closed" || item.status === "done")) {
    return language === "zh" ? "已完成" : "Completed";
  }
  return item.executionState ? AI_LABEL[language][item.executionState] : COPY[language].noAi;
}

export const WAITING_LABEL: Record<"zh" | "en", Record<LocalWorkItem["waitingOn"], string>> = {
  zh: { me: "我", requester: "提出者", internal: "内部成员", ai: "AI", none: "无需等待" },
  en: { me: "Me", requester: "Requester", internal: "Internal teammate", ai: "AI", none: "No one" },
};

export function expertSectionFor(item: LocalWorkItem, status: WorkItemUserStatus): WorkItemSection {
  if (item.executionState === "failed" || status === "blocked") return "process";
  if (item.executionState === "awaiting_approval") return "verification";
  if (status === "ready_for_review" || status === "completed") return "report";
  return "overview";
}

export type DeliveryDecision = {
  state: "ready" | "changes" | "waiting" | "caution";
  risk: "low" | "medium" | "high" | "unknown";
  domain: "development" | "office" | "other";
  domainLabel: string;
  statusLabel: string;
  riskReason: string;
  headline: string;
  scope: string;
  checks: string;
  recommendation: string;
  confirmEffect: string;
  confirmRisk: string;
  revisionEffect: string;
  revisionRisk: string;
};

export type DeliveryReviewFinding = { severity?: string; message?: string };

export type WorkItemIntentSummary = {
  state: "aligned" | "needs_confirmation" | "draft";
  statusLabel: string;
  goal: string;
  expectedOutcome: string;
  scope: string;
  boundary: string;
  confidenceReason: string;
};

export function deriveWorkItemIntentSummary({
  item,
  domain,
  language,
  completed = false,
}: {
  item: LocalWorkItem;
  domain: DeliveryDecision["domain"];
  language: "zh" | "en";
  completed?: boolean;
}): WorkItemIntentSummary {
  const contract = item.channelTaskContract ?? null;
  const workMode = contract?.workMode ?? null;
  const mutation = contract?.dataMutationPreview ?? null;
  const sourceNames = (mutation?.targetSources?.length
    ? mutation.targetSources.map((source) => source.fileName)
    : workMode?.data.sources.map((source) => source.fileName) ?? [])
    .filter((name): name is string => Boolean(name));
  const fields = [...new Set([
    ...(mutation?.requiredFields ?? []),
    ...(mutation?.fieldChanges ?? []).map((change) => change.field),
  ].filter(Boolean))];
  const rows = mutation?.estimatedAffectedRows ?? workMode?.mutation.targetCount ?? null;
  const goal = workMode?.goal?.trim()
    || contract?.goal?.trim()
    || item.intentStatement?.trim()
    || item.title.trim();
  const expectedOutcome = workMode?.expectedOutput?.trim()
    || contract?.outputExpectation?.trim()
    || item.myTemplateBinding?.expectedOutput?.trim()
    || (item.acceptanceCriteria?.length === 1
      ? item.acceptanceCriteria[0]
      : item.acceptanceCriteria?.length
        ? (language === "zh" ? `满足已确认的 ${item.acceptanceCriteria.length} 项完成标准` : `Meet ${item.acceptanceCriteria.length} confirmed completion requirements`)
        : (language === "zh" ? "按当前任务描述产出可检查的结果" : "Produce a reviewable result from the current task description"));
  const scopeParts = language === "zh"
    ? [sourceNames.length ? `资料：${sourceNames.join("、")}` : null, rows != null ? `预计 ${rows} 条记录` : null, fields.length ? `字段：${fields.join("、")}` : null]
    : [sourceNames.length ? `Sources: ${sourceNames.join(", ")}` : null, rows != null ? `About ${rows} records` : null, fields.length ? `Fields: ${fields.join(", ")}` : null];
  const scope = scopeParts.filter(Boolean).join(language === "zh" ? "；" : "; ")
    || (domain === "development"
      ? (language === "zh" ? "围绕当前任务处理，并按已确认的检查步骤验证" : "Work within this task and verify it against the confirmed checks")
      : (language === "zh" ? "只使用当前任务已选择的资料和范围" : "Use only the sources and scope selected for this task"));
  const needsConfirmation = workMode?.state === "needs_confirmation"
    || ["needs_sources", "ambiguous", "stale"].includes(contract?.dataPlan?.status ?? "")
    || ["needs_review", "stale"].includes(mutation?.status ?? "");
  const aligned = !needsConfirmation && (item.executionContractGate?.ready === true || workMode?.state === "matched");
  const state = needsConfirmation ? "needs_confirmation" : aligned ? "aligned" : "draft";
  return {
    state,
    statusLabel: state === "needs_confirmation"
      ? (language === "zh" ? "需要你确认" : "Needs your confirmation")
      : state === "aligned"
        ? (language === "zh" ? "理解已对齐" : "Understanding aligned")
        : (language === "zh" ? "按当前描述理解" : "Based on the current description"),
    goal,
    expectedOutcome,
    scope,
    boundary: completed
      ? (language === "zh"
          ? "本次结果已按你的确认完成交付；后续新增修改会作为新的处理记录，不会静默改写本次结果。"
          : "This result was delivered with your confirmation. Later changes create a new work record instead of silently rewriting this result.")
      : domain === "development"
      ? (language === "zh" ? "先在独立任务工作区处理；检查通过并由你确认前，不会应用到主分支。" : "Work in an isolated task workspace first; nothing reaches the base branch before checks pass and you confirm it.")
      : domain === "office"
        ? (language === "zh" ? "只处理上述资料和范围；写入、删除或对外发送仍需单独确认。" : "Only the sources and scope above are handled; writing, deletion, or external sending still requires separate confirmation.")
        : (language === "zh" ? "只按当前任务和已确认材料处理；扩大范围前会再次确认。" : "Use only this task and its confirmed materials; expanding the scope requires another confirmation."),
    confidenceReason: state === "needs_confirmation"
      ? (language === "zh" ? "资料、处理方式或影响范围仍有歧义，当前不会直接执行实质修改。" : "The sources, handling method, or impact is still ambiguous, so no material change will run yet.")
      : state === "aligned"
        ? (language === "zh" ? "目标、预期结果和检查方式已经形成可执行约定。" : "The goal, expected result, and checks form an executable agreement.")
        : (language === "zh" ? "这是根据当前任务描述整理的理解，开始前仍可修改。" : "This understanding comes from the current task description and can still be changed before starting."),
  };
}

export function deliveryDomainFor({
  executionKind,
  taskKind,
  taskText = "",
}: {
  executionKind: WorkItemExecutionKind | null;
  taskKind?: string | null;
  taskText?: string;
}): DeliveryDecision["domain"] {
  const kind = String(taskKind ?? "").toLowerCase();
  const text = `${kind}\n${taskText}`;
  if (/(?:^|_)software_(?:analysis|implementation|verification|deployment)(?:$|_)/.test(kind)) {
    return "development";
  }
  if (
    /(?:^|_)(?:business|office|document|spreadsheet|procurement|legal|mail)_(?:[^\s]*)/.test(kind)
    || /(?:表格|工作簿|台账|报价|订单|合同|发货|回款|客户|联系人|报表|清单|名单|邮件|文档|演示文稿|excel|xlsx?|docx?|pptx?|spreadsheet|workbook|quotation|contract|invoice)/i.test(text)
  ) {
    return "office";
  }
  if (executionKind === "auto_run") return "development";
  return "other";
}

function deliveryDomainLabel(domain: DeliveryDecision["domain"], language: "zh" | "en") {
  if (domain === "development") return language === "zh" ? "开发交付" : "Development delivery";
  if (domain === "office") return language === "zh" ? "办公资料处理" : "Office/data work";
  return language === "zh" ? "任务交付" : "Task delivery";
}

function reviewSummaryLooksClean(summary: string | null | undefined) {
  return /(?:no\s+(?:actionable\s+)?(?:findings?|issues?|bugs?|regressions?)|tests?\s+pass|looks\s+good|consistent|no\s+observable\s+regressions|未发现|没有发现|(?:结果|改动|补丁).{0,10}(?:相互)?一致|未引入明显回归)/i.test(String(summary ?? ""));
}

export function aiPhaseDescription(phase: LocalWorkItemAutoRun["phase"], language: "zh" | "en") {
  if (!phase) return null;
  const descriptions = {
    zh: {
      queued: "任务已经交给 AI，正在等待开始。",
      understanding: "AI 正在理解任务、整理完成标准和验证方式；需要你决定时会在这里提问。",
      waiting_for_input: "AI 已暂停实质修改，正在等待你确认或补充信息。",
      planning: "AI 正在整理执行步骤和本次验收依据。",
      implementing: "执行依据已经建立，AI 正在隔离工作区内处理任务。",
      verifying: "AI 已完成主要处理，正在按本次标准验证结果。",
      review_ready: "AI 已完成处理和验证，请查看交付结果并决定是否通过。",
      failed: "本次 AI 处理失败，请查看原因后重试或转为人工处理。",
      cancelled: "本次 AI 处理已停止，任务仍保留在你的任务中。",
    },
    en: {
      queued: "The task is with AI and waiting to start.",
      understanding: "AI is understanding the task and establishing completion criteria and verification; it will ask here if a decision is needed.",
      waiting_for_input: "AI has paused material changes and is waiting for your confirmation or additional information.",
      planning: "AI is organizing the execution steps and acceptance basis for this run.",
      implementing: "The execution basis is established and AI is working in an isolated workspace.",
      verifying: "AI has completed the main work and is verifying the result against this run's criteria.",
      review_ready: "AI has completed the work and verification. Review the delivery and decide whether to approve it.",
      failed: "This AI run failed. Review the cause, then retry or return the task to manual handling.",
      cancelled: "This AI run was stopped. The task remains in My tasks.",
    },
  } as const;
  return descriptions[language][phase];
}

function changedFileScope(paths: string[], language: "zh" | "en", executionKind: WorkItemExecutionKind | null, resultFiles: string[], domain: DeliveryDecision["domain"]) {
  if (executionKind === "article_import") {
    if (!resultFiles.length) {
      return language === "zh"
        ? "公众号正文已完成导入，当前没有可直接打开的结果文件。"
        : "The article content was imported, but no directly browsable output file is available.";
    }
    return language === "zh"
      ? `公众号正文已完成导入，并在当前 Local Issue 中生成 ${resultFiles.length} 个结果文件。`
      : `The article content was imported and ${resultFiles.length} output file${resultFiles.length === 1 ? "" : "s"} were attached to this Local Issue.`;
  }
  const tests = paths.filter((path) => /(?:^|[\\/])(?:test|tests|__tests__)(?:[\\/])|\.(?:test|spec)\.[^.]+$/i.test(path)).length;
  const docsAndConfig = paths.filter((path) =>
    /(?:^|[\\/])docs?(?:[\\/])|\.md$/i.test(path)
    || /(?:^|[\\/])(?:\.github|config)(?:[\\/])|\.(?:json|ya?ml|toml|lock)$/i.test(path)).length;
  const product = Math.max(0, paths.length - tests - docsAndConfig);
  if (!paths.length) {
    return language === "zh"
      ? "AI 已完成处理，但系统没有取得可归类的文件清单；具体内容需要结合原始交付说明确认。"
      : "AI finished, but no file list was available to classify. Review the original delivery note for exact scope.";
  }
  if (domain === "office") {
    return language === "zh"
      ? `AI 已完成办公资料处理，共涉及 ${paths.length} 个文件；请先核对内容和影响范围，再决定是否应用结果。`
      : `AI completed the office/data work across ${paths.length} file${paths.length === 1 ? "" : "s"}. Review the content and impact before applying it.`;
  }
  const parts = language === "zh"
    ? [product ? `${product} 个程序文件` : null, tests ? `${tests} 个测试文件` : null, docsAndConfig ? `${docsAndConfig} 个说明或配置文件` : null]
    : [product ? `${product} product file${product === 1 ? "" : "s"}` : null, tests ? `${tests} test file${tests === 1 ? "" : "s"}` : null, docsAndConfig ? `${docsAndConfig} documentation or configuration file${docsAndConfig === 1 ? "" : "s"}` : null];
  return language === "zh"
    ? `AI 已在独立任务工作区完成代码变更，共涉及 ${paths.length} 个文件：${parts.filter(Boolean).join("、")}。这些改动尚未进入本地主分支。`
    : `AI completed code changes in an isolated task workspace across ${paths.length} files: ${parts.filter(Boolean).join(", ")}. These changes are not yet on the local base branch.`;
}

export function deriveDeliveryDecision({
  language,
  mode,
  changedFiles,
  reviewVerdict,
  reviewStatus,
  reviewFindings = [],
  reviewSummary = null,
  evidenceStatus = null,
  verification,
  executionKind,
  taskKind = null,
  taskText = "",
  resultFiles,
}: {
  language: "zh" | "en";
  mode: "local_merge" | "pull_request" | null;
  changedFiles: string[];
  reviewVerdict: "approved" | "changes_requested" | null;
  reviewStatus: string | null;
  reviewFindings?: DeliveryReviewFinding[];
  reviewSummary?: string | null;
  evidenceStatus?: string | null;
  verification: { passed: boolean; verified: boolean; summary: string | null } | null;
  executionKind: WorkItemExecutionKind | null;
  taskKind?: string | null;
  taskText?: string;
  resultFiles: string[];
}): DeliveryDecision {
  const domain = deliveryDomainFor({ executionKind, taskKind, taskText });
  const domainLabel = deliveryDomainLabel(domain, language);
  const scope = changedFileScope(changedFiles, language, executionKind, resultFiles, domain);
  const verifiedPass = verification?.verified === true && verification.passed === true;
  const verifiedFail = verification?.verified === true && verification.passed === false;
  const verificationMissing = verification?.verified === false;
  const reviewInconsistent = reviewVerdict === "changes_requested"
    && reviewFindings.length === 0
    && reviewSummaryLooksClean(reviewSummary);
  const reviewWaiting = !reviewVerdict && ["queued", "running"].includes(reviewStatus ?? "");
  const confirmEffect = mode === "pull_request"
    ? language === "zh"
      ? "创建一个 Pull Request 供后续合并；不会直接改动远端主分支，本地任务会继续保留在审核阶段。"
      : "Create a pull request for later merge. The remote base branch is not changed directly, and this task remains in review."
    : domain === "office"
      ? language === "zh"
        ? `把本次办公资料处理结果应用到当前项目，并将任务标记为完成；涉及外部发送或不可逆操作时仍需单独确认。`
        : "Apply the office/data result to the current project and complete the task; external sending or irreversible actions still require separate confirmation."
      : language === "zh"
      ? changedFiles.length
        ? `把这次涉及 ${changedFiles.length} 个文件的代码变更写入本地项目的基础分支，并将本地任务标记为完成；默认不会关闭 GitHub、GitLab 等外部 Issue。`
        : "把这次代码变更写入本地项目的基础分支，并将本地任务标记为完成；默认不会关闭 GitHub、GitLab 等外部 Issue。"
      : `Apply this ${changedFiles.length || "code"}-file delivery to the local base branch and complete the local task. External issues are not closed by default.`;
  const confirmRisk = mode === "pull_request"
    ? language === "zh" ? "较低：只创建待审核的 PR，但仍可能产生远端分支和协作通知。" : "Low: it only creates a reviewable PR, but it may create a remote branch and notifications."
    : domain === "office"
      ? language === "zh" ? "中等：会写入当前项目资料。请确认目标文件、修改范围，以及系统是否已准备失败恢复记录。" : "Medium: this writes to project materials. Confirm the target files, scope, and whether recovery evidence is prepared."
      : language === "zh" ? "中等：会实际修改本地项目代码。虽然已有复核和验证，仍建议先确认功能表现符合预期。" : "Medium: this changes local project code. Even with review and checks, confirm the user-visible behavior first.";
  const revisionEffect = language === "zh"
    ? "保留当前结果和历史记录，不应用现有交付；把你的修改要求交给 AI 在同一任务工作区继续处理。"
    : "Keep the current result and history without applying it, then ask AI to continue in the same task workspace.";
  const revisionRisk = language === "zh"
    ? "较低：不会把当前变更写入基础分支，但会增加一次 AI 运行时间，可能产生额外费用。"
    : "Low: current changes are not applied, but another AI run may take time and incur cost.";
  const officeBatchNeedsAttention = evidenceStatus === "office_batch_attention";
  const officeBatchRolledBack = evidenceStatus === "office_batch_rolled_back";
  const officeBatchInProgress = evidenceStatus === "office_batch_in_progress";

  if (reviewVerdict === "changes_requested" || verifiedFail) {
    const changesRequested = reviewVerdict === "changes_requested";
    const statusLabel = reviewInconsistent
      ? language === "zh" ? "复核结论不一致" : "Review is inconsistent"
      : verifiedFail
        ? language === "zh" ? "需要修复验证失败" : "Verification needs fixing"
        : language === "zh" ? "需要返工" : "Changes needed";
    return {
      state: "changes", risk: reviewInconsistent ? "unknown" : "high", domain, domainLabel, statusLabel, scope,
      riskReason: reviewInconsistent
        ? language === "zh" ? "复核状态标记为需修改，但没有给出具体问题，摘要反而显示结果一致；先重新复核，不要盲目修改。" : "The review says changes are needed but gives no finding, while its summary sounds positive. Re-review before changing the result."
        : verifiedFail
          ? language === "zh" ? "自动验证有明确失败项；先查看失败输出，再决定是否让 AI 修复。" : "Automated verification has a confirmed failure. Inspect its output before asking AI to revise."
          : changesRequested
            ? language === "zh" ? `${reviewFindings.length} 项复核问题阻止当前交付，请先处理具体问题。` : `${reviewFindings.length} review finding${reviewFindings.length === 1 ? "" : "s"} blocks this delivery; address the specific finding${reviewFindings.length === 1 ? "" : "s"} first.`
            : language === "zh" ? "当前结果还有未解决的问题。" : "The current result still has unresolved issues.",
      headline: reviewInconsistent
        ? language === "zh" ? "复核结论需要重新确认" : "Review result needs clarification"
        : language === "zh" ? "这份结果暂不建议接受" : "Do not accept this result yet",
      checks: reviewInconsistent
        ? language === "zh" ? "复核状态和摘要不一致，系统没有足够依据判断是否需要修改。" : "The review status and summary disagree, so there is not enough evidence to decide whether changes are needed."
        : verifiedFail
          ? language === "zh" ? "自动验证未通过，当前结果存在明确失败项。" : "Automated verification failed, so the result has a confirmed problem."
          : language === "zh" ? "自动复核发现需要处理的问题。" : "Automated review found issues that need to be fixed.",
      recommendation: reviewInconsistent
        ? language === "zh" ? "先查看完整复核，或重新执行一次复核；不要直接让 AI 重写。" : "Open the full review or run the review again; do not ask AI to rewrite blindly."
        : language === "zh" ? "先查看具体问题，再让 AI 继续修改；旧结果不会被覆盖。" : "Inspect the specific issue, then ask AI to revise; the existing result will be preserved.",
      confirmEffect, confirmRisk, revisionEffect, revisionRisk,
    };
  }
  if (officeBatchNeedsAttention) {
    return {
      state: "changes", risk: "high", domain, domainLabel, scope,
      statusLabel: language === "zh" ? "批次需要处理" : "Batch needs attention",
      riskReason: language === "zh"
        ? "批次包含失败项、失效项或部分完成记录；继续应用可能造成资料状态不一致。"
        : "The batch contains failed, invalidated, or partially completed items. Applying it could leave the records inconsistent.",
      headline: language === "zh" ? "这批办公结果暂不能应用" : "This office batch cannot be applied yet",
      checks: language === "zh" ? "复核和文件验证可能已通过，但批次执行结果仍有未解决项。" : "Review and file verification may have passed, but the batch still has unresolved items.",
      recommendation: language === "zh" ? "展开批次详情，处理失败项或确认回滚结果后再继续。" : "Open the batch details and resolve failed items or confirm rollback before continuing.",
      confirmEffect, confirmRisk, revisionEffect, revisionRisk,
    };
  }
  if (officeBatchRolledBack || officeBatchInProgress) {
    return {
      state: "caution", risk: "medium", domain, domainLabel, scope,
      statusLabel: officeBatchRolledBack
        ? language === "zh" ? "批次已回滚" : "Batch rolled back"
        : language === "zh" ? "批次处理中" : "Batch in progress",
      riskReason: officeBatchRolledBack
        ? language === "zh" ? "本批次已执行回滚，当前没有可继续应用的稳定结果。" : "This batch was rolled back, so there is no stable result to apply."
        : language === "zh" ? "批次仍在处理中，最终成功、失败和回滚数量尚未确定。" : "The batch is still running, so its final success, failure, and rollback counts are not known.",
      headline: officeBatchRolledBack
        ? language === "zh" ? "办公批次已回滚" : "The office batch was rolled back"
        : language === "zh" ? "办公批次仍在处理" : "The office batch is still running",
      checks: language === "zh" ? "请以批次详情和回滚记录为准。" : "Use the batch details and rollback record as the source of truth.",
      recommendation: officeBatchRolledBack
        ? language === "zh" ? "确认资料已恢复；如仍需修改，请重新生成一个批次。" : "Confirm the records were restored; create a new batch if the changes are still needed."
        : language === "zh" ? "等待批次结束后再决定是否重试或回滚。" : "Wait for the batch to finish before retrying or rolling back.",
      confirmEffect, confirmRisk, revisionEffect, revisionRisk,
    };
  }
  if (reviewWaiting) {
    return {
      state: "waiting", risk: "unknown", domain, domainLabel, statusLabel: language === "zh" ? "等待复核" : "Review pending", scope,
      riskReason: language === "zh" ? "独立复核尚未完成，当前不能判断是否适合接受。" : "Independent review is not complete, so acceptance cannot be assessed yet.",
      headline: language === "zh" ? "结果已生成，系统仍在复核" : "Result delivered; automated review is still running",
      checks: verifiedPass
        ? language === "zh" ? "自动验证已通过，独立代码复核尚未结束。" : "Automated verification passed; independent code review is still in progress."
        : language === "zh" ? "独立代码复核尚未结束，暂不能判断是否适合接受。" : "Independent code review has not finished, so acceptance is not yet recommended.",
      recommendation: language === "zh" ? "暂时无需操作；等待复核完成后再确认或交回修改。" : "No action yet. Wait for review before confirming or requesting changes.",
      confirmEffect, confirmRisk, revisionEffect, revisionRisk,
    };
  }
  if (executionKind === "article_import" && verifiedPass) {
    return {
      state: "ready", risk: "low", domain, domainLabel, scope,
      statusLabel: language === "zh" ? "可以确认" : "Ready to confirm",
      riskReason: language === "zh" ? "结果和验证证据均已通过当前任务标准。" : "The result and verification evidence passed this task's criteria.",
      headline: language === "zh" ? "公众号导入结果已通过任务验收" : "The article import passed task acceptance",
      checks: language === "zh"
        ? "完成标准和验证记录均已通过，导入产物已绑定到当前 Local Issue。"
        : "The completion criteria and verification record passed, and the imported outputs are attached to this Local Issue.",
      recommendation: language === "zh"
        ? "任务已经完成；需要时可直接查看、下载或复用结果文件。"
        : "The task is complete. Review, download, or reuse the output files when needed.",
      confirmEffect, confirmRisk, revisionEffect, revisionRisk,
    };
  }
  if (reviewVerdict === "approved" && verifiedPass) {
    return {
      state: "ready", risk: "low", domain, domainLabel, scope,
      statusLabel: language === "zh" ? "可以确认" : "Ready to confirm",
      riskReason: language === "zh" ? "独立复核和自动验证均已通过；仍建议确认实际使用表现。" : "Independent review and automated verification passed; still confirm the real-world behavior.",
      headline: language === "zh" ? "结果已通过自动复核和验证" : "Result passed automated review and verification",
      checks: language === "zh" ? "未发现阻止交付的问题，自动检查也已通过；这降低了代码缺陷风险，但不等于业务表现已由人工确认。" : "No delivery-blocking issue was found and automated checks passed. This lowers code risk but does not replace a user-visible behavior check.",
      recommendation: language === "zh" ? "如果功能表现符合你的预期，可以确认交付；拿不准时先让 AI 补充说明或继续修改。" : "Confirm delivery if the behavior matches your expectation; otherwise ask AI for clarification or revisions.",
      confirmEffect, confirmRisk, revisionEffect, revisionRisk,
    };
  }
  return {
    state: "caution", risk: verificationMissing ? "medium" : "unknown", domain, domainLabel, scope,
    statusLabel: verificationMissing
      ? language === "zh" ? "需要补验证" : "Verification needed"
      : language === "zh" ? "证据尚不完整" : "Evidence incomplete",
    riskReason: verificationMissing
      ? language === "zh" ? "当前没有配置或执行可复现的验证命令；这表示证据不足，不等于已经发现代码问题。" : "No reproducible verification command is configured or has run. This is missing evidence, not proof of a code defect."
      : language === "zh" ? "当前没有足够的独立复核与验证信息。" : "There is not enough independent review and verification evidence yet.",
    headline: reviewVerdict === "approved"
      ? language === "zh" ? "自动复核已通过，但验证证据不足" : "Automated review approved the change, but verification is incomplete"
      : language === "zh" ? "AI 已交付结果，但审核证据还不完整" : "AI delivered a result, but review evidence is incomplete",
    checks: verification?.verified === false
      ? language === "zh" ? "系统未配置或未执行可复现的自动验证，不能仅凭“AI 已完成”判断功能可用。" : "No reproducible automated verification ran, so AI completion alone does not prove the behavior works."
      : language === "zh" ? "目前没有足够的独立复核与验证信息。" : "There is not enough independent review and verification evidence yet.",
    recommendation: language === "zh" ? "建议先让 AI 补充验证或修改，不要直接确认完成。" : "Ask AI to add verification or revise before confirming completion.",
    confirmEffect, confirmRisk, revisionEffect, revisionRisk,
  };
}
