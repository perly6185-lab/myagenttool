import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { focusQueryTarget } from "@/lib/focus-query";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { AutoRunAttempt, AutoRunRecord, AutoRunSummary, DeploymentSummary } from "./auto-run-model";

export type AutoRunViewMode = "list" | "board";

interface AutoRunsResponse {
  autoRuns?: AutoRunRecord[];
  summary?: AutoRunSummary;
  deployments?: DeploymentSummary;
}

export function filterAutoRuns(runs: AutoRunRecord[], query: string, status: string): AutoRunRecord[] {
  const normalizedQuery = query.trim().toLowerCase();
  return runs.filter((run) => {
    if (status !== "all" && run.status !== status) return false;
    const haystack = [
      run.id,
      run.link?.title,
      run.link?.number,
      run.agentId,
      run.branchName,
    ].filter(Boolean).join(" ").toLowerCase();
    return !normalizedQuery || haystack.includes(normalizedQuery);
  });
}

export function buildAutoRunAttemptMap(runs: AutoRunRecord[]): Map<string, AutoRunAttempt> {
  const groups = new Map<string, AutoRunRecord[]>();
  for (const run of runs) {
    const key = run.link
      ? `${run.projectId ?? ""}:${run.link.type}:${run.link.number}`
      : run.id;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }

  const result = new Map<string, AutoRunAttempt>();
  for (const rows of groups.values()) {
    rows
      .slice()
      .sort((left, right) => Date.parse(left.createdAt ?? "") - Date.parse(right.createdAt ?? ""))
      .forEach((run, index) => result.set(run.id, { attempt: index + 1, total: rows.length }));
  }
  return result;
}

function scrollToAutoRun(runId: string) {
  requestAnimationFrame(() => {
    document.getElementById(`auto-run-${runId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

export function useAutoRunsController() {
  const { t } = useAppTranslation();
  const { data: consoleState } = useConsoleState();
  const [runs, setRuns] = useState<AutoRunRecord[]>([]);
  const [summary, setSummary] = useState<AutoRunSummary | null>(null);
  const [deployments, setDeployments] = useState<DeploymentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<AutoRunViewMode>("list");
  const [focusedRunId, setFocusedRunId] = useState<string | null>(null);
  const [actionRunId, setActionRunId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runQuery, setRunQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async (refresh = false, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      // Manual refresh also refreshes PR dispositions; polling remains cheap.
      const data = (await api.listAutoRuns(refresh)) as AutoRunsResponse;
      setRuns(data.autoRuns ?? []);
      setSummary(data.summary ?? null);
      setDeployments(data.deployments ?? null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useVisibleInterval(() => {
    void load(false, true);
  }, 10_000);

  useEffect(() => {
    const refresh = () => void load(false, true);
    window.addEventListener("myagenttool:state-change", refresh);
    return () => window.removeEventListener("myagenttool:state-change", refresh);
  }, [load]);

  useEffect(() => {
    if (!runs.length) return;
    const target = focusQueryTarget(window.location.href, "autoRun");
    if (!target) return;
    setViewMode("list");
    setFocusedRunId(target.id);
    scrollToAutoRun(target.id);
    window.history.replaceState(window.history.state, "", target.nextLocation);
    const timer = window.setTimeout(() => setFocusedRunId(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [runs]);

  const visibleRuns = useMemo(
    () => filterAutoRuns(runs, runQuery, statusFilter),
    [runQuery, runs, statusFilter],
  );
  const attemptMetaById = useMemo(() => buildAutoRunAttemptMap(runs), [runs]);

  const openRun = useCallback((runId: string) => {
    setViewMode("list");
    setFocusedRunId(runId);
    scrollToAutoRun(runId);
  }, []);

  const performRunAction = useCallback(async (runId: string, action: () => Promise<unknown>) => {
    setActionRunId(runId);
    setActionError(null);
    try {
      await action();
      await load(false, true);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("executionUi.actionFailed"));
    } finally {
      setActionRunId(null);
    }
  }, [load, t]);

  return {
    runs,
    visibleRuns,
    summary,
    deployments,
    consoleState,
    loading,
    error,
    actionError,
    viewMode,
    setViewMode,
    focusedRunId,
    actionRunId,
    runQuery,
    setRunQuery,
    statusFilter,
    setStatusFilter,
    attemptMetaById,
    load,
    openRun,
    performRunAction,
  };
}
