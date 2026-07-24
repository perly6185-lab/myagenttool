import { useEffect, useMemo, useState } from "react";
import { Hand, History, RefreshCw, ExternalLink, GitBranch, Workflow, Zap, Plus, Save, MessageSquare, Trash2, Pencil, FolderKanban, ArrowUp, ArrowDown, Star, Bell } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { statusTone } from "@/lib/readable-labels";
import { invocationStatus } from "@/lib/i18n/readable-labels";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { IssueClaimEvent } from "@/lib/console-state";
import { branchFromIssue, worktreeLinkFor } from "@/features/projects/worktree-payload";
import { githubItemKindLabel, worktreeAutoRunPrompt } from "@myagenttool/protocol/issue-prompt";
import {
  downloadPlanningExport,
  parsePlanningProjectSnapshot,
  planningExportFilename,
  planningProjectCsv,
  planningProjectJson,
} from "@/features/planning/planning-export";

type GithubItem = {
  type: "issue" | "pr";
  number: number;
  title: string;
  headRefName: string | null;
  author: string;
  url: string | null;
  state: string;
};
type GithubResult = { available: boolean; message: string; items: GithubItem[] };
type WorkItemExecutionState = "unclaimed" | "claimed" | "running" | "awaiting_approval" | "verifying" | "failed" | "completed";
type GithubWorkItemBinding = {
  kind: "github_issue"; number: number; url: string | null; lastSyncedAt: string;
  conflict: null | { fields: string[]; local: Record<string, unknown>; remote: Record<string, unknown> };
};
type LocalWorkItem = {
  id: string;
  localRef: string;
  projectId: string;
  title: string;
  body: string;
  type: "task" | "bug" | "feature" | "initiative";
  status: "backlog" | "ready" | "in_progress" | "review" | "blocked" | "done";
  priority: "p0" | "p1" | "p2" | "p3";
  state: "open" | "closed";
  businessState?: "open" | "closed";
  planningStatus?: LocalWorkItem["status"];
  executionState?: WorkItemExecutionState;
  statusModel?: {
    business: "open" | "closed";
    planning: LocalWorkItem["status"];
    execution: WorkItemExecutionState;
  };
  labels: string[];
  assigneeIds: string[];
  acceptanceCriteria: string[];
  acceptanceResults?: { criterion: string; status: "passed" | "failed" | "not_tested"; note: string; verificationId: string }[];
  verificationRecords?: {
    id: string; kind: "test" | "lint" | "typecheck" | "manual" | "review";
    status: "passed" | "failed"; command: string | null; summary: string;
    evidence: { kind: string; ref: string; summary: string }[]; recordedAt: string; recordedBy: string;
  }[];
  completionGate?: { ready: boolean; missingCriteria: string[]; verificationRequired: boolean };
  dueDate: string | null;
  milestone: string;
  estimatePoints: number;
  revision: number;
  archivedAt: string | null;
  executionBindings?: { kind: "worktree" | "auto_run"; targetId: string; worktreeId: string | null; createdAt: string }[];
  externalBindings?: GithubWorkItemBinding[];
  planningProjects?: { id: string; name: string; archivedAt: string | null }[];
  dependencyIds?: string[];
  parentId?: string | null;
  parent?: { id: string; localRef: string; title: string; status: LocalWorkItem["status"]; state: "open" | "closed" } | null;
  subIssues?: { id: string; localRef: string; title: string; status: LocalWorkItem["status"]; state: "open" | "closed" }[];
  subIssuesSummary?: { total: number; completed: number; percentCompleted: number };
  blockedBy?: { id: string; localRef: string; title: string; status: LocalWorkItem["status"]; state: "open" | "closed"; resolved: boolean }[];
  blocks?: { id: string; localRef: string; title: string; status: LocalWorkItem["status"]; state: "open" | "closed" }[];
  updatedAt: string;
};
type LocalWorkItemResult = { workItems: LocalWorkItem[]; count: number };
type PlanningAutoRun = { id: string; status: string };
type PlanningProject = {
  id: string;
  name: string;
  description: string;
  color?: string;
  revision: number;
  archivedAt: string | null;
  updatedAt?: string;
  pinned?: boolean;
  watching?: boolean;
  itemCount: number;
  openItemCount: number;
  completedItemCount: number;
  statusCounts: Record<LocalWorkItem["status"], number>;
  priorityCounts: Record<LocalWorkItem["priority"], number>;
  blockedItemCount?: number;
  overdueItemCount?: number;
  activeRunCount?: number;
  failedRunCount?: number;
  riskScore?: number;
  recommendedActions?: { code: string; count: number; risk: "low" | "medium" | "high"; approvalRequired: boolean }[];
  plannedPoints?: number;
  capacityPoints?: number;
  overCapacity?: boolean;
  capacityUtilization?: number | null;
  startDate?: string | null;
  targetDate?: string | null;
  projectOverdue?: boolean;
  daysRemaining?: number | null;
  ownerId?: string | null;
  unowned?: boolean;
  status?: "planned" | "active" | "on_hold" | "completed";
  tags?: string[];
  statusSummary?: string;
  statusUpdatedAt?: string | null;
  daysSinceStatusUpdate?: number | null;
  staleStatus?: boolean;
  checkIns?: { id: string; summary: string; authorId: string; createdAt: string }[];
  health?: "healthy" | "active" | "attention";
  savedViews?: {
    id: string;
    name: string;
    view: "list" | "board" | "roadmap" | "insights" | "executions";
    filters: { status: string; priority: string; milestone: string; due: "all" | "overdue" | "upcoming" | "month" | "quarter" | "unscheduled" };
  }[];
  automationRules?: { id: string; status: string; priority: string; type: string; label: string }[];
  activity?: { id: string; action: string; actorId: string; createdAt: string; details: Record<string, unknown> }[];
  items?: { membership: { position: number }; workItem: LocalWorkItem }[];
};
type WorkItemComment = {
  id: string;
  body: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deletedAt: string | null;
};
type WorkItemActivity = {
  id: string;
  action: string;
  actorId: string;
  createdAt: string;
  details: Record<string, unknown>;
};
type WorkItemAttention = {
  id: string;
  kind: "github_conflict" | "execution_approval" | "verification_failed" | "acceptance_blocked" | "recommended_action_approval" | "governed_action";
  severity: "low" | "medium" | "high";
  workItemId: string | null;
  planningProjectId?: string | null;
  localRef: string | null;
  title: string;
  createdAt: string;
  dueAt: string;
  slaStatus: "within_sla" | "breached";
  history: { action: string; actorId: string; createdAt: string }[];
  handling: { actorId: string; claimedAt: string } | null;
  resolution: { actorId: string; resolvedAt: string; note: string } | null;
  details: Record<string, unknown>;
};
// Each row also carries which project it came from (for the "All projects" view).
type Row = GithubItem & { projectId: string; projectName: string };

