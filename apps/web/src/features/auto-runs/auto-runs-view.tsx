import { Bot, RefreshCw, LayoutList, Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/common/empty-state";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { installExecutionUiTranslations } from "@/lib/i18n/execution-ui-resources";
import { installAutoRunTranslations } from "@/lib/i18n/auto-run-resources";
import { AutoRunDashboard } from "./auto-run-dashboard";
import { AutoRunDetailCard } from "./auto-run-detail-card";
import { AutoRunBoard as RunBoard } from "./auto-run-overview";
import { useAutoRunsController } from "./use-auto-runs-controller";

export {
  eventsForRun,
  failoverSummary,
  localQueueSnapshot,
  mergeRisk,
  postureRows,
  runLane,
} from "./auto-run-model";
export type { AutoRunRecord, FailoverOutcome, FailoverTransition } from "./auto-run-model";

installExecutionUiTranslations();
installAutoRunTranslations();







export function AutoRunsView() {
  const { t } = useAppTranslation();
  const controller = useAutoRunsController();
  const {
    runs, visibleRuns, summary, deployments, consoleState, loading, error, actionError,
    viewMode, setViewMode, focusedRunId, actionRunId, runQuery, setRunQuery,
    statusFilter, setStatusFilter, attemptMetaById, load, openRun, performRunAction,
  } = controller;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Bot className="size-5" /> {t("autoRuns.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("autoRuns.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5" role="group" aria-label={t("autoRuns.view")}>
            <button
              type="button"
              aria-pressed={viewMode === "list"}
              onClick={() => setViewMode("list")}
              title={t("autoRuns.listHint")}
              className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs", viewMode === "list" ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <LayoutList className="size-3.5" /> {t("autoRuns.list")}
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "board"}
              onClick={() => setViewMode("board")}
              title={t("autoRuns.boardHint")}
              className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs", viewMode === "board" ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <Columns3 className="size-3.5" /> {t("autoRuns.board")}
            </button>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void load(true)} disabled={loading}>
            <RefreshCw className={cn("mr-1 size-3.5", loading && "animate-spin")} /> {t("autoRuns.refresh")}
          </Button>
        </div>
      </div>

      <AutoRunDashboard
        runs={runs}
        summary={summary}
        deploymentSummary={deployments}
        consoleState={consoleState}
        onOpenRun={openRun}
      />
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {actionError ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{actionError}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={runQuery}
          onChange={(event) => setRunQuery(event.target.value)}
          placeholder={t("executionUi.searchRuns")}
          className="h-8 min-w-56 flex-1 text-xs"
        />
        <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-8 w-auto text-xs">
          <option value="all">{t("executionUi.allStatuses")}</option>
          {[...new Set(runs.map((run) => run.status))].map((status) => (
            <option key={status} value={status}>
              {status === "done" ? t("executionUi.done") : t(`autoRuns.status.${status}` as never, { defaultValue: status })}
            </option>
          ))}
        </Select>
      </div>

      {runs.length === 0 && !loading ? (
        <EmptyState
          title={t("autoRuns.empty")}
          hint={t("autoRuns.emptyHint")}
        />
      ) : viewMode === "board" ? (
        <RunBoard runs={visibleRuns} onOpen={openRun} />
      ) : (
        <div className="flex flex-col gap-2">
          {visibleRuns.map((run) => (
            <AutoRunDetailCard
              key={run.id}
              run={run}
              attempt={attemptMetaById.get(run.id)}
              focused={focusedRunId === run.id}
              actionPending={actionRunId === run.id}
              invocations={consoleState?.invocations ?? []}
              events={consoleState?.events ?? []}
              onAction={performRunAction}
              onReload={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}
