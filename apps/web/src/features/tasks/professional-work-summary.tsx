import { Badge } from "@/components/ui/badge";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { LocalWorkItem, LocalWorkItemObservability } from "./task-view-types";

const TEXT_LIMIT = 220;

function bounded(value: unknown, limit = TEXT_LIMIT) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function statusTone(status: string | null | undefined): "success" | "warning" | "danger" | "neutral" {
  if (status === "ready" || status === "verified" || status === "passed" || status === "completed") return "success";
  if (status === "stale" || status === "needs_review" || status === "ambiguous" || status === "waiting") return "warning";
  if (status === "failed" || status === "needs_attention" || status === "invalidated") return "danger";
  return "neutral";
}

function statusLabel(status: string | null | undefined, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    ready: ["已准备", "Ready"],
    verified: ["已核对", "Verified"],
    passed: ["已通过", "Passed"],
    completed: ["已完成", "Completed"],
    stale: ["已过期", "Stale"],
    needs_review: ["待复核", "Needs review"],
    ambiguous: ["有歧义", "Ambiguous"],
    waiting: ["等待中", "Waiting"],
    failed: ["失败", "Failed"],
    needs_attention: ["需要处理", "Needs attention"],
    invalidated: ["已失效", "Invalidated"],
    not_required: ["不需要", "Not required"],
  };
  return labels[status ?? ""]?.[zh ? 0 : 1] ?? status ?? "—";
}

function nextActionLabel(action: string | undefined, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    answer_ai: ["补充信息", "Answer AI"],
    review_approval: ["审核确认", "Review approval"],
    review_delivery: ["审核交付结果", "Review delivery"],
    resolve_sync_conflict: ["解决同步冲突", "Resolve sync conflict"],
    inspect_failure: ["检查失败原因", "Inspect failure"],
    monitor_execution: ["观察执行进度", "Monitor execution"],
    start_execution: ["开始执行", "Start execution"],
    none: ["暂无", "None"],
  };
  return labels[action ?? ""]?.[zh ? 0 : 1] ?? action ?? "—";
}

function Fact({ label, value, detail, tone = "neutral" }: {
  label: string;
  value: string;
  detail?: string | null;
  tone?: "success" | "warning" | "danger" | "neutral";
}) {
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Badge tone={tone}>{value}</Badge>
      </div>
      {detail ? <p className="mt-2 break-words text-xs font-medium">{detail}</p> : null}
    </div>
  );
}

