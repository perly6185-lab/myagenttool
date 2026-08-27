import { AlertTriangle, Bot, CheckCircle2, Database, FileCheck2, FolderGit2, Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { ReactNode } from "react";
import type { ExecutionStartSummary } from "./execution-start-summary";

export function ExecutionStartConfirmation({
  open,
  summary,
  language,
  pending,
  canConfirm,
  error,
  blockedActionLabel,
  onResolveBlocked,
  onConfirm,
  onClose,
}: {
  open: boolean;
  summary: ExecutionStartSummary;
  language: "zh" | "en";
  pending: boolean;
  canConfirm: boolean;
  error: string | null;
  blockedActionLabel?: string;
  onResolveBlocked?: () => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const zh = language === "zh";
  const blockingIssues = summary.issues.filter((issue) => issue.severity === "blocking");
  const warningIssues = summary.issues.filter((issue) => issue.severity === "warning");
  const noticeIssues = summary.issues.filter((issue) => issue.severity === "notice");
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={pending}
      size="lg"
      title={zh ? "确认让 AI 开始" : "Confirm AI start"}
      description={zh ? "请确认 AI 要做什么、依据什么资料，以及怎样算完成。" : "Confirm what AI will do, which materials it may use, and how completion will be checked."}
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
            {zh ? "暂不开始" : "Not now"}
          </Button>
          <Button type="button" disabled={pending || !canConfirm} onClick={onConfirm}>
            <Bot aria-hidden />
            {pending ? (zh ? "正在确认…" : "Confirming…") : (zh ? "确认并让 AI 开始" : "Confirm and start AI")}
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <section className="rounded-xl border border-primary/30 bg-primary/[0.055] p-4" aria-labelledby="execution-start-goal">
          <p className="text-xs font-medium text-primary">{zh ? "这次要完成" : "Goal"}</p>
          <h3 id="execution-start-goal" className="mt-1 text-base font-semibold leading-relaxed">{summary.goal}</h3>
        </section>

        <section className={`rounded-xl border p-4 ${blockingIssues.length ? "border-destructive/40 bg-destructive/[0.045]" : warningIssues.length ? "border-warning/40 bg-warning/[0.06]" : "border-success/35 bg-success/[0.05]"}`} aria-labelledby="execution-start-risk">
          <div className="flex items-center gap-2">
            {blockingIssues.length || warningIssues.length ? <AlertTriangle className="size-4 text-warning-foreground" aria-hidden /> : <CheckCircle2 className="size-4 text-success" aria-hidden />}
            <h3 id="execution-start-risk" className="text-sm font-semibold">{zh ? "开始前提醒" : "Before starting"}</h3>
          </div>
          {summary.issues.length ? (
            <>
              <div className="mt-3 space-y-3 text-sm leading-relaxed">
                {blockingIssues.length ? <IssueGroup title={zh ? "必须先处理" : "Must resolve"} tone="danger" issues={blockingIssues.map((issue) => issue.message)} /> : null}
                {warningIssues.length ? <IssueGroup title={zh ? "可以继续，但请确认" : "Review before continuing"} tone="warning" issues={warningIssues.map((issue) => issue.message)} /> : null}
                {noticeIssues.length ? <IssueGroup title={zh ? "执行后会发生" : "What happens next"} tone="neutral" issues={noticeIssues.map((issue) => issue.message)} /> : null}
              </div>
              {!canConfirm && onResolveBlocked && blockedActionLabel ? (
                <Button className="mt-3" type="button" size="sm" variant="secondary" disabled={pending} onClick={onResolveBlocked}>
                  {blockedActionLabel}
                </Button>
              ) : null}
            </>
          ) : <p className="mt-2 text-sm text-muted-foreground">{zh ? "当前没有发现会阻止启动的问题。" : "No issue currently blocks this start."}</p>}
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <SummaryList
            icon={<CheckCircle2 className="size-4 text-success" aria-hidden />}
            title={zh ? "怎样算完成" : "Done when"}
            items={summary.acceptanceCriteria}
            empty={zh ? "尚未生成完成标准。" : "Completion criteria are not ready."}
          />
          <SummaryList
            icon={<FileCheck2 className="size-4 text-primary" aria-hidden />}
            title={zh ? "AI 会怎样检查" : "How AI will check"}
            items={summary.verificationSteps}
            empty={zh ? "尚未生成检查步骤。" : "Verification steps are not ready."}
          />
        </div>

        <section className="rounded-xl border border-border p-4" aria-labelledby="execution-start-context">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-primary" aria-hidden />
            <h3 id="execution-start-context" className="text-sm font-semibold">{zh ? "AI 将使用的范围" : "What AI may use"}</h3>
          </div>
          <dl className="mt-3 space-y-3 text-sm">
            <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground">{zh ? "需求来源" : "Request source"}</dt>
              <dd className="min-w-0 font-medium">{summary.origin.label}</dd>
            </div>
            <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground">{zh ? "处理方式" : "Method"}</dt>
              <dd className="min-w-0">
                <span className="font-medium">{summary.method.name}</span>
                <span className="block text-xs text-muted-foreground">{summary.method.expectedOutput
                  ? `${zh ? "预计得到：" : "Expected result: "}${summary.method.expectedOutput}`
                  : summary.method.kind === "template" ? (zh ? "使用已保存模板" : "Uses a saved template") : (zh ? "按本任务方案处理，不套用已保存模板" : "Use this task plan without a saved template")}</span>
              </dd>
            </div>
            <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground">{zh ? "相关资料" : "Materials"}</dt>
              <dd className="min-w-0">
                {summary.materials.length ? (
                  <ul className="space-y-1.5">
                    {summary.materials.map((material) => (
                      <li key={`${material.source}:${material.id}`} className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="break-words">{material.title}</span>
                        <Badge tone="neutral">{material.source}</Badge>
                        <Badge tone={material.role === (zh ? "允许修改" : "Change target") ? "warning" : "neutral"}>{material.role}</Badge>
                      </li>
                    ))}
                  </ul>
                ) : (zh ? "未指定额外资料，只使用任务说明和项目内容" : "No extra materials; use only the task description and project content")}
              </dd>
            </div>
            <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
              <dt className="flex items-center gap-1 text-muted-foreground"><FolderGit2 className="size-3.5" aria-hidden />{zh ? "工作位置" : "Workspace"}</dt>
              <dd className="min-w-0">
                <span className="font-medium">{summary.repository.name}</span>
                {summary.repository.path ? <code className="mt-0.5 block break-all text-xs text-muted-foreground">{summary.repository.path}</code> : null}
              </dd>
            </div>
            <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground">{zh ? "结果去向" : "Result destination"}</dt>
              <dd className="min-w-0 font-medium">{summary.delivery.destination === "channel"
                ? (zh ? `先在任务中确认，再回传到 ${summary.delivery.label}` : `Review in the task, then return it to ${summary.delivery.label}`)
                : (zh ? "保留在当前任务中，等待你确认" : "Keep it in this task for your review")}</dd>
            </div>
          </dl>
        </section>

        <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          <Route className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{summary.boundary}</p>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>
    </Modal>
  );
}

function IssueGroup({
  title,
  tone,
  issues,
}: {
  title: string;
  tone: "danger" | "warning" | "neutral";
  issues: string[];
}) {
  return (
    <div>
      <Badge tone={tone}>{title}</Badge>
      <ul className="mt-1.5 space-y-1">
        {issues.map((issue) => <li key={issue}>• {issue}</li>)}
      </ul>
    </div>
  );
}

function SummaryList({
  icon,
  title,
  items,
  empty,
}: {
  icon: ReactNode;
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <section className="rounded-xl border border-border p-4">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {items.length ? (
        <ol className="mt-2 space-y-1.5 pl-5 text-sm leading-relaxed marker:text-muted-foreground">
          {items.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}
        </ol>
      ) : <p className="mt-2 text-sm text-destructive">{empty}</p>}
    </section>
  );
}
