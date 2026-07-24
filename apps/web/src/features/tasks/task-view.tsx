import { useEffect, useMemo, useState } from "react";
import { Hand, History, RefreshCw, ExternalLink, GitBranch, Workflow, Zap, Plus, Save, MessageSquare, Trash2, Pencil, FolderKanban } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
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
  labels: string[];
  assigneeIds: string[];
  acceptanceCriteria: string[];
  revision: number;
  archivedAt: string | null;
  executionBindings?: { kind: "worktree" | "auto_run"; targetId: string; worktreeId: string | null; createdAt: string }[];
  planningProjects?: { id: string; name: string; archivedAt: string | null }[];
  updatedAt: string;
};
type LocalWorkItemResult = { workItems: LocalWorkItem[]; count: number };
type PlanningProject = {
  id: string;
  name: string;
  description: string;
  revision: number;
  archivedAt: string | null;
  itemCount: number;
  openItemCount: number;
  completedItemCount: number;
  statusCounts: Record<LocalWorkItem["status"], number>;
  priorityCounts: Record<LocalWorkItem["priority"], number>;
  items?: { workItem: LocalWorkItem }[];
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
  const [planningProjects, setPlanningProjects] = useState<PlanningProject[]>([]);
  const [planningProjectId, setPlanningProjectId] = useState("all");
  const [createLocalOpen, setCreateLocalOpen] = useState(false);
  const [planningOpen, setPlanningOpen] = useState(false);
  const [selectedLocalId, setSelectedLocalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const targetProjects = projectId === "all" ? repoProjects : repoProjects.filter((p) => p.id === projectId);

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
          <LocalWorkItemTable
            items={visibleLocal}
            projects={projects}
            emptyTitle={t("tasks.noLocalIssues")}
            emptyHint={t("tasks.noLocalMatches")}
            onOpen={setSelectedLocalId}
          />
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

function PlanningProjectsPanel({ onChanged }: { onChanged: () => void }) {
  const { t } = useAppTranslation();
  const { execute, pending, error } = useAsyncAction();
  const [projects, setProjects] = useState<PlanningProject[]>([]);
  const [workItems, setWorkItems] = useState<LocalWorkItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<"items" | "board">("items");
  const [nonce, setNonce] = useState(0);
  const selected = projects.find((project) => project.id === selectedId);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.listPlanningProjects(true) as Promise<{ projects: PlanningProject[] }>,
      api.listWorkItems() as Promise<LocalWorkItemResult>,
    ]).then(async ([result, workItemResult]) => {
      if (cancelled) return;
      setWorkItems(workItemResult.workItems);
      const nextId = selectedId || result.projects[0]?.id || "";
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
      const result = await api.createPlanningProject({ name, description }) as { project: PlanningProject };
      created = result.project;
      return result;
    }).then((ok) => {
      if (!ok || !created) return;
      setName("");
      setDescription("");
      setSelectedId(created.id);
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

  return (
    <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
      <div className="space-y-2">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("planningProjects.name")} />
        <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("planningProjects.description")} />
        <Button size="sm" disabled={pending || !name.trim()} onClick={create}><Plus className="mr-1 size-4" />{t("planningProjects.create")}</Button>
        <div className="space-y-1 border-t border-border pt-2">
          {projects.map((project) => (
            <button key={project.id} type="button" onClick={() => setSelectedId(project.id)}
              className={cn("flex w-full justify-between rounded-md px-2 py-1.5 text-left text-sm", selectedId === project.id ? "bg-muted font-medium" : "hover:bg-muted/60")}>
              <span className="truncate">{project.name}</span><Badge tone="neutral">{project.itemCount}</Badge>
            </button>
          ))}
          {!projects.length ? <p className="text-xs text-muted-foreground">{t("planningProjects.empty")}</p> : null}
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
                </div>
              ) : <div><h3 className="font-semibold">{selected.name}</h3><p className="text-sm text-muted-foreground">{selected.description || t("planningProjects.noDescription")}</p></div>}
              <div className="flex gap-1">
                {editing ? (
                  <Button size="sm" disabled={pending || !name.trim()} onClick={save}>{t("planningProjects.save")}</Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => { setName(selected.name); setDescription(selected.description); setEditing(true); }}>{t("planningProjects.edit")}</Button>
                )}
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
            <div className="flex gap-1 rounded-md bg-muted p-0.5 text-xs">
              {(["items", "board"] as const).map((value) => (
                <button key={value} type="button" onClick={() => setView(value)}
                  className={cn("rounded px-2 py-1", view === value && "bg-background shadow-sm")}>
                  {t(`planningProjects.${value}`)}
                </button>
              ))}
            </div>
            {view === "items" ? (
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {workItems.map((item) => {
                  const included = selected.items?.some((row) => row.workItem.id === item.id);
                  return (
                    <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
                      <input type="checkbox" checked={Boolean(included)} disabled={pending} onChange={() => toggleItem(item)} />
                      <span className="font-mono text-xs text-muted-foreground">{item.localRef}</span><span className="truncate">{item.title}</span>
                    </label>
                  );
                })}
                {!workItems.length ? <p className="text-xs text-muted-foreground">{t("planningProjects.noItems")}</p> : null}
              </div>
            ) : (
              <div className="grid max-h-96 grid-cols-2 gap-2 overflow-auto lg:grid-cols-3">
                {(["backlog", "ready", "in_progress", "review", "blocked", "done"] as const).map((status) => (
                  <section key={status} className="min-w-36 rounded-md bg-muted/60 p-2">
                    <h4 className="mb-2 flex justify-between text-xs font-semibold">
                      <span>{t(`tasks.localStatus.${status}`)}</span><Badge tone="neutral">{selected.statusCounts?.[status] ?? 0}</Badge>
                    </h4>
                    <div className="space-y-1.5">
                      {selected.items?.filter((row) => row.workItem.status === status).map(({ workItem }) => (
                        <div key={workItem.id} className="rounded border border-border bg-background p-2 text-xs">
                          <div className="font-mono text-muted-foreground">{workItem.localRef}</div>
                          <div className="mb-2 font-medium">{workItem.title}</div>
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
            )}
          </>
        ) : <EmptyState title={t("planningProjects.select")} hint={t("planningProjects.selectHint")} />}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
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
  const [comment, setComment] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");

  const load = async () => {
    try {
      const [detail, commentResult, activityResult] = await Promise.all([
        api.getWorkItem(workItemId) as Promise<{ workItem: LocalWorkItem }>,
        api.listWorkItemComments(workItemId) as Promise<{ comments: WorkItemComment[] }>,
        api.listWorkItemActivity(workItemId) as Promise<{ activities: WorkItemActivity[] }>,
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
      setComments(commentResult.comments);
      setActivity(activityResult.activities);
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

  return (
    <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">{item.localRef}</span>
        <span>{projects.find((project) => project.id === item.projectId)?.name ?? item.projectId}</span>
        <Badge tone={item.state === "open" ? "success" : "neutral"}>{t(`taskLocal.state.${item.state}`)}</Badge>
        <span>{t("taskLocal.revision", { revision: item.revision })}</span>
      </div>
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
  const submit = () => {
    void execute(() => api.createWorkItem({
      projectId,
      title,
      body,
      type,
      priority,
      labels: labels.split(",").map((value) => value.trim()).filter(Boolean),
      acceptanceCriteria: acceptance.split("\n").map((value) => value.trim()).filter(Boolean),
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
