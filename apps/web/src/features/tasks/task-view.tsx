import { ConfirmModal } from "@/components/common/confirm-modal";
import { EmptyState } from "@/components/common/empty-state";
import { Field } from "@/components/common/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { api, useAsyncAction } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { branchFromIssue, worktreeLinkFor } from "@/features/projects/worktree-payload";
import { HomeTaskComposer } from "@/features/dashboard/home-task-composer";
import { useCurrentProjectSelection } from "@/hooks/use-current-project-selection";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { installAutoRunTranslations } from "@/lib/i18n/auto-run-resources";
import { installExecutionUiTranslations } from "@/lib/i18n/execution-ui-resources";
import { invocationStatus } from "@/lib/i18n/readable-labels";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { statusTone } from "@/lib/readable-labels";
import { useUiStore } from "@/store/ui-store";
import { githubItemKindLabel, worktreeAutoRunPrompt } from "@myagenttool/protocol/issue-prompt";
import { ExternalLink, FolderKanban, GitBranch, Hand, History, KanbanSquare, Plus, RefreshCw, Workflow, Zap } from "lucide-react";
import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { LocalWorkItemDetail } from "./local-work-item-detail";
import { LocalWorkItemTable } from "./local-work-item-table";
import { PlanningProjectsPanel } from "./planning-projects-panel";
import { ExternalCollaborationMenu } from "./external-collaboration-menu";
import {
  TASK_TABS as TABS,
  type GithubResult,
  type LocalWorkItem,
  type LocalWorkItemResult,
  type PlanningProject,
  type Row,
  type TaskTab,
  type WorkItemAttention,
  type WorkItemAttentionMetrics,
} from "./task-view-types";
import { WorktreeOptionsForm } from "./worktree-options-form";
import { deriveWorkItemUserStatus, type WorkItemUserStatus } from "./work-item-user-status";

export { shouldShowWorkItemCost } from "./task-view-types";

const CreateLocalWorkItemForm = lazy(() => import("./create-local-work-item-form"));
const ExternalIssueImportDialog = lazy(() => import("./external-issue-import-dialog")
  .then((module) => ({ default: module.ExternalIssueImportDialog })));
const WorkItemSummaryView = lazy(() => import("./work-item-summary-view")
  .then((module) => ({ default: module.WorkItemSummaryView })));
const ClaimHistoryList = lazy(() => import("./claim-history-list")
  .then((module) => ({ default: module.ClaimHistoryList })));

installExecutionUiTranslations();
installAutoRunTranslations();
const RoutineBatchQueue = lazy(() => import("./routine-batch-queue")
  .then((module) => ({ default: module.RoutineBatchQueue })));

type LocalTaskQuickFilter = "all" | "needs_action" | "ready_for_review" | "ai_working" | "completed";

const LOCAL_TASK_PRIORITY: Record<WorkItemUserStatus, number> = {
  needs_action: 0,
  ready_for_review: 1,
  blocked: 2,
  ai_working: 3,
  scheduled: 4,
  not_started: 5,
  waiting: 6,
  completed: 7,
};

function matchesLocalTaskFilter(status: WorkItemUserStatus, filter: LocalTaskQuickFilter) {
  return filter === "all" || status === filter;
}

function compareLocalTasksForOrdinaryUsers(left: LocalWorkItem, right: LocalWorkItem) {
  const statusDelta = LOCAL_TASK_PRIORITY[deriveWorkItemUserStatus(left)]
    - LOCAL_TASK_PRIORITY[deriveWorkItemUserStatus(right)];
  if (statusDelta) return statusDelta;
  const leftDue = left.dueDate ?? "9999-12-31";
  const rightDue = right.dueDate ?? "9999-12-31";
  return leftDue.localeCompare(rightDue) || right.updatedAt.localeCompare(left.updatedAt);
}

// Task = GitHub issues/PRs across repo-backed projects, surfaced as work items.
// Mirrors the project's existing per-worktree GitHub list, lifted to a top-level
// board with project/type/search filters.

