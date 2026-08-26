import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, Circle, GitBranch, Link2, LoaderCircle, ShieldAlert } from "lucide-react";
import type { LocalWorkItem } from "./task-view-types";

type RelatedTask = NonNullable<LocalWorkItem["subIssues"]>[number];

function relatedState(item: RelatedTask, language: "zh" | "en") {
  if (item.state === "closed" || item.status === "done") return { label: language === "zh" ? "已完成" : "Complete", tone: "success" as const, icon: CheckCircle2 };
  if (item.status === "review") return { label: language === "zh" ? "等你确认" : "Ready for review", tone: "warning" as const, icon: ShieldAlert };
  if (item.status === "in_progress") return { label: language === "zh" ? "正在处理" : "In progress", tone: "running" as const, icon: LoaderCircle };
  if (item.status === "blocked") return { label: language === "zh" ? "暂时受阻" : "Blocked", tone: "danger" as const, icon: ShieldAlert };
  return { label: language === "zh" ? "尚未开始" : "Not started", tone: "neutral" as const, icon: Circle };
}

export function WorkItemJobOverview({
  item,
  language,
  onOpenWorkItem,
}: {
  item: LocalWorkItem;
  language: "zh" | "en";
  onOpenWorkItem?: (workItemId: string) => void;
}) {
  const children = item.subIssues ?? [];
  const goalTasks = (item.goalTasks ?? []).filter((task) => task.id !== item.id);
  const intentPeers = goalTasks.length ? [] : item.intentPeers ?? [];
  const methodSteps = item.myTemplateBinding?.snapshot.steps ?? [];
  const dependencies = item.blockedBy ?? [];
  const hasContent = Boolean(item.workGoal || item.parent || item.draftSyncReadiness || goalTasks.length || intentPeers.length || children.length || dependencies.length || methodSteps.length > 1);
  if (!hasContent) return null;

  return (
    <section className="rounded-xl border border-border bg-muted/15 p-4" aria-label={language === "zh" ? "这件事的处理步骤" : "Steps for this work"} data-testid="work-item-job-overview">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><GitBranch className="size-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold">{item.workGoal?.title ?? (language === "zh" ? "这件事怎么完成" : "How this work gets done")}</h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {item.workGoal?.outcome ?? (language === "zh" ? "这里只展示你需要理解的步骤；完整依赖、模板和执行证据可在专业视图查看。" : "Only the steps you need are shown here. Open Professional view for full dependencies, templates, and evidence.")}
          </p>
          {item.workGoal?.progress ? (
            <p className="mt-1 text-xs font-medium text-primary">
              {language === "zh"
                ? `已完成 ${item.workGoal.progress.completed}/${item.workGoal.progress.total} 项专业任务`
                : `${item.workGoal.progress.completed}/${item.workGoal.progress.total} professional tasks complete`}
            </p>
          ) : null}
          {item.workGoal?.userSummary ? (
            <div className="mt-3 rounded-lg border border-primary/20 bg-background/80 px-3 py-2 text-xs" data-testid="work-goal-user-summary">
              <p className="font-medium">{language === "zh" ? "你现在只需要知道" : "What you need to know now"}</p>
              <p className="mt-1 text-muted-foreground">{item.workGoal.userSummary.nextStep}</p>
              {item.workGoal.userSummary.latestChange?.summary ? <p className="mt-1 text-muted-foreground">{language === "zh" ? "最近调整：" : "Latest change: "}{item.workGoal.userSummary.latestChange.summary}</p> : null}
              {item.workGoal.userSummary.quality.failed > 0 ? (
                <p className="mt-1 font-medium text-danger">{language === "zh" ? `${item.workGoal.userSummary.quality.failed} 项结果检查未通过，暂不算合格交付。` : `${item.workGoal.userSummary.quality.failed} result check(s) failed; delivery is not accepted yet.`}</p>
              ) : item.workGoal.userSummary.quality.passed > 0 ? (
                <p className="mt-1 font-medium text-success">{language === "zh" ? `${item.workGoal.userSummary.quality.passed} 项结果检查已通过。` : `${item.workGoal.userSummary.quality.passed} result check(s) passed.`}</p>
              ) : null}
              {onOpenWorkItem && item.workGoal.userSummary.nextAction?.workItemId ? (
                <Button className="mt-2" size="sm" variant="secondary" onClick={() => onOpenWorkItem(item.workGoal!.userSummary!.nextAction!.workItemId!)}>
                  {language === "zh"
                    ? item.workGoal.userSummary.nextAction.label
                    : item.workGoal.userSummary.nextAction.kind === "repair_result" ? "Review and repair"
                      : item.workGoal.userSummary.nextAction.kind === "view_progress" ? "View progress"
                        : item.workGoal.userSummary.nextAction.kind === "view_waiting" ? "Why is this waiting?"
                          : "Open task"}
                  <ArrowRight aria-hidden />
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {item.taskKind === "content_publish" && item.publicationReadiness ? (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${item.publicationReadiness.state === "ready" ? "border-success/30 bg-success/[0.06]" : "border-warning/30 bg-warning/[0.06]"}`} data-testid="publication-readiness">
          {item.publicationReadiness.state === "ready"
            ? (language === "zh" ? "发布连接已就绪；真正发布前仍需你确认。" : "The publishing connection is ready; your confirmation is still required before publishing.")
            : (language === "zh" ? "发布连接尚未配置，任务和前置成果已保留。" : "The publishing connection is not configured; this task and its upstream work are preserved.")}
        </div>
      ) : null}

      {item.taskKind === "wechat_draft_sync" && item.draftSyncReadiness ? (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${item.draftSyncReadiness.state === "ready" ? "border-success/30 bg-success/[0.06]" : "border-warning/30 bg-warning/[0.06]"}`} data-testid="draft-sync-readiness">
          {item.draftSyncReadiness.state === "ready"
            ? (language === "zh" ? "公众号草稿连接已就绪；只会保存到草稿箱，不会公开发布。" : "The WeChat draft connection is ready. It saves a draft and never publishes publicly.")
            : (language === "zh" ? "公众号草稿连接尚未配置，任务和文章已经保留。" : "The WeChat draft connection is not configured; the task and article are preserved.")}
        </div>
      ) : null}

      {item.parent ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background/80 px-3 py-2 text-sm">
          <span className="inline-flex min-w-0 items-center gap-2"><Link2 className="size-4 shrink-0 text-primary" aria-hidden /><span className="truncate">{language === "zh" ? "属于：" : "Part of: "}{item.parent.title}</span></span>
          {onOpenWorkItem ? <Button size="sm" variant="ghost" onClick={() => onOpenWorkItem(item.parent!.id)}>{language === "zh" ? "查看整件事" : "Open parent"}<ArrowRight aria-hidden /></Button> : null}
        </div>
      ) : null}

      {goalTasks.length ? (
        <div className="mt-3 rounded-lg border border-primary/20 bg-background/80 p-3" data-testid="work-goal-tasks">
          <p className="text-sm font-medium">{language === "zh" ? "这件事包含的专业任务" : "Professional tasks in this goal"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {language === "zh"
              ? "每项任务独立执行和重试；需要上游产物时才会等待。"
              : "Each task runs and retries independently, waiting only for required upstream artifacts."}
          </p>
          <ol className="mt-2 space-y-2">
            {goalTasks.map((task) => {
              const state = relatedState(task, language);
              return (
                <li key={task.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
                  {task.platformTarget ? <Badge tone="neutral">{task.platformTarget.label}</Badge> : null}
                  <Badge tone={state.tone}>{state.label}</Badge>
                  {onOpenWorkItem ? <Button size="sm" variant="ghost" aria-label={`${language === "zh" ? "打开" : "Open"} ${task.title}`} onClick={() => onOpenWorkItem(task.id)}><ArrowRight aria-hidden /></Button> : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {intentPeers.length ? (
        <div className="mt-3 rounded-lg border border-primary/20 bg-background/80 p-3">
          <p className="text-sm font-medium">{language === "zh" ? "同一意图下的独立任务" : "Independent tasks from the same intent"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {language === "zh"
              ? "这些任务共享用户意图，但不会互相自动启动或继承成败。"
              : "These tasks share the user's intent, but do not auto-start one another or share success and failure."}
          </p>
          <ol className="mt-2 space-y-2">
            {intentPeers.map((peer) => {
              const state = relatedState(peer, language);
              return (
                <li key={peer.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{peer.title}</span>
                  <Badge tone={state.tone}>{state.label}</Badge>
                  {onOpenWorkItem ? <Button size="sm" variant="ghost" aria-label={`${language === "zh" ? "打开" : "Open"} ${peer.title}`} onClick={() => onOpenWorkItem(peer.id)}><ArrowRight aria-hidden /></Button> : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {children.length ? (
        <ol className="mt-3 space-y-2">
          {children.map((child, index) => {
            const state = relatedState(child, language);
            const Icon = state.icon;
            return (
              <li key={child.id} className="flex items-center gap-3 rounded-lg bg-background/80 px-3 py-2.5">
                <span className="text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
                <Icon className={`size-4 shrink-0 ${child.status === "in_progress" ? "animate-spin text-primary" : "text-muted-foreground"}`} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{child.title}</span>
                <Badge tone={state.tone}>{state.label}</Badge>
                {onOpenWorkItem ? <Button size="sm" variant="ghost" aria-label={`${language === "zh" ? "打开" : "Open"} ${child.title}`} onClick={() => onOpenWorkItem(child.id)}><ArrowRight aria-hidden /></Button> : null}
              </li>
            );
          })}
        </ol>
      ) : methodSteps.length > 1 ? (
        <ol className="mt-3 grid gap-2 sm:grid-cols-2">
          {methodSteps.map((step, index) => (
            <li key={step.key} className="flex gap-2 rounded-lg bg-background/80 px-3 py-2 text-sm">
              <span className="font-semibold text-primary">{index + 1}.</span><span>{step.label}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {dependencies.length ? (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/[0.05] px-3 py-2 text-sm">
          <p className="font-medium">{language === "zh" ? "需要先完成" : "Needs to finish first"}</p>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {dependencies.map((dependency) => (
              <li key={dependency.id}>
                {dependency.resolved ? "✓" : "○"} {dependency.title}
                {!dependency.resolved && dependency.taskResolved && dependency.artifactResolved === false
                  ? (language === "zh" ? "（任务已完成，但成果格式或数量还未通过检查）" : " (task finished, but its artifact format or quantity has not passed validation)")
                  : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
