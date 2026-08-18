import { ConfirmModal } from "@/components/common/confirm-modal";
import { Field } from "@/components/common/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { MarkdownBlock } from "@/components/ui/markdown-block";
import { Modal } from "@/components/ui/modal";
import { api, useAsyncAction } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { useSafeNavigation } from "@/hooks/use-safe-navigation";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { cn } from "@/lib/cn";
import { installAutoRunTranslations } from "@/lib/i18n/auto-run-resources";
import { installExecutionUiTranslations } from "@/lib/i18n/execution-ui-resources";
import { invocationStatus } from "@/lib/i18n/readable-labels";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { statusTone } from "@/lib/readable-labels";
import { useUiStore, type WorkItemSection } from "@/store/ui-store";
import { History, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useArticleTaskLabels } from "./article-task-labels";
import { articleApi } from "./article-workflow-api";
import type {
  ArticleAnalysis,
  ArticleDerivative,
  ArticleDerivativeRequest,
  ArticleImportJob,
  ArticleSimilarityMatch,
  ArticleSimilaritySearch,
} from "./article-workflow-types";
import {
  type LocalWorkItem,
  type LocalWorkItemObservability,
  type LocalWorkItemResult,
  type WorkItemActivity,
  type WorkItemComment,
} from "./task-view-types";
import { WorkItemExecutionActions } from "./work-item-execution-actions";
import {
  DEFAULT_WORK_ITEM_FOLLOW_UP_DRAFT,
  followUpDraftEquals,
  followUpDraftFromWorkItem,
  followUpPayload,
  validateFollowUpDraft,
  type WorkItemFollowUpDraft,
} from "./work-item-follow-up-model";
import { WorkItemSectionNav } from "./work-item-section-nav";
import { WorkItemTraceLinks } from "./work-item-trace-links";
import { readableAutoRunReadinessCheck } from "./auto-run-readiness-ui";

const ArticleWorkflowDialogs = lazy(() => import("./article-workflow-dialogs"));
const WorkItemFollowUpFields = lazy(() => import("./work-item-follow-up-fields")
  .then((module) => ({ default: module.WorkItemFollowUpFields })));
const WorkItemFollowUpSummary = lazy(() => import("./work-item-follow-up-fields")
  .then((module) => ({ default: module.WorkItemFollowUpSummary })));
const WorkItemProgressDialog = lazy(() => import("./work-item-progress-dialog"));
const WorkItemReportSection = lazy(() => import("./work-item-report-section"));
const WorkItemExternalSync = lazy(() => import("./work-item-external-sync")
  .then((module) => ({ default: module.WorkItemExternalSync })));
const WorkItemAlertAndCostDetails = lazy(() => import("./work-item-observability")
  .then((module) => ({ default: module.WorkItemAlertAndCostDetails })));
const WorkItemAssetChain = lazy(() => import("./work-item-observability")
  .then((module) => ({ default: module.WorkItemAssetChain })));
const WorkItemTimeline = lazy(() => import("./work-item-observability")
  .then((module) => ({ default: module.WorkItemTimeline })));
const WorkItemTraceSummary = lazy(() => import("./work-item-observability")
  .then((module) => ({ default: module.WorkItemTraceSummary })));
const WorkItemRoutingSection = lazy(() => import("./work-item-routing-section")
  .then((module) => ({ default: module.WorkItemRoutingSection })));
installExecutionUiTranslations();
installAutoRunTranslations();
const RoutineWorkController = lazy(() => import("./routine-work-controller"));
const WorkItemAcceptanceSection = lazy(() => import("./work-item-acceptance-section")
  .then((module) => ({ default: module.WorkItemAcceptanceSection })));

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
  const plannedDateLabel = i18n.language.startsWith("zh") ? "计划 AI 执行日期" : "Planned AI execution date";
  const expectedCompletionLabel = i18n.language.startsWith("zh") ? "预期完成日期" : "Expected completion date";
  const verificationSopLabel = i18n.language.startsWith("zh") ? "检查步骤" : "Verification steps";
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
  const [verificationSop, setVerificationSop] = useState("");
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
    || verificationSop !== (item.verificationSop ?? []).join("\n")
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
    setVerificationSop((next.verificationSop ?? []).join("\n"));
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
      verificationSop: verificationSop.split("\n").map((value) => value.trim()).filter(Boolean),
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
      {(boundRun?.status === "report_posted" && boundRun?.report) ? (
        <section className="space-y-3 rounded-lg bg-card p-6">
          <h3 className="text-base font-semibold">Report</h3>
          <MarkdownBlock text={boundRun.report} />
        </section>
      ) : null}
      {selectedWorkItemSection === "process" && boundRun?.decision ? (
        <Suspense fallback={null}>
          <WorkItemRoutingSection
            run={boundRun}
            observability={observability}
            pending={pending}
            onOpen={() => openAutoRun(boundRun.id)}
            onAnswer={async (action) => {
              await execute(async () => {
                const response = await api.answerClarify(boundRun.id, {
                  answers: action.label,
                  selectedAction: action.id,
                  repoUrl: action.payload?.repoUrl,
                }) as { retryError?: { message?: string } | null };
                if (response.retryError) throw new Error(response.retryError.message ?? t("executionUi.routingEvidence.repositoryStartFailed"));
                void load();
              });
            }}
          />
        </Suspense>
      ) : null}
      {selectedWorkItemSection === "process" && observability?.runHistory?.length ? (
        <section className="space-y-3 rounded-md border border-border p-3" aria-label={t("taskRunHistory.title")}>
          <div className="flex flex-wrap items-center gap-2">
            <History className="size-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-sm font-semibold">{t("taskRunHistory.title")}</h3>
            <Badge tone="neutral">{observability.runHistory.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{t("taskRunHistory.hint")}</p>
          <ol className="space-y-2">
            {observability.runHistory.map((run) => (
              <li key={run.invocationId} className="rounded-md bg-muted/50 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{t("taskRunHistory.attempt", { count: run.attempt })}</span>
                  <Badge tone={statusTone(run.status)}>{invocationStatus(t, run.status)}</Badge>
                  {run.current ? <Badge tone="running">{t("taskRunHistory.current")}</Badge> : null}
                  <time className="ml-auto text-muted-foreground" dateTime={run.createdAt ?? undefined}>
                    {run.createdAt ? new Date(run.createdAt).toLocaleString(i18n.language) : "-"}
                  </time>
                </div>
                {run.summary ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{run.summary}</p> : null}
                {run.errorCode ? (
                  <p className="mt-1 font-mono text-[11px] text-destructive">
                    {t("taskRunHistory.errorCode", { code: run.errorCode })}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
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
      <Field label={verificationSopLabel}>
        <textarea className="min-h-24 w-full rounded-md border border-border bg-background p-2 text-sm" value={verificationSop} onChange={(event) => setVerificationSop(event.target.value)} />
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
              : autoRunReadiness?.checks
                .filter((check) => check.status === "blocked")
                .map((check) => readableAutoRunReadinessCheck(check, i18n.language.startsWith("zh") ? "zh" : "en").detail)
                .join(" ")}
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
            {autoRunReadiness.checks.filter((check) => check.status === "blocked").map((check) => {
              const readable = readableAutoRunReadinessCheck(check, i18n.language.startsWith("zh") ? "zh" : "en");
              return <li key={check.key}>{readable.label}: {readable.detail}</li>;
            })}
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
