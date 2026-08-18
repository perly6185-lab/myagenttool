import { ConfirmModal } from "@/components/common/confirm-modal";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { api, useAsyncAction } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import {
  downloadPlanningExport,
  parsePlanningProjectSnapshot,
  planningExportFilename,
  planningProjectCsv,
  planningProjectJson,
} from "@/features/planning/planning-export";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { cn } from "@/lib/cn";
import { installAutoRunTranslations } from "@/lib/i18n/auto-run-resources";
import { installExecutionUiTranslations } from "@/lib/i18n/execution-ui-resources";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { statusTone } from "@/lib/readable-labels";
import { useUiStore } from "@/store/ui-store";
import { ArrowDown, ArrowUp, Bell, GitBranch, Plus, Star, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { LocalWorkItemDetail } from "./local-work-item-detail";
import { PlanningInsights } from "./planning-insights";
import {
  type LocalWorkItem,
  type LocalWorkItemResult,
  type PlanningAutoRun,
  type PlanningProject,
  type WorkItemAutoRunBatch,
} from "./task-view-types";
import { workItemBatchApi } from "./work-item-batch-api";

installExecutionUiTranslations();
installAutoRunTranslations();

export function PlanningProjectsPanel({ onChanged = () => {} }: { onChanged?: () => void }) {
  const { t, i18n } = useAppTranslation();
  const plannedDateLabel = i18n.language.startsWith("zh") ? "计划 AI 执行日期" : "Planned AI execution date";
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
