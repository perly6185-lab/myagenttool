import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { GitPullRequest, Plus, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useUiStore } from "@/store/ui-store";
import type { LocalWorkItem, LocalWorkItemResult } from "./task-view-types";

const CreateLocalWorkItemForm = lazy(() => import("./create-local-work-item-form"));

type TaskFilter = "all" | "active" | "waiting" | "done";

function taskMatchesFilter(item: LocalWorkItem, filter: TaskFilter) {
  if (filter === "active") return item.status === "ready" || item.status === "in_progress";
  if (filter === "waiting") return item.status === "review" || item.status === "blocked" || item.waitingOn !== "none";
  if (filter === "done") return item.status === "done" || item.state === "closed";
  return true;
}

function sourceLabel(item: LocalWorkItem) {
  const binding = item.externalBindings?.find((candidate) => candidate.isPrimary)
    ?? item.externalBindings?.[0];
  if (!binding) return null;
  const provider = binding.provider ?? binding.kind.split("_")[0];
  return `${provider === "github" ? "GitHub" : provider === "gitlab" ? "GitLab" : "Gitea"} #${binding.number}`;
}

function statusLabelKey(item: LocalWorkItem) {
  return String(item.status) === "completed" ? "done" : item.status;
}

function statusTone(item: LocalWorkItem): "success" | "danger" | "warning" | "neutral" {
  const status = String(item.status);
  if (status === "done" || status === "completed") return "success";
  if (status === "blocked") return "danger";
  if (status === "review") return "warning";
  return "neutral";
}