const TABS = ["local", "issue", "pr"] as const;
type TaskTab = (typeof TABS)[number];

// Task = GitHub issues/PRs across repo-backed projects, surfaced as work items.
// Mirrors the project's existing per-worktree GitHub list, lifted to a top-level
// board with project/type/search filters.
export function TaskView() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const setSection = useUiStore((s) => s.setSection);
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
  // One-click Auto: materialize a worktree from the item and start an
  // issue-seeded agent run in it, then jump into that worktree. Merge stays human.
  function autoRunIssue(row: Row) {
    void execute(async () => {
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
  const [attentionItems, setAttentionItems] = useState<WorkItemAttention[]>([]);
  const [attentionKind, setAttentionKind] = useState("");
  const [attentionSla, setAttentionSla] = useState("");
  const [attentionHandler, setAttentionHandler] = useState("");
  const [showResolvedAttention, setShowResolvedAttention] = useState(false);
  const [selectedAttentionIds, setSelectedAttentionIds] = useState<Set<string>>(new Set());
  const [planningProjects, setPlanningProjects] = useState<PlanningProject[]>([]);
  const [planningProjectId, setPlanningProjectId] = useState("all");
  const [createLocalOpen, setCreateLocalOpen] = useState(false);
  const [planningOpen, setPlanningOpen] = useState(false);
  const [selectedLocalId, setSelectedLocalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

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
        setNonce((value) => value + 1);
      }
    });
  };
  const decideRecommendedAction = (attention: WorkItemAttention, decision: "approve" | "deny") => {
    const approvalRequestId = typeof attention.details.approvalRequestId === "string"
      ? attention.details.approvalRequestId
      : "";
    if (!attention.planningProjectId || !approvalRequestId) return;
    if (!window.confirm(`${decision === "approve" ? t("approvals.approve") : t("approvals.deny")}?`)) return;
    const note = window.prompt(t("taskLocal.commentPlaceholder"))?.trim() ?? "";
    if (!note) return;
    void execute(() => api.decidePlanningRecommendedAction(
      attention.planningProjectId!,
      approvalRequestId,
      decision,
      { confirmed: true, note },
    )).then((ok) => {
      if (ok) setNonce((value) => value + 1);
    });
  };

  useEffect(() => {
    let cancelled = false;
    const selectedProjectId = projectId === "all" ? undefined : projectId;
    void (api.listWorkItems({
      projectId: selectedProjectId,
      planningProjectId: planningProjectId === "all" ? undefined : planningProjectId,
    }) as Promise<LocalWorkItemResult>)
      .then((result) => {
        if (!cancelled) setLocalRows(result.workItems);
      })
      .catch(() => {
        if (!cancelled) setLocalRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, planningProjectId, nonce]);

  useEffect(() => {
    void (api.listWorkItemAttention({
      projectId: projectId === "all" ? undefined : projectId,
      kind: attentionKind || undefined,
      sla: attentionSla || undefined,
      handler: attentionHandler === "mine" || attentionHandler === "unclaimed" ? attentionHandler : undefined,
      includeResolved: showResolvedAttention ? "1" : undefined,
    }) as Promise<{ items: WorkItemAttention[] }>)
      .then((result) => setAttentionItems(result.items))
      .catch(() => setAttentionItems([]));
  }, [projectId, attentionKind, attentionSla, attentionHandler, showResolvedAttention, nonce]);

  useEffect(() => {
    setSelectedAttentionIds((current) => new Set([...current].filter((id) =>
      attentionItems.some((item) => item.id === id))));
  }, [attentionItems]);

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
          <Button size="sm" onClick={() => setCreateLocalOpen(true)}>
            <Plus className="mr-1 size-4" /> {t("tasks.newLocal")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Type tabs */}
          <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs">
            {TABS.map((key) => (
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
        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        {tab === "local" ? (
          <>
            <section className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{t("approvals.pending", { count: attentionItems.length })}</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox"
                        checked={attentionItems.length > 0 && attentionItems.every((item) => selectedAttentionIds.has(item.id))}
                        onChange={(event) => setSelectedAttentionIds(event.target.checked
                          ? new Set(attentionItems.map((item) => item.id))
                          : new Set())} />
                      {t("evidence.show")}
                    </label>
                    <Select value={attentionKind} onChange={(event) => setAttentionKind(event.target.value)} className="h-7 text-xs">
                      <option value="">{t("evidence.show")}</option>
                      <option value="github_conflict">{t("taskLocal.github.conflict")}</option>
                      <option value="execution_approval">{t("approvals.kind.invocation_approval")}</option>
                      <option value="verification_failed">{t("approvals.testsFailed")}</option>
                      <option value="acceptance_blocked">{t("tasks.acceptanceCriteria")}</option>
                      <option value="recommended_action_approval">{t("planningDecision.nextActions")}</option>
                    </Select>
                    <Select value={attentionSla} onChange={(event) => setAttentionSla(event.target.value)} className="h-7 text-xs">
                      <option value="">{t("planningFilters.allStatuses")}</option>
                      <option value="breached">{t("planningSchedule.overdue")}</option>
                      <option value="within_sla">{t("planningExecution.healthy")}</option>
                    </Select>
                    <Select value={attentionHandler} onChange={(event) => setAttentionHandler(event.target.value)} className="h-7 text-xs">
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
            </section>
            <LocalWorkItemTable
              items={visibleLocal}
              projects={projects}
              emptyTitle={t("tasks.noLocalIssues")}
              emptyHint={t("tasks.noLocalMatches")}
              onOpen={setSelectedLocalId}
            />
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
        {historyRow ? <ClaimHistoryList events={claimHistory(historyRow)} /> : null}
      </Modal>

      <Modal open={createLocalOpen} onClose={() => setCreateLocalOpen(false)} title={t("tasks.newLocal")}>
        <CreateLocalWorkItemForm
          projects={projects}
          initialProjectId={projectId === "all" ? projects[0]?.id ?? "" : projectId}
          onDone={() => {
            setCreateLocalOpen(false);
            setTab("local");
            setNonce((value) => value + 1);
          }}
        />
      </Modal>

      <Modal open={planningOpen} onClose={() => setPlanningOpen(false)} title={t("planningProjects.title")}>
        <div className="mb-3 flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => { setPlanningOpen(false); setSection("planning"); }}>
            <FolderKanban className="mr-1 size-4" />{t("planningWorkspace.title")}
          </Button>
        </div>
        <PlanningProjectsPanel onChanged={() => setNonce((value) => value + 1)} />
      </Modal>

      <Modal open={Boolean(selectedLocalId)} onClose={() => setSelectedLocalId(null)} title={t("taskLocal.details")}>
        {selectedLocalId ? (
          <LocalWorkItemDetail
            workItemId={selectedLocalId}
            projects={projects}
            onChanged={() => setNonce((value) => value + 1)}
          />
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
  const { t } = useAppTranslation();
  const { data: consoleState } = useConsoleState();
  const setSection = useUiStore((state) => state.setSection);
  const { execute, pending, error } = useAsyncAction();
  const [projects, setProjects] = useState<PlanningProject[]>([]);
  const [workItems, setWorkItems] = useState<LocalWorkItem[]>([]);
  const [autoRuns, setAutoRuns] = useState<PlanningAutoRun[]>([]);
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
  const [bulkField, setBulkField] = useState<"status" | "priority" | "milestone" | "dueDate" | "estimatePoints" | "remove">("status");
  const [bulkValue, setBulkValue] = useState("ready");
  const [detailWorkItemId, setDetailWorkItemId] = useState<string | null>(null);
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
  const activeExecutionStatuses = new Set(["materializing", "running", "awaiting_approval", "verifying", "publishing"]);
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
      api.listAutoRuns() as Promise<{ runs: PlanningAutoRun[] }>,
    ]).then(async ([result, workItemResult, autoRunResult]) => {
      if (cancelled) return;
      setWorkItems(workItemResult.workItems);
      setAutoRuns(autoRunResult.runs);
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

  const create = () => {
    let created: PlanningProject | null = null;
    void execute(async () => {
      const result = await api.createPlanningProject({
        name, description, capacityPoints: Number(capacityPoints),
        startDate: projectStartDate || null, targetDate: projectTargetDate || null,
        ownerId: projectOwnerId.trim() || undefined,
        status: projectStatus,
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
      [bulkField]: bulkField === "dueDate" ? (bulkValue || null)
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
            <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
              <div className="rounded-md border border-border p-2"><strong className="block text-base">{blockedCount}</strong>{t("planningExecution.blocked")}</div>
              <div className="rounded-md border border-border p-2"><strong className="block text-base">{overdueCount}</strong>{t("planningExecution.overdue")}</div>
              <div className="rounded-md border border-border p-2"><strong className="block text-base">{activeExecutionCount}</strong>{t("planningExecution.running")}</div>
              <div className="rounded-md border border-border p-2">
                <strong className="block text-base">{blockedCount + overdueCount ? t("planningExecution.atRisk") : t("planningExecution.healthy")}</strong>
                {t("planningExecution.health")}
              </div>
            </div>
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
                  ) : bulkField === "dueDate" ? (
                    <Input type="date" value={bulkValue} aria-label={t("planningBulk.value")} onChange={(event) => setBulkValue(event.target.value)}
                      className="h-8 w-auto text-xs" />
                  ) : bulkField === "estimatePoints" ? (
                    <Input type="number" min="0" max="1000" value={bulkValue} aria-label={t("planningBulk.value")}
                      onChange={(event) => setBulkValue(event.target.value)} className="h-8 w-24 text-xs" />
                  ) : null}
                  <Button size="sm" disabled={pending || selectedWorkItemIds.length === 0
                    || (bulkField !== "remove" && bulkField !== "dueDate" && !bulkValue.trim())}
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
                <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
                  {([
                    ["running", linkedExecutions.filter(({ run }) => ["materializing", "running", "verifying", "publishing"].includes(run?.status ?? "")).length],
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
      <Modal open={Boolean(detailWorkItemId)} onClose={() => setDetailWorkItemId(null)} title={t("taskLocal.details")}>
        {detailWorkItemId ? (
          <LocalWorkItemDetail
            workItemId={detailWorkItemId}
            projects={consoleState?.projects ?? []}
            onChanged={() => { setNonce((value) => value + 1); onChanged(); }}
          />
        ) : null}
      </Modal>
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

function LocalWorkItemDetail({
  workItemId,
  projects,
  onChanged,
}: {
  workItemId: string;
  projects: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const { t } = useAppTranslation();
  const { execute, pending, error } = useAsyncAction();
  const setSection = useUiStore((state) => state.setSection);
  const setSelectedProjectId = useUiStore((state) => state.setSelectedProjectId);
  const setSelectedWorktreeId = useUiStore((state) => state.setSelectedWorktreeId);
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
  const [dueDate, setDueDate] = useState("");
  const [milestone, setMilestone] = useState("");
  const [estimatePoints, setEstimatePoints] = useState("0");
  const [comment, setComment] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");
  const [dependencyCandidates, setDependencyCandidates] = useState<LocalWorkItem[]>([]);
  const [dependencyId, setDependencyId] = useState("");
  const [parentId, setParentId] = useState("");

  const load = async () => {
    try {
      const [detail, commentResult, activityResult, workItemResult] = await Promise.all([
        api.getWorkItem(workItemId) as Promise<{ workItem: LocalWorkItem }>,
        api.listWorkItemComments(workItemId) as Promise<{ comments: WorkItemComment[] }>,
        api.listWorkItemActivity(workItemId) as Promise<{ activities: WorkItemActivity[] }>,
        api.listWorkItems() as Promise<LocalWorkItemResult>,
      ]);
      const next = detail.workItem;
      setItem(next);
      setTitle(next.title);
      setBody(next.body);
      setType(next.type);
      setStatus(next.status);
      setPriority(next.priority);
      setLabels(next.labels.join(", "));
      setAcceptance(next.acceptanceCriteria.join("\n"));
      setDueDate(next.dueDate ?? "");
      setMilestone(next.milestone ?? "");
      setEstimatePoints(String(next.estimatePoints ?? 0));
      setParentId(next.parentId ?? "");
      setComments(commentResult.comments);
      setActivity(activityResult.activities);
      setDependencyCandidates(workItemResult.workItems.filter((candidate) => candidate.id !== workItemId));
      setLoadError(null);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : t("taskLocal.loadFailed"));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workItemId]);

  if (!item) {
    return <p className={cn("text-sm", loadError ? "text-destructive" : "text-muted-foreground")}>{loadError ?? t("tasks.loading")}</p>;
  }

  const save = () => {
    void execute(() => api.updateWorkItem(item.id, {
      expectedRevision: item.revision,
      title,
      body,
      type,
      status,
      priority,
      labels: labels.split(",").map((value) => value.trim()).filter(Boolean),
      acceptanceCriteria: acceptance.split("\n").map((value) => value.trim()).filter(Boolean),
      dueDate: dueDate || null,
      milestone,
      estimatePoints: Number(estimatePoints),
      parentId: parentId || null,
    })).then(() => {
      onChanged();
      void load();
    });
  };
  const transition = (action: "close" | "reopen") => {
    void execute(() => api.transitionWorkItem(item.id, action, item.revision)).then(() => {
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
    void execute(() => api.createWorkItemComment(item.id, comment)).then(() => {
      setComment("");
      void load();
    });
  };
  const saveComment = (row: WorkItemComment) => {
    void execute(() => api.updateWorkItemComment(item.id, row.id, {
      expectedRevision: row.revision,
      body: editingCommentBody,
    })).then(() => {
      setEditingCommentId(null);
      void load();
    });
  };
  const removeComment = (row: WorkItemComment) => {
    void execute(() => api.deleteWorkItemComment(item.id, row.id, row.revision)).then(() => void load());
  };
  const openWorktreeResult = (worktreeId: string | null | undefined) => {
    if (!worktreeId) return;
    setSelectedProjectId(item.projectId);
    setSelectedWorktreeId(worktreeId);
    setSection("projects");
  };
  const createExecutionWorktree = () => {
    void execute(async () => {
      const result = await api.createWorkItemWorktree(item.id) as { worktree?: { id: string } };
      openWorktreeResult(result.worktree?.id);
      return result;
    }).then(() => {
      onChanged();
      void load();
    });
  };
  const startExecution = () => {
    void execute(async () => {
      const result = await api.startWorkItemAutoRun(item.id) as { worktree?: { id: string }; autoRun?: { worktreeId?: string } };
      openWorktreeResult(result.worktree?.id ?? result.autoRun?.worktreeId);
      return result;
    }).then(() => {
      onChanged();
      void load();
    });
  };
  const githubBinding = item.externalBindings?.find((binding) => binding.kind === "github_issue");
  const syncGithub = (direction: "pull" | "push" | "resolve_local" | "resolve_remote") => {
    void execute(() => api.syncWorkItemGithubIssue(item.id, {
      expectedRevision: item.revision, direction,
    })).then((ok) => {
      if (ok) {
        onChanged();
        void load();
      }
    });
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
      {githubBinding ? (
        <div className="space-y-2 rounded-md border border-border p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={githubBinding.conflict ? "danger" : "success"}>
              GitHub #{githubBinding.number} · {t(githubBinding.conflict ? "taskLocal.github.conflict" : "taskLocal.github.synced")}
            </Badge>
            {githubBinding.url ? <a className="text-primary hover:underline" href={githubBinding.url} target="_blank" rel="noreferrer">{t("taskLocal.github.open")}</a> : null}
            <Button variant="secondary" disabled={pending} onClick={() => syncGithub("pull")}>{t("taskLocal.github.pull")}</Button>
            <Button variant="secondary" disabled={pending || Boolean(githubBinding.conflict)} onClick={() => syncGithub("push")}>{t("taskLocal.github.push")}</Button>
          </div>
          {githubBinding.conflict ? (
            <div className="flex flex-wrap items-center gap-2 rounded bg-danger/10 p-2">
              <span>{t("taskLocal.github.conflictFields", { fields: githubBinding.conflict.fields.join(", ") })}</span>
              <Button variant="secondary" disabled={pending} onClick={() => syncGithub("resolve_local")}>{t("taskLocal.github.keepLocal")}</Button>
              <Button variant="secondary" disabled={pending} onClick={() => syncGithub("resolve_remote")}>{t("taskLocal.github.acceptRemote")}</Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("taskLocal.dueDate")}><Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field>
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
      {(item.acceptanceCriteria.length || item.verificationRecords?.length) ? (
        <section className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("tasks.acceptanceCriteria")}</h3>
            <Badge tone={item.completionGate?.ready ? "success" : "warning"}>
              {t(item.completionGate?.ready ? "tasks.localStatus.done" : "tasks.localStatus.blocked")}
            </Badge>
          </div>
          <ul className="space-y-1">
            {item.acceptanceCriteria.map((criterion) => {
              const result = item.acceptanceResults?.find((candidate) => candidate.criterion === criterion);
              return (
                <li key={criterion} className="flex items-start justify-between gap-2 text-xs">
                  <span>{criterion}{result?.note ? ` · ${result.note}` : ""}</span>
                  <Badge tone={result?.status === "passed" ? "success" : result?.status === "failed" ? "danger" : "neutral"}>
                    {result?.status === "passed" ? t("approvals.testsPassed") : result?.status === "failed" ? t("approvals.testsFailed") : t("evidence.none")}
                  </Badge>
                </li>
              );
            })}
          </ul>
          {(item.verificationRecords ?? []).map((record) => (
            <div key={record.id} className="rounded bg-muted p-2 text-xs">
              <div className="flex justify-between gap-2">
                <strong>{record.kind} · {record.summary}</strong>
                <Badge tone={record.status === "passed" ? "success" : "danger"}>{t(record.status === "passed" ? "approvals.testsPassed" : "approvals.testsFailed")}</Badge>
              </div>
              {record.command ? <code className="mt-1 block">{record.command}</code> : null}
              {record.evidence.map((entry) => <div key={`${entry.kind}:${entry.ref}`} className="mt-1 font-mono">{entry.kind}: {entry.ref}</div>)}
            </div>
          ))}
        </section>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" disabled={pending || item.state !== "open"} onClick={createExecutionWorktree}>
          <GitBranch className="mr-1 size-4" />{t("taskLocal.createWorktree")}
        </Button>
        <Button disabled={pending || item.state !== "open"} onClick={startExecution}>
          <Zap className="mr-1 size-4" />{t("taskLocal.startAutoRun")}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => transition(item.state === "open" ? "close" : "reopen")}>
          {t(item.state === "open" ? "taskLocal.close" : "taskLocal.reopen")}
        </Button>
        <Button disabled={pending || !title.trim()} onClick={save}><Save className="mr-1 size-4" />{t("taskLocal.save")}</Button>
      </div>
      {(item.executionBindings?.length ?? 0) > 0 ? (
        <div className="rounded-md border border-border p-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t("taskLocal.executions")}</p>
          <ul className="space-y-1">
            {item.executionBindings?.map((binding) => (
              <li key={`${binding.kind}:${binding.targetId}`} className="flex items-center gap-2 text-xs">
                <Badge tone={binding.kind === "auto_run" ? "warning" : "neutral"}>
                  {t(binding.kind === "auto_run" ? "taskLocal.autoRun" : "taskLocal.worktree")}
                </Badge>
                <span className="font-mono">{binding.targetId}</span>
                {binding.worktreeId ? (
                  <button type="button" className="ml-auto text-primary hover:underline" onClick={() => openWorktreeResult(binding.worktreeId)}>
                    {t("taskLocal.openWorktree")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="space-y-2 border-t border-border pt-4">
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
                    <button type="button" aria-label={t("taskLocal.deleteComment")} onClick={() => removeComment(row)}><Trash2 className="size-3.5" /></button>
                  </span>
                ) : null}
              </div>
            </div>
          ))}
          {!comments.length ? <p className="text-xs text-muted-foreground">{t("taskLocal.noComments")}</p> : null}
        </div>
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">{t("taskLocal.activity")}</h3>
        <ul className="space-y-1">
          {activity.map((row) => (
            <li key={row.id} className="flex gap-2 text-xs">
              <Badge tone="neutral">{t(`taskLocal.activityAction.${row.action}`, { defaultValue: row.action })}</Badge>
              <span>{row.actorId}</span>
              <span className="ml-auto text-muted-foreground">{row.createdAt.replace("T", " ").slice(0, 16)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function CreateLocalWorkItemForm({
  projects,
  initialProjectId,
  onDone,
}: {
  projects: { id: string; name: string }[];
  initialProjectId: string;
  onDone: () => void;
}) {
  const { t } = useAppTranslation();
  const { execute, pending, error } = useAsyncAction();
  const [projectId, setProjectId] = useState(initialProjectId);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<LocalWorkItem["type"]>("task");
  const [priority, setPriority] = useState<LocalWorkItem["priority"]>("p2");
  const [labels, setLabels] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [milestone, setMilestone] = useState("");
  const [estimatePoints, setEstimatePoints] = useState("0");
  const submit = () => {
    void execute(() => api.createWorkItem({
      projectId,
      title,
      body,
      type,
      priority,
      labels: labels.split(",").map((value) => value.trim()).filter(Boolean),
      acceptanceCriteria: acceptance.split("\n").map((value) => value.trim()).filter(Boolean),
      dueDate: dueDate || null,
      milestone,
      estimatePoints: Number(estimatePoints),
    })).then(onDone);
  };
  return (
    <div className="space-y-3">
      <Field label={t("tasks.project")}>
        <Select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </Select>
      </Field>
      <Field label={t("tasks.localTitle")}>
        <Input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("tasks.type")}>
          <Select value={type} onChange={(event) => setType(event.target.value as LocalWorkItem["type"])}>
            {(["task", "bug", "feature", "initiative"] as const).map((value) => <option key={value} value={value}>{t(`tasks.localType.${value}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("tasks.priority")}>
          <Select value={priority} onChange={(event) => setPriority(event.target.value as LocalWorkItem["priority"])}>
            {(["p0", "p1", "p2", "p3"] as const).map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
          </Select>
        </Field>
      </div>
      <Field label={t("tasks.descriptionField")}>
        <textarea className="min-h-24 w-full rounded-md border border-border bg-background p-2 text-sm" value={body} onChange={(event) => setBody(event.target.value)} />
      </Field>
      <Field label={t("tasks.labels")}>
        <Input value={labels} onChange={(event) => setLabels(event.target.value)} placeholder={t("tasks.labelsPlaceholder")} />
      </Field>
      <Field label={t("tasks.acceptanceCriteria")}>
        <textarea className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm" value={acceptance} onChange={(event) => setAcceptance(event.target.value)} placeholder={t("tasks.acceptancePlaceholder")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("taskLocal.dueDate")}><Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field>
        <Field label={t("taskLocal.milestone")}><Input value={milestone} onChange={(event) => setMilestone(event.target.value)} /></Field>
        <Field label={t("planningInsights.estimatePoints")}><Input type="number" min="0" max="1000" value={estimatePoints} onChange={(event) => setEstimatePoints(event.target.value)} /></Field>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button disabled={pending || !projectId || !title.trim()} onClick={submit}>{t("tasks.createLocal")}</Button>
      </div>
    </div>
  );
}

// #1163: the durable claim trail for one issue — each row is a recorded
// transition from issueClaimEvents (#1152), newest first. Read-only.
const CLAIM_EVENT_TONE = { claimed: "warning", released: "neutral", expired: "danger" } as const;
function ClaimHistoryList({ events }: { events: IssueClaimEvent[] }) {
  const { t } = useAppTranslation();
  if (!events.length) return <p className="text-sm text-muted-foreground">{t("tasks.noClaimHistory")}</p>;
  return (
    <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
      {events.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/60 px-2.5 py-1.5 text-xs">
          <Badge tone={CLAIM_EVENT_TONE[e.type] ?? "neutral"}>{e.type}</Badge>
          <span className="font-medium">{e.claimedBy}</span>
          <span className="text-muted-foreground">{e.mode}</span>
          {e.type === "released" && e.actorId && e.actorId !== e.claimedBy ? (
            <span className="text-muted-foreground">{t("tasks.releasedBy", { actor: e.actorId })}</span>
          ) : null}
          {e.outcome && e.outcome !== "released" ? <span className="text-muted-foreground">{e.outcome.replaceAll("_", " ")}</span> : null}
          {e.autoRunId ? <span className="font-mono text-muted-foreground">{e.autoRunId}</span> : null}
          <span className="ml-auto text-muted-foreground">{e.at.replace("T", " ").slice(0, 16)}</span>
        </li>
      ))}
    </ul>
  );
}

// Worktree-creation options for a Task item: branch name (smart-suggested for an
// issue), base branch, and agent. A PR checks out its own branch, so only the
// agent is offered.
function WorktreeOptionsForm({ row, onDone }: { row: Row; onDone: (wt: { id: string; projectId: string } | null) => void }) {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const agents = state?.agents ?? [];
  const isPr = row.type === "pr";

  const [branch, setBranch] = useState(branchFromIssue(row));
  const [base, setBase] = useState("main");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [suggesting, setSuggesting] = useState(false);

  async function suggest() {
    setSuggesting(true);
    try {
      const r = (await api.suggestWorktreeName(row.title)) as { name?: string };
      if (r.name) setBranch(r.name);
    } catch {
      /* keep the slug fallback */
    }
    setSuggesting(false);
  }

  function create() {
    const link = worktreeLinkFor(row);
    const payload = isPr
      ? { prNumber: row.number, agentId: agentId || undefined, link }
      : { name: branch.trim() || branchFromIssue(row), startPoint: base.trim() || undefined, agentId: agentId || undefined, link };
    void execute(async () => {
      const r = (await api.createWorktree(row.projectId, payload)) as { worktree?: { id: string; projectId: string } };
      onDone(r.worktree ?? null);
      return r;
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {isPr ? (
          <>{t("tasks.checkoutPr", { number: row.number })}{row.headRefName ? <> (<span className="font-mono">{row.headRefName}</span>)</> : null}.</>
        ) : (
          <>{t("tasks.createIssueBranch", { number: row.number })}</>
        )}
      </p>
      {!isPr ? (
        <>
          <Field label={t("tasks.branchName")}>
            <div className="flex gap-2">
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} className="font-mono" />
              <Button variant="secondary" size="sm" disabled={suggesting} onClick={suggest} title={t("tasks.suggestName")}>
                {t("tasks.suggest")}
              </Button>
            </div>
          </Field>
          <Field label={t("tasks.baseBranch")}>
            <Input value={base} onChange={(e) => setBase(e.target.value)} className="font-mono" placeholder="main" />
          </Field>
        </>
      ) : null}
      <Field label={t("tasks.agent")}>
        <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => onDone(null)}>
          {t("tasks.cancel")}
        </Button>
        <Button size="sm" disabled={pending} onClick={create}>
          {t("tasks.createWorktree")}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
