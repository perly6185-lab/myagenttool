import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, GitBranch, Inbox, LoaderCircle, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { api, useAsyncAction } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useUiStore } from "@/store/ui-store";
import type { GithubResult, LocalWorkItem, LocalWorkItemResult, Row } from "./task-view-types";

const ExternalIssueImportDialog = lazy(() => import("./external-issue-import-dialog")
  .then((module) => ({ default: module.ExternalIssueImportDialog })));

/**
 * External code-host records are intake and delivery context, not Tasks.
 * Issues may become a local task; PRs/MRs remain reviewable code changes.
 */
export function ExternalWorkView() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const navigate = usePageNavigation();
  const openWorkItem = useUiStore((store) => store.openWorkItem);
  const setSelectedProjectId = useUiStore((store) => store.setSelectedProjectId);
  const setSelectedWorktreeId = useUiStore((store) => store.setSelectedWorktreeId);
  const restoredTab = useUiStore((store) => store.selectedExternalWorkTab);
  const rememberTab = useUiStore((store) => store.setSelectedExternalWorkTab);
  const projects = useMemo(
    () => (state?.projects ?? []).filter((project) => project.status !== "archived"),
    [state?.projects],
  );
  const worktrees = state?.worktrees ?? [];
  const repoProjectIds = useMemo(
    () => new Set((state?.projectTargets ?? [])
      .filter((target) => target.state === "ready")
      .map((target) => target.projectId)),
    [state?.projectTargets],
  );
  const repoProjects = useMemo(
    () => projects.filter((project) => repoProjectIds.has(project.id)),
    [projects, repoProjectIds],
  );
  const [projectId, setProjectId] = useState("all");
  const [tab, setTab] = useState(restoredTab ?? "issue");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [localRows, setLocalRows] = useState<LocalWorkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => setTab(restoredTab ?? "issue"), [restoredTab]);

  function selectTab(next: "issue" | "pr") {
    setTab(next);
    rememberTab?.(next);
  }

  const targetProjects = projectId === "all"
    ? repoProjects
    : repoProjects.filter((project) => project.id === projectId);

  useEffect(() => {
    let cancelled = false;
    void (api.listWorkItems({
      projectId: projectId === "all" ? undefined : projectId,
      limit: "100",
    }) as Promise<LocalWorkItemResult>)
      .then((result) => {
        if (!cancelled) setLocalRows(result.workItems);
      })
      .catch(() => {
        if (!cancelled) setLocalRows([]);
      });
    return () => { cancelled = true; };
  }, [projectId, nonce]);

  useEffect(() => {
    let cancelled = false;
    if (!targetProjects.length) {
      setRows([]);
      setNotice(repoProjects.length ? null : t("tasks.noRepoProject"));
      return () => { cancelled = true; };
    }
    setLoading(true);
    setNotice(null);
    void Promise.all(targetProjects.map((project) =>
      (api.listGithubItems(project.id) as Promise<GithubResult>)
        .then((result) => ({ project, result }))
        .catch(() => ({
          project,
          result: { available: false, message: t("tasks.requestFailed"), items: [] } as GithubResult,
        })),
    )).then((results) => {
      if (cancelled) return;
      const next: Row[] = [];
      const unavailable: string[] = [];
      for (const { project, result } of results) {
        if (!result.available) unavailable.push(`${project.name}: ${result.message}`);
        for (const item of result.items) {
          next.push({ ...item, projectId: project.id, projectName: project.name });
        }
      }
      next.sort((left, right) => right.number - left.number);
      setRows(next);
      setNotice(next.length ? null : unavailable.join(" · ") || null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [nonce, projectId, repoProjects.length]);

  const visible = rows
    .filter((row) => row.type === tab)
    .filter((row) => {
      const normalized = query.trim().toLowerCase();
      return !normalized || `${row.number} ${row.title} ${row.projectName}`.toLowerCase().includes(normalized);
    });

  function linkedTask(row: Row) {
    return localRows.find((item) => item.projectId === row.projectId && item.externalBindings?.some((binding) =>
      (binding.provider === "github" || binding.kind === "github_issue") && binding.number === row.number));
  }

  function linkedWorktree(row: Row) {
    return worktrees.find((worktree) => worktree.projectId === row.projectId
      && worktree.link?.type === row.type
      && worktree.link?.number === row.number);
  }

  function openTask(item: LocalWorkItem) {
    openWorkItem(item.id, { mode: "summary", section: "overview" });
    navigate("task");
  }

  function createTask(row: Row) {
    void execute(async () => {
      try {
        const result = await api.createWorkItemFromExternal({
          projectId: row.projectId,
          provider: "github",
          issueNumber: row.number,
          relation: "source",
          isPrimary: true,
          syncPolicy: "manual",
        }) as { workItem: LocalWorkItem };
        setLocalRows((current) => [result.workItem, ...current.filter((item) => item.id !== result.workItem.id)]);
        openTask(result.workItem);
        return result;
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === "external_issue_already_linked") {
          const existing = caught.details?.workItem as LocalWorkItem | undefined;
          if (existing?.id) {
            setLocalRows((current) => [existing, ...current.filter((item) => item.id !== existing.id)]);
            openTask(existing);
            return existing;
          }
        }
        throw caught;
      }
    });
  }

  function openProjectWorktree(row: Row) {
    const worktree = linkedWorktree(row);
    if (!worktree) return;
    setSelectedProjectId(row.projectId);
    setSelectedWorktreeId(worktree.id);
    navigate("projects");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{t("externalWork.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("externalWork.description")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={loading}
              onClick={() => setNonce((value) => value + 1)}
              title={t("externalWork.refresh")}
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <Inbox className="mr-1 size-4" />{t("externalWork.createFromIssue")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/25 p-3 text-sm">
          <p className="font-medium">{t(tab === "issue" ? "externalWork.incomingHint" : "externalWork.changesHint")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("externalWork.githubOnlyHint")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs" role="tablist" aria-label={t("externalWork.title")}>
            {(["issue", "pr"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => selectTab(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium transition",
                  tab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(key === "issue" ? "externalWork.issues" : "externalWork.changes")}
                <span className="ml-1.5 text-muted-foreground">{rows.filter((row) => row.type === key).length}</span>
              </button>
            ))}
          </div>
          <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label={t("tasks.project")} className="h-8 w-auto text-xs">
            <option value="all">{t("tasks.allProjects")}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </Select>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("externalWork.searchPlaceholder")}
            aria-label={t("externalWork.search")}
            className="h-8 max-w-xs text-xs"
          />
        </div>

        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        {loading && !visible.length ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground" role="status">
            <LoaderCircle className="size-4 animate-spin" />{t("tasks.loading")}
          </div>
        ) : !visible.length ? (
          <EmptyState
            title={t(tab === "issue" ? "externalWork.emptyIssues" : "externalWork.emptyChanges")}
            hint={t("externalWork.emptyHint")}
          />
        ) : (
          <>
          <div className="space-y-2 sm:hidden">
            {visible.map((row) => {
              const task = row.type === "issue" ? linkedTask(row) : undefined;
              const worktree = linkedWorktree(row);
              return (
                <article key={`${row.projectId}:${row.type}:${row.number}`} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{row.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">#{row.number} · {row.projectName}</p>
                    </div>
                    <Badge tone={row.state === "open" ? "success" : "neutral"}>{row.state}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge tone="neutral">GitHub</Badge>
                    {row.headRefName ? <><GitBranch className="size-3" /><span className="break-all font-mono">{row.headRefName}</span></> : null}
                    {task ? <Badge tone="success">{t("externalWork.linkedTask")} · {task.localRef}</Badge> : null}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    {row.type === "issue" ? (
                      task ? (
                        <Button size="sm" variant="secondary" onClick={() => openTask(task)}>{t("externalWork.openTask")}</Button>
                      ) : (
                        <Button size="sm" disabled={pending} onClick={() => createTask(row)}>{t("externalWork.createTask")}</Button>
                      )
                    ) : worktree ? (
                      <Button size="sm" variant="secondary" onClick={() => openProjectWorktree(row)}>{t("tasks.open")}</Button>
                    ) : null}
                    {row.url ? (
                      <a href={row.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                        {t("tasks.openGithub")}<ArrowUpRight className="size-4" />
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border border-border sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">{t("tasks.titleContext")}</th>
                  <th className="px-3 py-2 font-medium">{t("externalWork.source")}</th>
                  <th className="px-3 py-2 font-medium">{t("tasks.state")}</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const task = row.type === "issue" ? linkedTask(row) : undefined;
                  const worktree = linkedWorktree(row);
                  return (
                    <tr key={`${row.projectId}:${row.type}:${row.number}`} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">#{row.number}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{row.projectName}</span>
                          {row.headRefName ? <><span>·</span><GitBranch className="size-3" /><span className="font-mono">{row.headRefName}</span></> : null}
                          {task ? <Badge tone="success">{t("externalWork.linkedTask")} · {task.localRef}</Badge> : null}
                        </div>
                      </td>
                      <td className="px-3 py-2"><Badge tone="neutral">GitHub</Badge></td>
                      <td className="px-3 py-2"><Badge tone={row.state === "open" ? "success" : "neutral"}>{row.state}</Badge></td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2">
                          {row.type === "issue" ? (
                            task ? (
                              <Button size="sm" variant="secondary" onClick={() => openTask(task)}>{t("externalWork.openTask")}</Button>
                            ) : (
                              <Button size="sm" disabled={pending} onClick={() => createTask(row)}>{t("externalWork.createTask")}</Button>
                            )
                          ) : worktree ? (
                            <Button size="sm" variant="secondary" onClick={() => openProjectWorktree(row)}>{t("tasks.open")}</Button>
                          ) : null}
                          {row.url ? (
                            <a href={row.url} target="_blank" rel="noreferrer" className="inline-grid size-8 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" title={t("tasks.openGithub")}>
                              <ArrowUpRight className="size-4" />
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </CardContent>

      {importOpen ? (
        <Suspense fallback={null}>
          <ExternalIssueImportDialog
            open
            projects={projects}
            repoProjectIds={repoProjectIds}
            initialProjectId={projectId === "all" ? projects[0]?.id : projectId}
            onClose={() => setImportOpen(false)}
            onImported={(workItem) => {
              setImportOpen(false);
              setLocalRows((current) => [workItem, ...current.filter((item) => item.id !== workItem.id)]);
              openTask(workItem);
            }}
          />
        </Suspense>
      ) : null}
    </Card>
  );
}
