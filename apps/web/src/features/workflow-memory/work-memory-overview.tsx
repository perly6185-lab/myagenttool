import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  WorkMemoryOverviewCard,
  WorkMemoryOverviewNotice,
  type WorkMemoryOverview,
} from "@/features/workflow-memory/work-memory-overview-card";
import {
  workflowMemoryApi,
  type WorkflowMemoryInsights,
} from "@/features/workflow-memory/workflow-memory-api";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

const TYPE_NAMES: Record<string, { en: string; zh: string }> = {
  inquiry: { en: "inquiry", zh: "询价" },
  quotation: { en: "quotation", zh: "报价" },
  order: { en: "order", zh: "订单" },
  contract_review: { en: "contract review", zh: "合同审查" },
  purchase_request: { en: "purchase request", zh: "采购申请" },
  customer_complaint: { en: "customer complaint", zh: "客户投诉" },
  weekly_report: { en: "weekly report", zh: "周报" },
  project_acceptance: { en: "project acceptance", zh: "项目验收" },
};

function visibleValue(value: unknown, zh: boolean): string {
  if (value == null) return zh ? "未设置" : "Not set";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) {
    const values = value.filter((item) => ["string", "number"].includes(typeof item)).slice(0, 4);
    return values.length ? values.join("、") : (zh ? "内容已调整" : "Content updated");
  }
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    for (const key of ["directories", "documentTypes", "pathTemplate"]) {
      if (row[key] != null) return visibleValue(row[key], zh);
    }
  }
  return zh ? "内容已调整" : "Content updated";
}

function overviewFrom(data: WorkflowMemoryInsights, name: string, zh: boolean): WorkMemoryOverview | null {
  const requiredKinds = ["entry", "reference", "intermediate", "final", "ledger"];
  if (!data.memoryPackage
    || !Number.isInteger(data.memoryPackage.version)
    || !data.memoryPackage.summary
    || !data.pathGraph
    || !Array.isArray(data.pathGraph.nodes)
    || requiredKinds.some((kind) => !data.pathGraph?.nodes.some((item) =>
      item.kind === kind && Array.isArray(item.paths)))) return null;
  const node = (kind: string) => data.pathGraph?.nodes.find((item) => item.kind === kind);
  const pathItem = (kind: string, fallbackZh: string, fallbackEn: string) => {
    const paths = node(kind)?.paths.map((item) => item.path) ?? [];
    return {
      title: paths.length ? paths.join("、") : (zh ? fallbackZh : fallbackEn),
      detail: paths.length > 1
        ? (zh ? `历史记录中确认了 ${paths.length} 个位置` : `${paths.length} locations confirmed from history`)
        : null,
    };
  };
  const reasonCopy: Record<string, { zh: string; en: string; actionZh: string; actionEn: string }> = {
    insufficient_samples: { zh: "历史样本还不够，健康度暂时不能代表长期表现。", en: "There are not enough historical samples yet.", actionZh: "继续正常处理几次同类工作即可。", actionEn: "Keep handling a few more examples normally." },
    duplicate_rate_high: { zh: "同一份工作被重复识别的次数偏多。", en: "The same work is being recognized more than once.", actionZh: "检查监控目录是否包含重复副本。", actionEn: "Check whether the watched folder contains duplicate copies." },
    manual_correction_rate_high: { zh: "最近人工修改结果的次数偏多。", en: "Recent results needed frequent manual edits.", actionZh: "检查下方改进建议，确认后再更新规矩。", actionEn: "Review the suggestions below before updating the rules." },
    completion_rate_low: { zh: "有较多任务没有按当前规矩完成。", en: "Several tasks did not finish with the current rules.", actionZh: "查看最近需要帮助的任务，补齐缺失资料。", actionEn: "Review recent tasks needing help and supply missing information." },
    verification_pass_rate_low: { zh: "部分结果没有通过最终检查。", en: "Some results did not pass their final checks.", actionZh: "检查验收要求是否与实际结果一致。", actionEn: "Check whether acceptance requirements match real results." },
    anomaly_rate_high: { zh: "最近出现的异常情况偏多。", en: "There have been more unusual cases recently.", actionZh: "先暂停自动处理并检查新旧文件差异。", actionEn: "Pause automatic handling and review recent file differences." },
  };
  const issues = (data.health?.reasons ?? []).map((reason) => ({
    id: reason,
    message: reasonCopy[reason]?.[zh ? "zh" : "en"] ?? (zh ? "这套规矩需要检查。" : "These rules need a quick check."),
    action: reasonCopy[reason]?.[zh ? "actionZh" : "actionEn"] ?? null,
  }));
  const status = data.health?.status;
  const healthState = status === "healthy" ? "healthy" : status === "at_risk" ? "paused" : "needs_attention";
  const triggerValue = data.memoryPackage.summary.trigger?.value as { documentTypes?: unknown } | undefined;
  const typeKey = Array.isArray(triggerValue?.documentTypes)
    ? String(triggerValue.documentTypes[0] ?? "")
    : "";
  const typeName = TYPE_NAMES[typeKey]?.[zh ? "zh" : "en"] ?? name;
  const changeLabels: Record<string, { zh: string; en: string }> = {
    trigger: { zh: "什么时候开始处理", en: "When work starts" },
    reference: { zh: "会参考哪些资料", en: "References used" },
    output: { zh: "结果保存位置", en: "Result location" },
    naming: { zh: "结果命名方式", en: "Result naming" },
    acceptance: { zh: "完成前检查", en: "Checks before completion" },
    humanGates: { zh: "什么时候询问你", en: "When to ask you" },
    pathGraph: { zh: "工作路径", en: "Work path" },
  };
  const changes = (data.packageDiff?.changes ?? []).slice(0, 8).map((change, index) => {
    const section = change.path.split("/").filter(Boolean).find((part) => changeLabels[part]) ?? "pathGraph";
    return {
      id: `${change.path}:${index}`,
      label: changeLabels[section][zh ? "zh" : "en"],
      previous: visibleValue(change.before, zh),
      current: visibleValue(change.after, zh),
    };
  });
  return {
    name: typeName || name,
    path: {
      incoming: pathItem("entry", "等待确认新工作进入位置", "Waiting to confirm the incoming folder"),
      references: pathItem("reference", "暂未确认固定参考位置", "No fixed reference folder confirmed"),
      process: pathItem("intermediate", "按已确认步骤处理", "Follow the confirmed steps"),
      result: pathItem("final", "暂未确认最终结果位置", "No final result folder confirmed"),
      ledger: node("ledger")?.state === "confirmed"
        ? pathItem("ledger", "更新已确认台账", "Update the confirmed ledger")
        : null,
    },
    health: {
      state: healthState,
      score: data.health?.score ?? null,
      summary: status === "healthy"
        ? (zh ? "这套工作规矩目前可以使用，近期任务能够按要求完成。" : "These rules can be used; recent work completed as required.")
        : status === "at_risk"
          ? (zh ? "建议先暂停自动处理，按下面提示检查后再继续。" : "Pause automatic handling and review the items below before continuing.")
          : (zh ? "这套工作规矩需要检查，完成下面提示后再继续使用。" : "These rules need review before they continue to be used."),
      issues,
    },
    versions: {
      current: { name, versionLabel: zh ? `第 ${data.memoryPackage.version} 版` : `Version ${data.memoryPackage.version}` },
      previous: data.previousMemoryPackage
        ? { name, versionLabel: zh ? `第 ${data.previousMemoryPackage.version} 版` : `Version ${data.previousMemoryPackage.version}` }
        : null,
      changes,
    },
    resultSuggestions: (data.resultSuggestions ?? []).map((suggestion) => ({
      id: suggestion.id,
      title: zh ? `改进${TYPE_NAMES[suggestion.documentType]?.zh ?? "这项工作"}的处理规矩` : `Improve the ${TYPE_NAMES[suggestion.documentType]?.en ?? "work"} rules`,
      observedDifference: zh
        ? `${suggestion.evidenceCount} 个已确认结果支持这项变化。`
        : `${suggestion.evidenceCount} confirmed results support this change.`,
      suggestedChange: [...suggestion.changes.added, ...suggestion.changes.removed.map((item) => `${zh ? "不再：" : "Remove: "}${item}`)].join("；")
        || (zh ? "调整自动识别把握度。" : "Adjust the recognition confidence."),
      reason: suggestion.evaluationPassed
        ? (zh ? "离线评估已经通过，仍需你确认后才会生效。" : "Offline evaluation passed; your confirmation is still required.")
        : (zh ? "评估尚未通过，不建议现在启用。" : "Evaluation has not passed; do not enable it yet."),
    })),
  };
}

