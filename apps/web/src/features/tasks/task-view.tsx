import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Hand, History, RefreshCw, ExternalLink, GitBranch, GitPullRequest, Workflow, Zap, Plus, MessageSquare, Trash2, Pencil, FolderKanban, ArrowUp, ArrowDown, Star, Bell, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarkdownBlock } from "@/components/ui/markdown-block";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/common/empty-state";
import { ConfirmModal } from "@/components/common/confirm-modal";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { type WorkItemSection, useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { statusTone } from "@/lib/readable-labels";
import { invocationStatus } from "@/lib/i18n/readable-labels";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { installExecutionUiTranslations } from "@/lib/i18n/execution-ui-resources";
import { installAutoRunTranslations } from "@/lib/i18n/auto-run-resources";
import { branchFromIssue, worktreeLinkFor } from "@/features/projects/worktree-payload";
import { githubItemKindLabel, worktreeAutoRunPrompt } from "@myagenttool/protocol/issue-prompt";
import {
  downloadPlanningExport,
  parsePlanningProjectSnapshot,
  planningExportFilename,
  planningProjectCsv,
  planningProjectJson,
} from "@/features/planning/planning-export";
import {
  TASK_TABS as TABS,
  type GithubResult,
  type LocalWorkItem,
  type LocalWorkItemObservability,
  type LocalWorkItemResult,
  type PlanningAutoRun,
  type PlanningProject,
  type Row,
  type TaskTab,
  type WorkItemActivity,
  type WorkItemAttention,
  type WorkItemAttentionMetrics,
  type WorkItemComment,
  type WorkItemAutoRunBatch,
} from "./task-view-types";
import { WorkItemSectionNav } from "./work-item-section-nav";
import { useSafeNavigation } from "@/hooks/use-safe-navigation";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { WorktreeOptionsForm } from "./worktree-options-form";
import { WorkItemExecutionActions } from "./work-item-execution-actions";
import { WorkItemTraceLinks } from "./work-item-trace-links";
import { workItemBatchApi } from "./work-item-batch-api";
import type {
  ArticleAnalysis,
  ArticleDerivative,
  ArticleDerivativeRequest,
  ArticleImportJob,
  ArticleSimilarityMatch,
  ArticleSimilaritySearch,
} from "./article-workflow-types";
import { articleApi } from "./article-workflow-api";
import { useArticleTaskLabels } from "./article-task-labels";
import { ApiError } from "@/lib/api-client";
import {
  DEFAULT_WORK_ITEM_FOLLOW_UP_DRAFT,
  followUpDraftEquals,
  followUpDraftFromWorkItem,
  followUpPayload,
  validateFollowUpDraft,
  type WorkItemFollowUpDraft,
} from "./work-item-follow-up-model";

export { shouldShowWorkItemCost } from "./task-view-types";

const ArticleWorkflowDialogs = lazy(() => import("./article-workflow-dialogs"));
const CreateLocalWorkItemForm = lazy(() => import("./create-local-work-item-form"));
const WorkItemFollowUpFields = lazy(() => import("./work-item-follow-up-fields")
  .then((module) => ({ default: module.WorkItemFollowUpFields })));
const WorkItemFollowUpSummary = lazy(() => import("./work-item-follow-up-fields")
  .then((module) => ({ default: module.WorkItemFollowUpSummary })));
const WorkItemProgressDialog = lazy(() => import("./work-item-progress-dialog"));
const WorkItemReportSection = lazy(() => import("./work-item-report-section"));
const WorkItemExternalSync = lazy(() => import("./work-item-external-sync")
  .then((module) => ({ default: module.WorkItemExternalSync })));
const ExternalIssueImportDialog = lazy(() => import("./external-issue-import-dialog")
  .then((module) => ({ default: module.ExternalIssueImportDialog })));
const WorkItemSummaryView = lazy(() => import("./work-item-summary-view")
  .then((module) => ({ default: module.WorkItemSummaryView })));
const WorkItemAlertAndCostDetails = lazy(() => import("./work-item-observability")
  .then((module) => ({ default: module.WorkItemAlertAndCostDetails })));
const WorkItemAssetChain = lazy(() => import("./work-item-observability")
  .then((module) => ({ default: module.WorkItemAssetChain })));
const WorkItemTimeline = lazy(() => import("./work-item-observability")
  .then((module) => ({ default: module.WorkItemTimeline })));
const WorkItemTraceSummary = lazy(() => import("./work-item-observability")
  .then((module) => ({ default: module.WorkItemTraceSummary })));
const ClaimHistoryList = lazy(() => import("./claim-history-list")
  .then((module) => ({ default: module.ClaimHistoryList })));

installExecutionUiTranslations();
installAutoRunTranslations();
const RoutineBatchQueue = lazy(() => import("./routine-batch-queue")
  .then((module) => ({ default: module.RoutineBatchQueue })));
const RoutineWorkController = lazy(() => import("./routine-work-controller"));
const WorkItemAcceptanceSection = lazy(() => import("./work-item-acceptance-section")
  .then((module) => ({ default: module.WorkItemAcceptanceSection })));

// Task = GitHub issues/PRs across repo-backed projects, surfaced as work items.
// Mirrors the project's existing per-worktree GitHub list, lifted to a top-level
// board with project/type/search filters.
export function TaskView({ localOnly = false }: { localOnly?: boolean } = {}) {
  const { t, i18n } = useAppTranslation();
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const setSection = useUiStore((s) => s.setSection);
  const navigate = usePageNavigation();
  const setSelectedWorkItemSection = useUiStore((s) => s.setSelectedWorkItemSection);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  const setSelectedWorktreeId = useUiStore((s) => s.setSelectedWorktreeId);
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
    setSection("projects");
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
      setSection("automation");
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
  const [rows, setRows] = useState<Row[]>([]);
  const [localRows, setLocalRows] = useState<LocalWorkItem[]>([]);
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
  const [externalImportOpen, setExternalImportOpen] = useState(false);
  const [importHandoff, setImportHandoff] = useState<{
    workItemId: string;
    localRef: string;
    provider: string;
    duplicate: boolean;
    importedCount?: number;
    failedCount?: number;
  } | null>(null);
  const [createArticleImportActive, setCreateArticleImportActive] = useState(false);
  const [planningOpen, setPlanningOpen] = useState(false);
  const storedSelectedLocalId = useUiStore((state) => state.selectedWorkItemId);
  const persistSelectedLocalId = useUiStore((state) => state.setSelectedWorkItemId);
  const storedSelectedLocalMode = useUiStore((state) => state.selectedWorkItemMode) ?? "summary";
  const detailPreference = useUiStore((state) => state.workItemDetailPreference) ?? "summary";
  const persistSelectedLocalMode = useUiStore((state) => state.setSelectedWorkItemMode);
  const persistDetailPreference = useUiStore((state) => state.setWorkItemDetailPreference);
  const [selectedLocalId, setSelectedLocalIdState] = useState<string | null>(storedSelectedLocalId ?? null);
  const [selectedLocalMode, setSelectedLocalModeState] = useState(storedSelectedLocalId ? storedSelectedLocalMode : detailPreference);
  const setSelectedLocalId = (id: string | null) => {
    setSelectedLocalIdState(id);
    persistSelectedLocalId?.(id);
    if (id) {
      // Routine-bound work exposes its governed step controls only in the
      // expert surface. Keep ordinary tasks on the user's preferred detail
      // mode, while preserving the established routine execution entry point.
      const nextMode = localRows.find((item) => item.id === id)?.routineDefinitionId
        ? "expert"
        : detailPreference;
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
    void (api.listWorkItems({
      projectId: selectedProjectId,
      planningProjectId: planningProjectId === "all" ? undefined : planningProjectId,
      limit: "100",
    }) as Promise<LocalWorkItemResult>)
      .then((result) => {
        if (!cancelled) {
          setLocalRows(result.workItems);
          setLocalNextCursor(result.nextCursor ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLocalRows([]);
          setLocalNextCursor(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, planningProjectId, nonce]);

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
  const visibleLocal = localRows.filter((item) => {
    const q = query.trim().toLowerCase();
    const projectName = projects.find((project) => project.id === item.projectId)?.name ?? "";
    return !q || `${item.localRef} ${item.title} ${item.labels.join(" ")} ${projectName}`.toLowerCase().includes(q);
  });
  const taskTabs: readonly TaskTab[] = localOnly ? ["local"] : TABS;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{t("tasks.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("tasks.description")}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => setNonce((n) => n + 1)}
            title={t("tasks.refresh")}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPlanningOpen(true)}>
            <FolderKanban className="mr-1 size-4" /> {t("planningProjects.title")}
          </Button>
          {localOnly ? (
            <Button variant="secondary" size="sm" onClick={() => navigate("externalWork")}>
              <GitPullRequest className="mr-1 size-4" /> {t("externalWork.title")}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setExternalImportOpen(true)}>
              <Download className="mr-1 size-4" /> {i18n.language.startsWith("zh") ? "导入外部 Issue" : "Import external issue"}
            </Button>
          )}
          <Button size="sm" onClick={() => setCreateLocalOpen(true)}>
            <Plus className="mr-1 size-4" /> {t("tasks.newLocal")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Type tabs */}
          <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs">
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
          {tab === "local" ? (
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

        {tab !== "local" && notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
        {liveSyncError ? <p className="text-xs text-destructive">{liveSyncError}</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        {tab === "local" ? (
          <>
            {externalFunnel?.metrics?.total ? (
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
            <section className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
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
            </section>
            <LocalWorkItemTable
              items={visibleLocal}
              projects={projects}
              emptyTitle={t("tasks.noLocalIssues")}
              emptyHint={t("tasks.noLocalMatches")}
              onOpen={setSelectedLocalId}
            />
            {localNextCursor ? (
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
        onClose={() => {
          if (!createArticleImportActive) setCreateLocalOpen(false);
        }}
        title={t("tasks.newLocal")}
        closeDisabled={createArticleImportActive}
      >
        {createLocalOpen ? (
          <Suspense fallback={null}>
            <CreateLocalWorkItemForm
              projects={projects}
              users={state?.users ?? []}
              initialProjectId={projectId === "all" ? projects[0]?.id ?? "" : projectId}
              onImportActivityChange={setCreateArticleImportActive}
              onDone={() => {
                setCreateArticleImportActive(false);
                setCreateLocalOpen(false);
                setTab("local");
                setNonce((value) => value + 1);
              }}
            />
          </Suspense>
        ) : null}
      </Modal>

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
          <Button variant="secondary" size="sm" onClick={() => { setPlanningOpen(false); setSection("planning"); }}>
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
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1" aria-label={i18n.language.startsWith("zh") ? "详情显示方式" : "Detail display mode"}>
              <Button size="sm" disabled={selectedLocalDirty && selectedLocalMode !== "summary"} variant={selectedLocalMode === "summary" ? "secondary" : "ghost"} aria-pressed={selectedLocalMode === "summary"} onClick={() => setSelectedLocalMode("summary")}>
                {i18n.language.startsWith("zh") ? "简洁详情" : "Simple details"}
              </Button>
              <Button size="sm" disabled={selectedLocalDirty && selectedLocalMode !== "expert"} variant={selectedLocalMode === "expert" ? "secondary" : "ghost"} aria-pressed={selectedLocalMode === "expert"} onClick={() => setSelectedLocalMode("expert")}>
                {i18n.language.startsWith("zh") ? "专业详情" : "Expert details"}
              </Button>
            </div>
            {detailPreference !== selectedLocalMode ? (
              <Button size="sm" variant="ghost" onClick={() => persistDetailPreference?.(selectedLocalMode)}>
                {i18n.language.startsWith("zh") ? "设为默认视图" : "Make this my default"}
              </Button>
            ) : null}
            {selectedLocalMode === "summary" ? (
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
                />
              </Suspense>
            ) : (
              <LocalWorkItemDetail
                workItemId={selectedLocalId}
                projects={projects}
                onDirtyChange={setSelectedLocalDirty}
                onChanged={() => setNonce((value) => value + 1)}
              />
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

export function PlanningProjectsPanel({ onChanged = () => {} }: { onChanged?: () => void }) {
  const { t, i18n } = useAppTranslation();
  const plannedDateLabel = i18n.language.startsWith("zh") ? "AI 执行日期" : "AI execution date";
  const { data: consoleState } = useConsoleState();
  const setSection = useUiStore((state) => state.setSection);
  const { execute, pending, error } = useAsyncAction();
  const [projects, setProjects] = useState<PlanningProject[]>([]);
  const [workItems, setWorkItems] = useState<LocalWorkItem[]>([]);
  const [autoRuns, setAutoRuns] = useState<PlanningAutoRun[]>([]);
  const [autoRunBatches, setAutoRunBatches] = useState<WorkItemAutoRunBatch[]>([]);
  const [batchConcurrency, setBatchConcurrency] = useState("2");
  const [batchAgentId, setBatchAgentId] = useState("");
  const storedSelectedId = useUiStore((state) => state.selectedPlanningProjectId) ?? "";
  const storeSelectedId = useUiStore((state) => state.setSelectedPlanningProjectId);
  const [selectedId, setSelectedIdLocal] = useState(storedSelectedId);
  const setSelectedId = (value: string) => {
    setSelectedIdLocal(value);
    storeSelectedId(value || null);
  };
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [capacityPoints, setCapacityPoints] = useState("0");
  const [projectStartDate, setProjectStartDate] = useState("");
  const [projectTargetDate, setProjectTargetDate] = useState("");
  const [projectOwnerId, setProjectOwnerId] = useState("");
  const [projectStatus, setProjectStatus] = useState<"planned" | "active" | "on_hold" | "completed">("active");
  const [projectAutonomy, setProjectAutonomy] = useState<"cautious" | "standard" | "high">("standard");
  const [projectTags, setProjectTags] = useState("");
  const [projectStatusSummary, setProjectStatusSummary] = useState("");
  const [editing, setEditing] = useState(false);
  const storedPlanningView = useUiStore((state) => state.planningProjectView);
  const storePlanningView = useUiStore((state) => state.setPlanningProjectView);
  const storedFilters = useUiStore((state) => state.planningProjectFilters);
  const storeFilters = useUiStore((state) => state.setPlanningProjectFilters);
  const [view, setViewLocal] = useState<"items" | "board" | "roadmap" | "insights" | "executions">(
    ["board", "roadmap", "insights", "executions"].includes(storedPlanningView) ? storedPlanningView as "board" | "roadmap" | "insights" | "executions" : "items",
  );
  const setView = (next: "items" | "board" | "roadmap" | "insights" | "executions") => {
    setViewLocal(next);
    storePlanningView(next === "items" ? "list" : next);
  };
  const filters = storedFilters ?? { status: "all", priority: "all", milestone: "", due: "all" as const };
  const [selectedWorkItemIds, setSelectedWorkItemIds] = useState<string[]>([]);
  const [bulkField, setBulkField] = useState<"status" | "priority" | "milestone" | "plannedDate" | "dueDate" | "estimatePoints" | "remove">("status");
  const [bulkValue, setBulkValue] = useState("ready");
  const [detailWorkItemId, setDetailWorkItemId] = useState<string | null>(null);
  const [detailDirty, setDetailDirty] = useState(false);
  const [confirmDetailClose, setConfirmDetailClose] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectScope, setProjectScope] = useState<"active" | "attention" | "archived">("active");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [projectSort, setProjectSort] = useState<"risk" | "target" | "updated" | "name">("risk");
  const [watchFilter, setWatchFilter] = useState<"all" | "watched">("all");
  const [savedViewName, setSavedViewName] = useState("");
  const [savedViewId, setSavedViewId] = useState("");
  const [ruleStatus, setRuleStatus] = useState("");
  const [rulePriority, setRulePriority] = useState("");
  const [ruleType, setRuleType] = useState("");
  const [ruleLabel, setRuleLabel] = useState("");
  const [aiPlan, setAiPlan] = useState<{
    autonomyProfile: string;
    requiresApproval: boolean;
    targetProjectId: string | null;
    drafts: {
      title: string; body: string; type: LocalWorkItem["type"]; priority: LocalWorkItem["priority"];
      suggestedRoute: string; acceptanceCriteria: string[];
    }[];
    evidence: { generator: string; policyVersion: string; modelVersion: string | null; inputDigest: string; confidence: number };
  } | null>(null);
  const [planningLiveError, setPlanningLiveError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const selected = projects.find((project) => project.id === selectedId);
  const displayWorkItems = selected?.items
    ? [
        ...selected.items.map((row) => workItems.find((item) => item.id === row.workItem.id) ?? row.workItem),
        ...workItems.filter((item) => !selected.items?.some((row) => row.workItem.id === item.id)),
      ]
    : workItems;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const currentQuarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const inCurrentQuarter = (date: string) =>
    date.slice(0, 4) === today.slice(0, 4)
    && Math.floor((Number(date.slice(5, 7)) - 1) / 3) === currentQuarter;
  const matchesFilters = (item: LocalWorkItem) =>
    (filters.status === "all" || item.status === filters.status)
    && (filters.priority === "all" || item.priority === filters.priority)
    && (!filters.milestone || item.milestone.toLowerCase().includes(filters.milestone.toLowerCase()))
    && (filters.due === "all"
      || (filters.due === "overdue" && Boolean(item.dueDate && item.dueDate < today && item.status !== "done"))
      || (filters.due === "upcoming" && Boolean(item.dueDate && item.dueDate >= today && item.dueDate <= upcoming))
      || (filters.due === "month" && Boolean(item.dueDate?.startsWith(currentMonth)))
      || (filters.due === "quarter" && Boolean(item.dueDate && inCurrentQuarter(item.dueDate)))
      || (filters.due === "unscheduled" && !item.dueDate));
  const filteredDisplayWorkItems = displayWorkItems.filter(matchesFilters);
  const filteredProjectItems = (selected?.items ?? []).filter((row) => matchesFilters(row.workItem));
  const projectItems = selected?.items?.map((row) => row.workItem) ?? [];
  const blockedCount = projectItems.filter((item) => item.blockedBy?.some((dependency) => !dependency.resolved)).length;
  const overdueCount = projectItems.filter((item) => item.dueDate && item.dueDate < today && item.status !== "done").length;
  const activeExecutionStatuses = new Set(["materializing", "running", "waiting_capacity", "awaiting_approval", "verifying", "publishing"]);
  const activeExecutionCount = projectItems.filter((item) => item.executionBindings?.some((binding) => {
    if (binding.kind !== "auto_run") return false;
    const run = autoRuns.find((candidate) => candidate.id === binding.targetId);
    return run && activeExecutionStatuses.has(run.status);
  })).length;
  const linkedExecutions = projectItems.flatMap((workItem) =>
    (workItem.executionBindings ?? [])
      .filter((binding) => binding.kind === "auto_run")
      .map((binding) => ({
        workItem,
        binding,
        run: autoRuns.find((candidate) => candidate.id === binding.targetId),
      })))
    .filter((row) => row.run);
  const projectWorkItemIds = new Set(projectItems.map((item) => item.id));
  const projectBatches = autoRunBatches.filter((batch) =>
    batch.items.some((item) => projectWorkItemIds.has(item.workItemId)));

  useEffect(() => {
    setSelectedIdLocal(storedSelectedId);
  }, [storedSelectedId]);

  useEffect(() => {
    setViewLocal(["board", "roadmap", "insights", "executions"].includes(storedPlanningView)
      ? storedPlanningView as "board" | "roadmap" | "insights" | "executions"
      : "items");
  }, [storedPlanningView]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.listPlanningProjects(true) as Promise<{ projects: PlanningProject[] }>,
      api.listWorkItems() as Promise<LocalWorkItemResult>,
      api.listAutoRuns() as Promise<{ autoRuns?: PlanningAutoRun[] }>,
      workItemBatchApi.list() as Promise<{ batches?: WorkItemAutoRunBatch[] }>,
    ]).then(async ([result, workItemResult, autoRunResult, batchResult]) => {
      if (cancelled) return;
      setWorkItems(workItemResult.workItems);
      setAutoRuns(autoRunResult.autoRuns ?? []);
      setAutoRunBatches(batchResult.batches ?? []);
      const nextId = result.projects.some((project) => project.id === selectedId)
        ? selectedId
        : result.projects[0]?.id ?? "";
      if (!nextId) {
        setProjects(result.projects);
        return;
      }
      const detail = await api.getPlanningProject(nextId) as unknown as { project: PlanningProject };
      if (!cancelled) {
        setProjects(result.projects.map((project) => project.id === nextId ? detail.project : project));
        setSelectedId(nextId);
      }
    });
    return () => { cancelled = true; };
  }, [nonce, selectedId]);

  useVisibleInterval(() => {
    if (selectedId) {
      void Promise.all([
        api.getPlanningProject(selectedId) as Promise<{ project: PlanningProject }>,
        api.listAutoRuns() as Promise<{ autoRuns?: PlanningAutoRun[] }>,
        workItemBatchApi.list() as Promise<{ batches?: WorkItemAutoRunBatch[] }>,
      ]).then(([detail, runResult, batchResult]) => {
        setProjects((current) => current.map((project) => project.id === selectedId ? detail.project : project));
        setAutoRuns(runResult.autoRuns ?? []);
        setAutoRunBatches(batchResult.batches ?? []);
        setPlanningLiveError(null);
      }).catch(() => setPlanningLiveError(t("aiOps.projectRefreshFailed")));
    }
  }, 10_000, Boolean(selectedId));

  const create = () => {
    let created: PlanningProject | null = null;
    void execute(async () => {
      const result = await api.createPlanningProject({
        name, description, capacityPoints: Number(capacityPoints),
        startDate: projectStartDate || null, targetDate: projectTargetDate || null,
        ownerId: projectOwnerId.trim() || undefined,
        status: projectStatus,
        autonomyProfile: projectAutonomy,
        tags: projectTags.split(",").map((tag) => tag.trim()).filter(Boolean),
        statusSummary: projectStatusSummary,
      }) as { project: PlanningProject };
      created = result.project;
      return result;
    }).then((ok) => {
      if (!ok || !created) return;
      setName("");
      setDescription("");
      setCapacityPoints("0");
      setProjectStartDate("");
      setProjectTargetDate("");
      setProjectOwnerId("");
      setProjectStatus("active");
      setProjectAutonomy("standard");
      setProjectTags("");
      setProjectStatusSummary("");
      setSelectedId(created.id);
      setNonce((value) => value + 1);
      onChanged();
    });
  };
  const duplicate = () => {
    if (!selected) return;
    let created: PlanningProject | null = null;
    void execute(async () => {
      const result = await api.createPlanningProject({
        name: t("planningLifecycle.copyName", { name: selected.name }),
        templateProjectId: selected.id,
      }) as { project: PlanningProject };
      created = result.project;
      return result;
    }).then((ok) => {
      if (!ok || !created) return;
      setSelectedId(created.id);
      setNonce((value) => value + 1);
      onChanged();
    });
  };
  const executeRecommendation = (code: string) => {
    if (!selected) return;
    void execute(() => api.executePlanningRecommendedAction(selected.id, code, {
      expectedRevision: selected.revision,
      idempotencyKey: `${selected.id}:${code}:${selected.revision}`,
      confirmed: true,
    })).then((ok) => {
      if (ok) {
        setNonce((value) => value + 1);
        onChanged();
      }
    });
  };
  const draftAiPlan = () => {
    if (!selected) return;
    let plan: typeof aiPlan = null;
    void execute(async () => {
      const result = await api.suggestPlanningProjectPlan(selected.id) as { plan: NonNullable<typeof aiPlan> };
      plan = result.plan;
      return result;
    }).then((ok) => {
      if (ok) setAiPlan(plan);
    });
  };
  const createAiPlanDraft = (draft: NonNullable<typeof aiPlan>["drafts"][number]) => {
    if (!selected || !aiPlan?.targetProjectId) return;
    const targetProjectId = aiPlan.targetProjectId;
    const planEvidence = aiPlan.evidence;
    let workItemId: string | null = null;
    void execute(async () => {
      const created = await api.createWorkItem({
        projectId: targetProjectId,
        title: draft.title,
        body: draft.body,
        type: draft.type,
        priority: draft.priority,
        acceptanceCriteria: draft.acceptanceCriteria,
        labels: ["ai-plan-draft"],
        idempotencyKey: `ai-plan:${selected.id}:${planEvidence.inputDigest}:${draft.title.slice(0, 80)}`,
      }) as { workItem: LocalWorkItem };
      workItemId = created.workItem.id;
      await api.addPlanningProjectItem(selected.id, created.workItem.id);
      return created;
    }).then((ok) => {
      if (!ok || !workItemId) return;
      setAiPlan((current) => current ? {
        ...current,
        drafts: current.drafts.filter((candidate) => candidate.title !== draft.title),
      } : null);
      setNonce((value) => value + 1);
      onChanged();
    });
  };
  const toggleItem = (workItem: LocalWorkItem) => {
    if (!selected) return;
    const included = selected.items?.some((row) => row.workItem.id === workItem.id);
    void execute(() => included
      ? api.removePlanningProjectItem(selected.id, workItem.id)
      : api.addPlanningProjectItem(selected.id, workItem.id))
      .then(() => { setNonce((value) => value + 1); onChanged(); });
  };
  const archive = () => {
    if (!selected) return;
    void execute(() => api.setPlanningProjectArchived(selected.id, selected.revision, !selected.archivedAt)).then(() => {
      setNonce((value) => value + 1);
      onChanged();
    });
  };
  const save = () => {
    if (!selected) return;
    void execute(() => api.updatePlanningProject(selected.id, {
      expectedRevision: selected.revision,
      name,
      description,
      capacityPoints: Number(capacityPoints),
      startDate: projectStartDate || null,
      targetDate: projectTargetDate || null,
      ownerId: projectOwnerId.trim() || null,
      status: projectStatus,
      autonomyProfile: projectAutonomy,
      tags: projectTags.split(",").map((tag) => tag.trim()).filter(Boolean),
      statusSummary: projectStatusSummary,
    })).then((ok) => {
      if (!ok) return;
      setEditing(false);
      setNonce((value) => value + 1);
      onChanged();
    });
  };
  const changeStatus = (workItem: LocalWorkItem, status: LocalWorkItem["status"]) => {
    if (workItem.status === status) return;
    void execute(() => api.updateWorkItem(workItem.id, {
      expectedRevision: workItem.revision,
      status,
    })).then((ok) => {
      if (!ok) return;
      setNonce((value) => value + 1);
      onChanged();
    });
  };
  const moveItem = (workItemId: string, direction: -1 | 1) => {
    if (!selected?.items) return;
    const ids = selected.items.map((row) => row.workItem.id);
    const index = ids.indexOf(workItemId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void execute(() => api.reorderPlanningProjectItems(selected.id, selected.revision, ids)).then((ok) => {
      if (!ok) return;
      setNonce((value) => value + 1);
      onChanged();
    });
  };
  const applyBulkUpdate = () => {
    if (!selected?.items || selectedWorkItemIds.length === 0) return;
    if (bulkField === "remove") {
      void execute(() => api.updatePlanningProjectItems(selected.id, [], selectedWorkItemIds)).then((ok) => {
        if (!ok) return;
        setSelectedWorkItemIds([]);
        setNonce((value) => value + 1);
        onChanged();
      });
      return;
    }
    const items = selected.items
      .map((row) => row.workItem)
      .filter((item) => selectedWorkItemIds.includes(item.id))
      .map((item) => ({ id: item.id, expectedRevision: item.revision }));
    const changes = {
      [bulkField]: bulkField === "dueDate" || bulkField === "plannedDate" ? (bulkValue || null)
        : bulkField === "estimatePoints" ? Number(bulkValue)
          : bulkValue,
    };
    void execute(() => api.bulkUpdateWorkItems({ items, changes })).then((ok) => {
      if (!ok) return;
      setSelectedWorkItemIds([]);
      setNonce((value) => value + 1);
      onChanged();
    });
  };
  const startSelectedBatch = () => {
    if (!selectedWorkItemIds.length) return;
    void execute(() => workItemBatchApi.create({
      workItemIds: selectedWorkItemIds,
      maxConcurrent: Number(batchConcurrency),
      ...(batchAgentId ? { agentId: batchAgentId } : {}),
    })).then((ok) => {
      if (!ok) return;
      setSelectedWorkItemIds([]);
      setView("executions");
      setNonce((value) => value + 1);
      onChanged();
    });
  };
  const startPlanningExecution = (workItem: LocalWorkItem, kind: "worktree" | "auto_run") => {
    void execute(() => kind === "worktree"
      ? api.createWorkItemWorktree(workItem.id)
      : api.startWorkItemAutoRun(workItem.id))
      .then((ok) => {
        if (!ok) return;
        setNonce((value) => value + 1);
        onChanged();
      });
  };
  const executionStatus = (workItem: LocalWorkItem) => {
    const binding = [...(workItem.executionBindings ?? [])].reverse().find((row) => row.kind === "auto_run");
    if (!binding) return null;
    return autoRuns.find((run) => run.id === binding.targetId)?.status ?? null;
  };
  const saveCurrentView = () => {
    if (!selected || !savedViewName.trim()) return;
    void execute(() => api.updatePlanningProject(selected.id, {
      expectedRevision: selected.revision,
      savedViews: [
        ...(selected.savedViews ?? []),
        { name: savedViewName.trim(), view: view === "items" ? "list" : view, filters },
      ],
    })).then((ok) => {
      if (!ok) return;
      setSavedViewName("");
      setNonce((value) => value + 1);
    });
  };
  const applySavedView = (id: string) => {
    setSavedViewId(id);
    const saved = selected?.savedViews?.find((candidate) => candidate.id === id);
    if (!saved) return;
    setView(saved.view === "list" ? "items" : saved.view);
    storeFilters(saved.filters);
  };
  const deleteSavedView = () => {
    if (!selected || !savedViewId) return;
    void execute(() => api.updatePlanningProject(selected.id, {
      expectedRevision: selected.revision,
      savedViews: (selected.savedViews ?? []).filter((candidate) => candidate.id !== savedViewId),
    })).then((ok) => {
      if (!ok) return;
      setSavedViewId("");
      setNonce((value) => value + 1);
    });
  };
  const saveAutomationRule = () => {
    if (!selected || (!ruleStatus && !rulePriority && !ruleType && !ruleLabel.trim())) return;
    void execute(() => api.updatePlanningProject(selected.id, {
      expectedRevision: selected.revision,
      automationRules: [
        ...(selected.automationRules ?? []),
        { status: ruleStatus, priority: rulePriority, type: ruleType, label: ruleLabel.trim() },
      ],
    })).then((ok) => {
      if (!ok) return;
      setRuleStatus("");
      setRulePriority("");
      setRuleType("");
      setRuleLabel("");
      setNonce((value) => value + 1);
    });
  };
  const deleteAutomationRule = (id: string) => {
    if (!selected) return;
    void execute(() => api.updatePlanningProject(selected.id, {
      expectedRevision: selected.revision,
      automationRules: (selected.automationRules ?? []).filter((rule) => rule.id !== id),
    })).then((ok) => {
      if (ok) setNonce((value) => value + 1);
    });
  };
  const exportProject = (format: "csv" | "json") => {
    if (!selected) return;
    const content = format === "csv" ? planningProjectCsv(selected) : planningProjectJson(selected);
    downloadPlanningExport(
      planningExportFilename(selected.name, format),
      content,
      format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
    );
  };
  const importProjectTemplate = (file: File) => {
    let created: PlanningProject | null = null;
    void execute(async () => {
      const snapshot = parsePlanningProjectSnapshot(await file.text());
      const result = await api.createPlanningProject({
        name: t("planningImport.importedName", { name: snapshot.name }),
        description: snapshot.description,
        color: snapshot.color,
        capacityPoints: snapshot.capacityPoints,
        startDate: snapshot.startDate,
        targetDate: snapshot.targetDate,
        ownerId: snapshot.ownerId,
        status: snapshot.status,
        tags: snapshot.tags,
        statusSummary: snapshot.statusSummary,
        pinned: snapshot.pinned,
        savedViews: snapshot.savedViews,
        automationRules: snapshot.automationRules,
      }) as { project: PlanningProject };
      created = result.project;
      return result;
    }).then((ok) => {
      if (!ok || !created) return;
      setProjectScope("active");
      setSelectedId(created.id);
      setNonce((value) => value + 1);
      onChanged();
    });
  };
  const visibleProjects = projects
    .filter((project) => !projectQuery.trim()
      || `${project.name} ${project.description} ${project.ownerId ?? ""} ${(project.tags ?? []).join(" ")}`
        .toLowerCase().includes(projectQuery.trim().toLowerCase()))
    .filter((project) => ownerFilter === "all"
      || (ownerFilter === "unowned" ? !project.ownerId : project.ownerId === ownerFilter))
    .filter((project) => statusFilter === "all" || project.status === statusFilter)
    .filter((project) => tagFilter === "all" || project.tags?.includes(tagFilter))
    .filter((project) => watchFilter === "all" || project.watching)
    .filter((project) => projectScope === "archived"
      ? Boolean(project.archivedAt)
      : !project.archivedAt && (projectScope !== "attention" || project.health === "attention"))
    .sort((a, b) => {
      const pinned = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      if (pinned) return pinned;
      if (projectSort === "target") return (a.targetDate ?? "9999-12-31").localeCompare(b.targetDate ?? "9999-12-31");
      if (projectSort === "updated") return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
      if (projectSort === "name") return a.name.localeCompare(b.name);
      return (b.riskScore ?? 0) - (a.riskScore ?? 0) || b.itemCount - a.itemCount;
    });
  const portfolioAttention = projects.filter((project) => project.health === "attention").length;
  const portfolioActiveRuns = projects.reduce((sum, project) => sum + (project.activeRunCount ?? 0), 0);
  const projectOwners = [...new Set(projects.map((project) => project.ownerId).filter(Boolean) as string[])].sort();
  const projectTagsAvailable = [...new Set(projects.flatMap((project) => project.tags ?? []))].sort();
  const overCapacityProjects = projects.filter((project) => project.overCapacity && !project.archivedAt).length;
  const overdueProjects = projects.filter((project) => project.projectOverdue && !project.archivedAt).length;
  const staleProjects = projects.filter((project) => project.staleStatus && !project.archivedAt).length;
  const watchedAlerts = projects.filter((project) => project.watching && !project.archivedAt
    && (project.projectOverdue || project.overCapacity || project.staleStatus || project.health === "attention")).length;
  const clearPortfolioFilters = () => {
    setProjectQuery("");
    setProjectScope("active");
    setOwnerFilter("all");
    setStatusFilter("all");
    setTagFilter("all");
    setWatchFilter("all");
  };
  const togglePinned = () => {
    if (!selected) return;
    void execute(() => api.updatePlanningProject(selected.id, {
      expectedRevision: selected.revision,
      pinned: !selected.pinned,
    })).then((ok) => {
      if (ok) setNonce((value) => value + 1);
    });
  };
  const toggleWatching = () => {
    if (!selected) return;
    void execute(() => api.updatePlanningProject(selected.id, {
      expectedRevision: selected.revision,
      watching: !selected.watching,
    })).then((ok) => {
      if (ok) setNonce((value) => value + 1);
    });
  };

  return (
    <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
      <div className="space-y-2">
        <details className="rounded-md border border-border p-2">
          <summary className="cursor-pointer text-sm font-medium">{t("planningDecision.createProject")}</summary>
          <div className="mt-2 space-y-2">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("planningProjects.name")} />
            <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("planningProjects.description")} />
            <Input value={projectOwnerId} onChange={(event) => setProjectOwnerId(event.target.value)}
              placeholder={t("planningOwnership.owner")} aria-label={t("planningOwnership.owner")} />
            <Select value={projectStatus} aria-label={t("planningStatus.field")}
              onChange={(event) => setProjectStatus(event.target.value as typeof projectStatus)}>
              {(["planned", "active", "on_hold", "completed"] as const).map((status) =>
                <option key={status} value={status}>{t(`planningStatus.${status}`)}</option>)}
            </Select>
            <Input value={projectTags} onChange={(event) => setProjectTags(event.target.value)}
              placeholder={t("planningTags.hint")} aria-label={t("planningTags.field")} />
            <Textarea value={projectStatusSummary} onChange={(event) => setProjectStatusSummary(event.target.value)}
              placeholder={t("planningCheckIn.placeholder")} aria-label={t("planningCheckIn.summary")} />
            <Input type="number" min="0" max="1000000" value={capacityPoints}
              onChange={(event) => setCapacityPoints(event.target.value)}
              placeholder={t("planningCapacity.capacity")} aria-label={t("planningCapacity.capacity")} />
            <div className="grid grid-cols-2 gap-1">
              <Input type="date" value={projectStartDate} aria-label={t("planningSchedule.startDate")}
                onChange={(event) => setProjectStartDate(event.target.value)} />
              <Input type="date" value={projectTargetDate} aria-label={t("planningSchedule.targetDate")}
                onChange={(event) => setProjectTargetDate(event.target.value)} />
            </div>
            <Button size="sm" disabled={pending || !name.trim()} onClick={create}><Plus className="mr-1 size-4" />{t("planningProjects.create")}</Button>
          </div>
        </details>
        <label className="inline-flex h-8 cursor-pointer items-center justify-center rounded-md border border-border px-3 text-sm hover:bg-accent">
          {t("planningImport.button")}
          <input type="file" accept="application/json,.json" className="sr-only"
            aria-label={t("planningImport.button")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importProjectTemplate(file);
              event.target.value = "";
            }} />
        </label>
        <p className="text-[10px] text-muted-foreground">{t("planningImport.hint")}</p>
        <div className="grid grid-cols-2 gap-1 text-center text-xs">
          <div className="rounded-md bg-muted p-1.5"><strong className="block">{portfolioAttention}</strong>{t("planningPortfolio.attention")}</div>
          <div className="rounded-md bg-muted p-1.5"><strong className="block">{portfolioActiveRuns}</strong>{t("planningPortfolio.activeRuns")}</div>
          <div className="rounded-md bg-muted p-1.5"><strong className="block">{overCapacityProjects}</strong>{t("planningFinish.overCapacity")}</div>
          <div className="rounded-md bg-muted p-1.5"><strong className="block">{overdueProjects}</strong>{t("planningFinish.overdue")}</div>
          <div className="col-span-2 rounded-md bg-muted p-1.5"><strong className="block">{staleProjects}</strong>{t("planningFinish.stale")}</div>
          <div className="col-span-2 rounded-md bg-muted p-1.5"><strong className="block">{watchedAlerts}</strong>{t("planningWatch.alerts")}</div>
        </div>
        <Input value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)}
          placeholder={t("planningPortfolio.search")} aria-label={t("planningPortfolio.search")} />
        <Select value={projectScope} aria-label={t("planningLifecycle.scope")}
          onChange={(event) => setProjectScope(event.target.value as typeof projectScope)}>
          <option value="active">{t("planningLifecycle.active")}</option>
          <option value="attention">{t("planningLifecycle.attention")}</option>
          <option value="archived">{t("planningLifecycle.archived")}</option>
        </Select>
        <Select value={ownerFilter} aria-label={t("planningOwnership.filter")}
          onChange={(event) => setOwnerFilter(event.target.value)}>
          <option value="all">{t("planningOwnership.all")}</option>
          <option value="unowned">{t("planningOwnership.unowned")}</option>
          {projectOwners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
        </Select>
        <Select value={statusFilter} aria-label={t("planningStatus.filter")}
          onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">{t("planningStatus.all")}</option>
          {(["planned", "active", "on_hold", "completed"] as const).map((status) =>
            <option key={status} value={status}>{t(`planningStatus.${status}`)}</option>)}
        </Select>
        <Select value={tagFilter} aria-label={t("planningTags.filter")}
          onChange={(event) => setTagFilter(event.target.value)}>
          <option value="all">{t("planningTags.all")}</option>
          {projectTagsAvailable.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
        </Select>
        <Select value={projectSort} aria-label={t("planningFinish.sort")}
          onChange={(event) => setProjectSort(event.target.value as typeof projectSort)}>
          {(["risk", "target", "updated", "name"] as const).map((sort) =>
            <option key={sort} value={sort}>{t(`planningFinish.${sort}`)}</option>)}
        </Select>
        <Select value={watchFilter} aria-label={t("planningWatch.filter")}
          onChange={(event) => setWatchFilter(event.target.value as typeof watchFilter)}>
          <option value="all">{t("planningWatch.all")}</option>
          <option value="watched">{t("planningWatch.watched")}</option>
        </Select>
        <Button variant="ghost" size="sm" onClick={clearPortfolioFilters}>{t("planningFinish.clear")}</Button>
        <div className="space-y-1 border-t border-border pt-2">
          {visibleProjects.map((project) => (
            <button key={project.id} type="button" onClick={() => setSelectedId(project.id)}
              className={cn("flex w-full justify-between rounded-md px-2 py-1.5 text-left text-sm", selectedId === project.id ? "bg-muted font-medium" : "hover:bg-muted/60")}>
              <span className="min-w-0">
                <span className="block truncate">{project.name}</span>
                {project.pinned ? <Star className="inline size-3 fill-current" aria-label={t("planningFinish.pin")} /> : null}
                {project.watching ? <Bell className="ml-1 inline size-3 fill-current" aria-label={t("planningWatch.watch")} /> : null}
                <span className="block text-[10px] text-muted-foreground">{t(`planningStatus.${project.status ?? "active"}`)}</span>
                {(project.tags ?? []).length ? <span className="block truncate text-[10px] text-muted-foreground">{project.tags?.join(" · ")}</span> : null}
                <span className="flex gap-1 text-[10px] text-muted-foreground">
                  {(project.blockedItemCount ?? 0) > 0 ? <span>{t("planningPortfolio.blocked", { count: project.blockedItemCount ?? 0 })}</span> : null}
                  {(project.overdueItemCount ?? 0) > 0 ? <span>{t("planningPortfolio.overdue", { count: project.overdueItemCount ?? 0 })}</span> : null}
                  {project.overCapacity ? <span>{t("planningCapacity.over")}</span> : null}
                  {project.projectOverdue ? <span>{t("planningSchedule.overdue")}</span> : null}
                  {project.unowned ? <span>{t("planningOwnership.unowned")}</span> : null}
                  {project.staleStatus ? <span>{t("planningCheckIn.stale")}</span> : null}
                </span>
              </span>
              <Badge tone={project.health === "attention" ? "danger" : project.health === "active" ? "running" : "neutral"}>
                {project.itemCount}
              </Badge>
            </button>
          ))}
          {!visibleProjects.length ? <p className="text-xs text-muted-foreground">{t("planningPortfolio.noMatches")}</p> : null}
        </div>
      </div>
      <div className="space-y-3">
        {selected ? (
          <>
            <div className="flex items-start justify-between gap-2">
              {editing ? (
                <div className="flex-1 space-y-2">
                  <Input value={name} onChange={(event) => setName(event.target.value)} aria-label={t("planningProjects.editName")} />
                  <Input value={description} onChange={(event) => setDescription(event.target.value)} aria-label={t("planningProjects.editDescription")} />
                  <Input value={projectOwnerId} onChange={(event) => setProjectOwnerId(event.target.value)}
                    aria-label={t("planningOwnership.owner")} />
                  <Select value={projectStatus} aria-label={t("planningStatus.field")}
                    onChange={(event) => setProjectStatus(event.target.value as typeof projectStatus)}>
                    {(["planned", "active", "on_hold", "completed"] as const).map((status) =>
                      <option key={status} value={status}>{t(`planningStatus.${status}`)}</option>)}
                  </Select>
                  <Select value={projectAutonomy} aria-label="AI autonomy"
                    onChange={(event) => setProjectAutonomy(event.target.value as typeof projectAutonomy)}>
                    <option value="cautious">AI autonomy · cautious</option>
                    <option value="standard">AI autonomy · standard</option>
                    <option value="high">AI autonomy · high</option>
                  </Select>
                  <Input value={projectTags} onChange={(event) => setProjectTags(event.target.value)}
                    aria-label={t("planningTags.field")} />
                  <Textarea value={projectStatusSummary} onChange={(event) => setProjectStatusSummary(event.target.value)}
                    placeholder={t("planningCheckIn.placeholder")} aria-label={t("planningCheckIn.summary")} />
                  <Input type="number" min="0" max="1000000" value={capacityPoints}
                    onChange={(event) => setCapacityPoints(event.target.value)}
                    aria-label={t("planningCapacity.capacity")} />
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="date" value={projectStartDate} aria-label={t("planningSchedule.startDate")}
                      onChange={(event) => setProjectStartDate(event.target.value)} />
                    <Input type="date" value={projectTargetDate} aria-label={t("planningSchedule.targetDate")}
                      onChange={(event) => setProjectTargetDate(event.target.value)} />
                  </div>
                </div>
              ) : <div><h3 className="font-semibold">{selected.name}</h3><p className="text-sm text-muted-foreground">{selected.description || t("planningProjects.noDescription")}</p><p className="text-xs text-muted-foreground">{t(`planningStatus.${selected.status ?? "active"}`)} · {t("planningOwnership.ownerValue", { owner: selected.ownerId || t("planningOwnership.unowned") })}</p><p className={cn("mt-1 text-xs", selected.staleStatus ? "text-destructive" : "text-muted-foreground")}>{selected.statusSummary || t("planningCheckIn.empty")} · {selected.daysSinceStatusUpdate == null ? t("planningCheckIn.empty") : t("planningCheckIn.updated", { days: selected.daysSinceStatusUpdate })}</p></div>}
              <div className="flex gap-1">
                <Button variant="secondary" size="sm" disabled={pending} onClick={draftAiPlan}>
                  {t("aiOps.plan")}
                </Button>
                <Button variant="ghost" size="sm" disabled={pending} title={t(selected.watching ? "planningWatch.unwatch" : "planningWatch.watch")}
                  onClick={toggleWatching}><Bell className={cn("size-4", selected.watching && "fill-current")} /></Button>
                <Button variant="ghost" size="sm" disabled={pending} title={t(selected.pinned ? "planningFinish.unpin" : "planningFinish.pin")}
                  onClick={togglePinned}><Star className={cn("size-4", selected.pinned && "fill-current")} /></Button>
                {editing ? (
                  <Button size="sm" disabled={pending || !name.trim()} onClick={save}>{t("planningProjects.save")}</Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => {
                    setName(selected.name);
                    setDescription(selected.description);
                    setCapacityPoints(String(selected.capacityPoints ?? 0));
                    setProjectStartDate(selected.startDate ?? "");
                    setProjectTargetDate(selected.targetDate ?? "");
                    setProjectOwnerId(selected.ownerId ?? "");
                    setProjectStatus(selected.status ?? "active");
                    setProjectAutonomy(selected.autonomyProfile ?? "standard");
                    setProjectTags((selected.tags ?? []).join(", "));
                    setProjectStatusSummary(selected.statusSummary ?? "");
                    setEditing(true);
                  }}>{t("planningProjects.edit")}</Button>
                )}
                <Button variant="secondary" size="sm" disabled={pending} onClick={duplicate}>
                  {t("planningLifecycle.duplicate")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => exportProject("csv")}>
                  {t("planningExport.csv")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => exportProject("json")}>
                  {t("planningExport.json")}
                </Button>
                <Button variant="ghost" size="sm" disabled={pending} onClick={archive}>
                  {t(selected.archivedAt ? "planningProjects.restore" : "planningProjects.archive")}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md bg-muted p-2"><strong className="block text-base">{selected.itemCount}</strong>{t("planningProjects.total")}</div>
              <div className="rounded-md bg-muted p-2"><strong className="block text-base">{selected.openItemCount}</strong>{t("planningProjects.open")}</div>
              <div className="rounded-md bg-muted p-2"><strong className="block text-base">{selected.completedItemCount}</strong>{t("planningProjects.completed")}</div>
            </div>
            {planningLiveError ? <p className="text-xs text-destructive">{planningLiveError}</p> : null}
            <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-5">
              <div className="rounded-md border border-border p-2"><strong className="block text-base">{selected.aiHealth?.blocked ?? blockedCount}</strong>{t("planningExecution.blocked")}</div>
              <div className="rounded-md border border-border p-2"><strong className="block text-base">{selected.aiHealth?.overdue ?? overdueCount}</strong>{t("planningExecution.overdue")}</div>
              <div className="rounded-md border border-border p-2"><strong className="block text-base">{selected.aiHealth?.active ?? activeExecutionCount}</strong>{t("planningExecution.running")}</div>
              <div className="rounded-md border border-border p-2"><strong className="block text-base">{selected.aiHealth?.failed ?? 0}</strong>{t("aiOps.aiFailed")}</div>
              <div className="rounded-md border border-border p-2">
                <strong className="block text-base">{selected.aiHealth?.needsAttention ? t("planningExecution.atRisk") : t("planningExecution.healthy")}</strong>
                <span>{t("planningExecution.health")}</span> · AI {selected.autonomyProfile ?? "standard"}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-muted p-2 text-xs text-muted-foreground">
              <span>{t("aiOps.success")}: {selected.aiHealth?.successRate == null ? "n/a" : `${Math.round(selected.aiHealth.successRate * 100)}%`}</span>
              <span>{t("aiOps.routeCorrections")}: {selected.aiHealth?.routingCorrectionRate == null ? "n/a" : `${Math.round(selected.aiHealth.routingCorrectionRate * 100)}%`}</span>
              <span>{t("aiOps.knownCost")}: ${(selected.aiHealth?.knownCostUsd ?? 0).toFixed(4)}</span>
              <span>{t("aiOps.alertBacklog")}: {selected.aiHealth?.alertBacklog ?? 0}</span>
              <span>{t("aiOps.settledRuns")}: {selected.aiHealth?.settled ?? 0}</span>
              <span>Trace coverage: {selected.aiHealth?.traceCoverage == null ? "n/a" : `${Math.round(selected.aiHealth.traceCoverage * 100)}%`}</span>
              <Badge tone={selected.aiHealth?.sloStatus === "at_risk" ? "danger" : selected.aiHealth?.sloStatus === "healthy" ? "success" : "neutral"}>
                AI SLO · {selected.aiHealth?.sloStatus ?? "insufficient_data"}
              </Badge>
              {(selected.aiHealth?.signals ?? []).map((signal) => <span key={signal}>{signal.replaceAll("_", " ")}</span>)}
            </div>
            {aiPlan ? (
              <section className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold">{t("aiOps.planDraft")}</h4>
                  <Badge tone="warning">{t("aiOps.reviewRequired")}</Badge>
                </div>
                <p className="mb-2 text-xs text-muted-foreground">
                  Autonomy: {aiPlan.autonomyProfile}. Nothing is created until you review and act.
                  {` · ${aiPlan.evidence.generator} ${Math.round(aiPlan.evidence.confidence * 100)}% · policy ${aiPlan.evidence.policyVersion}`}
                </p>
                <div className="space-y-2">
                  {aiPlan.drafts.map((draft) => (
                    <div key={draft.title} className="rounded border border-border p-2 text-xs">
                      <strong>{draft.title}</strong>
                      <p className="text-muted-foreground">{draft.priority} · route: {draft.suggestedRoute}</p>
                      <p>{draft.acceptanceCriteria.join(" · ")}</p>
                      <Button className="mt-2" size="sm" variant="secondary"
                        disabled={pending || !aiPlan.targetProjectId}
                        onClick={() => createAiPlanDraft(draft)}>
                        Create reviewed draft
                      </Button>
                    </div>
                  ))}
                </div>
                {!aiPlan.targetProjectId ? (
                  <p className="mt-2 text-xs text-muted-foreground">Add one repository-backed issue before creating plan drafts.</p>
                ) : null}
              </section>
            ) : null}
            <section className="rounded-md border border-border p-3">
              <h4 className="mb-2 text-sm font-semibold">{t("planningDecision.nextActions")}</h4>
              <div className="flex flex-wrap gap-2">
                {(selected.recommendedActions ?? []).map((action) => (
                  <div key={action.code} className="flex items-center gap-1 rounded border border-border p-1">
                    <Badge tone={action.risk === "high" ? "danger" : action.risk === "medium" ? "warning" : "neutral"}>
                      {t(`planningDecision.actions.${action.code}` as never, { count: action.count })}
                    </Badge>
                    <span className="text-[10px] uppercase text-muted-foreground">{action.risk}</span>
                    {action.code === "refresh_status" ? (
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => executeRecommendation(action.code)}>
                        {t("tasks.automate")}
                      </Button>
                    ) : null}
                  </div>
                ))}
                {!selected.recommendedActions?.length ? <span className="text-xs text-muted-foreground">{t("planningDecision.noActions")}</span> : null}
              </div>
            </section>
            <div className="flex gap-1 rounded-md bg-muted p-0.5 text-xs">
              {(["items", "board", "roadmap", "executions", "insights"] as const).map((value) => (
                <button key={value} type="button" onClick={() => setView(value)}
                  className={cn("rounded px-2 py-1", view === value && "bg-background shadow-sm")}>
                  {value === "roadmap" ? t("planningFilters.roadmap")
                    : value === "executions" ? t("planningExecutions.title")
                    : value === "insights" ? t("planningInsights.title")
                      : t(`planningProjects.${value}`)}
                </button>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
              <Select value={savedViewId} aria-label={t("planningSavedViews.savedViews")}
                onChange={(event) => applySavedView(event.target.value)}>
                <option value="">{t("planningSavedViews.select")}</option>
                {(selected.savedViews ?? []).map((saved) => <option key={saved.id} value={saved.id}>{saved.name}</option>)}
              </Select>
              <Button variant="ghost" size="sm" disabled={!savedViewId || pending} onClick={deleteSavedView}>
                {t("planningSavedViews.delete")}
              </Button>
              <Input value={savedViewName} onChange={(event) => setSavedViewName(event.target.value)}
                placeholder={t("planningSavedViews.name")} aria-label={t("planningSavedViews.name")} />
              <Button variant="secondary" size="sm" disabled={!savedViewName.trim() || pending} onClick={saveCurrentView}>
                {t("planningSavedViews.save")}
              </Button>
            </div>
            <details className="rounded-md border border-border p-2">
              <summary className="cursor-pointer text-sm font-medium">
                {t("planningCheckIn.history", { count: selected.checkIns?.length ?? 0 })}
              </summary>
              <ol className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                {(selected.checkIns ?? []).map((checkIn) => (
                  <li key={checkIn.id} className="border-l-2 border-border pl-2 text-xs">
                    <p>{checkIn.summary}</p>
                    <p className="text-muted-foreground">{checkIn.authorId} · {new Date(checkIn.createdAt).toLocaleString()}</p>
                  </li>
                ))}
                {!selected.checkIns?.length ? <li className="text-xs text-muted-foreground">{t("planningCheckIn.noHistory")}</li> : null}
              </ol>
            </details>
            <details className="rounded-md border border-border p-2">
              <summary className="cursor-pointer text-sm font-medium">
                {t("planningAutomation.title", { count: selected.automationRules?.length ?? 0 })}
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-4">
                <Select value={ruleStatus} aria-label={t("planningAutomation.status")} onChange={(event) => setRuleStatus(event.target.value)}>
                  <option value="">{t("planningAutomation.anyStatus")}</option>
                  {(["backlog", "ready", "in_progress", "review", "blocked", "done"] as const).map((value) => (
                    <option key={value} value={value}>{t(`tasks.localStatus.${value}`)}</option>
                  ))}
                </Select>
                <Select value={rulePriority} aria-label={t("planningAutomation.priority")} onChange={(event) => setRulePriority(event.target.value)}>
                  <option value="">{t("planningAutomation.anyPriority")}</option>
                  {(["p0", "p1", "p2", "p3"] as const).map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
                </Select>
                <Select value={ruleType} aria-label={t("planningAutomation.type")} onChange={(event) => setRuleType(event.target.value)}>
                  <option value="">{t("planningAutomation.anyType")}</option>
                  {(["task", "bug", "feature", "initiative"] as const).map((value) => (
                    <option key={value} value={value}>{t(`tasks.localType.${value}`)}</option>
                  ))}
                </Select>
                <Input value={ruleLabel} aria-label={t("planningAutomation.label")} onChange={(event) => setRuleLabel(event.target.value)}
                  placeholder={t("planningAutomation.label")} />
              </div>
              <div className="mt-2 flex justify-end">
                <Button variant="secondary" size="sm" disabled={pending || (!ruleStatus && !rulePriority && !ruleType && !ruleLabel.trim())}
                  onClick={saveAutomationRule}>{t("planningAutomation.add")}</Button>
              </div>
              <div className="mt-2 space-y-1">
                {(selected.automationRules ?? []).map((rule) => (
                  <div key={rule.id} className="flex items-center justify-between rounded bg-muted px-2 py-1 text-xs">
                    <span>{[
                      rule.status && t(`tasks.localStatus.${rule.status}` as never),
                      rule.priority?.toUpperCase(),
                      rule.type && t(`tasks.localType.${rule.type}` as never),
                      rule.label,
                    ].filter(Boolean).join(" · ")}</span>
                    <Button variant="ghost" size="sm" onClick={() => deleteAutomationRule(rule.id)}>{t("planningAutomation.delete")}</Button>
                  </div>
                ))}
              </div>
            </details>
            <div className="grid gap-2 sm:grid-cols-4">
              <Select value={filters.status} aria-label={t("planningFilters.status")}
                onChange={(event) => storeFilters({ ...filters, status: event.target.value })}>
                <option value="all">{t("planningFilters.allStatuses")}</option>
                {(["backlog", "ready", "in_progress", "review", "blocked", "done"] as const).map((value) => (
                  <option key={value} value={value}>{t(`tasks.localStatus.${value}`)}</option>
                ))}
              </Select>
              <Select value={filters.priority} aria-label={t("planningFilters.priority")}
                onChange={(event) => storeFilters({ ...filters, priority: event.target.value })}>
                <option value="all">{t("planningFilters.allPriorities")}</option>
                {(["p0", "p1", "p2", "p3"] as const).map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
              </Select>
              <Input value={filters.milestone} aria-label={t("planningFilters.milestone")}
                placeholder={t("planningFilters.milestone")}
                onChange={(event) => storeFilters({ ...filters, milestone: event.target.value })} />
              <Select value={filters.due} aria-label={t("planningFilters.due")}
                onChange={(event) => storeFilters({ ...filters, due: event.target.value as typeof filters.due })}>
                <option value="all">{t("planningFilters.allDates")}</option>
                <option value="overdue">{t("planningFilters.overdue")}</option>
                <option value="upcoming">{t("planningFilters.nextSevenDays")}</option>
                <option value="month">{t("planningFilters.currentMonth")}</option>
                <option value="quarter">{t("planningFilters.currentQuarter")}</option>
                <option value="unscheduled">{t("planningFilters.unscheduled")}</option>
              </Select>
            </div>
            {(filters.status !== "all" || filters.priority !== "all" || filters.milestone || filters.due !== "all") ? (
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => storeFilters({
                  status: "all", priority: "all", milestone: "", due: "all",
                })}>{t("planningFilters.clear")}</Button>
              </div>
            ) : null}
            {view === "items" ? (
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {filteredDisplayWorkItems.map((item) => {
                  const included = selected.items?.some((row) => row.workItem.id === item.id);
                  const orderIndex = selected.items?.findIndex((row) => row.workItem.id === item.id) ?? -1;
                  return (
                    <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
                      <input type="checkbox" checked={Boolean(included)} disabled={pending}
                        aria-label={t("planningProjects.selectItem", { ref: item.localRef })}
                        onChange={() => toggleItem(item)} />
                      <span className="font-mono text-xs text-muted-foreground">{item.localRef}</span><span className="truncate">{item.title}</span>
                      {included ? (
                        <span className="ml-auto flex gap-1">
                          <button type="button" aria-label={t("planningProjects.moveUp", { ref: item.localRef })}
                            disabled={pending || orderIndex === 0} onClick={(event) => { event.preventDefault(); moveItem(item.id, -1); }}>
                            <ArrowUp className="size-3.5" />
                          </button>
                          <button type="button" aria-label={t("planningProjects.moveDown", { ref: item.localRef })}
                            disabled={pending || orderIndex === (selected.items?.length ?? 0) - 1} onClick={(event) => { event.preventDefault(); moveItem(item.id, 1); }}>
                            <ArrowDown className="size-3.5" />
                          </button>
                        </span>
                      ) : null}
                    </label>
                  );
                })}
                {!workItems.length ? <p className="text-xs text-muted-foreground">{t("planningProjects.noItems")}</p> : null}
              </div>
            ) : view === "board" ? (
              <div className="space-y-2">
                <section className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2">
                  <strong className="text-xs">{t("executionUi.batchTitle")}</strong>
                  <span className="text-xs text-muted-foreground">
                    {t("planningProjects.selectedCount", { count: selectedWorkItemIds.length })}
                  </span>
                  <label className="flex items-center gap-1 text-xs">
                    {t("executionUi.concurrency")}
                    <Select value={batchConcurrency} onChange={(event) => setBatchConcurrency(event.target.value)} className="h-8 w-16 text-xs">
                      {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
                    </Select>
                  </label>
                  <Select value={batchAgentId} onChange={(event) => setBatchAgentId(event.target.value)} className="h-8 min-w-44 text-xs">
                    <option value="">{t("executionUi.executionAgentAuto")}</option>
                    {(consoleState?.agents ?? []).filter((agent) => agent.status !== "disabled").map((agent) => (
                      <option key={agent.id} value={agent.id}>{agent.name}</option>
                    ))}
                  </Select>
                  <Button size="sm" disabled={pending || selectedWorkItemIds.length === 0} onClick={startSelectedBatch}>
                    <Zap className="mr-1 size-3.5" />{t("executionUi.startBatch")}
                  </Button>
                  <span className="text-[10px] text-muted-foreground">{t("executionUi.batchDurableHint")}</span>
                </section>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t("planningProjects.selectedCount", { count: selectedWorkItemIds.length })}</span>
                  <Select value={bulkField} aria-label={t("planningBulk.field")}
                    onChange={(event) => {
                      const field = event.target.value as typeof bulkField;
                      setBulkField(field);
                      setBulkValue(field === "status" ? "ready" : field === "priority" ? "p2" : "");
                    }} className="h-8 w-auto text-xs">
                    <option value="status">{t("planningBulk.status")}</option>
                    <option value="priority">{t("planningBulk.priority")}</option>
                    <option value="milestone">{t("planningBulk.milestone")}</option>
                    <option value="plannedDate">{plannedDateLabel}</option>
                    <option value="dueDate">{t("planningBulk.dueDate")}</option>
                    <option value="estimatePoints">{t("planningBulk.estimatePoints")}</option>
                    <option value="remove">{t("planningBulk.remove")}</option>
                  </Select>
                  {bulkField === "status" ? (
                    <Select value={bulkValue} aria-label={t("planningBulk.value")} onChange={(event) => setBulkValue(event.target.value)} className="h-8 w-auto text-xs">
                      {(["backlog", "ready", "in_progress", "review", "blocked", "done"] as const).map((value) => (
                        <option key={value} value={value}>{t(`tasks.localStatus.${value}`)}</option>
                      ))}
                    </Select>
                  ) : bulkField === "priority" ? (
                    <Select value={bulkValue} aria-label={t("planningBulk.value")} onChange={(event) => setBulkValue(event.target.value)} className="h-8 w-auto text-xs">
                      {(["p0", "p1", "p2", "p3"] as const).map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
                    </Select>
                  ) : bulkField === "milestone" ? (
                    <Input value={bulkValue} aria-label={t("planningBulk.value")} onChange={(event) => setBulkValue(event.target.value)}
                      placeholder={t("planningBulk.milestone")} className="h-8 w-auto text-xs" />
                  ) : bulkField === "dueDate" || bulkField === "plannedDate" ? (
                    <Input type="date" value={bulkValue} aria-label={t("planningBulk.value")} onChange={(event) => setBulkValue(event.target.value)}
                      className="h-8 w-auto text-xs" />
                  ) : bulkField === "estimatePoints" ? (
                    <Input type="number" min="0" max="1000" value={bulkValue} aria-label={t("planningBulk.value")}
                      onChange={(event) => setBulkValue(event.target.value)} className="h-8 w-24 text-xs" />
                  ) : null}
                  <Button size="sm" disabled={pending || selectedWorkItemIds.length === 0
                    || (bulkField !== "remove" && bulkField !== "dueDate" && bulkField !== "plannedDate" && !bulkValue.trim())}
                    onClick={applyBulkUpdate}>{t("planningProjects.applyBulk")}</Button>
                </div>
                <div className="grid max-h-96 grid-cols-2 gap-2 overflow-auto lg:grid-cols-3">
                  {(["backlog", "ready", "in_progress", "review", "blocked", "done"] as const).map((status) => (
                  <section key={status} className="min-w-36 rounded-md bg-muted/60 p-2">
                    <h4 className="mb-2 flex justify-between text-xs font-semibold">
                      <span>{t(`tasks.localStatus.${status}`)}</span><Badge tone="neutral">{selected.statusCounts?.[status] ?? 0}</Badge>
                    </h4>
                    <div className="space-y-1.5">
                      {filteredProjectItems.filter((row) => row.workItem.status === status).map(({ workItem }) => (
                        <div key={workItem.id} className="rounded border border-border bg-background p-2 text-xs">
                          <div className="flex items-center gap-1 font-mono text-muted-foreground">
                            <input type="checkbox" aria-label={t("planningProjects.selectItem", { ref: workItem.localRef })}
                              checked={selectedWorkItemIds.includes(workItem.id)}
                              onChange={(event) => setSelectedWorkItemIds((current) => event.target.checked
                                ? [...current, workItem.id]
                                : current.filter((id) => id !== workItem.id))} />
                            {workItem.localRef}
                          </div>
                          <div className="mb-2 font-medium">{workItem.title}</div>
                          {workItem.blockedBy?.some((dependency) => !dependency.resolved) ? (
                            <Badge tone="danger">{t("taskDependencies.blocked")}</Badge>
                          ) : null}
                          {executionStatus(workItem) ? (
                            <button type="button" title={t("planningExecution.openAutoRuns")}
                              onClick={() => setSection("autoRuns")}>
                              <Badge tone={statusTone(executionStatus(workItem) ?? "")}>
                                {t(`autoRuns.status.${executionStatus(workItem)}` as never, { defaultValue: executionStatus(workItem) })}
                              </Badge>
                            </button>
                          ) : (
                            <div className="mt-2 flex gap-1">
                              <Button variant="ghost" size="sm" disabled={pending}
                                onClick={() => startPlanningExecution(workItem, "worktree")}>
                                <GitBranch className="mr-1 size-3" />{t("planningExecution.worktree")}
                              </Button>
                              <Button variant="ghost" size="sm" disabled={pending}
                                onClick={() => startPlanningExecution(workItem, "auto_run")}>
                                <Zap className="mr-1 size-3" />{t("planningExecution.autoRun")}
                              </Button>
                            </div>
                          )}
                          <Select value={workItem.status} disabled={pending}
                            aria-label={t("planningProjects.changeStatus", { ref: workItem.localRef })}
                            onChange={(event) => changeStatus(workItem, event.target.value as LocalWorkItem["status"])}
                            className="h-7 text-xs">
                            {(["backlog", "ready", "in_progress", "review", "blocked", "done"] as const).map((value) => (
                              <option key={value} value={value}>{t(`tasks.localStatus.${value}`)}</option>
                            ))}
                          </Select>
                        </div>
                      ))}
                    </div>
                  </section>
                  ))}
                </div>
              </div>
            ) : view === "executions" ? (
              <div className="space-y-3">
                {projectBatches.map((batch) => (
                  <section key={batch.id} className="rounded-md border border-border p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <strong>{t("executionUi.batchTitle")} · {batch.id}</strong>
                        <p className="mt-1 text-muted-foreground">
                          {t("executionUi.batchProgress", {
                            completed: batch.completed,
                            total: batch.total,
                            running: batch.active,
                            queued: batch.counts.queued ?? 0,
                            concurrency: batch.maxConcurrent,
                          })}
                        </p>
                      </div>
                      <Badge tone={batch.status === "completed" ? "success" : batch.status === "completed_with_failures" ? "warning" : "running"}>
                        {t(`executionUi.batchStatus.${batch.status}` as never)}
                      </Badge>
                    </div>
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                      {batch.items.map((item) => (
                        <button key={item.workItemId} type="button" disabled={!item.autoRunId}
                          onClick={() => setSection("autoRuns")}
                          title={item.error ?? undefined}
                          className="flex items-center justify-between rounded bg-muted px-2 py-1 text-left disabled:cursor-default">
                          <span className="truncate">{item.localRef} · {item.title}</span>
                          <Badge tone={["materializing", "running", "waiting_capacity", "awaiting_approval", "verifying", "publishing"].includes(item.status) ? "running" : ["done", "pr_open", "report_posted", "decomposed"].includes(item.status) ? "success" : item.status === "queued" ? "neutral" : "warning"}>
                            {t(`executionUi.batchItemStatus.${item.status}` as never, { defaultValue: item.status })}
                          </Badge>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
                <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
                  {([
                    ["running", linkedExecutions.filter(({ run }) => ["materializing", "running", "waiting_capacity", "verifying", "publishing"].includes(run?.status ?? "")).length],
                    ["approval", linkedExecutions.filter(({ run }) => run?.status === "awaiting_approval").length],
                    ["failed", linkedExecutions.filter(({ run }) => ["failed", "blocked"].includes(run?.status ?? "")).length],
                    ["review", linkedExecutions.filter(({ run }) => ["pr_open", "report_posted", "plan_proposed"].includes(run?.status ?? "")).length],
                  ] as const).map(([label, count]) => (
                    <div key={label} className="rounded-md border border-border p-2">
                      <strong className="block text-base">{count}</strong>{t(`planningExecutions.${label}`)}
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setSection("autoRuns")}>{t("planningExecutions.openAutoRuns")}</Button>
                  <Button variant="secondary" size="sm" onClick={() => setSection("review")}>{t("planningExecutions.openReview")}</Button>
                  <Button variant="secondary" size="sm" onClick={() => setSection("evidence")}>{t("planningExecutions.openEvidence")}</Button>
                </div>
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {linkedExecutions.map(({ workItem, binding, run }) => (
                    <button key={`${workItem.id}:${binding.targetId}`} type="button"
                      onClick={() => setSection("autoRuns")}
                      className="flex w-full items-center justify-between rounded-md border border-border p-2 text-left text-xs hover:bg-muted">
                      <span><strong>{workItem.localRef}</strong> · {workItem.title}</span>
                      <Badge tone={statusTone(run?.status ?? "")}>
                        {t(`autoRuns.status.${run?.status}` as never, { defaultValue: run?.status })}
                      </Badge>
                    </button>
                  ))}
                  {!linkedExecutions.length ? <EmptyState title={t("planningExecutions.none")} hint={t("planningExecutions.openAutoRuns")} /> : null}
                </div>
              </div>
            ) : view === "roadmap" ? (
              <div className="max-h-[28rem] space-y-4 overflow-y-auto">
                {[...new Set(filteredProjectItems.map((row) => row.workItem.milestone || t("planningFilters.noMilestone")))]
                  .sort()
                  .map((milestone) => (
                    <section key={milestone} className="rounded-md border border-border p-3">
                      <h4 className="mb-2 flex items-center justify-between text-sm font-semibold">
                        <span>{milestone}</span>
                        {(() => {
                          const rows = filteredProjectItems.filter(
                            (row) => (row.workItem.milestone || t("planningFilters.noMilestone")) === milestone,
                          );
                          const done = rows.filter((row) => row.workItem.status === "done").length;
                          const overdue = rows.filter((row) =>
                            Boolean(row.workItem.dueDate && row.workItem.dueDate < today && row.workItem.status !== "done")).length;
                          return (
                            <span className="flex gap-1">
                              <Badge tone="neutral">{t("planningFilters.progress", {
                                percent: rows.length ? Math.round((done / rows.length) * 100) : 0,
                              })}</Badge>
                              {overdue ? <Badge tone="danger">{t("planningFilters.overdueCount", { count: overdue })}</Badge> : null}
                            </span>
                          );
                        })()}
                      </h4>
                      <div className="space-y-1.5">
                        {filteredProjectItems
                          .filter((row) => (row.workItem.milestone || t("planningFilters.noMilestone")) === milestone)
                          .sort((a, b) => (a.workItem.dueDate ?? "9999-12-31").localeCompare(b.workItem.dueDate ?? "9999-12-31"))
                          .map(({ workItem }) => (
                            <div key={workItem.id} className="grid grid-cols-[6rem_1fr_auto] items-center gap-2 rounded bg-muted/50 px-2 py-1.5 text-xs">
                              <span className={cn("font-mono", workItem.dueDate && workItem.dueDate < today && workItem.status !== "done" && "text-destructive")}>
                                {workItem.dueDate ?? t("planningFilters.noDate")}
                              </span>
                              <button type="button" onClick={() => setDetailWorkItemId(workItem.id)}
                                className="truncate text-left font-medium hover:text-primary hover:underline">
                                {workItem.localRef} · {workItem.title}
                              </button>
                              <span className="flex gap-1">
                                {workItem.blockedBy?.some((dependency) => !dependency.resolved) ? (
                                  <Badge tone="danger">{t("taskDependencies.blocked")}</Badge>
                                ) : null}
                                <Badge tone={statusTone(workItem.status)}>{t(`tasks.localStatus.${workItem.status}`)}</Badge>
                                {executionStatus(workItem) ? (
                                  <button type="button" title={t("planningExecution.openAutoRuns")}
                                    onClick={() => setSection("autoRuns")}>
                                    <Badge tone={statusTone(executionStatus(workItem) ?? "")}>
                                      {t(`autoRuns.status.${executionStatus(workItem)}` as never, { defaultValue: executionStatus(workItem) })}
                                    </Badge>
                                  </button>
                                ) : (
                                  <button type="button" disabled={pending} title={t("planningExecution.startAutoRun")}
                                    onClick={() => startPlanningExecution(workItem, "auto_run")}
                                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                                    <Zap className="size-3.5" />
                                  </button>
                                )}
                              </span>
                            </div>
                          ))}
                      </div>
                    </section>
                  ))}
                {!filteredProjectItems.length ? <EmptyState title={t("planningFilters.noMatches")} hint={t("planningFilters.adjustFilters")} /> : null}
              </div>
            ) : (
              <PlanningInsights
                items={filteredProjectItems.map((row) => row.workItem)}
                today={today}
                capacityPoints={selected.capacityPoints ?? 0}
                startDate={selected.startDate ?? null}
                targetDate={selected.targetDate ?? null}
                daysRemaining={selected.daysRemaining ?? null}
                projectOverdue={selected.projectOverdue ?? false}
              />
            )}
            <details className="rounded-md border border-border p-2">
              <summary className="cursor-pointer text-sm font-medium">
                {t("planningActivity.title", { count: selected.activity?.length ?? 0 })}
              </summary>
              <ol className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                {(selected.activity ?? []).map((entry) => (
                  <li key={entry.id} className="border-l-2 border-border pl-2 text-xs">
                    <div className="font-medium">
                      {t(`planningActivity.actions.${entry.action}` as never, { defaultValue: entry.action })}
                    </div>
                    <div className="text-muted-foreground">
                      {entry.actorId} · {new Date(entry.createdAt).toLocaleString()}
                      {typeof entry.details.localRef === "string" ? ` · ${entry.details.localRef}` : ""}
                    </div>
                  </li>
                ))}
                {!selected.activity?.length ? <li className="text-xs text-muted-foreground">{t("planningActivity.empty")}</li> : null}
              </ol>
            </details>
          </>
        ) : <EmptyState title={t("planningProjects.select")} hint={t("planningProjects.selectHint")} />}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
      <Modal open={Boolean(detailWorkItemId)} onClose={() => {
        if (detailDirty) setConfirmDetailClose(true);
        else setDetailWorkItemId(null);
      }} title={t("taskLocal.details")} size="xl">
        {detailWorkItemId ? (
          <LocalWorkItemDetail
            workItemId={detailWorkItemId}
            projects={consoleState?.projects ?? []}
            onDirtyChange={setDetailDirty}
            onChanged={() => { setNonce((value) => value + 1); onChanged(); }}
          />
        ) : null}
      </Modal>
      <ConfirmModal
        open={confirmDetailClose}
        title={t("taskLocal.details")}
        description={t("officeEditors.unsaved")}
        confirmLabel={t("shared.confirm")}
        destructive
        onClose={() => setConfirmDetailClose(false)}
        onConfirm={() => {
          setConfirmDetailClose(false);
          setDetailDirty(false);
          setDetailWorkItemId(null);
        }}
      />
    </div>
  );
}

function PlanningInsights({
  items, today, capacityPoints, startDate, targetDate, daysRemaining, projectOverdue,
}: {
  items: LocalWorkItem[];
  today: string;
  capacityPoints: number;
  startDate: string | null;
  targetDate: string | null;
  daysRemaining: number | null;
  projectOverdue: boolean;
}) {
  const { t } = useAppTranslation();
  const statusRows = (["backlog", "ready", "in_progress", "review", "blocked", "done"] as const)
    .map((status) => ({ status, count: items.filter((item) => item.status === status).length }));
  const priorityRows = (["p0", "p1", "p2", "p3"] as const)
    .map((priority) => ({ priority, count: items.filter((item) => item.priority === priority).length }));
  const milestones = [...new Set(items.map((item) => item.milestone || t("planningFilters.noMilestone")))].sort();
  const assignees = [...new Set(items.flatMap((item) => item.assigneeIds))].sort();
  const total = Math.max(items.length, 1);
  const overdue = items.filter((item) => item.dueDate && item.dueDate < today && item.status !== "done").length;
  const blocked = items.filter((item) => item.status === "blocked"
    || item.blockedBy?.some((dependency) => !dependency.resolved)).length;
  const unscheduled = items.filter((item) => !item.dueDate).length;
  const plannedPoints = items.filter((item) => item.status !== "done")
    .reduce((sum, item) => sum + (item.estimatePoints ?? 0), 0);
  const utilization = capacityPoints > 0 ? Math.round((plannedPoints / capacityPoints) * 100) : null;
  if (!items.length) return <EmptyState title={t("planningFilters.noMatches")} hint={t("planningFilters.adjustFilters")} />;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="rounded-md border border-border p-3">
        <h4 className="mb-2 text-sm font-semibold">{t("planningInsights.statusDistribution")}</h4>
        <div className="space-y-2">
          {statusRows.map(({ status, count }) => (
            <div key={status} className="grid grid-cols-[7rem_1fr_2rem] items-center gap-2 text-xs">
              <span>{t(`tasks.localStatus.${status}`)}</span>
              <div className="h-2 overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary" style={{ width: `${(count / total) * 100}%` }} />
              </div>
              <span className="text-right">{count}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-md border border-border p-3">
        <h4 className="mb-2 text-sm font-semibold">{t("planningInsights.priorityDistribution")}</h4>
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          {priorityRows.map(({ priority, count }) => (
            <div key={priority} className="rounded bg-muted p-2"><strong className="block text-base">{count}</strong>{priority.toUpperCase()}</div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div><strong className="block text-base text-destructive">{overdue}</strong>{t("planningInsights.overdue")}</div>
          <div><strong className="block text-base text-destructive">{blocked}</strong>{t("planningInsights.blocked")}</div>
          <div><strong className="block text-base">{unscheduled}</strong>{t("planningInsights.unscheduled")}</div>
        </div>
        <div className={cn("mt-3 rounded p-2 text-center text-xs", utilization != null && utilization > 100 ? "bg-destructive/10 text-destructive" : "bg-muted")}>
          <strong className="block text-base">{utilization == null ? "—" : `${utilization}%`}</strong>
          {t("planningCapacity.utilization", { planned: plannedPoints, capacity: capacityPoints || "—" })}
        </div>
        <div className={cn("mt-2 rounded p-2 text-center text-xs", projectOverdue ? "bg-destructive/10 text-destructive" : "bg-muted")}>
          <strong className="block text-sm">
            {startDate || "—"} → {targetDate || "—"}
          </strong>
          {!targetDate
            ? t("planningSchedule.noTarget")
            : projectOverdue
              ? t("planningSchedule.overdue")
              : t("planningSchedule.daysRemaining", { count: daysRemaining ?? 0 })}
        </div>
      </section>
      <section className="rounded-md border border-border p-3">
        <h4 className="mb-2 text-sm font-semibold">{t("planningInsights.milestones")}</h4>
        <div className="space-y-1">
          {milestones.map((milestone) => {
            const rows = items.filter((item) => (item.milestone || t("planningFilters.noMilestone")) === milestone);
            const done = rows.filter((item) => item.status === "done").length;
            const points = rows.reduce((sum, item) => sum + (item.estimatePoints ?? 0), 0);
            return <div key={milestone} className="flex justify-between text-xs"><span>{milestone}</span><span>{done}/{rows.length} · {Math.round((done / rows.length) * 100)}% · {points} {t("planningInsights.points")}</span></div>;
          })}
        </div>
      </section>
      <section className="rounded-md border border-border p-3">
        <h4 className="mb-2 text-sm font-semibold">{t("planningInsights.workload")}</h4>
        <div className="space-y-1">
          {assignees.map((assignee) => (
            <div key={assignee} className="flex justify-between text-xs">
              <span>{assignee}</span>
              <span>{(() => {
                const assigned = items.filter((item) => item.assigneeIds.includes(assignee) && item.status !== "done");
                return `${assigned.length} · ${assigned.reduce((sum, item) => sum + (item.estimatePoints ?? 0), 0)} ${t("planningInsights.points")}`;
              })()}</span>
            </div>
          ))}
          {!assignees.length ? <p className="text-xs text-muted-foreground">{t("planningInsights.noAssignees")}</p> : null}
        </div>
      </section>
    </div>
  );
}

function LocalWorkItemTable({
  items,
  projects,
  emptyTitle,
  emptyHint,
  onOpen,
}: {
  items: LocalWorkItem[];
  projects: { id: string; name: string }[];
  emptyTitle: string;
  emptyHint: string;
  onOpen: (id: string) => void;
}) {
  const { t } = useAppTranslation();
  if (!items.length) return <EmptyState title={emptyTitle} hint={emptyHint} />;
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
          {items.map((item) => (
            <tr key={item.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{item.localRef}</td>
              <td className="px-3 py-2">
                <button type="button" className="font-medium hover:text-primary hover:underline" onClick={() => onOpen(item.id)}>
                  {item.title}
                </button>
                <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                  <span>{projects.find((project) => project.id === item.projectId)?.name ?? item.projectId}</span>
                  {item.labels.map((label) => <Badge key={label} tone="neutral">{label}</Badge>)}
                  {item.planningProjects?.filter((project) => !project.archivedAt).map((project) => (
                    <Badge key={project.id} tone="running"><FolderKanban className="mr-1 size-3" />{project.name}</Badge>
                  ))}
                  {item.milestone ? <Badge tone="neutral">{item.milestone}</Badge> : null}
                  {item.dueDate ? (
                    <Badge tone={item.status !== "done" && item.dueDate < new Date().toISOString().slice(0, 10) ? "danger" : "warning"}>
                      {item.status !== "done" && item.dueDate < new Date().toISOString().slice(0, 10)
                        ? t("taskLocal.overdue", { date: item.dueDate })
                        : t("taskLocal.due", { date: item.dueDate })}
                    </Badge>
                  ) : null}
                </div>
              </td>
              <td className="px-3 py-2"><Badge tone="neutral">{t(`tasks.localType.${item.type}`)}</Badge></td>
              <td className="px-3 py-2"><Badge tone={item.priority === "p0" ? "danger" : item.priority === "p1" ? "warning" : "neutral"}>{item.priority.toUpperCase()}</Badge></td>
              <td className="px-3 py-2"><Badge tone={statusTone(item.status)}>{t(`tasks.localStatus.${item.status}`)}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LocalWorkItemDetail({
  workItemId,
  projects,
  onChanged,
  onDirtyChange,
}: {
  workItemId: string;
  projects: { id: string; name: string }[];
  onChanged: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t, i18n } = useAppTranslation();
  const plannedDateLabel = i18n.language.startsWith("zh") ? "AI 执行日期" : "AI execution date";
  const expectedCompletionLabel = i18n.language.startsWith("zh") ? "预期完成日期" : "Expected completion date";
  const { data: consoleState } = useConsoleState();
  const articleText = useArticleTaskLabels();
  const { execute, pending, error } = useAsyncAction();
  const setSection = useUiStore((state) => state.setSection);
  const setSelectedProjectId = useUiStore((state) => state.setSelectedProjectId);
  const setSelectedWorktreeId = useUiStore((state) => state.setSelectedWorktreeId);
  const storedWorkItemSection = useUiStore((state) => state.selectedWorkItemSection) ?? "overview";
  const storeSelectedWorkItemSection = useUiStore((state) => state.setSelectedWorkItemSection);
  const [selectedWorkItemSection, setSelectedWorkItemSection] = useState<WorkItemSection>(storedWorkItemSection);
  const [item, setItem] = useState<LocalWorkItem | null>(null);
  const [comments, setComments] = useState<WorkItemComment[]>([]);
  const [activity, setActivity] = useState<WorkItemActivity[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<LocalWorkItem["type"]>("task");
  const [status, setStatus] = useState<LocalWorkItem["status"]>("backlog");
  const [priority, setPriority] = useState<LocalWorkItem["priority"]>("p2");
  const [labels, setLabels] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [milestone, setMilestone] = useState("");
  const [estimatePoints, setEstimatePoints] = useState("0");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [followUp, setFollowUp] = useState<WorkItemFollowUpDraft>({ ...DEFAULT_WORK_ITEM_FOLLOW_UP_DRAFT });
  const [comment, setComment] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");
  const [dependencyCandidates, setDependencyCandidates] = useState<LocalWorkItem[]>([]);
  const [dependencyId, setDependencyId] = useState("");
  const [parentId, setParentId] = useState("");
  const [observability, setObservability] = useState<LocalWorkItemObservability | null>(null);
  const [autoRunReadiness, setAutoRunReadiness] = useState<{
    ready: boolean;
    checks: { key: string; label: string; status: "ok" | "warn" | "blocked"; detail: string }[];
  } | null>(null);
  const [deleteCommentTarget, setDeleteCommentTarget] = useState<WorkItemComment | null>(null);
  const [progressOpen, setProgressOpen] = useState(false);
  const [deliveryConfirmMode, setDeliveryConfirmMode] = useState<"local_merge" | "pull_request" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedExecutionAgentId, setSelectedExecutionAgentId] = useState("");
  const [articleImportJobs, setArticleImportJobs] = useState<Record<string, ArticleImportJob>>({});
  const [articleAnalysis, setArticleAnalysis] = useState<ArticleAnalysis | null>(null);
  const [similarArticles, setSimilarArticles] = useState<ArticleSimilaritySearch | null>(null);
  const [articleDerivatives, setArticleDerivatives] = useState<Record<string, ArticleDerivative>>({});
  const [articleDerivativeDialog, setArticleDerivativeDialog] = useState<{
    sourceJobId: string;
    worktreeId: string;
  } | null>(null);
  const [articleDerivative, setArticleDerivative] = useState<ArticleDerivative | null>(null);
  const [reportDirty, setReportDirty] = useState(false);

  const taskDirty = item != null && (
    title !== item.title
    || body !== item.body
    || type !== item.type
    || status !== item.status
    || priority !== item.priority
    || labels !== item.labels.join(", ")
    || acceptance !== item.acceptanceCriteria.join("\n")
    || plannedDate !== (item.plannedDate ?? "")
    || dueDate !== (item.dueDate ?? "")
    || milestone !== (item.milestone ?? "")
    || estimatePoints !== String(item.estimatePoints ?? 0)
    || parentId !== (item.parentId ?? "")
    || assigneeIds.join("\u0000") !== item.assigneeIds.join("\u0000")
    || !followUpDraftEquals(followUp, followUpDraftFromWorkItem(item))
  );
  const dirty = taskDirty || reportDirty;
  const syncDraft = (next: LocalWorkItem) => {
    setItem(next);
    setTitle(next.title);
    setBody(next.body);
    setType(next.type);
    setStatus(next.status);
    setPriority(next.priority);
    setLabels(next.labels.join(", "));
    setAcceptance(next.acceptanceCriteria.join("\n"));
    setPlannedDate(next.plannedDate ?? "");
    setDueDate(next.dueDate ?? "");
    setMilestone(next.milestone ?? "");
    setEstimatePoints(String(next.estimatePoints ?? 0));
    setParentId(next.parentId ?? "");
    setAssigneeIds(next.assigneeIds);
    setFollowUp(followUpDraftFromWorkItem(next));
  };
  const load = async () => {
    try {
      setAutoRunReadiness(null);
      const [detail, commentResult, activityResult, workItemResult] = await Promise.all([
        api.getWorkItem(workItemId) as Promise<{ workItem: LocalWorkItem; observability: LocalWorkItemObservability }>,
        api.listWorkItemComments(workItemId) as Promise<{ comments: WorkItemComment[] }>,
        api.listWorkItemActivity(workItemId) as Promise<{ activities: WorkItemActivity[] }>,
        api.listWorkItems() as Promise<LocalWorkItemResult>,
      ]);
      const next = detail.workItem;
      syncDraft(next);
      setComments(commentResult.comments);
      setActivity(activityResult.activities);
      setDependencyCandidates(workItemResult.workItems.filter((candidate) => candidate.id !== workItemId));
      setObservability(detail.observability);
      if (!next.routineDefinitionId) {
        void (api.autoRunReadiness(next.projectId) as Promise<{ readiness?: typeof autoRunReadiness }>)
          .then((result) => setAutoRunReadiness(result.readiness ?? null))
          .catch(() => setAutoRunReadiness({
            ready: false,
            checks: [{
              key: "preflight",
              label: t("taskReadiness.preflight"),
              status: "blocked",
              detail: t("taskReadiness.checkFailed"),
            }],
          }));
      }
      setLoadError(null);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : t("taskLocal.loadFailed"));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workItemId]);
  useVisibleInterval(() => {
    void (api.getWorkItem(workItemId) as Promise<{ workItem: LocalWorkItem; observability: LocalWorkItemObservability }>)
      .then((detail) => {
        setObservability(detail.observability);
        // Preserve an in-progress local edit. With no local draft, refresh the
        // whole record so delivery and save actions use the latest revision.
        if (!taskDirty) syncDraft(detail.workItem);
      })
      .catch(() => {});
  }, 5_000);
  const refreshArticleImports = async () => {
    if (!item?.executionBindings?.some((binding) => binding.kind === "article_import")) return;
    try {
      const result = await articleApi.listImports(workItemId) as { jobs?: ArticleImportJob[] };
      const jobs = result.jobs ?? [];
      setArticleImportJobs(Object.fromEntries(jobs.map((job) => [job.id, job])));
      if (item.executionBindings?.some((binding) => binding.kind === "article_derivative")) {
        const derivativeResults = await Promise.all(jobs
          .filter((job) => job.state === "completed")
          .map((job) => articleApi.listDerivatives(workItemId, job.id)
            .catch(() => ({ derivatives: [] })) as Promise<{ derivatives?: ArticleDerivative[] }>));
        setArticleDerivatives(Object.fromEntries(
          derivativeResults.flatMap((entry) => entry.derivatives ?? [])
            .map((derivative) => [derivative.id, derivative]),
        ));
      }
    } catch {
      // The Issue remains usable when import history cannot be refreshed.
    }
  };
  useEffect(() => {
    void refreshArticleImports();
    // Refresh when the server adds a new execution binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workItemId, item?.executionBindings?.length]);
  useVisibleInterval(() => {
    if (Object.values(articleImportJobs).some((job) => ["queued", "running"].includes(job.state))) {
      void refreshArticleImports();
    }
  }, 1_500);
  useVisibleInterval(() => {
    if (!articleDerivativeDialog || !articleDerivative
      || ["completed", "failed", "canceled"].includes(articleDerivative.state)) return;
    void (articleApi.getDerivative(
      workItemId,
      articleDerivativeDialog.sourceJobId,
      articleDerivative.id,
    ) as Promise<{ derivative: ArticleDerivative }>).then((result) => {
      setArticleDerivative(result.derivative);
      setArticleDerivatives((current) => ({ ...current, [result.derivative.id]: result.derivative }));
      if (result.derivative.state === "completed") {
        onChanged();
        void load();
      }
    }).catch(() => {});
  }, 1_500, Boolean(articleDerivativeDialog && articleDerivative));

  const safeNavigation = useSafeNavigation(dirty);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!item) {
    return <p className={cn("text-sm", loadError ? "text-destructive" : "text-muted-foreground")}>{loadError ?? t("tasks.loading")}</p>;
  }

  const save = (afterSave?: () => void) => {
    if (validateFollowUpDraft(followUp)) return;
    void execute(() => api.updateWorkItem(item.id, {
      expectedRevision: item.revision,
      title,
      body,
      type,
      status,
      priority,
      labels: labels.split(",").map((value) => value.trim()).filter(Boolean),
      acceptanceCriteria: acceptance.split("\n").map((value) => value.trim()).filter(Boolean),
      assigneeIds,
      plannedDate: plannedDate || null,
      dueDate: dueDate || null,
      milestone,
      estimatePoints: Number(estimatePoints),
      parentId: parentId || null,
      ...followUpPayload(followUp),
    })).then((ok) => {
      if (!ok) return;
      setNotice(`${t("taskLocal.save")} ✓`);
      onChanged();
      void load();
      afterSave?.();
    });
  };
  const transition = (action: "close" | "reopen") => {
    void execute(() => api.transitionWorkItem(item.id, action, item.revision)).then((ok) => {
      if (!ok) return;
      onChanged();
      void load();
    });
  };
  const updateDependencies = (dependencyIds: string[]) => {
    void execute(() => api.updateWorkItem(item.id, {
      expectedRevision: item.revision,
      dependencyIds,
    })).then((ok) => {
      if (!ok) return;
      setDependencyId("");
      onChanged();
      void load();
    });
  };
  const addComment = () => {
    if (!comment.trim()) return;
    void execute(() => api.createWorkItemComment(item.id, comment)).then((ok) => {
      if (!ok) return;
      setComment("");
      void load();
    });
  };
  const saveComment = (row: WorkItemComment) => {
    void execute(() => api.updateWorkItemComment(item.id, row.id, {
      expectedRevision: row.revision,
      body: editingCommentBody,
    })).then((ok) => {
      if (!ok) return;
      setEditingCommentId(null);
      void load();
    });
  };
  const removeComment = (row: WorkItemComment) => {
    void execute(() => api.deleteWorkItemComment(item.id, row.id, row.revision)).then((ok) => {
      if (ok) void load();
    });
  };
  const requestNavigation = safeNavigation.requestNavigation;
  const openWorktreeResult = (worktreeId: string | null | undefined) => {
    if (!worktreeId) return;
    requestNavigation(() => {
      setSelectedProjectId(item.projectId);
      setSelectedWorktreeId(worktreeId);
      setSection("projects");
    });
  };
  const openOutputAsset = (asset: Pick<NonNullable<LocalWorkItem["outputAssets"]>[number], "path" | "worktreeId">) => {
    requestNavigation(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("section", "documents");
      url.searchParams.set("project", item.projectId);
      url.searchParams.set("document", asset.path);
      if (asset.worktreeId) url.searchParams.set("worktree", asset.worktreeId);
      else url.searchParams.delete("worktree");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      setSelectedProjectId(item.projectId);
      setSelectedWorktreeId(asset.worktreeId ?? null);
      setSection("documents");
    });
  };
  const markdownAssetFor = (worktreeId?: string | null) => [...(item.outputAssets ?? [])].reverse()
    .find((asset) => asset.family === "markdown"
      && asset.path.toLowerCase().endsWith("/article.md")
      && (!worktreeId || asset.worktreeId === worktreeId));
  const analysisAssetFor = (worktreeId?: string | null) => [...(item.outputAssets ?? [])].reverse()
    .find((asset) => asset.family === "markdown"
      && asset.path.toLowerCase().endsWith("/analysis.md")
      && (!worktreeId || asset.worktreeId === worktreeId));
  const htmlAssetFor = (worktreeId?: string | null) => [...(item.outputAssets ?? [])].reverse()
    .find((asset) => asset.path.toLowerCase().endsWith(".html") && (!worktreeId || asset.worktreeId === worktreeId));
  const retryArticleImport = (job: ArticleImportJob) => {
    if (!job.canonicalUrl || !job.worktreeId) return;
    void execute(() => articleApi.startImport(item.id, {
      url: job.canonicalUrl!,
      worktreeId: job.worktreeId!,
    })).then((ok) => {
      if (!ok) return;
      onChanged();
      void load();
      void refreshArticleImports();
    });
  };
  const viewArticleAnalysis = (jobId: string) => {
    void execute(async () => {
      const result = await articleApi.analyze(item.id, jobId) as {
        analysis: ArticleAnalysis;
        analysisPath: string;
      };
      setArticleAnalysis(result.analysis);
      return result;
    }).then((ok) => {
      if (!ok) return;
      onChanged();
      void load();
      void refreshArticleImports();
    });
  };
  const findSimilarArticles = (jobId: string) => {
    void execute(async () => {
      const result = await articleApi.findSimilar(item.id, jobId) as ArticleSimilaritySearch;
      setSimilarArticles(result);
      return result;
    });
  };
  const openArticleDerivative = (sourceJobId: string, worktreeId: string) => {
    setArticleDerivative(null);
    setArticleDerivativeDialog({ sourceJobId, worktreeId });
  };
  const openArticleDerivativeStatus = (derivative: ArticleDerivative) => {
    setArticleDerivative(derivative);
    setArticleDerivativeDialog({
      sourceJobId: derivative.sourceJobId,
      worktreeId: derivative.worktreeId,
    });
  };
  const createArticleDerivative = (request: ArticleDerivativeRequest) => {
    if (!articleDerivativeDialog) return;
    void execute(async () => {
      const result = await articleApi.createDerivative(
        item.id,
        articleDerivativeDialog.sourceJobId,
        request,
      ) as { derivative: ArticleDerivative };
      setArticleDerivative(result.derivative);
      setArticleDerivatives((current) => ({ ...current, [result.derivative.id]: result.derivative }));
      return result;
    }).then((ok) => {
      if (!ok) return;
      onChanged();
      void load();
    });
  };
  const openSimilarArticle = (match: ArticleSimilarityMatch) => {
    requestNavigation(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("section", "documents");
      url.searchParams.set("project", item.projectId);
      url.searchParams.set("document", match.markdownPath);
      url.searchParams.set("worktree", match.worktreeId);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      setSelectedProjectId(item.projectId);
      setSelectedWorktreeId(match.worktreeId);
      setSection("documents");
      setSimilarArticles(null);
    });
  };
  const createExecutionWorktree = () => {
    void execute(async () => {
      const result = await api.createWorkItemWorktree(item.id) as { worktree?: { id: string } };
      const worktreeId = result.worktree?.id;
      if (worktreeId) {
        setSelectedProjectId(item.projectId);
        setSelectedWorktreeId(worktreeId);
        setSection("projects");
      }
      return result;
    }).then((ok) => {
      if (!ok) return;
      setNotice(`${t("taskLocal.createWorktree")} ✓`);
      onChanged();
      void load();
    });
  };
  const startExecution = () => {
    let startedAutoRunId: string | null = null;
    void execute(async () => {
      const result = await api.startWorkItemAutoRun(item.id, selectedExecutionAgentId
        ? { agentId: selectedExecutionAgentId }
        : {}) as { autoRun?: { id?: string } };
      startedAutoRunId = result.autoRun?.id ?? null;
      return result;
    }).then((ok) => {
      if (!ok) return;
      setNotice(`${t("taskLocal.startAutoRun")} ✓`);
      onChanged();
      void load();
      if (startedAutoRunId) {
        const url = new URL(window.location.href);
        url.searchParams.set("autoRun", startedAutoRunId);
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }
      setSection("autoRuns");
    });
  };
  const deliver = (mode: "local_merge" | "pull_request") => {
    void execute(() => api.deliverWorkItem(item.id, mode, item.revision)).then((ok) => {
      if (!ok) return;
      setDeliveryConfirmMode(null);
      setNotice(`${t(mode === "local_merge" ? "taskDelivery.localComplete" : "taskDelivery.prComplete")} ✓`);
      onChanged();
      void load();
    });
  };
  const externalIssueBinding = item.externalBindings?.find((binding) =>
    binding.resourceType === "issue" || binding.kind.endsWith("_issue"));
  const externalProvider = externalIssueBinding?.provider
    ?? externalIssueBinding?.kind.replace(/_issue$/, "");
  const externalProviderLabel = externalProvider === "gitlab"
    ? "GitLab"
    : externalProvider === "gitea"
      ? "Gitea"
      : "GitHub";
  const nextActionKey = observability?.nextAction ?? "start_execution";
  const nextAction = t(`taskNextAction.${nextActionKey}` as never);
  const boundRun = observability?.latestRun ?? null;
  const activeAutoRunStatuses = new Set(["materializing", "running", "waiting_capacity", "awaiting_approval", "verifying", "publishing"]);
  const activeAutoRunId = boundRun && activeAutoRunStatuses.has(boundRun.status) ? boundRun.id : null;
  const latestTimelineAt = (observability?.timeline ?? []).reduce(
    (latest, event) => !latest || Date.parse(event.at) > Date.parse(latest) ? event.at : latest,
    "",
  );
  const freshestAt = [item.updatedAt, boundRun?.updatedAt, latestTimelineAt]
    .filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value!)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? item.updatedAt;
  const updatedAgeSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(freshestAt)) / 1_000));
  const updatedAgeMinutes = Math.floor(updatedAgeSeconds / 60);
  const staleExecution = Boolean(activeAutoRunId && updatedAgeSeconds > 120);
  const latestActivity = (observability?.timeline ?? [])
    .slice()
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
  const itemAttention = observability?.attention ?? [];
  const knownCostUsd = observability?.cost.knownUsd ?? 0;
  const unknownCostEntries = observability?.cost.unknownEntries ?? 0;
  const failedAlerts = observability?.alerts.failed ?? 0;
  const queuedAlerts = observability?.alerts.queued ?? 0;
  const syncGithub = (direction: "pull" | "push" | "resolve_local" | "resolve_remote") => {
    void execute(() => api.syncWorkItemGithubIssue(item.id, {
      expectedRevision: item.revision, direction,
    })).then((ok) => {
      if (ok) {
        setNotice(`${externalProviderLabel} ${t("taskLocal.github.synced")} ✓`);
        onChanged();
        void load();
      }
    });
  };
  const syncExternal = (direction: "pull" | "push" | "resolve_local" | "resolve_remote") => {
    if (!externalProvider) return;
    if (externalProvider === "github") {
      syncGithub(direction);
      return;
    }
    void execute(() => api.syncWorkItemExternalIssue(item.id, externalProvider, {
      expectedRevision: item.revision, direction,
    })).then((ok) => {
      if (ok) {
        setNotice(`${externalProviderLabel} ${t("taskLocal.github.synced")} ✓`);
        onChanged();
        void load();
      }
    });
  };
  const openAutoRun = (autoRunId?: string | null) => {
    requestNavigation(() => {
      if (autoRunId) {
        const url = new URL(window.location.href);
        url.searchParams.set("autoRun", autoRunId);
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }
      setSection("autoRuns");
    });
  };
  const openExecutionBinding = (binding: NonNullable<LocalWorkItem["executionBindings"]>[number]) => {
    if (binding.kind === "auto_run") {
      openAutoRun(binding.targetId);
      return;
    }
    if (binding.kind === "article_import") {
      const output = markdownAssetFor(binding.worktreeId) ?? htmlAssetFor(binding.worktreeId);
      if (output) {
        openOutputAsset(output);
        return;
      }
    }
    openWorktreeResult(binding.worktreeId ?? binding.targetId);
  };
  const runNextAction = () => {
    if (nextActionKey === "start_execution") {
      requestNavigation(startExecution);
      return;
    }
    if (nextActionKey === "resolve_sync_conflict") {
      document.getElementById(`work-item-external-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (nextActionKey === "review_delivery") {
      openWorktreeResult(observability?.delivery?.worktreeId);
      return;
    }
    if (["review_approval", "inspect_failure", "monitor_execution"].includes(nextActionKey)) {
      openAutoRun(boundRun?.id);
    }
  };

  return (
    <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">{item.localRef}</span>
        <span>{projects.find((project) => project.id === item.projectId)?.name ?? item.projectId}</span>
        <Badge tone={item.state === "open" ? "success" : "neutral"}>
          {t("taskLocal.statusModel.business")}: {t(`taskLocal.state.${item.businessState ?? item.state}`)}
        </Badge>
        <Badge tone={statusTone(item.planningStatus ?? item.status)}>
          {t("taskLocal.statusModel.planning")}: {t(`tasks.localStatus.${item.planningStatus ?? item.status}`)}
        </Badge>
        {item.executionState ? (
          <Badge tone={item.executionState === "failed" ? "danger" : item.executionState === "completed" ? "success" : "neutral"}>
            {t("taskLocal.statusModel.execution")}: {t(`taskLocal.executionState.${item.executionState}`)}
          </Badge>
        ) : null}
        <span>{t("taskLocal.revision", { revision: item.revision })}</span>
      </div>
      <WorkItemSectionNav
        itemId={item.id}
        activeSection={selectedWorkItemSection}
        onSectionChange={(section) => {
          if (section === selectedWorkItemSection) return;
          requestNavigation(() => {
            setSelectedWorkItemSection(section);
            storeSelectedWorkItemSection?.(section);
          });
        }}
      />
      {selectedWorkItemSection === "overview" && item.routineDefinitionId ? (
        <Suspense fallback={<p className="text-xs text-muted-foreground">{t("tasks.loading")}</p>}>
          <RoutineWorkController workItemId={item.id} onChanged={() => {
            onChanged();
            void load();
          }} />
        </Suspense>
      ) : null}
      <div
        hidden={selectedWorkItemSection !== "overview"}
        className="flex items-center gap-1 overflow-x-auto rounded-md border border-border bg-muted/40 p-2 text-xs"
        aria-label={t("aiOps.timeline")}
      >
        {externalIssueBinding ? (
          <>
            <a href={externalIssueBinding.url ?? "#"} target={externalIssueBinding.url ? "_blank" : undefined}
              rel={externalIssueBinding.url ? "noreferrer" : undefined}
              className="whitespace-nowrap rounded bg-background px-2 py-1 font-medium hover:text-primary">
              {externalProviderLabel} #{externalIssueBinding.number}
            </a>
            <span aria-hidden="true">→</span>
          </>
        ) : null}
        <button type="button" className="whitespace-nowrap rounded bg-primary px-2 py-1 font-medium text-primary-foreground"
          onClick={() => setSelectedWorkItemSection("overview")}>
          {item.localRef}
        </button>
        {(item.executionBindings ?? []).map((binding) => (
          <div key={`chain:${binding.kind}:${binding.targetId}`} className="flex items-center gap-1">
            <span aria-hidden="true">→</span>
            <button type="button" className="whitespace-nowrap rounded bg-background px-2 py-1 font-mono hover:text-primary"
              onClick={() => openExecutionBinding(binding)}>
              {binding.kind === "auto_run"
                ? t("taskLocal.autoRun")
                : binding.kind === "article_import"
                  ? articleText.importBinding
                  : binding.kind === "article_derivative"
                    ? articleText.derivativeBinding
                    : t("taskLocal.worktree")} · {binding.targetId}
            </button>
          </div>
        ))}
        {item.completionGate?.ready ? (
          <>
            <span aria-hidden="true">→</span>
            <Badge tone="success">{t("tasks.localStatus.done")}</Badge>
          </>
        ) : null}
      </div>
      <section
        id={`work-item-overview-${item.id}`}
        role="tabpanel"
        aria-labelledby={`work-item-tab-overview-${item.id}`}
        hidden={selectedWorkItemSection !== "overview"}
        className="rounded-md border border-border p-3"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">{t("taskCockpit.title")}</h3>
            {observability?.activeClaim ? (
              <p className="text-xs text-muted-foreground">
                {t("taskNextAction.claimedBy", { actor: observability.activeClaim.actorId ?? "—" })}
                {observability.activeClaim.expiresAt ? ` · ${new Date(observability.activeClaim.expiresAt).toLocaleString()}` : ""}
              </p>
            ) : null}
          </div>
          <Badge tone={itemAttention.length ? "danger" : staleExecution ? "warning" : "success"}>
            {itemAttention.length
              ? t("taskCockpit.attentionCount", { count: itemAttention.length })
              : staleExecution
                ? t("executionUi.stale")
                : activeAutoRunId
                  ? t("executionUi.live")
                  : t("taskCockpit.healthy")}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 xl:grid-cols-4">
          <div className="rounded bg-muted p-2">
            <span className="block text-muted-foreground">{t("taskCockpit.stage")}</span>
            <strong>{item.executionState
              ? t(`taskLocal.executionState.${item.executionState}`)
              : t(`tasks.localStatus.${item.status}`)}</strong>
          </div>
          <div className="rounded bg-muted p-2">
            <span className="block text-muted-foreground">{t("taskCockpit.nextAction")}</span>
            <strong>{nextAction}</strong>
            {nextActionKey !== "none" ? (
              <button type="button" className="mt-1 block text-primary hover:underline" disabled={pending} onClick={runNextAction}>
                {t("taskNextAction.go")}
              </button>
            ) : null}
          </div>
          <div className="rounded bg-muted p-2">
            <span className="block text-muted-foreground">{t("taskCockpit.freshness")}</span>
            <strong>{updatedAgeSeconds < 60
              ? t("executionUi.secondsAgo", { count: updatedAgeSeconds })
              : t("taskCockpit.minutesAgo", { count: updatedAgeMinutes })}</strong>
            {latestActivity?.message ? <span className="mt-1 block truncate text-[10px] text-muted-foreground" title={latestActivity.message}>{latestActivity.message}</span> : null}
          </div>
          <div className="rounded bg-muted p-2">
            <span className="block text-muted-foreground">{plannedDateLabel}</span>
            <strong>{item.plannedDate || "—"}</strong>
          </div>
          <div className="rounded bg-muted p-2">
            <span className="block text-muted-foreground">{t("taskCockpit.cost")}</span>
            <strong>${knownCostUsd.toFixed(4)}</strong>
            {unknownCostEntries ? <span className="ml-1 text-muted-foreground">+{unknownCostEntries}?</span> : null}
          </div>
          <div className="rounded bg-muted p-2">
            <span className="block text-muted-foreground">{t("taskCockpit.alertDelivery")}</span>
            <strong className={failedAlerts ? "text-destructive" : ""}>
              {failedAlerts
                ? t("taskCockpit.alertFailed", { count: failedAlerts })
                : queuedAlerts
                  ? t("taskCockpit.alertQueued", { count: queuedAlerts })
                  : t("taskCockpit.alertClear")}
            </strong>
          </div>
        </div>
        <Suspense fallback={null}>
          <WorkItemFollowUpSummary
            item={item}
            users={consoleState?.users ?? []}
            onRecordProgress={() => setProgressOpen(true)}
          />
        </Suspense>
      </section>
      {selectedWorkItemSection === "report" ? (
        <section
          id={`work-item-report-${item.id}`}
          role="tabpanel"
          aria-labelledby={`work-item-tab-report-${item.id}`}
          className="rounded-md border border-border p-3"
        >
          <Suspense fallback={<p className="text-sm text-muted-foreground">{t("tasks.loading")}</p>}>
            <WorkItemReportSection key={item.id} item={item} onChanged={onChanged} onDirtyChange={setReportDirty} />
          </Suspense>
        </section>
      ) : null}
      <div hidden={selectedWorkItemSection !== "trace"}>
      <Suspense fallback={null}>
        <WorkItemAlertAndCostDetails
          observability={observability}
          pending={pending}
          onRetryAlert={(alertId) => {
            void execute(() => api.retryWorkItemAlert(item.id, alertId)).then((ok) => { if (ok) void load(); });
          }}
        />
      </Suspense>
      </div>
      {selectedWorkItemSection === "process" && boundRun?.decision ? (
        <section className="space-y-2 rounded-md border border-border p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{t("taskCockpit.routingTitle")}</h3>
            <Badge tone={boundRun.decision.confidence < 0.6 ? "warning" : "success"}>{boundRun.decision.path}</Badge>
            <span>{Math.round(boundRun.decision.confidence * 100)}%</span>
            <span className="text-muted-foreground">{boundRun.decision.via ?? boundRun.decision.decidedBy}</span>
            {boundRun.decision.latencyMs != null
              ? <span className="text-muted-foreground">{boundRun.decision.latencyMs} ms</span>
              : null}
          </div>
          {boundRun.decision.rationale ? <p className="whitespace-pre-wrap">{boundRun.decision.rationale}</p> : null}
          {boundRun.decision.evidence ? (
            <p className="font-mono text-[10px] text-muted-foreground">
              policy {boundRun.decision.evidence.policyVersion}
              {boundRun.decision.evidence.modelVersion ? ` · model ${boundRun.decision.evidence.modelVersion}` : ""}
              {` · input ${boundRun.decision.evidence.inputDigest.slice(0, 12)}`}
            </p>
          ) : null}
          {(boundRun.decision.clarifyingQuestions ?? []).length ? (
            <ul className="list-inside list-disc text-muted-foreground">
              {boundRun.decision.clarifyingQuestions?.map((question) => <li key={question}>{question}</li>)}
            </ul>
          ) : null}
          {(boundRun.decision.suggestedActions ?? []).length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {(boundRun.decision.suggestedActions ?? []).map((action: { id: string; label: string; description?: string; payload?: { repoUrl?: string } | null }) => (
                <Button
                  key={action.id}
                  variant={action.id === "evaluate" ? "primary" : "secondary"}
                  size="sm"
                  disabled={pending}
                  onClick={async () => {
                    await execute(async () => {
                      await api.answerClarify(boundRun.id, {
                        answers: action.label,
                        selectedAction: action.id,
                        repoUrl: action.payload?.repoUrl,
                      });
                      void load();
                    });
                  }}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          ) : null}
          {observability?.routingExplanation ? (
            <details>
              <summary className="cursor-pointer font-semibold">{t("aiOps.whyRoute")}</summary>
              <div className="mt-2 space-y-1">
                {observability.routingExplanation.humanCorrection ? (
                  <p className="rounded bg-muted p-2 font-semibold">
                    Human correction → {observability.routingExplanation.humanCorrection.actualPath}: {observability.routingExplanation.humanCorrection.reason}
                  </p>
                ) : null}
                {observability.routingExplanation.candidates.map((candidate) => (
                  <p key={candidate.path} className={candidate.selected ? "font-semibold" : "text-muted-foreground"}>
                    {candidate.path}{candidate.score != null ? ` ${Math.round(candidate.score * 100)}%` : ""}: {candidate.reason}
                  </p>
                ))}
              </div>
            </details>
          ) : null}
          {observability?.estimate ? (
            <p className="text-muted-foreground">
              {observability.estimate.remainingMs != null
                ? `Estimated remaining ${Math.ceil(observability.estimate.remainingMs / 60_000)} min`
                : t("aiOps.estimateUnavailable")}
              {` · ${observability.estimate.confidence} confidence · ${observability.estimate.sampleCount} comparable runs`}
              {observability.estimate.p90DurationMs != null
                ? ` · p90 ${Math.ceil(observability.estimate.p90DurationMs / 60_000)} min`
                : ""}
              {observability.estimate.calibrationMaeMs != null
                ? ` · historical MAE ${Math.ceil(observability.estimate.calibrationMaeMs / 60_000)} min`
                : ""}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(boundRun.status)}>
              {t(`autoRuns.status.${boundRun.status}` as never, { defaultValue: boundRun.status })}
            </Badge>
            {boundRun.terminalOutcome
              ? <span>{boundRun.terminalOutcome.disposition} · {boundRun.terminalOutcome.source}</span>
              : null}
            <Button className="ml-auto" variant="secondary" size="sm" onClick={() => openAutoRun(boundRun.id)}>
              {t("taskCockpit.openAutoRuns")}
            </Button>
          </div>
        </section>
      ) : null}
      {(boundRun?.status === "report_posted" && boundRun?.report) ? (
        <section className="space-y-2 rounded-md border border-border p-3 text-xs">
          <h3 className="text-sm font-semibold">Report</h3>
          <MarkdownBlock text={boundRun.report} />
        </section>
      ) : null}
      <div
        id={`work-item-trace-${item.id}`}
        role="tabpanel"
        aria-labelledby={`work-item-tab-trace-${item.id}`}
        hidden={selectedWorkItemSection !== "trace"}
        className="space-y-4"
      >
        <WorkItemTraceLinks item={item} observability={observability} />
        <Suspense fallback={null}>
          <WorkItemTraceSummary item={item} observability={observability} />
          <WorkItemTimeline observability={observability} expanded={selectedWorkItemSection === "trace"} />
        </Suspense>
        <Suspense fallback={null}>
          <WorkItemExternalSync
            itemId={item.id}
            binding={externalIssueBinding}
            providerLabel={externalProviderLabel}
            pending={pending}
            onSync={syncExternal}
          />
        </Suspense>
      </div>
      <div
        id={`work-item-assets-${item.id}`}
        role="tabpanel"
        aria-labelledby={`work-item-tab-assets-${item.id}`}
        hidden={selectedWorkItemSection !== "assets"}
        className="space-y-4"
      >
      <Suspense fallback={null}><WorkItemAssetChain item={item} /></Suspense>
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">{t("taskCockpit.details")}</summary>
        <div className="mt-3 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label={plannedDateLabel}><Input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} /></Field>
        <Field label={expectedCompletionLabel}><Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field>
        <Field label={t("taskLocal.milestone")}><Input value={milestone} onChange={(event) => setMilestone(event.target.value)} /></Field>
        <Field label={t("planningInsights.estimatePoints")}><Input type="number" min="0" max="1000" value={estimatePoints} onChange={(event) => setEstimatePoints(event.target.value)} /></Field>
      </div>
      <Field label={t("taskHierarchy.title")}>
        <div className="space-y-2">
          <Select value={parentId} aria-label={t("taskHierarchy.parent")}
            onChange={(event) => setParentId(event.target.value)}>
            <option value="">{t("taskHierarchy.noParent")}</option>
            {dependencyCandidates.filter((candidate) => candidate.projectId === item.projectId)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.localRef} · {candidate.title}</option>
              ))}
          </Select>
          <div className="rounded bg-muted p-2 text-xs">
            <strong>{item.subIssuesSummary?.completed ?? 0}/{item.subIssuesSummary?.total ?? 0}</strong>
            {" · "}{t("taskHierarchy.progress", { percent: item.subIssuesSummary?.percentCompleted ?? 0 })}
          </div>
          <div className="space-y-1">
            {(item.subIssues ?? []).map((child) => (
              <div key={child.id} className="flex justify-between rounded border border-border px-2 py-1 text-xs">
                <span>{child.localRef} · {child.title}</span>
                <Badge tone={statusTone(child.status)}>{t(`tasks.localStatus.${child.status}`)}</Badge>
              </div>
            ))}
            {!item.subIssues?.length ? <span className="text-xs text-muted-foreground">{t("taskHierarchy.noChildren")}</span> : null}
          </div>
        </div>
      </Field>
      <Field label={t("taskDependencies.blockedBy")}>
        <div className="space-y-2">
          <div className="flex gap-2">
            <Select value={dependencyId} onChange={(event) => setDependencyId(event.target.value)}>
              <option value="">{t("taskDependencies.select")}</option>
              {dependencyCandidates
                .filter((candidate) => !(item.dependencyIds ?? []).includes(candidate.id))
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>{candidate.localRef} · {candidate.title}</option>
                ))}
            </Select>
            <Button variant="secondary" size="sm" disabled={!dependencyId || pending}
              onClick={() => updateDependencies([...(item.dependencyIds ?? []), dependencyId])}>
              {t("taskDependencies.add")}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {item.blockedBy?.map((dependency) => (
              <button key={dependency.id} type="button"
                onClick={() => updateDependencies((item.dependencyIds ?? []).filter((id) => id !== dependency.id))}
                title={t("taskDependencies.remove", { ref: dependency.localRef })}>
                <Badge tone={dependency.resolved ? "success" : "danger"}>
                  {dependency.localRef} · {dependency.resolved ? t("taskDependencies.resolved") : t("taskDependencies.blocking")} ×
                </Badge>
              </button>
            ))}
            {!item.blockedBy?.length ? <span className="text-xs text-muted-foreground">{t("taskDependencies.none")}</span> : null}
          </div>
        </div>
      </Field>
      <Field label={t("tasks.localTitle")}><Input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("tasks.type")}>
          <Select value={type} onChange={(event) => setType(event.target.value as LocalWorkItem["type"])}>
            {(["task", "bug", "feature", "initiative"] as const).map((value) => <option key={value} value={value}>{t(`tasks.localType.${value}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("tasks.state")}>
          <Select value={status} onChange={(event) => setStatus(event.target.value as LocalWorkItem["status"])}>
            {(["backlog", "ready", "in_progress", "review", "blocked", "done"] as const).map((value) => <option key={value} value={value}>{t(`tasks.localStatus.${value}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("tasks.priority")}>
          <Select value={priority} onChange={(event) => setPriority(event.target.value as LocalWorkItem["priority"])}>
            {(["p0", "p1", "p2", "p3"] as const).map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
          </Select>
        </Field>
      </div>
      <Field label={t("tasks.descriptionField")}>
        <textarea className="min-h-28 w-full rounded-md border border-border bg-background p-2 text-sm" value={body} onChange={(event) => setBody(event.target.value)} />
      </Field>
      <Field label={t("tasks.labels")}><Input value={labels} onChange={(event) => setLabels(event.target.value)} /></Field>
      <Field label={t("tasks.acceptanceCriteria")}>
        <textarea className="min-h-24 w-full rounded-md border border-border bg-background p-2 text-sm" value={acceptance} onChange={(event) => setAcceptance(event.target.value)} />
      </Field>
      <Suspense fallback={null}>
        <WorkItemFollowUpFields
          value={followUp}
          onChange={setFollowUp}
          users={consoleState?.users ?? []}
          assigneeIds={assigneeIds}
          onAssigneeIdsChange={setAssigneeIds}
          disabled={pending}
        />
      </Suspense>
        </div>
      </details>
      </div>
      <div
        id={`work-item-acceptance-${item.id}`}
        role="tabpanel"
        aria-labelledby={`work-item-tab-verification-${item.id}`}
        hidden={selectedWorkItemSection !== "verification"}
      >
        <Suspense fallback={null}><WorkItemAcceptanceSection item={item} /></Suspense>
      </div>
      <div aria-live="polite" aria-atomic="true">
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {notice ? <p className="text-xs text-success">{notice}</p> : null}
      </div>
      {item.routineDefinitionId ? (
        <div
          role="tabpanel"
          aria-labelledby={`work-item-tab-process-${item.id}`}
          hidden={selectedWorkItemSection !== "process"}
          className="sticky bottom-0 z-10 flex flex-wrap justify-end gap-2 border-t border-border bg-background/95 py-2 backdrop-blur"
        >
          <Button variant="secondary" disabled={pending}
            onClick={() => transition(item.state === "open" ? "close" : "reopen")}>
            {t(item.state === "open" ? "taskLocal.close" : "taskLocal.reopen")}
          </Button>
          <Button variant="secondary" disabled={pending || !title.trim() || Boolean(validateFollowUpDraft(followUp))} onClick={() => save()}>
            {t("taskLocal.save")}
          </Button>
        </div>
      ) : (
        <div
          role="tabpanel"
          aria-labelledby={`work-item-tab-process-${item.id}`}
          hidden={selectedWorkItemSection !== "process"}
          className="space-y-4"
        >
          {!activeAutoRunId ? (
            <section className="rounded-md border border-border bg-muted/20 p-3 text-xs">
              <label className="grid gap-1 sm:max-w-sm">
                <span className="font-medium">{t("executionUi.executionAgent")}</span>
                <Select
                  value={selectedExecutionAgentId}
                  onChange={(event) => setSelectedExecutionAgentId(event.target.value)}
                  disabled={pending}
                >
                  <option value="">{t("executionUi.executionAgentAuto")}</option>
                  {(consoleState?.agents ?? [])
                    .filter((agent) => agent.status !== "disabled")
                    .map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name} · {agent.id}
                      </option>
                    ))}
                </Select>
              </label>
              {selectedExecutionAgentId && (consoleState?.agents ?? []).find((agent) => agent.id === selectedExecutionAgentId)?.name.toLowerCase().includes("demo") ? (
                <p className="mt-2 text-amber-700 dark:text-amber-300">{t("executionUi.demoAgentWarning")}</p>
              ) : (
                <p className="mt-2 text-muted-foreground">{t("executionUi.executionAgentHint")}</p>
              )}
            </section>
          ) : null}
          <WorkItemExecutionActions
            itemId={item.id}
            open={item.state === "open"}
            pending={pending}
            canSave={Boolean(title.trim()) && !validateFollowUpDraft(followUp)}
            worktreeReady={Boolean(autoRunReadiness && !autoRunReadiness.checks.some((check) => check.key === "git" && check.status === "blocked"))}
            autoRunReady={autoRunReadiness?.ready === true && !activeAutoRunId}
            autoRunBlockedReason={activeAutoRunId
              ? t("executionUi.activeAutoRunBlocked")
              : autoRunReadiness?.checks.filter((check) => check.status === "blocked").map((check) => check.detail).join(" ")}
            activeAutoRunId={activeAutoRunId}
            onCreateWorktree={() => requestNavigation(createExecutionWorktree)}
            onStartAutoRun={() => requestNavigation(startExecution)}
            onOpenAutoRun={() => openAutoRun(activeAutoRunId)}
            onTransition={() => transition(item.state === "open" ? "close" : "reopen")}
            onSave={() => save()}
          />
        </div>
      )}
      {!item.routineDefinitionId && autoRunReadiness?.ready === false ? (
        <div hidden={selectedWorkItemSection !== "process"} className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs" role="alert">
          <strong className="block text-destructive">{t("taskReadiness.blocked")}</strong>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
            {autoRunReadiness.checks.filter((check) => check.status === "blocked").map((check) => (
              <li key={check.key}>{check.label}: {check.detail}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {observability?.delivery ? (
        <section hidden={selectedWorkItemSection !== "process"} className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">{t("taskDelivery.title")}</h3>
              <p className="text-xs text-muted-foreground">
                {observability.delivery.branchName ?? observability.delivery.worktreeId}
                {" · "}{t(observability.delivery.mode === "local_merge" ? "taskDelivery.localMode" : "taskDelivery.prMode")}
              </p>
            </div>
            <Badge tone={observability.delivery.review?.verdict === "approved" ? "success" : "warning"}>
              {observability.delivery.review?.verdict === "approved"
                ? t("taskDelivery.approved")
                : observability.delivery.review?.verdict === "changes_requested"
                  ? t("taskDelivery.changesRequested")
                  : t("taskDelivery.reviewRequired")}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("taskDelivery.hint")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => openWorktreeResult(observability.delivery?.worktreeId)}>
              {t("taskDelivery.review")}
            </Button>
            <Button size="sm" disabled={pending || observability.delivery.review?.verdict !== "approved"}
              onClick={() => setDeliveryConfirmMode(observability.delivery?.mode ?? null)}>
              {t(observability.delivery.mode === "local_merge" ? "taskDelivery.merge" : "taskDelivery.createPr")}
            </Button>
          </div>
        </section>
      ) : null}
      {(item.executionBindings?.length ?? 0) > 0 ? (
        <div hidden={selectedWorkItemSection !== "process"} className="rounded-md border border-border p-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t("taskLocal.executions")}</p>
          <ul className="space-y-1">
            {item.executionBindings?.map((binding) => {
              const importJob = binding.targetId ? articleImportJobs[binding.targetId] : undefined;
              const derivative = binding.targetId ? articleDerivatives[binding.targetId] : undefined;
              return (
              <li key={`${binding.kind}:${binding.targetId}`} className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={binding.kind === "auto_run" ? "warning" : "neutral"}>
                  {binding.kind === "article_import"
                    ? articleText.importBinding
                    : binding.kind === "article_derivative"
                      ? articleText.derivativeBinding
                      : t(binding.kind === "auto_run" ? "taskLocal.autoRun" : "taskLocal.worktree")}
                </Badge>
                {binding.kind === "auto_run" || binding.kind === "article_import" || binding.kind === "article_derivative" ? (
                  <button type="button" className="font-mono text-primary hover:underline"
                    disabled={binding.kind === "article_derivative" && !derivative}
                    onClick={() => binding.kind === "article_derivative" && derivative
                      ? openArticleDerivativeStatus(derivative)
                      : openExecutionBinding(binding)}>
                    {binding.targetId}
                  </button>
                ) : <span className="font-mono">{binding.targetId}</span>}
                {binding.kind === "article_import" ? (
                  <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    {importJob ? (
                      <span className={importJob.state === "failed" ? "text-destructive" : "text-muted-foreground"}>
                        {importJob.error === "article_import_interrupted"
                          ? articleText.interrupted
                          : articleText.importState[importJob.state]}
                      </span>
                    ) : null}
                    {["failed", "canceled"].includes(importJob?.state ?? "")
                      && importJob?.canonicalUrl ? (
                        <button type="button" className="text-primary hover:underline"
                          onClick={() => retryArticleImport(importJob)}>
                          {articleText.retryImport}
                        </button>
                      ) : null}
                    {markdownAssetFor(binding.worktreeId) ? (
                      <button type="button" className="text-primary hover:underline"
                        onClick={() => openOutputAsset(markdownAssetFor(binding.worktreeId)!)}>
                        {t("taskLocal.openMarkdown")}
                      </button>
                    ) : null}
                    {htmlAssetFor(binding.worktreeId) ? (
                      <button type="button" className="text-primary hover:underline"
                        onClick={() => openOutputAsset(htmlAssetFor(binding.worktreeId)!)}>
                        {t("taskLocal.openHtml")}
                      </button>
                    ) : null}
                    {importJob?.state === "completed" && binding.targetId ? (
                      <>
                        <button type="button" className="text-primary hover:underline" disabled={pending}
                          onClick={() => viewArticleAnalysis(binding.targetId!)}>
                          {articleText.viewAnalysis}
                        </button>
                        <button type="button" className="text-primary hover:underline" disabled={pending}
                          onClick={() => findSimilarArticles(binding.targetId!)}>
                          {articleText.findSimilar}
                        </button>
                        {binding.worktreeId ? (
                          <button type="button" className="text-primary hover:underline" disabled={pending}
                            onClick={() => openArticleDerivative(binding.targetId!, binding.worktreeId!)}>
                            {articleText.createDerivative}
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    {analysisAssetFor(binding.worktreeId) ? (
                      <button type="button" className="text-primary hover:underline"
                        onClick={() => openOutputAsset(analysisAssetFor(binding.worktreeId)!)}>
                        {articleText.openAnalysis}
                      </button>
                    ) : null}
                  </span>
                ) : binding.kind === "article_derivative" ? (
                  <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    {derivative ? (
                      <>
                        <Badge tone={derivative.state === "completed"
                          ? "success"
                          : derivative.state === "failed" ? "danger" : "warning"}>
                          {articleText.derivativeState[derivative.state]}
                        </Badge>
                        {derivative.state === "completed" ? (
                          <button type="button" className="text-primary hover:underline"
                            onClick={() => openOutputAsset({
                              path: derivative.outputPath,
                              worktreeId: derivative.worktreeId,
                            })}>
                            {articleText.openDerivative}
                          </button>
                        ) : null}
                      </>
                    ) : <span className="text-muted-foreground">{t("tasks.loading")}</span>}
                  </span>
                ) : binding.worktreeId ? (
                  <button type="button" className="ml-auto text-primary hover:underline" onClick={() => openWorktreeResult(binding.worktreeId)}>
                    {t("taskLocal.openWorktree")}
                  </button>
                ) : null}
              </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <section hidden={selectedWorkItemSection !== "trace"} className="space-y-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">{t("taskLocal.comments")}</h3>
        <div className="flex gap-2">
          <Input value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t("taskLocal.commentPlaceholder")} />
          <Button disabled={pending || !comment.trim()} onClick={addComment}><MessageSquare className="mr-1 size-4" />{t("taskLocal.comment")}</Button>
        </div>
        <div className="space-y-2">
          {comments.map((row) => (
            <div key={row.id} className="rounded-md border border-border p-2 text-sm">
              {row.deletedAt ? <p className="italic text-muted-foreground">{t("taskLocal.commentDeleted")}</p> : editingCommentId === row.id ? (
                <div className="flex gap-2">
                  <Input value={editingCommentBody} onChange={(event) => setEditingCommentBody(event.target.value)} />
                  <Button size="sm" onClick={() => saveComment(row)}>{t("taskLocal.save")}</Button>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{row.body}</p>
              )}
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{row.createdBy}</span><span>{row.createdAt.replace("T", " ").slice(0, 16)}</span>
                {!row.deletedAt && editingCommentId !== row.id ? (
                  <span className="ml-auto flex gap-1">
                    <button type="button" aria-label={t("taskLocal.editComment")} onClick={() => { setEditingCommentId(row.id); setEditingCommentBody(row.body ?? ""); }}><Pencil className="size-3.5" /></button>
                    <button type="button" aria-label={t("taskLocal.deleteComment")} onClick={() => setDeleteCommentTarget(row)}><Trash2 className="size-3.5" /></button>
                  </span>
                ) : null}
              </div>
            </div>
          ))}
          {!comments.length ? <p className="text-xs text-muted-foreground">{t("taskLocal.noComments")}</p> : null}
        </div>
      </section>

      <section hidden={selectedWorkItemSection !== "trace"} className="space-y-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">{t("taskLocal.activity")}</h3>
        <ul className="space-y-1">
          {activity.map((row) => (
            <li key={row.id} className="flex gap-2 text-xs">
              <Badge tone="neutral">
                {row.action === "article_import_started"
                  ? articleText.importStarted
                  : row.action === "article_derivative_started"
                    ? articleText.derivativeStarted
                    : row.action === "progress_recorded"
                      ? (t as unknown as (key: string) => string)("taskFollowUp.progressActivity")
                      : t(`taskLocal.activityAction.${row.action}`, { defaultValue: row.action })}
              </Badge>
              <span>
                {row.actorId}
                {row.action === "progress_recorded" && typeof row.details.summary === "string"
                  ? ` · ${row.details.summary}`
                  : ""}
              </span>
              <span className="ml-auto text-muted-foreground">{row.createdAt.replace("T", " ").slice(0, 16)}</span>
            </li>
          ))}
        </ul>
      </section>
      <ConfirmModal
        open={Boolean(deliveryConfirmMode)}
        title={t(deliveryConfirmMode === "local_merge" ? "taskDelivery.merge" : "taskDelivery.createPr")}
        description={t(deliveryConfirmMode === "local_merge" ? "taskDelivery.mergeConfirm" : "taskDelivery.prConfirm")}
        confirmLabel={t(deliveryConfirmMode === "local_merge" ? "taskDelivery.merge" : "taskDelivery.createPr")}
        onClose={() => setDeliveryConfirmMode(null)}
        onConfirm={() => {
          if (deliveryConfirmMode) deliver(deliveryConfirmMode);
        }}
      />
      <ConfirmModal
        open={Boolean(deleteCommentTarget)}
        title={t("taskLocal.deleteComment")}
        description={deleteCommentTarget?.body ?? undefined}
        confirmLabel={t("taskLocal.deleteComment")}
        destructive
        onClose={() => setDeleteCommentTarget(null)}
        onConfirm={() => {
          if (deleteCommentTarget) removeComment(deleteCommentTarget);
          setDeleteCommentTarget(null);
        }}
      />
      <Suspense fallback={null}>
        <WorkItemProgressDialog
          target={item}
          open={progressOpen}
          onClose={() => setProgressOpen(false)}
          onSaved={async (next) => {
            syncDraft(next);
            try {
              const activityResult = await api.listWorkItemActivity(workItemId) as { activities: WorkItemActivity[] };
              setActivity(activityResult.activities);
            } catch {
              // The progress write succeeded; the normal detail refresh will reconcile activity later.
            }
            onChanged();
            setNotice((t as unknown as (key: string) => string)("taskFollowUp.progressSaved"));
          }}
        />
      </Suspense>
      {articleAnalysis || similarArticles || articleDerivativeDialog ? (
        <Suspense fallback={null}>
          <ArticleWorkflowDialogs
            analysis={articleAnalysis}
            similarArticles={similarArticles}
            derivativeContext={articleDerivativeDialog}
            derivative={articleDerivative}
            pending={pending}
            onCloseAnalysis={() => setArticleAnalysis(null)}
            onCloseSimilarity={() => setSimilarArticles(null)}
            onCloseDerivative={() => {
              setArticleDerivativeDialog(null);
              setArticleDerivative(null);
            }}
            onOpenSimilar={openSimilarArticle}
            onOpenOutput={openOutputAsset}
            onCreateDerivative={createArticleDerivative}
          />
        </Suspense>
      ) : null}
      <Modal
        open={safeNavigation.pendingNavigation}
        title={t("taskLocal.details")}
        description={reportDirty
          ? (t as unknown as (key: string) => string)("taskReport.unsavedNavigation")
          : t("officeEditors.unsaved")}
        onClose={safeNavigation.cancelNavigation}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={safeNavigation.cancelNavigation}>{t("shared.cancel")}</Button>
          <Button variant="destructive" onClick={safeNavigation.discardAndContinue}>{t("shared.confirm")}</Button>
          {!reportDirty ? (
            <Button onClick={() => safeNavigation.saveAndContinue((action) => save(action))}>{t("taskLocal.save")}</Button>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