export function TaskView({ localOnly = false }: { localOnly?: boolean } = {}) {
  const { t, i18n } = useAppTranslation();
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const projectSelection = useCurrentProjectSelection();
  const navigate = usePageNavigation();
  const setSelectedWorkItemSection = useUiStore((s) => s.setSelectedWorkItemSection);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  const setSelectedWorktreeId = useUiStore((s) => s.setSelectedWorktreeId);
  const setSelectedExternalWorkTab = useUiStore((s) => s.setSelectedExternalWorkTab);
  const setSettingsQuery = useUiStore((s) => s.setSettingsQuery);
  const worktrees = state?.worktrees ?? [];
  const invocations = state?.invocations ?? [];
  const [wtRow, setWtRow] = useState<Row | null>(null);
  const projects = useMemo(
    () => (state?.projects ?? []).filter((p) => p.status !== "archived"),
    [state?.projects],
  );

  // A worktree already linked to this item (so the row offers "Open" not "Create").
  function linkedWorktree(row: Row) {
    return worktrees.find((w) => w.projectId === row.projectId && w.link?.type === row.type && w.link?.number === row.number) ?? null;
  }
  // #1143: the issue's active, unexpired claim (develop lease preferred) — the
  // pool signal: who holds this issue right now.
  const issueClaims = state?.issueClaims ?? [];
  function activeClaim(row: Row) {
    const nowMs = Date.now();
    const live = issueClaims.filter(
      (c) =>
        c.projectId === row.projectId &&
        c.issueNumber === row.number &&
        c.status === "active" &&
        (!c.leaseExpiresAt || Date.parse(c.leaseExpiresAt) > nowMs),
    );
    return live.find((c) => c.mode === "develop") ?? live[0] ?? null;
  }
  // Claim/release are advisory-fast: the 700ms state poll reflects the result,
  // and a 409 (someone else holds the develop lease) surfaces on the error line.
  function claimIssueRow(row: Row) {
    void execute(() => api.claimIssue(row.projectId, { issueNumber: row.number }));
  }
  function releaseClaimRow(claimId: string) {
    void execute(() => api.releaseIssueClaim(claimId));
  }
  // #1163: the issue's durable claim history (#1152's issueClaimEvents — who
  // held it and how each hold ended). Server rows are newest-first already.
  const issueClaimEvents = state?.issueClaimEvents ?? [];
  const [historyRow, setHistoryRow] = useState<Row | null>(null);
  function claimHistory(row: Row) {
    return issueClaimEvents.filter((e) => e.projectId === row.projectId && e.issueNumber === row.number);
  }
  // The newest run in a worktree (invocations are newest-first) for its status.
  function latestRun(worktreeId: string) {
    return invocations.find((i) => i.worktreeId === worktreeId) ?? null;
  }
  function openWorktree(worktreeId: string, projectId: string) {
    setSelectedProjectId(projectId);
    setSelectedWorktreeId(worktreeId);
    navigate("projects");
  }
  // GitHub Issues are intake records. They must first become Local Issues;
  // only the Local Issue detail can start a code-writing Agent run.
  function autoRunIssue(row: Row) {
    void execute(async () => {
      if (row.type === "issue") {
        const existing = localRows.find((item) =>
          item.projectId === row.projectId
          && item.externalBindings?.some((binding) =>
            (binding.provider === "github" || binding.kind === "github_issue")
            && binding.number === row.number),
        );
        if (existing) {
          setTab("local");
          setSelectedLocalId(existing.id);
          return existing;
        }
        let created: { workItem: LocalWorkItem };
        try {
          created = await api.createWorkItemFromExternal({
            projectId: row.projectId,
            provider: "github",
            issueNumber: row.number,
            relation: "source",
            isPrimary: true,
            syncPolicy: "manual",
          }) as { workItem: LocalWorkItem };
        } catch (caught) {
          if (caught instanceof ApiError && caught.code === "external_issue_already_linked") {
            const duplicate = caught.details?.workItem as LocalWorkItem | undefined;
            if (duplicate?.id) {
              setLocalRows((current) => [duplicate, ...current.filter((item) => item.id !== duplicate.id)]);
              setTab("local");
              setSelectedLocalId(duplicate.id);
              setImportHandoff({ workItemId: duplicate.id, localRef: duplicate.localRef, provider: "GitHub", duplicate: true });
              return duplicate;
            }
          }
          throw caught;
        }
        setLocalRows((current) => [created.workItem, ...current.filter((item) => item.id !== created.workItem.id)]);
        setTab("local");
        setSelectedLocalId(created.workItem.id);
        setImportHandoff({ workItemId: created.workItem.id, localRef: created.workItem.localRef, provider: "GitHub", duplicate: false });
        setNotice(`${created.workItem.localRef} · ${t("tasks.adoptedLocal")} ✓`);
        return created;
      }
      const r = (await api.startAutoRun(row.projectId, {
        link: worktreeLinkFor(row),
        name: branchFromIssue(row),
      })) as { worktree?: { id: string } };
      if (r.worktree?.id) openWorktree(r.worktree.id, row.projectId);
      return r;
    });
  }
  // Create a paused automation scoped to this item; the user lands on it to tune.
  function automateIssue(row: Row) {
    const kindLabel = githubItemKindLabel(row.type);
    void execute(async () => {
      const r = await api.createAutomation({
        name: `${kindLabel} #${row.number}: ${row.title}`.slice(0, 80),
        projectId: row.projectId,
        branch: "main",
        schedule: { kind: "weekdays", time: "09:00" },
        enabled: false,
        prompt: worktreeAutoRunPrompt({ type: row.type, number: row.number, title: row.title, url: row.url }),
      });
      navigate("automation");
      return r;
    });
  }
  const repoProjectIds = useMemo(
    () => new Set((state?.projectTargets ?? []).filter((t) => t.state === "ready").map((t) => t.projectId)),
    [state?.projectTargets],
  );
  // Only projects with a ready repository can have GitHub items.
  const repoProjects = useMemo(() => projects.filter((p) => repoProjectIds.has(p.id)), [projects, repoProjectIds]);

  const [projectId, setProjectId] = useState<string>("all");
  const [tab, setTab] = useState<TaskTab>("local");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [rows, setRows] = useState<Row[]>([]);
  const [localRows, setLocalRows] = useState<LocalWorkItem[]>([]);
  const [localTaskFilter, setLocalTaskFilter] = useState<LocalTaskQuickFilter>("all");
  const [localNextCursor, setLocalNextCursor] = useState<string | null>(null);
  const [attentionItems, setAttentionItems] = useState<WorkItemAttention[]>([]);
  const [attentionNextCursor, setAttentionNextCursor] = useState<string | null>(null);
  const [attentionMetrics, setAttentionMetrics] = useState<WorkItemAttentionMetrics | null>(null);
  const [externalFunnel, setExternalFunnel] = useState<{
    metrics: { total: number; notStarted: number; running: number; review: number; completed: number; stalled: number };
    stalls: { kind: "execution_failed" | "writeback_pending" | "imported_not_started" | "review_waiting"; workItemId: string; localRef: string; title: string; provider: string; issueNumber: number; since: string }[];
  } | null>(null);
  const [attentionKind, setAttentionKind] = useState("");
  const [attentionSla, setAttentionSla] = useState("");
  const [attentionHandler, setAttentionHandler] = useState("");
  const [showResolvedAttention, setShowResolvedAttention] = useState(false);
  const [selectedAttentionIds, setSelectedAttentionIds] = useState<Set<string>>(new Set());
  const [approvalDecision, setApprovalDecision] = useState<{
    attention: WorkItemAttention; decision: "approve" | "deny";
  } | null>(null);
  const [approvalNote, setApprovalNote] = useState("");
  const [planningProjects, setPlanningProjects] = useState<PlanningProject[]>([]);
  const [planningProjectId, setPlanningProjectId] = useState("all");
  const [createLocalOpen, setCreateLocalOpen] = useState(false);
  const [createLocalDirty, setCreateLocalDirty] = useState(false);
  const [confirmCreateLocalClose, setConfirmCreateLocalClose] = useState(false);
  const [externalImportOpen, setExternalImportOpen] = useState(false);
  const [importHandoff, setImportHandoff] = useState<{
    workItemId: string;
    localRef: string;
    provider: string;
    duplicate: boolean;
    importedCount?: number;
    failedCount?: number;
  } | null>(null);
  const [planningOpen, setPlanningOpen] = useState(false);
  const storedSelectedLocalId = useUiStore((state) => state.selectedWorkItemId);
  const persistSelectedLocalId = useUiStore((state) => state.setSelectedWorkItemId);
  const storedSelectedLocalMode = useUiStore((state) => state.selectedWorkItemMode) ?? "summary";
  const persistSelectedLocalMode = useUiStore((state) => state.setSelectedWorkItemMode);
  const preferredLocalMode = useUiStore((state) => state.workItemDetailPreference) ?? "summary";
  const setComposerDraftTask = useUiStore((state) => state.setComposerDraftTask);
  const [selectedLocalId, setSelectedLocalIdState] = useState<string | null>(storedSelectedLocalId ?? null);
  const [selectedLocalMode, setSelectedLocalModeState] = useState(storedSelectedLocalId ? storedSelectedLocalMode : "summary");
  const setSelectedLocalId = (id: string | null) => {
    setSelectedLocalIdState(id);
    persistSelectedLocalId?.(id);
    if (id) {
      // Routine-bound work exposes its governed step controls only in the
      // expert surface. Keep ordinary tasks on the user's preferred detail
      // mode, while preserving the established routine execution entry point.
      const nextMode = localRows.find((item) => item.id === id)?.routineDefinitionId ? "expert" : preferredLocalMode;
      setSelectedLocalModeState(nextMode);
      persistSelectedLocalMode?.(nextMode);
    }
  };
  const setSelectedLocalMode = (mode: "summary" | "expert") => {
    setSelectedLocalModeState(mode);
    persistSelectedLocalMode?.(mode);
  };
  // URL navigation is applied to the shared store after the first render.
  // Mirror that deep-link state into the task surface so `taskMode=expert`
  // and `taskView=...` open the authoritative detail instead of leaving the
  // modal in its summary default.
  useEffect(() => {
    // A local close already updates the component state. Do not treat a
    // mocked or not-yet-hydrated null store value as an instruction to close
    // a detail the user just opened.
    if (storedSelectedLocalId && storedSelectedLocalId !== selectedLocalId) {
      setSelectedLocalIdState(storedSelectedLocalId);
    }
  }, [selectedLocalId, storedSelectedLocalId]);
  useEffect(() => {
    if (storedSelectedLocalId && selectedLocalMode !== storedSelectedLocalMode) {
      setSelectedLocalModeState(storedSelectedLocalMode);
    }
  }, [selectedLocalMode, storedSelectedLocalId, storedSelectedLocalMode]);
  const [selectedLocalDirty, setSelectedLocalDirty] = useState(false);
  const [confirmSelectedLocalClose, setConfirmSelectedLocalClose] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localLoading, setLocalLoading] = useState(true);
  const [localLoadError, setLocalLoadError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveSyncError, setLiveSyncError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const refresh = () => setNonce((value) => value + 1);
    window.addEventListener("myagenttool:state-change", refresh);
    return () => window.removeEventListener("myagenttool:state-change", refresh);
  }, []);

  const targetProjects = projectId === "all" ? repoProjects : repoProjects.filter((p) => p.id === projectId);
  const updateAttention = (attentionId: string, action: "claim" | "resolve" | "reopen") => {
    void execute(() => api.updateWorkItemAttention([attentionId], action)).then((ok) => {
      if (ok) setNonce((value) => value + 1);
    });
  };
  const updateSelectedAttention = (action: "claim" | "resolve" | "reopen") => {
    const ids = [...selectedAttentionIds];
    if (!ids.length) return;
    void execute(() => api.updateWorkItemAttention(
      ids,
      action,
      "",
      { idempotencyKey: `${action}:${Date.now()}` },
    )).then((ok) => {
      if (ok) {
        setSelectedAttentionIds(new Set());
        setNotice(`${ids.length} · ${action === "claim" ? t("approvals.handle") : action === "reopen" ? t("taskLocal.reopen") : t("tasks.localStatus.done")}`);
        setNonce((value) => value + 1);
      }
    });
  };
  const loadMoreLocal = () => {
    if (!localNextCursor) return;
    void (api.listWorkItems({
      projectId: projectId === "all" ? undefined : projectId,
      planningProjectId: planningProjectId === "all" ? undefined : planningProjectId,
      q: deferredQuery || undefined,
      limit: "100",
      cursor: localNextCursor,
    }) as Promise<LocalWorkItemResult>).then((result) => {
      setLocalRows((current) => [...current, ...result.workItems.filter((item) =>
        !current.some((existing) => existing.id === item.id))]);
      setLocalNextCursor(result.nextCursor ?? null);
    });
  };
  const loadMoreAttention = () => {
    if (!attentionNextCursor) return;
    void (api.listWorkItemAttention({
      projectId: projectId === "all" ? undefined : projectId,
      kind: attentionKind || undefined,
      sla: attentionSla || undefined,
      handler: attentionHandler === "mine" || attentionHandler === "unclaimed" ? attentionHandler : undefined,
      includeResolved: showResolvedAttention ? "1" : undefined,
      limit: "100",
      cursor: attentionNextCursor,
    }) as Promise<{
      items: WorkItemAttention[]; metrics: WorkItemAttentionMetrics;
      nextCursor?: string | null;
    }>).then((result) => {
      setAttentionItems((current) => [...current, ...result.items.filter((item) =>
        !current.some((existing) => existing.id === item.id))]);
      setAttentionMetrics(result.metrics);
      setAttentionNextCursor(result.nextCursor ?? null);
    });
  };
  const decideRecommendedAction = (attention: WorkItemAttention, decision: "approve" | "deny") => {
    setApprovalNote("");
    setApprovalDecision({ attention, decision });
  };
  const submitRecommendedActionDecision = () => {
    if (!approvalDecision || !approvalNote.trim()) return;
    const { attention, decision } = approvalDecision;
    const approvalRequestId = typeof attention.details.approvalRequestId === "string"
      ? attention.details.approvalRequestId
      : "";
    if (!attention.planningProjectId || !approvalRequestId) return;
    void execute(() => api.decidePlanningRecommendedAction(
      attention.planningProjectId!,
      approvalRequestId,
      decision,
      { confirmed: true, note: approvalNote.trim() },
    )).then((ok) => {
      if (ok) {
        setApprovalDecision(null);
        setApprovalNote("");
        setNonce((value) => value + 1);
      }
    });
  };

  useEffect(() => {
    let cancelled = false;
    const selectedProjectId = projectId === "all" ? undefined : projectId;
    setLocalLoading(true);
    setLocalLoadError(false);
    void (api.listWorkItems({
      projectId: selectedProjectId,
      planningProjectId: planningProjectId === "all" ? undefined : planningProjectId,
      q: deferredQuery || undefined,
      limit: "100",
    }) as Promise<LocalWorkItemResult>)
      .then((result) => {
        if (!cancelled) {
          setLocalRows(result.workItems);
          setLocalNextCursor(result.nextCursor ?? null);
          setLocalLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLocalLoadError(true);
          setLocalLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [deferredQuery, projectId, planningProjectId, nonce]);

  useEffect(() => {
    let cancelled = false;
    void (api.getWorkItemExternalIssueFunnel(projectId === "all" ? undefined : projectId) as Promise<typeof externalFunnel>)
      .then((result) => { if (!cancelled) setExternalFunnel(result); })
      .catch(() => { if (!cancelled) setExternalFunnel(null); });
    return () => { cancelled = true; };
  }, [nonce, projectId]);

  useEffect(() => {
    void (api.listWorkItemAttention({
      projectId: projectId === "all" ? undefined : projectId,
      kind: attentionKind || undefined,
      sla: attentionSla || undefined,
      handler: attentionHandler === "mine" || attentionHandler === "unclaimed" ? attentionHandler : undefined,
      includeResolved: showResolvedAttention ? "1" : undefined,
      limit: "100",
    }) as Promise<{
      items: WorkItemAttention[]; metrics: WorkItemAttentionMetrics;
      nextCursor?: string | null;
    }>)
      .then((result) => {
        setAttentionItems(result.items);
        setAttentionMetrics(result.metrics);
        setAttentionNextCursor(result.nextCursor ?? null);
      })
      .catch(() => {
        setAttentionItems([]);
        setAttentionMetrics(null);
        setAttentionNextCursor(null);
      });
  }, [projectId, attentionKind, attentionSla, attentionHandler, showResolvedAttention, nonce]);

  useEffect(() => {
    setSelectedAttentionIds((current) => new Set([...current].filter((id) =>
      attentionItems.some((item) => item.id === id))));
  }, [attentionItems]);

  useVisibleInterval(() => {
    setLiveSyncError(null);
      const latestWorkItemAt = localRows.reduce((latest, item) =>
        !latest || item.updatedAt > latest ? item.updatedAt : latest, "");
      if (latestWorkItemAt) {
        void (api.listWorkItems({
          projectId: projectId === "all" ? undefined : projectId,
          planningProjectId: planningProjectId === "all" ? undefined : planningProjectId,
          q: deferredQuery || undefined,
          updatedSince: latestWorkItemAt,
        }) as Promise<LocalWorkItemResult>).then((result) => {
          setLocalRows((current) => {
            const byId = new Map(current.map((item) => [item.id, item]));
            for (const item of result.workItems) byId.set(item.id, item);
            return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          });
        }).catch(() => setLiveSyncError(t("aiOps.issueRefreshFailed")));
      }
      const latestAttentionAt = attentionItems.reduce((latest, item) => {
        const candidate = item.updatedAt ?? item.createdAt;
        return !latest || candidate > latest ? candidate : latest;
      }, "");
      if (latestAttentionAt && !attentionHandler) {
        void (api.listWorkItemAttention({
          projectId: projectId === "all" ? undefined : projectId,
          kind: attentionKind || undefined,
          sla: attentionSla || undefined,
          includeResolved: "1",
          updatedSince: latestAttentionAt,
        }) as Promise<{ items: WorkItemAttention[]; metrics: WorkItemAttentionMetrics }>).then((result) => {
          setAttentionItems((current) => {
            const byId = new Map(current.map((item) => [item.id, item]));
            for (const item of result.items) byId.set(item.id, item);
            return [...byId.values()].filter((item) => showResolvedAttention || !item.resolution);
          });
          setAttentionMetrics(result.metrics);
        }).catch(() => setLiveSyncError(t("aiOps.attentionRefreshFailed")));
      }
  }, 15_000);

  useEffect(() => {
    void (api.listPlanningProjects() as Promise<{ projects: PlanningProject[] }>)
      .then((result) => setPlanningProjects(result.projects))
      .catch(() => setPlanningProjects([]));
  }, [nonce]);

  useEffect(() => {
    let cancelled = false;
    if (targetProjects.length === 0) {
      setRows([]);
      setNotice(repoProjects.length === 0 ? t("tasks.noRepoProject") : null);
      return;
    }
    setLoading(true);
    setNotice(null);
    Promise.all(
      targetProjects.map((p) =>
        (api.listGithubItems(p.id) as Promise<GithubResult>)
          .then((r) => ({ p, r }))
          .catch(() => ({ p, r: { available: false, message: t("tasks.requestFailed"), items: [] } as GithubResult })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const next: Row[] = [];
      const unavailable: string[] = [];
      for (const { p, r } of results) {
        if (!r.available) unavailable.push(`${p.name}: ${r.message}`);
        for (const item of r.items) next.push({ ...item, projectId: p.id, projectName: p.name });
      }
      next.sort((a, b) => b.number - a.number);
      setRows(next);
      setNotice(next.length === 0 && unavailable.length > 0 ? unavailable.join(" · ") : null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, repoProjects.length, nonce]);

  const visible = rows
    .filter((r) => r.type === tab)
    .filter((r) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return r.title.toLowerCase().includes(q) || String(r.number).includes(q) || r.projectName.toLowerCase().includes(q);
    });
  const localTaskStatusCounts = localRows.reduce<Record<LocalTaskQuickFilter, number>>((counts, item) => {
    const status = deriveWorkItemUserStatus(item);
    counts.all += 1;
    if (status === "needs_action" || status === "ready_for_review" || status === "ai_working" || status === "completed") {
      counts[status] += 1;
    }
    return counts;
  }, { all: 0, needs_action: 0, ready_for_review: 0, ai_working: 0, completed: 0 });
  const visibleLocal = localRows
    .filter((item) => !localOnly || preferredLocalMode !== "summary"
      || matchesLocalTaskFilter(deriveWorkItemUserStatus(item), localTaskFilter))
    .sort(localOnly && preferredLocalMode === "summary" ? compareLocalTasksForOrdinaryUsers : () => 0);
  const taskTabs: readonly TaskTab[] = localOnly ? ["local"] : TABS;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{t("tasks.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("tasks.description")}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={loading}
              onClick={() => setNonce((n) => n + 1)}
              title={t("tasks.refresh")}
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
            {!localOnly ? (
              <Button variant="secondary" size="sm" onClick={() => setPlanningOpen(true)}>
                <FolderKanban className="mr-1 size-4" /> {t("planningProjects.title")}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setCreateLocalOpen(true)}>
              <Plus className="mr-1 size-4" /> {t("tasks.newLocal")}
            </Button>
            <ExternalCollaborationMenu
              onImportIssue={() => setExternalImportOpen(true)}
              onOpenIssueInbox={() => {
                setSelectedExternalWorkTab("issue");
                navigate("externalWork");
              }}
              onOpenChanges={() => {
                setSelectedExternalWorkTab("pr");
                navigate("externalWork");
              }}
              onOpenSettings={() => {
                navigate("settings");
                setSettingsQuery(i18n.language.startsWith("zh") ? "外部 Issue" : "external issue");
              }}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Type tabs */}
          <div className={cn("gap-1 rounded-lg bg-muted p-0.5 text-xs", localOnly && preferredLocalMode === "summary" ? "hidden" : "flex")}>
            {taskTabs.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium transition",
                  tab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(key === "local" ? "tasks.local" : key === "issue" ? "tasks.issues" : "tasks.prs")}
                {(key === "local" ? localRows.length : rows.filter((r) => r.type === key).length) > 0 ? (
                  <span className="ml-1.5 text-muted-foreground">
                    {key === "local" ? localRows.length : rows.filter((r) => r.type === key).length}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label={t("tasks.project")} className="h-8 w-auto text-xs">
            <option value="all">{t("tasks.allProjects")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          {tab === "local" && !localOnly ? (
            <Select value={planningProjectId} onChange={(event) => setPlanningProjectId(event.target.value)}
              aria-label={t("planningProjects.filter")} className="h-8 w-auto text-xs">
              <option value="all">{t("planningProjects.all")}</option>
              {planningProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </Select>
          ) : null}
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("tasks.searchPlaceholder")}
            aria-label={t("tasks.search")}
            className="h-8 max-w-xs text-xs"
          />
        </div>
        {localOnly && preferredLocalMode === "summary" ? (
          <div className="flex flex-wrap items-center gap-2" aria-label={i18n.language.startsWith("zh") ? "按进展筛选任务" : "Filter tasks by progress"}>
            {([
              ["all", i18n.language.startsWith("zh") ? "全部" : "All"],
              ["needs_action", i18n.language.startsWith("zh") ? "需要你处理" : "Needs you"],
              ["ready_for_review", i18n.language.startsWith("zh") ? "等你确认" : "Ready for you"],
              ["ai_working", i18n.language.startsWith("zh") ? "AI 处理中" : "AI working"],
              ["completed", i18n.language.startsWith("zh") ? "已完成" : "Completed"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={localTaskFilter === key}
                onClick={() => setLocalTaskFilter(key)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                  localTaskFilter === key
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                {label} <span className="ml-1 tabular-nums">{localTaskStatusCounts[key]}</span>
              </button>
            ))}
          </div>
        ) : null}
        {localOnly ? (
          <details className="rounded-lg border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium text-muted-foreground">
              {i18n.language.startsWith("zh") ? "更多任务工具" : "More task tools"}
            </summary>
            <div className="mt-2 flex flex-wrap gap-2 border-t border-border pt-2">
              <Button variant="secondary" size="sm" onClick={() => navigate("workBoard")}>
                <KanbanSquare className="mr-1 size-4" /> {t("sections.workBoard.label")}
              </Button>
              {preferredLocalMode === "expert" ? (
                <Button variant="secondary" size="sm" onClick={() => setPlanningOpen(true)}>
                  <FolderKanban className="mr-1 size-4" /> {t("planningProjects.title")}
                </Button>
              ) : null}
            </div>
          </details>
        ) : null}

        {tab !== "local" && notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
        {liveSyncError ? <p className="text-xs text-destructive">{liveSyncError}</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        {tab === "local" ? (
          <>
            {!localOnly && externalFunnel?.metrics?.total ? (
              <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-3" aria-label={i18n.language.startsWith("zh") ? "外部 Issue 执行漏斗" : "External issue execution funnel"}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">{i18n.language.startsWith("zh") ? "外部 Issue 执行漏斗" : "External issue execution funnel"}</h3>
                    <p className="text-xs text-muted-foreground">{i18n.language.startsWith("zh") ? "从导入到执行、审核与回写，停滞超过 24 小时会出现在下方。" : "From intake through execution, review, and writeback. Items stalled over 24 hours appear below."}</p>
                  </div>
                  <Badge tone={externalFunnel.metrics.stalled ? "warning" : "success"}>{externalFunnel.metrics.stalled} {i18n.language.startsWith("zh") ? "项待处理" : "need attention"}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded bg-background p-2"><strong>{externalFunnel.metrics.notStarted}</strong> {i18n.language.startsWith("zh") ? "未开始" : "not started"}</div>
                  <div className="rounded bg-background p-2"><strong>{externalFunnel.metrics.running}</strong> {i18n.language.startsWith("zh") ? "执行中" : "running"}</div>
                  <div className="rounded bg-background p-2"><strong>{externalFunnel.metrics.review}</strong> {i18n.language.startsWith("zh") ? "待审核" : "in review"}</div>
                  <div className="rounded bg-background p-2"><strong>{externalFunnel.metrics.completed}</strong> {i18n.language.startsWith("zh") ? "已完成" : "completed"}</div>
                </div>
                {externalFunnel.stalls.length ? (
                  <div className="grid gap-2 lg:grid-cols-2" aria-live="polite">
                    {externalFunnel.stalls.map((stall) => (
                      <div key={`${stall.workItemId}-${stall.kind}`} className="flex flex-col gap-2 rounded-lg border border-warning/35 bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{stall.localRef} · {stall.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {stall.provider} #{stall.issueNumber} · {stall.kind === "execution_failed"
                              ? i18n.language.startsWith("zh") ? "执行失败" : "execution failed"
                              : stall.kind === "writeback_pending"
                                ? i18n.language.startsWith("zh") ? "等待外部回写" : "writeback pending"
                                : stall.kind === "review_waiting"
                                  ? i18n.language.startsWith("zh") ? "等待审核超过 24 小时" : "review waiting over 24 hours"
                                  : i18n.language.startsWith("zh") ? "导入后超过 24 小时未开始" : "not started within 24 hours of intake"}
                          </p>
                        </div>
                        <Button size="sm" variant="secondary" onClick={() => {
                          setSelectedLocalId(stall.workItemId);
                          if (stall.kind === "writeback_pending" || stall.kind === "execution_failed") {
                            setSelectedWorkItemSection(stall.kind === "writeback_pending" ? "trace" : "process");
                            setSelectedLocalMode("expert");
                          }
                        }}>{i18n.language.startsWith("zh") ? "继续处理" : "Continue"}</Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
            <Suspense fallback={null}>
              <RoutineBatchQueue
                projectId={projectId === "all" ? undefined : projectId}
                onOpen={setSelectedLocalId}
              />
            </Suspense>
            {!localOnly ? <section className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-sm font-semibold">{t("approvals.pending", { count: attentionItems.length })}</h3>
                  <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap">
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox"
                        checked={attentionItems.length > 0 && attentionItems.every((item) => selectedAttentionIds.has(item.id))}
                        onChange={(event) => setSelectedAttentionIds(event.target.checked
                          ? new Set(attentionItems.map((item) => item.id))
                          : new Set())} />
                      {t("evidence.show")}
                    </label>
                    <Select value={attentionKind} onChange={(event) => setAttentionKind(event.target.value)} className="h-7 w-full text-xs">
                      <option value="">{t("evidence.show")}</option>
                      <option value="github_conflict">{t("taskLocal.github.conflict")}</option>
                      <option value="github_deleted">{t("workItemGithub.deleted")}</option>
                      <option value="execution_approval">{t("approvals.kind.invocation_approval")}</option>
                      <option value="execution_input">{i18n.language.startsWith("zh") ? "AI 等待回答" : "AI needs an answer"}</option>
                      <option value="verification_failed">{t("approvals.testsFailed")}</option>
                      <option value="acceptance_blocked">{t("tasks.acceptanceCriteria")}</option>
                      <option value="recommended_action_approval">{t("planningDecision.nextActions")}</option>
                    </Select>
                    <Select value={attentionSla} onChange={(event) => setAttentionSla(event.target.value)} className="h-7 w-full text-xs">
                      <option value="">{t("planningFilters.allStatuses")}</option>
                      <option value="breached">{t("planningSchedule.overdue")}</option>
                      <option value="within_sla">{t("planningExecution.healthy")}</option>
                    </Select>
                    <Select value={attentionHandler} onChange={(event) => setAttentionHandler(event.target.value)} className="h-7 w-full text-xs">
                      <option value="">{t("planningFilters.allStatuses")}</option>
                      <option value="mine">{t("approvals.handling")}</option>
                      <option value="unclaimed">{t("taskLocal.executionState.unclaimed")}</option>
                    </Select>
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={showResolvedAttention}
                        onChange={(event) => setShowResolvedAttention(event.target.checked)} />
                      {t("tasks.localStatus.done")}
                    </label>
                    <Badge tone="warning">{t("evidenceDetails.highCount", { count: attentionItems.filter((item) => item.severity === "high").length })}</Badge>
                  </div>
                </div>
                {attentionMetrics ? (
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div className="rounded bg-background p-2"><strong>{attentionMetrics.backlog}</strong> {t("planningPortfolio.attention")}</div>
                    <div className="rounded bg-background p-2"><strong>{attentionMetrics.breached}</strong> {t("planningSchedule.overdue")}</div>
                    <div className="rounded bg-background p-2"><strong>{attentionMetrics.claimed}</strong> {t("approvals.handling")}</div>
                    <div className="rounded bg-background p-2"><strong>{attentionMetrics.pendingApprovals}</strong> {t("approvals.kind.invocation_approval")}</div>
                  </div>
                ) : null}
                {selectedAttentionIds.size ? (
                  <div className="flex items-center gap-3 rounded border border-border bg-background px-2 py-1 text-xs">
                    <Badge tone="neutral">{selectedAttentionIds.size}</Badge>
                    <button type="button" className="text-primary hover:underline" onClick={() => updateSelectedAttention("claim")}>
                      {t("approvals.handle")}
                    </button>
                    <button type="button" className="text-primary hover:underline" onClick={() => updateSelectedAttention("resolve")}>
                      {t("tasks.localStatus.done")}
                    </button>
                    {showResolvedAttention ? (
                      <button type="button" className="text-primary hover:underline" onClick={() => updateSelectedAttention("reopen")}>
                        {t("taskLocal.reopen")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <div className="grid gap-2 lg:grid-cols-2">
                  {attentionItems.map((attention) => (
                    <div key={attention.id}
                      className="flex items-center gap-2 rounded border border-border bg-background p-2 text-left text-xs">
                      <input type="checkbox" checked={selectedAttentionIds.has(attention.id)}
                        onChange={(event) => setSelectedAttentionIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(attention.id);
                          else next.delete(attention.id);
                          return next;
                        })} />
                      <Badge tone={attention.severity === "high" ? "danger" : attention.severity === "medium" ? "warning" : "neutral"}>
                        {attention.kind === "github_conflict" ? t("taskLocal.github.conflict")
                          : attention.kind === "github_deleted" ? t("workItemGithub.deleted")
                          : attention.kind === "execution_approval" ? t("approvals.kind.invocation_approval")
                          : attention.kind === "execution_input" ? i18n.language.startsWith("zh") ? "AI 等待回答" : "AI needs an answer"
                          : attention.kind === "verification_failed" ? t("approvals.testsFailed")
                          : attention.kind === "acceptance_blocked" ? t("tasks.acceptanceCriteria")
                          : t("planningDecision.nextActions")}
                      </Badge>
                      <span className="font-mono">{attention.localRef ?? "—"}</span>
                      <span className="truncate">{attention.title}</span>
                      {attention.kind === "recommended_action_approval" ? (
                        <span className="max-w-48 truncate text-muted-foreground"
                          title={JSON.stringify({ parameters: attention.details.parameters, context: attention.details.context }, null, 2)}>
                          {String(attention.details.code ?? "")}
                          {typeof (attention.details.context as { affectedCount?: unknown } | undefined)?.affectedCount === "number"
                            ? ` · ${(attention.details.context as { affectedCount: number }).affectedCount}`
                            : ""}
                        </span>
                      ) : null}
                      <span className={attention.slaStatus === "breached" ? "text-destructive" : "text-muted-foreground"}>
                        {new Date(attention.dueAt).toLocaleString()}
                      </span>
                      {attention.workItemId ? (
                        <button type="button" className="text-primary hover:underline" onClick={() => setSelectedLocalId(attention.workItemId)}>
                          {t("approvals.open")}
                        </button>
                      ) : null}
                      {attention.kind === "recommended_action_approval" ? (
                        <>
                          <button type="button" className="text-primary hover:underline" onClick={() => decideRecommendedAction(attention, "approve")}>
                            {t("approvals.approve")}
                          </button>
                          <button type="button" className="text-destructive hover:underline" onClick={() => decideRecommendedAction(attention, "deny")}>
                            {t("approvals.deny")}
                          </button>
                        </>
                      ) : null}
                      <button type="button" className="text-primary hover:underline" onClick={() => updateAttention(attention.id, "claim")}>
                        {attention.handling ? attention.handling.actorId : t("approvals.handle")}
                      </button>
                      {attention.handling?.expiresAt ? (
                        <span className="text-muted-foreground">{new Date(attention.handling.expiresAt).toLocaleTimeString()}</span>
                      ) : null}
                      {attention.resolution ? (
                        <button type="button" className="text-primary hover:underline"
                          onClick={() => updateAttention(attention.id, "reopen")}>
                          {t("taskLocal.reopen")}
                        </button>
                      ) : (
                        <button type="button" className="text-primary hover:underline" onClick={() => updateAttention(attention.id, "resolve")}>
                          {t("tasks.localStatus.done")}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {!attentionItems.length ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">{t("approvals.empty")}</p>
                ) : null}
                {attentionNextCursor ? (
                  <Button variant="secondary" size="sm" onClick={loadMoreAttention}>{t("applicationInspectorDeep.showAll", { count: 100 })}</Button>
                ) : null}
            </section> : null}
            {localLoadError ? (
              <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-8 text-center">
                <p className="text-sm font-medium">{i18n.language.startsWith("zh") ? "任务加载失败，已有任务没有丢失。" : "Tasks could not be loaded. Your existing tasks are still safe."}</p>
                <Button variant="secondary" size="sm" onClick={() => setNonce((value) => value + 1)}>
                  <RefreshCw className="mr-1 size-4" />{i18n.language.startsWith("zh") ? "重新加载" : "Retry"}
                </Button>
              </div>
            ) : localLoading && !localRows.length ? (
              <p role="status" className="py-8 text-center text-sm text-muted-foreground">{t("tasks.loading")}</p>
            ) : (
              <LocalWorkItemTable
                items={visibleLocal}
                projects={projects}
                simple={localOnly && preferredLocalMode === "summary"}
                emptyTitle={t("tasks.noLocalIssues")}
                emptyHint={t("tasks.noLocalMatches")}
                onOpen={setSelectedLocalId}
              />
            )}
            {localNextCursor && !localLoadError ? (
              <Button variant="secondary" size="sm" onClick={loadMoreLocal}>{t("applicationInspectorDeep.showAll", { count: 100 })}</Button>
            ) : null}
          </>
        ) : visible.length === 0 ? (
          <EmptyState
            title={loading ? t("tasks.loading") : t(tab === "pr" ? "tasks.noPrs" : "tasks.noIssues")}
            hint={loading ? t("tasks.fetching") : t("tasks.noMatches")}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">{t("tasks.titleContext")}</th>
                  <th className="px-3 py-2 font-medium">{t("tasks.author")}</th>
                  <th className="px-3 py-2 font-medium">{t("tasks.state")}</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={`${r.projectId}:${r.type}:${r.number}`} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">#{r.number}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.title}</div>
                      <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                        <span>{r.projectName}</span>
                        {r.headRefName ? <span className="font-mono">· {r.headRefName}</span> : null}
                        {(() => {
                          const wt = linkedWorktree(r);
                          if (!wt) return null;
                          const run = latestRun(wt.id);
                          return (
                            <span className="inline-flex items-center gap-1">
                              <GitBranch className="size-3 opacity-70" />
                              <span className="font-mono">{wt.branch}</span>
                              {run ? <Badge tone={statusTone(run.status)}>{invocationStatus(t, run.status)}</Badge> : null}
                            </span>
                          );
                        })()}
                        {(() => {
                          if (r.type !== "issue") return null;
                          const claim = activeClaim(r);
                          return claim ? (
                            <Badge tone={claim.mode === "develop" ? "warning" : "neutral"} className="shrink-0">
                              <Hand className="mr-1 size-3" />
                              {t(claim.mode === "develop" ? "tasks.claimed" : "tasks.reviewing")} · {claim.claimedBy}
                            </Badge>
                          ) : null;
                        })()}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.author || "—"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={r.state === "open" ? "success" : r.state === "merged" ? "neutral" : "warning"}>{r.state}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {r.type === "issue" && claimHistory(r).length > 0 ? (
                          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setHistoryRow(r)} title={t("taskActions.claimHistoryHint")}>
                            <History className="size-3.5" />
                          </Button>
                        ) : null}
                        {(() => {
                          if (r.type !== "issue" || r.state !== "open") return null;
                          const claim = activeClaim(r);
                          return claim ? (
                            <Button variant="ghost" size="sm" disabled={pending} onClick={() => releaseClaimRow(claim.id)} title={t("taskActions.releaseHint", { owner: claim.claimedBy })}>
                              <Hand className="mr-1 size-3.5" /> {t("taskActions.release")}
                            </Button>
                          ) : (
                            <Button variant="secondary" size="sm" disabled={pending} onClick={() => claimIssueRow(r)} title={t("taskActions.claimHint")}>
                              <Hand className="mr-1 size-3.5" /> {t("taskActions.claim")}
                            </Button>
                          );
                        })()}
                        <Button variant="secondary" size="sm" disabled={pending} onClick={() => automateIssue(r)} title={t("taskActions.automateHint")}>
                          <Workflow className="mr-1 size-3.5" /> {t("tasks.automate")}
                        </Button>
                        {(() => {
                          if (r.type === "issue") {
                            const local = localRows.find((item) =>
                              item.projectId === r.projectId
                              && item.externalBindings?.some((binding) =>
                                (binding.provider === "github" || binding.kind === "github_issue")
                                && binding.number === r.number),
                            );
                            return local ? (
                              <Button variant="secondary" size="sm" disabled={pending} onClick={() => {
                                setTab("local");
                                setSelectedLocalId(local.id);
                              }} title={t("taskActions.openLocalHint")}>
                                <Plus className="mr-1 size-3.5" /> {t("tasks.openLocal")}
                              </Button>
                            ) : (
                              <Button size="sm" disabled={pending} onClick={() => autoRunIssue(r)} title={t("taskActions.adoptLocalHint")}>
                                <Plus className="mr-1 size-3.5" /> {t("tasks.adoptLocal")}
                              </Button>
                            );
                          }
                          const wt = linkedWorktree(r);
                          return wt ? (
                            <Button variant="secondary" size="sm" onClick={() => openWorktree(wt.id, r.projectId)} title={`Open worktree ${wt.branch}`}>
                              <GitBranch className="mr-1 size-3.5" /> {t("tasks.open")}
                            </Button>
                          ) : (
                            <>
                              <Button size="sm" disabled={pending} onClick={() => autoRunIssue(r)} title={t("taskActions.autoHint")}>
                                <Zap className="mr-1 size-3.5" /> {t("tasks.auto")}
                              </Button>
                              <Button variant="secondary" size="sm" disabled={pending} onClick={() => setWtRow(r)} title={t("taskActions.worktreeHint")}>
                                <GitBranch className="mr-1 size-3.5" /> {t("tasks.worktree")}
                              </Button>
                            </>
                          );
                        })()}
                        {r.url ? (
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                            title={t("tasks.openGithub")}
                          >
                            <ExternalLink className="size-4" />
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Modal open={Boolean(historyRow)} onClose={() => setHistoryRow(null)} title={historyRow ? t("tasks.claimHistoryId", { number: historyRow.number }) : t("tasks.claimHistory")}>
        {historyRow ? (
          <Suspense fallback={null}>
            <ClaimHistoryList events={claimHistory(historyRow)} />
          </Suspense>
        ) : null}
      </Modal>

      <Modal
        open={createLocalOpen}
        onClose={() => createLocalDirty ? setConfirmCreateLocalClose(true) : setCreateLocalOpen(false)}
        title={t("tasks.newLocal")}
        size="xl"
      >
        {createLocalOpen ? (
          localOnly ? (
            <HomeTaskComposer
              inline
              showTrigger={false}
              projectId={state?.currentProjectId ?? projects[0]?.id ?? null}
              projectName={projects.find((item) => item.id === (state?.currentProjectId ?? projects[0]?.id))?.name}
              projects={projects.map((item) => ({ id: item.id, name: item.name }))}
              onProjectChange={(nextProjectId) => projectSelection.selectProject(nextProjectId, state?.currentProjectId)}
              projectError={projectSelection.error}
              unavailable={!state}
              onCreated={() => {
                setCreateLocalDirty(false);
                setTab("local");
                setNonce((value) => value + 1);
              }}
              onDirtyChange={setCreateLocalDirty}
              onOpenTask={(workItemId) => {
                setCreateLocalOpen(false);
                setTab("local");
                setSelectedLocalId(workItemId);
              }}
              onOpenSetup={(section) => navigate(section)}
              onOpenProjects={() => {
                setCreateLocalOpen(false);
                navigate("projects");
              }}
            />
          ) : (
            <Suspense fallback={null}>
              <CreateLocalWorkItemForm
                projects={projects}
                users={state?.users ?? []}
                initialProjectId={projectId === "all" ? projects[0]?.id ?? "" : projectId}
                onDone={() => {
                  setCreateLocalOpen(false);
                  setTab("local");
                  setNonce((value) => value + 1);
                }}
              />
            </Suspense>
          )
        ) : null}
      </Modal>
      <ConfirmModal
        open={confirmCreateLocalClose}
        title={i18n.language.startsWith("zh") ? "放弃未保存的任务？" : "Discard this unsaved task?"}
        description={i18n.language.startsWith("zh") ? "关闭后，当前填写的任务内容将不会保留。" : "Closing will discard the task details you entered."}
        confirmLabel={i18n.language.startsWith("zh") ? "放弃并关闭" : "Discard and close"}
        destructive
        onClose={() => setConfirmCreateLocalClose(false)}
        onConfirm={() => {
          setConfirmCreateLocalClose(false);
          setCreateLocalDirty(false);
          setCreateLocalOpen(false);
        }}
      />

      {externalImportOpen ? (
        <Suspense fallback={null}>
          <ExternalIssueImportDialog
            open
            projects={projects}
            repoProjectIds={repoProjectIds}
            initialProjectId={projectId === "all" ? projects[0]?.id : projectId}
            onClose={() => setExternalImportOpen(false)}
            onImported={(workItem, context) => {
              setLocalRows((current) => [workItem, ...current.filter((item) => item.id !== workItem.id)]);
              setExternalImportOpen(false);
              setTab("local");
              setSelectedLocalId(workItem.id);
              setImportHandoff({
                workItemId: workItem.id,
                localRef: workItem.localRef,
                provider: context.provider === "github" ? "GitHub" : context.provider === "gitlab" ? "GitLab" : "Gitea",
                duplicate: context.duplicate,
                importedCount: context.importedCount,
                failedCount: context.failedCount,
              });
              setNonce((value) => value + 1);
            }}
          />
        </Suspense>
      ) : null}

      <Modal open={planningOpen} onClose={() => setPlanningOpen(false)} title={t("planningProjects.title")}>
        <div className="mb-3 flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => { setPlanningOpen(false); navigate("planning"); }}>
            <FolderKanban className="mr-1 size-4" />{t("planningWorkspace.title")}
          </Button>
        </div>
        <PlanningProjectsPanel onChanged={() => setNonce((value) => value + 1)} />
      </Modal>

      <Modal open={Boolean(selectedLocalId)} onClose={() => {
        if (selectedLocalDirty) setConfirmSelectedLocalClose(true);
        else setSelectedLocalId(null);
      }} title={t("taskLocal.details")} size={selectedLocalMode === "expert" ? "full" : "2xl"}>
        {selectedLocalId ? (
          <div className="space-y-4">
            {importHandoff?.workItemId === selectedLocalId ? (
              <div className="flex flex-col gap-2 rounded-lg border border-success/35 bg-success/[0.06] p-3 text-sm sm:flex-row sm:items-center sm:justify-between" role="status">
                <div>
                  <p className="font-medium">
                    {importHandoff.duplicate
                      ? i18n.language.startsWith("zh")
                        ? `该 ${importHandoff.provider} Issue 已属于 ${importHandoff.localRef}，已为你打开原任务。`
                        : `That ${importHandoff.provider} issue already belongs to ${importHandoff.localRef}; the existing task is open.`
                      : importHandoff.importedCount && importHandoff.importedCount > 1
                        ? i18n.language.startsWith("zh")
                          ? `已从 ${importHandoff.provider} 导入 ${importHandoff.importedCount} 个 Issue，并打开 ${importHandoff.localRef}。`
                          : `${importHandoff.importedCount} issues were imported from ${importHandoff.provider}; ${importHandoff.localRef} is open.`
                        : i18n.language.startsWith("zh")
                          ? `${importHandoff.localRef} 已从 ${importHandoff.provider} 导入。`
                          : `${importHandoff.localRef} was imported from ${importHandoff.provider}.`}
                  </p>
                  {!importHandoff.duplicate ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {i18n.language.startsWith("zh")
                        ? "下一步：确认任务目标和参考材料，然后点击“交给 AI 开始处理”。"
                        : "Next: review the goal and reference materials, then choose “Let AI start”."}
                    </p>
                  ) : null}
                  {importHandoff.failedCount ? (
                    <p className="mt-1 text-xs text-destructive" role="alert">
                      {i18n.language.startsWith("zh")
                        ? `${importHandoff.failedCount} 个 Issue 导入失败；请重新打开导入窗口后重试。`
                        : `${importHandoff.failedCount} issues failed to import; reopen the importer to retry them.`}
                    </p>
                  ) : null}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setImportHandoff(null)}>
                  {i18n.language.startsWith("zh") ? "知道了" : "Got it"}
                </Button>
              </div>
            ) : null}
            {selectedLocalMode === "summary" ? (
              <>
                <Suspense fallback={<p className="text-sm text-muted-foreground">{t("tasks.loading")}</p>}>
                  <WorkItemSummaryView
                    workItemId={selectedLocalId}
                    onDirtyChange={setSelectedLocalDirty}
                    onOpenSetup={(section) => {
                      navigate(section);
                    }}
                    onOpenExpert={(section = "overview") => {
                      setSelectedWorkItemSection(section);
                      setSelectedLocalMode("expert");
                    }}
                    onOpenWorkItem={(id) => {
                      setSelectedLocalId(id);
                      setSelectedLocalMode("summary");
                    }}
                    onCreateTaskDraft={(draft) => {
                      setComposerDraftTask(draft);
                      setSelectedLocalId(null);
                      navigate("dashboard");
                    }}
                  />
                </Suspense>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" disabled={selectedLocalDirty} onClick={() => setSelectedLocalMode("summary")}>
                  ← {i18n.language.startsWith("zh") ? "返回任务摘要" : "Back to task summary"}
                </Button>
                <LocalWorkItemDetail
                  workItemId={selectedLocalId}
                  projects={projects}
                  onDirtyChange={setSelectedLocalDirty}
                  onChanged={() => setNonce((value) => value + 1)}
                />
              </>
            )}
          </div>
        ) : null}
      </Modal>
      <ConfirmModal
        open={confirmSelectedLocalClose}
        title={t("taskLocal.details")}
        description={t("officeEditors.unsaved")}
        destructive
        onClose={() => setConfirmSelectedLocalClose(false)}
        onConfirm={() => {
          setConfirmSelectedLocalClose(false);
          setSelectedLocalDirty(false);
          setSelectedLocalId(null);
        }}
      />

      <Modal open={Boolean(approvalDecision)} onClose={() => setApprovalDecision(null)}
        title={approvalDecision?.decision === "approve" ? t("approvals.approve") : t("approvals.deny")}>
        {approvalDecision ? (
          <div className="space-y-3">
            <div className="space-y-2 rounded border border-border bg-muted/30 p-3 text-xs">
              <p className="font-medium">{approvalDecision.attention.title}</p>
              <p className="mt-1 font-mono">{String(approvalDecision.attention.details.code ?? "")}</p>
              {(() => {
                const context = approvalDecision.attention.details.context as Record<string, unknown> | undefined;
                return context ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="text-muted-foreground">{t("applicationInspectorDeep.risk")}</span><strong className="block">{String(context.risk ?? "—")}</strong></div>
                    <div><span className="text-muted-foreground">{t("applicationInspectorDeep.result")}</span><strong className="block">{String(context.impactScope ?? "—")}</strong></div>
                    <div><span className="text-muted-foreground">{t("applicationInspectorDeep.actionCount", { count: Number(context.affectedCount ?? 0) })}</span><strong className="block">{String(context.affectedCount ?? 0)}</strong></div>
                    <div><span className="text-muted-foreground">{t("evidenceDetails.evidence")}</span><strong className="block">{String(context.reasonCode ?? "—")}</strong></div>
                  </div>
                ) : null;
              })()}
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-muted-foreground">
                {JSON.stringify(approvalDecision.attention.details.parameters ?? {}, null, 2)}
              </pre>
            </div>
            <Field label={t("taskLocal.comment")}>
              <Textarea value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)}
                placeholder={t("taskLocal.commentPlaceholder")} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setApprovalDecision(null)}>
                {t("shared.cancel")}
              </Button>
              <Button size="sm" variant={approvalDecision.decision === "deny" ? "destructive" : "primary"}
                disabled={!approvalNote.trim() || pending} onClick={submitRecommendedActionDecision}>
                {approvalDecision.decision === "approve" ? t("approvals.approve") : t("approvals.deny")}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={Boolean(wtRow)} onClose={() => setWtRow(null)} title={wtRow ? t("tasks.worktreeFor", { number: wtRow.number }) : t("tasks.worktree")}>
        {wtRow ? (
          <WorktreeOptionsForm
            row={wtRow}
            onDone={(wt) => {
              setWtRow(null);
              if (wt) openWorktree(wt.id, wt.projectId);
            }}
          />
        ) : null}
      </Modal>
    </Card>
  );
}

export { LocalWorkItemDetail, PlanningProjectsPanel };