export function WorkMemoryOverview({
  projectId,
  sourceId,
  routineDefinitionId,
  routineName,
}: {
  projectId: string;
  sourceId: string;
  routineDefinitionId: string;
  routineName: string;
}) {
  const { i18n } = useAppTranslation();
  const zh = i18n.resolvedLanguage?.startsWith("zh") ?? false;
  const queryClient = useQueryClient();
  const queryKey = ["workflow-memory", "insights", projectId, sourceId, routineDefinitionId] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => workflowMemoryApi.getWorkflowMemoryInsights(projectId, sourceId, routineDefinitionId),
  });
  const rollback = useMutation({
    mutationFn: async () => {
      const target = query.data?.rollback;
      if (!target?.available || !target.ruleId || target.expectedRevision == null) return null;
      return workflowMemoryApi.rollbackAdaptiveLearningRule(target.ruleId, {
        expectedRevision: target.expectedRevision,
        confirmed: true,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["workflow-memory", "adaptive-learning", projectId, sourceId] }),
      ]);
    },
  });
  const overview = query.data ? overviewFrom(query.data, routineName, zh) : null;
  if (query.isPending) return <WorkMemoryOverviewNotice state="loading" />;
  if (query.isError) {
    return (
      <WorkMemoryOverviewNotice
        state="error"
        message={zh
          ? "暂时无法查看这套工作规矩。你的任务和文件没有受到影响。"
          : "This work memory cannot be shown right now. Your tasks and files are unaffected."}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!overview) {
    return (
      <WorkMemoryOverviewNotice
        state="error"
        message={zh
          ? "工作记录还没有整理完整，暂时不能按这套规矩自动处理。"
          : "This work memory is incomplete, so it cannot be used for automatic handling yet."}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return (
    <WorkMemoryOverviewCard
      overview={overview}
      restoring={rollback.isPending}
      onReviewSuggestion={() => {
        const details = document.getElementById("advanced-workflow-tools") as HTMLDetailsElement | null;
        if (details) details.open = true;
        details?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
      onRestorePrevious={() => rollback.mutate()}
    />
  );
}
