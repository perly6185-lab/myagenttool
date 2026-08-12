import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Pause, Play, RefreshCw, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { workflowMemoryApi } from "@/features/workflow-memory/workflow-memory-api";
import { ApiError } from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

const COPY = {
  en: {
    title: "Use this work memory automatically",
    learning: "The system is still learning this work. Confirm and enable a discovered work type first.",
    ready: "The work pattern is ready. Enable it once; future matching files can become local tasks automatically.",
    running: "Automatic daily work is on",
    runningHint: "This folder is watched locally. Safe matching work becomes a local task and continues automatically.",
    boundary: "The AI pauses only for missing or conflicting facts, a business decision, approval, a protected write, or a failure it cannot recover from.",
    enable: "Handle future work this way",
    disable: "Pause automatic handling",
    confirm: "Use the confirmed work memory for future matching files? The system only creates local tasks and keeps protected writes and approvals for you.",
    learned: "Learned work",
    needsHelp: "items currently need your attention",
    loading: "Checking the current automatic-handling status…",
    loadError: "The current automatic-handling status could not be checked.",
    retryStatus: "Check again",
    error: "The change was not fully completed. The actual status has been checked; review it below and try again.",
  },
  zh: {
    title: "以后自动按这个规矩处理",
    learning: "系统还在学习这项工作。请先检查并启用识别出的工作类型。",
    ready: "工作规矩已经准备好。只需启用一次，以后匹配的新文件会自动成为本地任务。",
    running: "日常工作已自动处理",
    runningHint: "系统正在本机留意这个目录；匹配且安全的新工作会自动创建任务并继续执行。",
    boundary: "只有缺少或冲突的信息、业务判断、人工确认、受保护写入，或无法自动恢复的失败，AI 才会请你处理。",
    enable: "以后按这个规矩处理",
    disable: "暂停自动处理",
    confirm: "以后匹配的新文件都使用这份已确认的工作记忆处理吗？系统只创建本地任务，需要审批或受保护写入时仍会请你确认。",
    learned: "已学会",
    needsHelp: "项工作需要你处理",
    loading: "正在确认当前自动处理状态……",
    loadError: "暂时无法确认当前是否已经开启自动处理。",
    retryStatus: "重新检查",
    error: "这次修改没有完整完成。系统已重新检查实际状态，请确认下方状态后再试一次。",
  },
} as const;

export function DailyWorkAutomationCard({
  projectId,
  sourceId,
  learnedRoutineName,
}: {
  projectId: string;
  sourceId: string;
  learnedRoutineName: string | null;
}) {
  const { i18n } = useAppTranslation();
  const copy = COPY[i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en"];
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryKey = ["workflow-memory", "adaptive-workbench", projectId, sourceId] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => workflowMemoryApi.getAdaptiveWorkWorkbench(projectId, sourceId),
    enabled: Boolean(projectId && sourceId),
  });
  const active = query.data?.policy.mode === "execute" && query.data.monitor?.enabled === true;

  const update = async () => {
    const current = query.data;
    if (!current?.monitor || !learnedRoutineName) return;
    if (!active && !window.confirm(copy.confirm)) return;
    setPending(true);
    setError(null);
    try {
      await workflowMemoryApi.updateAdaptiveWorkAutomation({
        projectId,
        sourceId,
        expectedPolicyRevision: current.policy.revision,
        expectedMonitorRevision: current.monitor.revision,
        enabled: !active,
        intervalMinutes: current.monitor.intervalMinutes,
        ...(!active ? { confirmed: true as const } : {}),
      });
      await queryClient.invalidateQueries({ queryKey });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message || copy.error : copy.error);
      await queryClient.invalidateQueries({ queryKey });
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className={active ? "border-success/40 bg-success/5" : "border-primary/30"}>
      <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            {active
              ? <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
              : <Sparkles className="size-5 text-primary" aria-hidden="true" />}
            <CardTitle className="text-base">{copy.title}</CardTitle>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {active ? copy.runningHint : learnedRoutineName ? copy.ready : copy.learning}
          </p>
        </div>
        {active ? <Badge tone="success">{copy.running}</Badge> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {copy.loading}
          </p>
        ) : null}
        {query.isError ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
            <p role="alert" className="min-w-0 flex-1 text-sm">{copy.loadError}</p>
            <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
              <RefreshCw />
              {copy.retryStatus}
            </Button>
          </div>
        ) : null}
        {learnedRoutineName ? (
          <p className="text-sm"><span className="text-muted-foreground">{copy.learned}：</span>{learnedRoutineName}</p>
        ) : null}
        <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">{copy.boundary}</p>
        {query.data && query.data.metrics.needsAttention > 0 ? (
          <p className="text-xs text-warning">
            {query.data.metrics.needsAttention} {copy.needsHelp}
          </p>
        ) : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <Button
          size="sm"
          variant={active ? "secondary" : "primary"}
          disabled={pending || query.isLoading || !learnedRoutineName || !query.data?.monitor}
          onClick={() => void update()}
        >
          {pending
            ? <Loader2 className="animate-spin" />
            : active ? <Pause /> : <Play />}
          {active ? copy.disable : copy.enable}
        </Button>
      </CardContent>
    </Card>
  );
}
