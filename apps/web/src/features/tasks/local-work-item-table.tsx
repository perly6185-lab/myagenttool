import { useMemo } from "react";
import type { ReactNode } from "react";
import { FolderKanban } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { statusTone } from "@/lib/readable-labels";
import type { LocalWorkItem } from "./task-view-types";
import { deriveWorkItemUserStatus, type WorkItemUserStatus } from "./work-item-user-status";

type LocalWorkItemTableProps = {
  items: LocalWorkItem[];
  projects: { id: string; name: string }[];
  emptyTitle: string;
  emptyHint: string;
  onOpen: (id: string) => void;
  simple?: boolean;
  emptyAction?: ReactNode;
};

const SIMPLE_STATUS_TONE: Record<WorkItemUserStatus, Parameters<typeof Badge>[0]["tone"]> = {
  not_started: "neutral",
  scheduled: "running",
  ai_working: "running",
  waiting: "warning",
  needs_action: "danger",
  ready_for_review: "warning",
  blocked: "danger",
  completed: "success",
};

export function LocalWorkItemTable({ items, projects, emptyTitle, emptyHint, onOpen, simple = false, emptyAction }: LocalWorkItemTableProps) {
  const { t, i18n } = useAppTranslation();
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const today = new Date().toISOString().slice(0, 10);
  const zh = i18n.language.startsWith("zh");
  const simpleCopy: Record<WorkItemUserStatus, { status: string; action: string }> = zh ? {
    not_started: { status: "未开始", action: "打开任务" },
    scheduled: { status: "已安排", action: "查看安排" },
    ai_working: { status: "AI 处理中", action: "查看进度" },
    waiting: { status: "等待他人", action: "查看详情" },
    needs_action: { status: "需要你处理", action: "继续处理" },
    ready_for_review: { status: "等你确认", action: "查看结果" },
    blocked: { status: "暂时受阻", action: "查看原因" },
    completed: { status: "已完成", action: "查看结果" },
  } : {
    not_started: { status: "Not started", action: "Open task" },
    scheduled: { status: "Scheduled", action: "View schedule" },
    ai_working: { status: "AI working", action: "View progress" },
    waiting: { status: "Waiting on others", action: "View details" },
    needs_action: { status: "Needs you", action: "Continue" },
    ready_for_review: { status: "Ready for you", action: "View result" },
    blocked: { status: "Blocked", action: "View reason" },
    completed: { status: "Completed", action: "View result" },
  };

  if (!items.length) return <EmptyState title={emptyTitle} hint={emptyHint} action={emptyAction} />;

  if (simple) {
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">{zh ? "任务" : "Task"}</th>
              <th className="px-3 py-2 font-medium">{zh ? "进展" : "Progress"}</th>
              <th className="px-3 py-2 text-right font-medium">{zh ? "下一步" : "Next"}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const overdue = item.status !== "done" && Boolean(item.dueDate && item.dueDate < today);
              const userStatus = deriveWorkItemUserStatus(item);
              const copy = simpleCopy[userStatus];
              return (
                <tr key={item.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                  <td className="min-w-56 px-3 py-3">
                    <button type="button" className="text-left font-medium hover:text-primary hover:underline" onClick={() => onOpen(item.id)}>
                      {item.title}
                    </button>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{projectNames.get(item.projectId) ?? item.projectId}</span>
                      {item.dueDate ? (
                        <span className={overdue ? "text-destructive" : undefined}>
                          {t(overdue ? "taskLocal.overdue" : "taskLocal.due", { date: item.dueDate })}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={SIMPLE_STATUS_TONE[userStatus]}>{copy.status}</Badge>
                    {item.lastProgressSummary ? <p className="mt-1 max-w-sm truncate text-xs text-muted-foreground">{item.lastProgressSummary}</p> : null}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button type="button" className="whitespace-nowrap font-medium text-primary hover:underline" onClick={() => onOpen(item.id)}>
                      {copy.action}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">ID</th>
            <th className="px-3 py-2 font-medium">{t("tasks.titleContext")}</th>
            <th className="px-3 py-2 font-medium">{t("tasks.type")}</th>
            <th className="px-3 py-2 font-medium">{t("tasks.priority")}</th>
            <th className="px-3 py-2 font-medium">{t("tasks.state")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const overdue = item.status !== "done" && Boolean(item.dueDate && item.dueDate < today);
            return (
              <tr key={item.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{item.localRef}</td>
                <td className="px-3 py-2">
                  <button type="button" className="font-medium hover:text-primary hover:underline" onClick={() => onOpen(item.id)}>
                    {item.title}
                  </button>
                  <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                    <span>{projectNames.get(item.projectId) ?? item.projectId}</span>
                    {item.labels.map((label) => <Badge key={label} tone="neutral">{label}</Badge>)}
                    {item.planningProjects?.filter((project) => !project.archivedAt).map((project) => (
                      <Badge key={project.id} tone="running"><FolderKanban className="mr-1 size-3" />{project.name}</Badge>
                    ))}
                    {item.milestone ? <Badge tone="neutral">{item.milestone}</Badge> : null}
                    {item.dueDate ? (
                      <Badge tone={overdue ? "danger" : "warning"}>
                        {t(overdue ? "taskLocal.overdue" : "taskLocal.due", { date: item.dueDate })}
                      </Badge>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2"><Badge tone="neutral">{t(`tasks.localType.${item.type}`)}</Badge></td>
                <td className="px-3 py-2"><Badge tone={item.priority === "p0" ? "danger" : item.priority === "p1" ? "warning" : "neutral"}>{item.priority.toUpperCase()}</Badge></td>
                <td className="px-3 py-2"><Badge tone={statusTone(item.status)}>{t(`tasks.localStatus.${item.status}`)}</Badge></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