/** Ordinary-user task center: only product-owned local tasks appear here. */
export function LocalTasksView() {
  const { t, i18n } = useAppTranslation();
  const zh = i18n.language.startsWith("zh");
  const { data: state } = useConsoleState();
  const openWorkItem = useUiStore((store) => store.openWorkItem);
  const navigate = usePageNavigation();
  const detailPreference = useUiStore((store) => store.workItemDetailPreference);
  const projects = useMemo(
    () => (state?.projects ?? []).filter((project) => project.status !== "archived"),
    [state?.projects],
  );
  const [items, setItems] = useState<LocalWorkItem[]>([]);
  const [projectId, setProjectId] = useState("all");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importActive, setImportActive] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const refresh = () => setNonce((value) => value + 1);
    window.addEventListener("myagenttool:state-change", refresh);
    return () => window.removeEventListener("myagenttool:state-change", refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    void (api.listWorkItems({
      projectId: projectId === "all" ? undefined : projectId,
      limit: "100",
    }) as Promise<LocalWorkItemResult>)
      .then((result) => {
        if (cancelled) return;
        setItems(result.workItems);
        setNextCursor(result.nextCursor ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setNextCursor(null);
        setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [nonce, projectId]);

  const counts = {
    all: items.length,
    active: items.filter((item) => taskMatchesFilter(item, "active")).length,
    waiting: items.filter((item) => taskMatchesFilter(item, "waiting")).length,
    done: items.filter((item) => taskMatchesFilter(item, "done")).length,
  };
  const visible = items.filter((item) => {
    if (!taskMatchesFilter(item, filter)) return false;
    const projectName = projects.find((project) => project.id === item.projectId)?.name ?? "";
    const normalized = query.trim().toLowerCase();
    return !normalized || `${item.localRef} ${item.title} ${item.labels.join(" ")} ${projectName}`.toLowerCase().includes(normalized);
  });

  function open(item: LocalWorkItem) {
    openWorkItem(item.id, {
      mode: item.routineDefinitionId ? "expert" : detailPreference,
      section: "overview",
    });
  }

  function loadMore() {
    if (!nextCursor) return;
    void (api.listWorkItems({
      projectId: projectId === "all" ? undefined : projectId,
      limit: "100",
      cursor: nextCursor,
    }) as Promise<LocalWorkItemResult>).then((result) => {
      setItems((current) => [...current, ...result.workItems.filter((item) =>
        !current.some((existing) => existing.id === item.id))]);
      setNextCursor(result.nextCursor ?? null);
    });
  }

  const filters: Array<{ key: TaskFilter; label: string }> = [
    { key: "all", label: zh ? "全部" : "All" },
    { key: "active", label: zh ? "进行中" : "Active" },
    { key: "waiting", label: zh ? "等待中" : "Waiting" },
    { key: "done", label: zh ? "已完成" : "Done" },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{t("tasks.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("tasks.description")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={loading} onClick={() => setNonce((value) => value + 1)} title={t("tasks.refresh")}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => navigate("externalWork")}>
              <GitPullRequest className="mr-1 size-4" />{t("externalWork.title")}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 size-4" />{t("tasks.newLocal")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs" role="tablist" aria-label={zh ? "任务状态" : "Task status"}>
            {filters.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={filter === item.key}
                onClick={() => setFilter(item.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium transition",
                  filter === item.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}<span className="ml-1.5 text-muted-foreground">{counts[item.key]}</span>
              </button>
            ))}
          </div>
          <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label={t("tasks.project")} className="h-8 w-auto text-xs">
            <option value="all">{t("tasks.allProjects")}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </Select>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("tasks.searchPlaceholder")} aria-label={t("tasks.search")} className="h-8 max-w-xs text-xs" />
        </div>

        {loadFailed ? <p className="text-xs text-destructive">{t("tasks.requestFailed")}</p> : null}
        {!visible.length && !loading ? (
          <EmptyState title={t("tasks.noLocalIssues")} hint={t("tasks.noLocalMatches")} />
        ) : (
          <>
          <div className="space-y-2 sm:hidden">
            {visible.map((item) => {
              const project = projects.find((candidate) => candidate.id === item.projectId);
              const source = sourceLabel(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  className="w-full rounded-lg border border-border p-3 text-left hover:bg-muted/40"
                  onClick={() => open(item)}
                >
                  <span className="font-medium">{item.title}</span>
                  <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="font-mono">{item.localRef}</span>
                    <Badge tone={statusTone(item)}>{t(`tasks.localStatus.${statusLabelKey(item)}`)}</Badge>
                    {item.priority === "p0" || item.priority === "p1" ? <Badge tone={item.priority === "p0" ? "danger" : "warning"}>{item.priority.toUpperCase()}</Badge> : null}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{project?.name ?? "—"}</span>
                    <span>{source ?? (zh ? "手动创建" : "Created here")}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border border-border sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{zh ? "任务" : "Task"}</th>
                  <th className="px-3 py-2 font-medium">{t("tasks.project")}</th>
                  <th className="px-3 py-2 font-medium">{t("tasks.state")}</th>
                  <th className="px-3 py-2 font-medium">{zh ? "来源" : "Source"}</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => {
                  const project = projects.find((candidate) => candidate.id === item.projectId);
                  const source = sourceLabel(item);
                  return (
                    <tr key={item.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-3">
                        <button type="button" className="text-left font-medium hover:text-primary" onClick={() => open(item)}>{item.title}</button>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="font-mono">{item.localRef}</span>
                          {item.priority === "p0" || item.priority === "p1" ? <Badge tone={item.priority === "p0" ? "danger" : "warning"}>{item.priority.toUpperCase()}</Badge> : null}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{project?.name ?? "—"}</td>
                      <td className="px-3 py-3"><Badge tone={statusTone(item)}>{t(`tasks.localStatus.${statusLabelKey(item)}`)}</Badge></td>
                      <td className="px-3 py-3">{source ? <Badge tone="neutral">{source}</Badge> : <span className="text-xs text-muted-foreground">{zh ? "手动创建" : "Created here"}</span>}</td>
                      <td className="px-3 py-3 text-right"><Button size="sm" variant="secondary" onClick={() => open(item)}>{zh ? "打开" : "Open"}</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
        {nextCursor ? <Button variant="secondary" size="sm" onClick={loadMore}>{zh ? "加载更多" : "Load more"}</Button> : null}
      </CardContent>

      <Modal
        open={createOpen}
        onClose={() => { if (!importActive) setCreateOpen(false); }}
        title={t("tasks.newLocal")}
        closeDisabled={importActive}
      >
        {createOpen ? (
          <Suspense fallback={<p className="py-8 text-center text-sm text-muted-foreground">{t("tasks.loading")}</p>}>
            <CreateLocalWorkItemForm
              projects={projects}
              users={state?.users ?? []}
              initialProjectId={projectId === "all" ? projects[0]?.id ?? "" : projectId}
              onImportActivityChange={setImportActive}
              onDone={() => {
                setImportActive(false);
                setCreateOpen(false);
                setNonce((value) => value + 1);
              }}
            />
          </Suspense>
        ) : null}
      </Modal>
    </Card>
  );
}
