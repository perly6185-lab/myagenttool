import { ArrowRight, MessageCircle, SquareCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import type { LocalWorkItem } from "@/features/tasks/task-view-types";
import type { ChannelDelivery, ChannelTaskRequest, ChannelTaskRevision, ChannelTaskThread } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { channelTaskUserState } from "@/features/channels/channel-task-user-state";
import { buildMyTaskTimeline, type MyTaskTimelineRow } from "./my-task-timeline";

type Props = {
  workItems?: LocalWorkItem[];
  channelTaskThreads?: ChannelTaskThread[];
  channelTaskRequests?: ChannelTaskRequest[];
  channelTaskRevisions?: ChannelTaskRevision[];
  channelDeliveries?: ChannelDelivery[];
  onOpenTask: (workItemId: string) => void;
  onOpenChannels: () => void;
};

function localStatus(status: string, zh: boolean): { label: string; tone: "neutral" | "running" | "warning" | "danger" | "success"; nextStep?: string } {
  const labels: Record<string, string> = zh
    ? { backlog: "待办", ready: "就绪", in_progress: "进行中", review: "待复核", blocked: "已阻塞", done: "已完成" }
    : { backlog: "Backlog", ready: "Ready", in_progress: "In progress", review: "Review", blocked: "Blocked", done: "Done" };
  return { label: labels[status] ?? status, tone: status === "done" ? "success" : status === "blocked" ? "danger" : status === "in_progress" ? "running" : "neutral", nextStep: labels[status] ?? status };
}

function formatTime(value: string, zh: boolean): string {
  return new Intl.DateTimeFormat(zh ? "zh-CN" : "en-US", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function rowStatus(row: MyTaskTimelineRow, thread: ChannelTaskThread | undefined, request: ChannelTaskRequest | undefined, revision: ChannelTaskRevision | undefined, delivery: ChannelDelivery | undefined, zh: boolean) {
  if (thread) return channelTaskUserState({ thread, task: request, revision, delivery });
  return localStatus(row.status, zh);
}

export function MyTaskTimelineCard({ workItems = [], channelTaskThreads = [], channelTaskRequests = [], channelTaskRevisions = [], channelDeliveries = [], onOpenTask, onOpenChannels }: Props) {
  const { t, i18n } = useAppTranslation();
  const zh = i18n.language.startsWith("zh");
  const rows = buildMyTaskTimeline({ workItems, channelTaskThreads, channelTaskRequests, channelTaskRevisions, channelDeliveries });
  if (rows.length === 0) return null;

  return (
    <Card data-testid="my-task-timeline" className="order-5">
      <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
        <div>
          <CardTitle>{t("dashboard.myTaskTimeline.title")}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t("dashboard.myTaskTimeline.hint")}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onOpenChannels}>{t("dashboard.myTaskTimeline.openChannels")}</Button>
      </CardHeader>
      <CardContent className="grid gap-2">
        {rows.map((row) => {
          const thread = row.source === "channel" ? channelTaskThreads.find((item) => `channel:${item.id}` === row.id) : undefined;
          const request = thread ? channelTaskRequests.find((item) => item.threadId === thread.id) : undefined;
          const revision = thread ? channelTaskRevisions.filter((item) => item.threadId === thread.id).sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""))[0] : undefined;
          const delivery = thread ? channelDeliveries.filter((item) => item.taskContext?.threadId === thread.id).sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt ?? "") - Date.parse(a.updatedAt ?? a.createdAt ?? ""))[0] : undefined;
          const status = rowStatus(row, thread, request, revision, delivery, zh);
          return (
            <div key={row.id} className="rounded-md border border-border px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                  <span className="mt-0.5 text-muted-foreground">{row.source === "channel" ? <MessageCircle className="size-4" aria-hidden /> : <SquareCheck className="size-4" aria-hidden />}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{status.nextStep ?? row.summary ?? "—"}</p>
                  </div>
                </div>
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>{row.events.slice(0, 3).reverse().map((event) => `${event.kind === "status" ? event.detail : event.kind} · ${formatTime(event.at, zh)}`).join("  →  ")}</span>
                {row.workItemId ? <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2" onClick={() => onOpenTask(row.workItemId!)}>{t("dashboard.myTaskTimeline.openTask")}<ArrowRight className="size-3" aria-hidden /></Button> : null}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
