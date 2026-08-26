import { Card, CardContent } from "@/components/ui/card";
import { isTerminalRunStatus } from "@/features/invocations/run-transcript";
import { cn } from "@/lib/cn";
import type { InvocationEventSnapshot, InvocationSnapshot } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { ClarifyAnswer } from "./clarify-answer";
import { DecompositionApproval } from "./decomposition-approval";
import { DesignApproval } from "./design-approval";
import { DesignPanel } from "./design-panel";
import { EpicRollup } from "./epic-rollup";
import { ReportView } from "./report-view";
import {
  AutoRunFilesPeek,
  AutoRunWorktreeDiffPeek,
} from "./auto-run-artifacts";
import { AutoRunActions } from "./auto-run-actions";
import { AutoRunDetailHeader } from "./auto-run-detail-header";
import type { AutoRunAttempt, AutoRunRecord } from "./auto-run-model";
import {
  AutoRunFailoverTrace,
  AutoRunTimeline,
} from "./auto-run-runtime";

interface AutoRunDetailCardProps {
  run: AutoRunRecord;
  attempt?: AutoRunAttempt;
  focused: boolean;
  actionPending: boolean;
  invocations: InvocationSnapshot[];
  events: InvocationEventSnapshot[];
  onAction: (runId: string, action: () => Promise<unknown>) => Promise<void>;
  onReload: (refresh?: boolean, quiet?: boolean) => Promise<void>;
}

export function isAutoRunTimelineTerminal(run: AutoRunRecord, invocations: InvocationSnapshot[]): boolean {
  const invocation = invocations.find((candidate) => candidate.id === run.invocationId);
  // An unknown invocation belongs to an evicted historical run and is finished.
  return invocation ? isTerminalRunStatus(invocation.status) : true;
}

export function AutoRunDetailCard({
  run,
  attempt,
  focused,
  actionPending,
  invocations,
  events,
  onAction,
  onReload,
}: AutoRunDetailCardProps) {
  const { t } = useAppTranslation();

  return (
    <Card
      id={`auto-run-${run.id}`}
      className={cn("scroll-mt-16 transition-shadow", focused && "ring-2 ring-primary shadow-lg")}
    >
      <CardContent className="flex flex-col gap-2 py-3">
        <AutoRunDetailHeader run={run} attempt={attempt} onReload={onReload} />
        <AutoRunFailoverTrace run={run} />
        {run.worktreeId ? <AutoRunWorktreeDiffPeek worktreeId={run.worktreeId} /> : null}
        {run.invocationId ? <AutoRunFilesPeek invocationId={run.invocationId} worktreeId={run.worktreeId} /> : null}
        <AutoRunTimeline
          runId={run.id}
          invocationId={run.invocationId}
          terminal={isAutoRunTimelineTerminal(run, invocations)}
          events={events}
        />

        <AutoRunActions run={run} pending={actionPending} onAction={onAction} />
        {run.report && (run.status === "report_posted" || run.status === "needs_input") ? (
          <ReportView report={run.report} />
        ) : null}
        {run.designArtifacts?.length && run.worktreeId ? (
          <DesignPanel worktreeId={run.worktreeId} artifacts={run.designArtifacts} />
        ) : null}
        {run.screenshots?.length && run.worktreeId ? (
          <DesignPanel worktreeId={run.worktreeId} artifacts={run.screenshots} title={t("autoRuns.screenshots")} />
        ) : null}
        {run.status === "report_posted" && run.decision?.path === "design" ? (
          <DesignApproval run={run} onDone={onReload} />
        ) : null}
        {run.status === "needs_input" ? (
          <ClarifyAnswer run={run} onDone={onReload} />
        ) : null}
        {run.status === "plan_proposed" && run.decision?.path === "decompose" ? (
          <DecompositionApproval run={run} onDone={onReload} />
        ) : null}
        {run.status === "decomposed" && run.childIssues?.length ? (
          <EpicRollup run={run} onDone={onReload} />
        ) : null}
        {run.deployment && (run.deployment.status === "failed" || run.deployment.status === "rolled_back") && run.deployment.summary ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Deploy {run.deployment.status === "rolled_back" ? "rolled back" : "failed"}: {run.deployment.summary}
          </p>
        ) : null}
        {run.error ? <p className="text-xs text-amber-600 dark:text-amber-400">{run.error}</p> : null}
      </CardContent>
    </Card>
  );
}
