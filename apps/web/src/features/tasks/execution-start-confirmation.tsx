import { AlertTriangle, Bot, CheckCircle2, Database, FileCheck2, FolderGit2, Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { ReactNode, RefObject } from "react";
import type { ExecutionStartClarificationOption, ExecutionStartSummary } from "./execution-start-summary";

function clarificationTargetLabel(target: string, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    "action.accessMode": ["操作权限", "Action permission"],
    "action.operation": ["动作类型", "Operation type"],
    "action.forbiddenActions": ["禁止动作", "Prohibited actions"],
    "materials.roles": ["资料用途与权限", "Material roles and access"],
    "delivery.destination": ["结果去向", "Delivery destination"],
    "delivery.platform": ["目标平台", "Target platform"],
    "method.selection": ["处理方法", "Method selection"],
    expectedOutput: ["预期结果", "Expected output"],
    "task.definition": ["任务定义", "Task definition"],
  };
  return labels[target]?.[zh ? 0 : 1] ?? target;
}

export function ExecutionStartConfirmation({
  open,
  summary,
  language,
  pending,
  canConfirm,
  error,
  blockedActionLabel,
  onResolveBlocked,
  onClarificationChoice,
  onConfirm,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  summary: ExecutionStartSummary;
  language: "zh" | "en";
  pending: boolean;
  canConfirm: boolean;
  error: string | null;
  blockedActionLabel?: string;
  onResolveBlocked?: () => void;
  onClarificationChoice?: (option: ExecutionStartClarificationOption) => void;
  onConfirm: () => void;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
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
      returnFocusRef={returnFocusRef}
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

        {summary.clarification ? (
          <section className="rounded-xl border border-warning/50 bg-warning/[0.08] p-4" aria-labelledby="execution-start-clarification">
            <p className="text-xs font-medium text-warning-foreground">{zh ? "只需要你确认这一点" : "One decision is needed"}</p>
            <h3 id="execution-start-clarification" className="mt-1 text-sm font-semibold leading-relaxed">{summary.clarification.question}</h3>
            {summary.clarification.reason ? (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">{zh ? "原因：" : "Why: "}</span>
                {summary.clarification.reason}
              </p>
            ) : null}
            {summary.clarification.recommendation ? (
              <p className="mt-2 rounded-lg bg-background/70 px-3 py-2 text-sm leading-relaxed">
                <span className="font-medium">{zh ? "建议：" : "Recommendation: "}</span>
                {summary.clarification.recommendation}
              </p>
            ) : null}
            {summary.clarification.options.length ? (
              <div className="mt-3 space-y-2">
                {summary.clarification.options.map((option) => (
                  <div key={option.id} className="rounded-lg border border-border bg-background/75 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{option.label}</p>
                      {option.recommended ? <Badge>{zh ? "推荐" : "Recommended"}</Badge> : null}
                    </div>
                    {option.description ? <p className="mt-1 text-sm leading-relaxed">{option.description}</p> : null}
                    {option.impact ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{zh ? "影响：" : "Impact: "}{option.impact}</p> : null}
                    {option.targetFields.length ? (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {zh ? "将更新：" : "Will update: "}
                        {option.targetFields.map((target) => clarificationTargetLabel(target, zh)).join(zh ? "、" : ", ")}
                      </p>
                    ) : null}
                    {onClarificationChoice ? (
                      <Button className="mt-2" type="button" size="sm" variant={option.recommended ? "primary" : "secondary"} disabled={pending} onClick={() => onClarificationChoice(option)}>
                        {option.applyMode === "automatic"
                          ? (zh ? "采用这个选项" : "Use this option")
                          : (zh ? "前往调整" : "Review and edit")}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

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
