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
  headline: string;
  scope: string;
  checks: string;
  recommendation: string;
  confirmEffect: string;
  confirmRisk: string;
  revisionEffect: string;
  revisionRisk: string;
};

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

function changedFileScope(paths: string[], language: "zh" | "en", executionKind: WorkItemExecutionKind | null, resultFiles: string[]) {
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
  verification,
  executionKind,
  resultFiles,
}: {
  language: "zh" | "en";
  mode: "local_merge" | "pull_request" | null;
  changedFiles: string[];
  reviewVerdict: "approved" | "changes_requested" | null;
  reviewStatus: string | null;
  verification: { passed: boolean; verified: boolean; summary: string | null } | null;
  executionKind: WorkItemExecutionKind | null;
  resultFiles: string[];
}): DeliveryDecision {
  const scope = changedFileScope(changedFiles, language, executionKind, resultFiles);
  const verifiedPass = verification?.verified === true && verification.passed === true;
  const verifiedFail = verification?.verified === true && verification.passed === false;
  const reviewWaiting = !reviewVerdict && ["queued", "running"].includes(reviewStatus ?? "");
  const confirmEffect = mode === "pull_request"
    ? language === "zh"
      ? "创建一个 Pull Request 供后续合并；不会直接改动远端主分支，本地任务会继续保留在审核阶段。"
      : "Create a pull request for later merge. The remote base branch is not changed directly, and this task remains in review."
    : language === "zh"
      ? changedFiles.length
        ? `把这次涉及 ${changedFiles.length} 个文件的代码变更写入本地项目的基础分支，并将本地任务标记为完成；默认不会关闭 GitHub、GitLab 等外部 Issue。`
        : "把这次代码变更写入本地项目的基础分支，并将本地任务标记为完成；默认不会关闭 GitHub、GitLab 等外部 Issue。"
      : `Apply this ${changedFiles.length || "code"}-file delivery to the local base branch and complete the local task. External issues are not closed by default.`;
  const confirmRisk = mode === "pull_request"
    ? language === "zh" ? "较低：只创建待审核的 PR，但仍可能产生远端分支和协作通知。" : "Low: it only creates a reviewable PR, but it may create a remote branch and notifications."
    : language === "zh" ? "中等：会实际修改本地项目代码。虽然已有复核和验证，仍建议先确认功能表现符合预期。" : "Medium: this changes local project code. Even with review and checks, confirm the user-visible behavior first.";
  const revisionEffect = language === "zh"
    ? "保留当前结果和历史记录，不应用现有交付；把你的修改要求交给 AI 在同一任务工作区继续处理。"
    : "Keep the current result and history without applying it, then ask AI to continue in the same task workspace.";
  const revisionRisk = language === "zh"
    ? "较低：不会把当前变更写入基础分支，但会增加一次 AI 运行时间，可能产生额外费用。"
    : "Low: current changes are not applied, but another AI run may take time and incur cost.";

  if (reviewVerdict === "changes_requested" || verifiedFail) {
    return {
      state: "changes", risk: "high", scope,
      headline: language === "zh" ? "这份结果暂不建议接受" : "Do not accept this result yet",
      checks: verifiedFail
        ? language === "zh" ? "自动验证未通过，当前结果存在明确失败项。" : "Automated verification failed, so the result has a confirmed problem."
        : language === "zh" ? "自动复核发现需要处理的问题。" : "Automated review found issues that need to be fixed.",
      recommendation: language === "zh" ? "点击“让 AI 继续修改”，说明期望或直接采用复核建议。" : "Choose Ask AI to revise and describe the expected result or use the review findings.",
      confirmEffect, confirmRisk, revisionEffect, revisionRisk,
    };
  }
  if (reviewWaiting) {
    return {
      state: "waiting", risk: "unknown", scope,
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
      state: "ready", risk: "low", scope,
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
      state: "ready", risk: "low", scope,
      headline: language === "zh" ? "结果已通过自动复核和验证" : "Result passed automated review and verification",
      checks: language === "zh" ? "未发现阻止交付的问题，自动检查也已通过；这降低了代码缺陷风险，但不等于业务表现已由人工确认。" : "No delivery-blocking issue was found and automated checks passed. This lowers code risk but does not replace a user-visible behavior check.",
      recommendation: language === "zh" ? "如果功能表现符合你的预期，可以确认交付；拿不准时先让 AI 补充说明或继续修改。" : "Confirm delivery if the behavior matches your expectation; otherwise ask AI for clarification or revisions.",
      confirmEffect, confirmRisk, revisionEffect, revisionRisk,
    };
  }
  return {
    state: "caution", risk: "medium", scope,
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