export function ProfessionalWorkSummary({
  item,
  observability,
}: {
  item: LocalWorkItem;
  observability: LocalWorkItemObservability | null;
}) {
  const { i18n } = useAppTranslation();
  const zh = i18n.language.startsWith("zh");
  const contract = item.channelTaskContract;
  const workMode = contract?.workMode;
  const dataPlan = contract?.dataPlan;
  const mutation = contract?.dataMutationPreview;
  const binding = contract?.dataMutationBinding;
  const ledger = contract?.ledgerMutationPreview;
  const sources = unique([
    ...(dataPlan?.sources ?? []).map((source) => `${source.fileName ?? source.sourceId}${source.revision != null ? ` · v${source.revision}` : ""}`),
    ...(mutation?.targetSources ?? []).map((source) => `${source.fileName ?? source.sourceId}${source.revision != null ? ` · v${source.revision}` : ""}`),
  ]);
  const criteriaCount = item.acceptanceCriteria?.length ?? 0;
  const passedCriteria = item.acceptanceResults?.filter((result) => result.status === "passed").length ?? 0;
  const evidenceCount = item.verificationRecords?.reduce((count, record) => count + record.evidence.length, 0) ?? 0;
  const retryCount = observability?.timeline?.filter((event) => event.stage === "retry").length ?? 0;
  const affectedRows = mutation?.dataMutationScope?.expectedAffectedRows ?? mutation?.estimatedAffectedRows;
  const changedFields = unique([
    ...(mutation?.fieldChanges ?? []).map((change) => change.field),
    ...(ledger?.changedCells ?? []).map((cell) => cell.field),
  ]);
  const sourceStatus = dataPlan?.status ?? (sources.length ? "ready" : "not_required");
  const verificationStatus = item.completionGate?.verificationRequired
    ? (passedCriteria > 0 && passedCriteria >= criteriaCount ? "passed" : "waiting")
    : evidenceCount > 0 ? "passed" : "not_required";

  return (
    <section className="space-y-3 rounded-md border border-primary/25 bg-primary/[0.035] p-4" aria-label={zh ? "专业处理摘要" : "Professional processing summary"} data-testid="professional-work-summary">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{zh ? "专业处理摘要" : "Professional processing summary"}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {zh ? "以下内容来自当前任务事实链；详细过程、原始事件和审计记录见对应页签。" : "These facts come from the current task record. Open the related tabs for detailed events and audit evidence."}
          </p>
        </div>
        <Badge tone={contract ? "success" : "neutral"}>{contract ? (zh ? "依据已绑定" : "Basis bound") : (zh ? "普通任务" : "Standard task")}</Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Fact
          label={zh ? "目标" : "Goal"}
          value={zh ? "已记录" : "Recorded"}
          detail={bounded(workMode?.goal) ?? bounded(item.title) ?? "—"}
        />
        <Fact
          label={zh ? "处理依据" : "Basis"}
          value={workMode?.source === "my_template" ? (zh ? "已确认做法" : "Confirmed approach") : workMode?.source === "suggested" ? (zh ? "待确认" : "Needs confirmation") : (zh ? "本次整理" : "This request")}
          detail={workMode ? `${bounded(workMode.name) ?? "—"}${workMode.version != null ? ` · v${workMode.version}` : ""}` : (zh ? "未绑定历史做法" : "No prior approach bound")}
          tone={workMode?.state === "needs_confirmation" ? "warning" : "neutral"}
        />
        <Fact
          label={zh ? "资料" : "Sources"}
          value={statusLabel(sourceStatus, zh)}
          detail={sources.length ? sources.slice(0, 3).join("、") : (zh ? "本次处理不依赖本地资料" : "No local sources required")}
          tone={statusTone(sourceStatus)}
        />
        <Fact
          label={zh ? "验收" : "Verification"}
          value={statusLabel(verificationStatus, zh)}
          detail={criteriaCount ? `${passedCriteria}/${criteriaCount} ${zh ? "项标准通过" : "criteria passed"}` : `${evidenceCount} ${zh ? "条证据" : "evidence item(s)"}`}
          tone={statusTone(verificationStatus)}
        />
      </div>

      {mutation ? (
        <div className="rounded-md border border-warning/30 bg-warning/[0.05] p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{zh ? "资料变更事实" : "Data change facts"}</span>
            <Badge tone={statusTone(ledger?.state ?? mutation.status)}>{statusLabel(ledger?.state ?? mutation.status, zh)}</Badge>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <p><span className="text-muted-foreground">{zh ? "文件" : "Files"}：</span>{sources.length || mutation.targetSourceIds.length}</p>
            <p><span className="text-muted-foreground">{zh ? "预计记录" : "Rows"}：</span>{affectedRows ?? "—"}</p>
            <p><span className="text-muted-foreground">{zh ? "修改内容" : "Fields"}：</span>{changedFields.slice(0, 6).join("、") || "—"}</p>
          </div>
          <p className="mt-2 text-muted-foreground">
            {binding
              ? (zh ? `文件保护设置已绑定 · 文件版本 v${binding.fileSourceRevision ?? "—"}` : `File protection bound · source revision v${binding.fileSourceRevision ?? "—"}`)
              : (zh ? "文件保护设置尚未绑定，当前不会修改源文件。" : "File protection is not bound; source files will not be changed yet.")}
          </p>
        </div>
      ) : null}

      <details className="rounded-md border border-border bg-background/50 px-3 py-2 text-xs" data-testid="professional-fact-chain">
        <summary className="cursor-pointer font-medium">{zh ? "查看完整事实链摘要" : "View complete fact-chain summary"}</summary>
        <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
          <div><dt className="text-muted-foreground">{zh ? "任务版本" : "Task revision"}</dt><dd className="font-mono">v{item.revision}</dd></div>
          <div><dt className="text-muted-foreground">{zh ? "执行链" : "Execution chain"}</dt><dd className="break-all font-mono">{observability?.executionChainId ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">{zh ? "资料检查摘要" : "Source digest"}</dt><dd className="break-all font-mono">{contract?.dataPlan?.digest ?? workMode?.trace.dataPlanDigest ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">{zh ? "对应关系摘要" : "Relation digest"}</dt><dd className="break-all font-mono">{contract?.dataRelationConfirmation?.relationDigest ?? workMode?.trace.relationDigest ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">{zh ? "处理摘要" : "Processing digest"}</dt><dd className="break-all font-mono">{workMode?.digest ?? mutation?.digest ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">{zh ? "重试次数 / 事件数" : "Retries / events"}</dt><dd>{retryCount} / {observability?.timeline?.length ?? 0}</dd></div>
          {ledger?.journal ? <div><dt className="text-muted-foreground">{zh ? "备份与恢复" : "Backup and recovery"}</dt><dd>{ledger.journal.snapshotCount} {zh ? "份备份，已处理 " : " snapshots, "}{ledger.journal.appliedCount} {zh ? "项" : " applied"}</dd></div> : null}
          <div><dt className="text-muted-foreground">{zh ? "当前下一步" : "Next action"}</dt><dd>{nextActionLabel(observability?.nextAction, zh)}</dd></div>
        </dl>
      </details>
    </section>
  );
}
