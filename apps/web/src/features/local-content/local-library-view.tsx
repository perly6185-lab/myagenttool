import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Library, RefreshCw, Table2, X } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { SectionHeading } from "@/components/common/section-heading";
import { Button } from "@/components/ui/button";
import { useConsoleState } from "@/data/use-console-state";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { ApiError } from "@/lib/api/request";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useUiStore } from "@/store/ui-store";
import type { LocalWorkItem, LocalWorkItemResult } from "@/features/tasks/task-view-types";
import { localContentApi, workResourceApi } from "./local-content-api";
import type { LocalContentRecord, WorkResource } from "./local-content-types";
import { COPY } from "./local-library-copy";
import { useLocalContentFilters } from "./use-local-content-filters";

const AddToTaskModal = lazy(() => import("./local-library-modals").then((module) => ({ default: module.AddToTaskModal })));
const PreviewModal = lazy(() => import("./local-library-modals").then((module) => ({ default: module.PreviewModal })));
const LocalContentDetailModal = lazy(() => import("./local-library-modals").then((module) => ({ default: module.LocalContentDetailModal })));
const LocalContentDirectory = lazy(() => import("./local-content-directory").then((module) => ({ default: module.LocalContentDirectory })));
const LocalContentCard = lazy(() => import("./local-content-card").then((module) => ({ default: module.LocalContentCard })));
const WorkResourceDirectorySection = lazy(() => import("./work-resource-directory-section").then((module) => ({ default: module.WorkResourceDirectorySection })));
const LocalLibraryFilterPanel = lazy(() => import("./local-library-filter-panel").then((module) => ({ default: module.LocalLibraryFilterPanel })));

const TASK_PAGE_SIZE = 200;
const MAX_TASK_CANDIDATES = 1_000;

async function loadTaskCandidates() {
  const { api } = await import("@/lib/api-client");
  const workItems: LocalWorkItem[] = [];
  let cursor: string | undefined;
  let truncated = false;
  while (workItems.length < MAX_TASK_CANDIDATES) {
    const page = await api.listWorkItems({ limit: String(TASK_PAGE_SIZE), ...(cursor ? { cursor } : {}) }) as LocalWorkItemResult;
    const remaining = MAX_TASK_CANDIDATES - workItems.length;
    workItems.push(...page.workItems.slice(0, remaining));
    if (page.workItems.length > remaining || (workItems.length >= MAX_TASK_CANDIDATES && page.hasMore)) {
      truncated = true;
      break;
    }
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor ?? undefined;
  }
  return { workItems, count: workItems.length, hasMore: truncated } satisfies LocalWorkItemResult;
}

function openTasksFor(record: LocalContentRecord, workItems: LocalWorkItem[]) {
  return workItems.filter((item) => item.state === "open" && item.status !== "done" && (!record.projectId || item.projectId === record.projectId));
}

export function LocalLibraryView() {
  const { i18n } = useAppTranslation();
  const language = i18n.language.startsWith("zh") ? "zh" : "en";
  const copy = COPY[language];
  const { data: consoleState } = useConsoleState();
  const navigate = usePageNavigation();
  const selectedWorkItemId = useUiStore((state) => state.selectedWorkItemId);
  const openWorkItem = useUiStore((state) => state.openWorkItem);
  const filters = useLocalContentFilters();
  const {
    query, setQuery, kind, setKind, projectId, setProjectId, setWorkItemId,
    sourceType, setSourceType, yearMonth, setYearMonth,
    mailAccountId, setMailAccountId, mailFolderId, setMailFolderId,
    page, resetPage, previousPage, nextPage, resetFilters,
    advancedFilterCount, activeFilterCount, searchQuery,
  } = filters;
  const [selected, setSelected] = useState<LocalContentRecord | null>(null);
  const [selectedResource, setSelectedResource] = useState<WorkResource | null>(null);
  const [libraryView, setLibraryView] = useState<"all" | "tables">("all");
  const [targetTaskId, setTargetTaskId] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addedTask, setAddedTask] = useState<LocalWorkItem | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<LocalContentRecord | null>(null);
  const [detailTarget, setDetailTarget] = useState<LocalContentRecord | null>(null);
  const [locatingId, setLocatingId] = useState<string | null>(null);
  const [locateFeedback, setLocateFeedback] = useState<string | null>(null);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<"reference" | "required_input">("required_input");
  const [createProjectId, setCreateProjectId] = useState("");
  const [createTaskTitle, setCreateTaskTitle] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const stats = useQuery({ queryKey: ["local-content", "stats"], queryFn: () => localContentApi.stats(), refetchInterval: 3_000 });
  const content = useQuery({
    queryKey: ["local-content", "search", searchQuery, stats.data?.catalog.lastRebuiltAt],
    queryFn: () => localContentApi.search(searchQuery),
  });
  const workItems = useQuery({
    queryKey: ["local-content", "work-items"],
    queryFn: loadTaskCandidates,
    enabled: true,
  });
  const preview = useQuery({
    queryKey: ["local-content", "preview", previewTarget?.id],
    queryFn: () => localContentApi.preview(previewTarget!.id),
    enabled: Boolean(previewTarget),
    retry: false,
  });
  const selectedTarget = selectedResource ?? selected;
  const candidates = useMemo(
    () => selectedTarget ? (workItems.data?.workItems ?? []).filter((item) => item.state === "open" && item.status !== "done" && (!selectedTarget.projectId || item.projectId === selectedTarget.projectId)) : [],
    [selectedTarget, workItems.data?.workItems],
  );

  useEffect(() => {
    if (!selectedTarget || !candidates.length) return;
    if (candidates.some((item) => item.id === targetTaskId)) return;
    setTargetTaskId(candidates.some((item) => item.id === selectedWorkItemId) ? selectedWorkItemId! : candidates[0].id);
  }, [candidates, selectedTarget, selectedWorkItemId, targetTaskId]);

  useEffect(() => {
    if (advancedFilterCount) setAdvancedOpen(true);
  }, [advancedFilterCount]);

  function choose(record: LocalContentRecord) {
    setSelected(record);
    setSelectedResource(null);
    setTargetTaskId("");
    setAddError(null);
    setAddedTask(null);
    setPurpose("required_input");
    setCreateProjectId(record.projectId ?? consoleState?.projects?.[0]?.id ?? "");
    setCreateTaskTitle(copy.createTaskDefault.replace("{{title}}", record.title));
  }

  function chooseResource(resource: WorkResource) {
    setSelected(null);
    setSelectedResource(resource);
    setTargetTaskId("");
    setAddError(null);
    setAddedTask(null);
    setPurpose("required_input");
    setCreateProjectId(resource.projectId ?? consoleState?.projects?.[0]?.id ?? "");
    setCreateTaskTitle(copy.createTaskDefault.replace("{{title}}", resource.displayName));
  }

  function closePicker() {
    if (adding || creatingTask) return;
    setSelected(null);
    setSelectedResource(null);
    setTargetTaskId("");
    setAddError(null);
    setAddedTask(null);
    setCreatingTask(false);
  }

  async function rebuild() {
    setRebuilding(true);
    setRebuildError(null);
    try {
      await localContentApi.rebuild();
      resetPage();
      await Promise.all([stats.refetch(), content.refetch()]);
    } catch {
      setRebuildError(copy.rebuildFailed);
    } finally {
      setRebuilding(false);
    }
  }

  async function addReference() {
    const task = candidates.find((item) => item.id === targetTaskId);
    if (!selectedTarget || !task || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const response = selectedResource
        ? await workResourceApi.addToWorkItem(task.id, {
          resourceId: selectedResource.id,
          expectedRevision: task.revision,
          purpose: purpose === "reference" ? "reference" : "query_source",
        })
        : await localContentApi.addToWorkItem(task.id, {
          contentId: selected!.id,
          expectedRevision: task.revision,
          purpose,
        });
      const next = response.workItem as LocalWorkItem;
      setAddedTask(next);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "local-content-reference-add", workItemId: next.id } }));
      await workItems.refetch();
    } catch (error) {
      setAddError(error instanceof ApiError && error.code === "local_content_original_changed"
        ? copy.changed
        : error instanceof ApiError && error.code === "local_content_original_unavailable"
          ? copy.originalMissing
          : copy.addFailed);
    } finally {
      setAdding(false);
    }
  }

  async function createTaskAndAddReference() {
    if (!selectedTarget || !createProjectId || !createTaskTitle.trim() || creatingTask) return;
    setCreatingTask(true);
    setAddError(null);
    let created: LocalWorkItem | null = null;
    try {
      const response = await localContentApi.createTask({
        projectId: createProjectId,
        title: createTaskTitle.trim(),
        body: selectedTarget.summary || ("title" in selectedTarget ? selectedTarget.title : selectedTarget.displayName),
        idempotencyKey: `work-resource:${selectedTarget.id}:${createProjectId}:${createTaskTitle.trim().toLocaleLowerCase()}`.slice(0, 200),
      });
      created = response.workItem as LocalWorkItem;
      const attached = selectedResource
        ? await workResourceApi.addToWorkItem(created.id, {
          resourceId: selectedResource.id,
          expectedRevision: created.revision,
          purpose: purpose === "reference" ? "reference" : "query_source",
        })
        : await localContentApi.addToWorkItem(created.id, {
          contentId: selected!.id,
          expectedRevision: created.revision,
          purpose,
        });
      setAddedTask(attached.workItem as LocalWorkItem);
      window.dispatchEvent(new CustomEvent("myagenttool:state-change", { detail: { source: "local-content-task-create", workItemId: created.id } }));
      await workItems.refetch();
    } catch {
      if (created) {
        setAddedTask(created);
        setAddError(copy.createdWithoutReference);
      } else {
        setAddError(copy.addFailed);
      }
    } finally {
      setCreatingTask(false);
    }
  }

  async function locateOriginal(record: LocalContentRecord) {
    if (locatingId) return;
    setLocatingId(record.id);
    setLocateFeedback(null);
    setLocateError(null);
    try {
      const result = await localContentApi.reveal(record.id);
      setLocateFeedback(copy.located.replace("{{name}}", result.name ?? record.title));
    } catch {
      setLocateError(copy.locateFailed);
    } finally {
      setLocatingId(null);
    }
  }

  function handleRemovedFromLibrary() {
    setPreviewTarget(null);
    setDetailTarget(null);
    setLocateFeedback(copy.removedFromLibrary);
    content.refetch();
  }

  function goToAddedTask() {
    if (!addedTask) return;
    openWorkItem(addedTask.id, { section: "assets" });
    navigate("task");
    closePicker();
  }

  const catalog = stats.data?.catalog;
  const hasIndexedContent = (catalog?.total ?? 0) > 0;
  const projects = consoleState?.projects ?? [];
  const taskProjects = selectedTarget?.projectId
    ? projects.filter((project) => project.id === selectedTarget.projectId)
    : projects;
  const truncatedFacetGroups = Object.values(catalog?.facets?.coverage ?? {}).filter((coverage) => coverage.truncated).length;
  const records = content.data?.results ?? [];
  const indexing = (catalog?.indexing?.queued ?? 0) + (catalog?.indexing?.running ?? 0) > 0;
  const previewErrorCode = preview.error instanceof ApiError ? preview.error.code : null;
  const previewErrorCopy = previewErrorCode === "local_content_preview_unsupported"
    ? copy.previewUnsupported
    : previewErrorCode === "local_content_preview_needs_ocr"
      ? copy.previewNeedsOcr
      : previewErrorCode === "local_content_preview_too_large"
        ? copy.previewTooLarge
        : previewErrorCode === "local_content_preview_extraction_failed"
          ? copy.previewExtractionFailed
          : copy.previewFailed;

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
        actions={<>
          <Button size="sm" variant="secondary" onClick={() => navigate("documents")}>
            {copy.openProjectFiles}
          </Button>
          {libraryView === "all" ? <Button size="sm" variant="secondary" disabled={rebuilding} onClick={() => void rebuild()}>
            <RefreshCw className={cn("size-4", rebuilding && "animate-spin")} aria-hidden />
            {rebuilding ? copy.rebuilding : hasIndexedContent ? copy.refresh : copy.build}
          </Button> : null}
        </>}
      />

      <div className="flex flex-wrap gap-2 border-b border-border pb-3" role="tablist" aria-label={copy.title}>
        <Button size="sm" variant={libraryView === "all" ? "primary" : "ghost"} role="tab" aria-selected={libraryView === "all"} onClick={() => setLibraryView("all")}><Library aria-hidden />{copy.allContentView}</Button>
        <Button size="sm" variant={libraryView === "tables" ? "primary" : "ghost"} role="tab" aria-selected={libraryView === "tables"} onClick={() => setLibraryView("tables")}><Table2 aria-hidden />{copy.tablesView}</Button>
      </div>

      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl border border-border bg-muted/40" aria-busy="true" />}>
        <WorkResourceDirectorySection
          mode={libraryView}
          query={query}
          projectId={projectId}
          projects={projects}
          locale={i18n.language}
          copy={copy}
          onQueryChange={setQuery}
          onProjectChange={setProjectId}
          onChoose={chooseResource}
          onManage={(resource) => {
            if (resource.actions.managementSection === "workflowMemory") navigate("workflowMemory");
          }}
        />
      </Suspense>

      {libraryView === "all" ? <div className="space-y-5">

      {catalog ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" role="status">
          <span>{copy.indexed.replace("{{count}}", String(catalog.total)).replace("{{available}}", String(catalog.available))}</span>
          {catalog.lastRebuiltAt ? <span>{copy.lastIndexed.replace("{{time}}", new Date(catalog.lastRebuiltAt).toLocaleString(i18n.language))}</span> : null}
        </div>
      ) : null}
      {rebuildError ? <p className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive" role="alert">{rebuildError}</p> : null}
      {indexing ? <p className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/[0.05] px-3 py-2 text-sm" role="status"><RefreshCw className="size-4 animate-spin text-primary" aria-hidden />{copy.autoIndexing}</p> : null}
      {(catalog?.indexing?.failed ?? 0) > 0 ? <p className="rounded-lg border border-warning/40 bg-warning/[0.07] px-3 py-2 text-sm" role="alert">{copy.autoIndexFailed}</p> : null}
      {truncatedFacetGroups ? <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" role="status">{copy.directoryLimited.replace("{{count}}", String(truncatedFacetGroups))}</p> : null}
      {locateFeedback ? <p className="rounded-lg border border-success/30 bg-success/[0.06] px-3 py-2 text-sm" role="status">{locateFeedback}</p> : null}
      {locateError ? <p className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive" role="alert">{locateError}</p> : null}

      <Suspense fallback={<div className="h-28 animate-pulse rounded-xl border border-border bg-muted/40" aria-busy="true" />}>
        <LocalLibraryFilterPanel
          copy={copy}
          filters={filters}
          projects={projects}
          catalog={catalog}
          workItems={workItems.data?.workItems ?? []}
          language={language}
          advancedOpen={advancedOpen}
          onAdvancedOpenChange={setAdvancedOpen}
        />
      </Suspense>

      <div className={cn(hasIndexedContent && "grid items-start gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]")}>
        {hasIndexedContent && catalog ? <Suspense fallback={<div className="h-64 animate-pulse rounded-xl border border-border bg-muted/40" />}><LocalContentDirectory
          copy={copy}
          catalog={catalog}
          projects={projects}
          language={language}
          kind={kind}
          projectId={projectId}
          sourceType={sourceType}
          yearMonth={yearMonth}
          mailAccountId={mailAccountId}
          mailFolderId={mailFolderId}
          onAll={() => { setKind("all"); setProjectId("all"); setSourceType("all"); setYearMonth("all"); setMailAccountId("all"); setMailFolderId("all"); resetPage(); }}
          onKind={(value) => {
            setKind(value);
            if (value !== "mail") {
              setMailAccountId("all");
              setMailFolderId("all");
            }
            resetPage();
          }}
          onProject={(value) => { setProjectId(value); resetPage(); }}
          onSource={(value) => { setSourceType(value); resetPage(); }}
          onMonth={(value) => { setYearMonth(value); resetPage(); }}
          onMailAccount={(accountId) => {
            setKind("mail");
            setProjectId("all");
            setWorkItemId("all");
            setMailAccountId(accountId);
            setMailFolderId("all");
            resetPage();
          }}
          onMailFolder={(accountId, folderId) => {
            setKind("mail");
            setProjectId("all");
            setWorkItemId("all");
            setMailAccountId(accountId);
            setMailFolderId(folderId);
            resetPage();
          }}
        /></Suspense> : null}
        <div className="min-w-0 space-y-4">
          {stats.isError || content.isError ? (
            <EmptyState title={copy.loadFailed} action={<Button size="sm" variant="secondary" onClick={() => { void stats.refetch(); void content.refetch(); }}>{copy.retry}</Button>} />
          ) : content.isLoading || stats.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2" aria-label={copy.rebuilding} aria-busy="true">
              {[0, 1, 2, 3].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl border border-border bg-muted/40" />)}
            </div>
          ) : !hasIndexedContent ? (
            <EmptyState title={copy.empty} hint={copy.emptyHint} action={<Button size="sm" disabled={rebuilding} onClick={() => void rebuild()}><Library aria-hidden />{copy.build}</Button>} />
          ) : !records.length ? (
            <EmptyState title={copy.noMatches} hint={copy.noMatchesHint} action={activeFilterCount
              ? <Button size="sm" variant="secondary" onClick={resetFilters}><X aria-hidden />{copy.clearFilters}</Button>
              : undefined} />
          ) : (
            <Suspense fallback={<div className="grid gap-3 md:grid-cols-2" aria-busy="true">{[0, 1].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl border border-border bg-muted/40" />)}</div>}><div className="grid gap-3 md:grid-cols-2">
              {records.map((record) => <LocalContentCard
                key={record.id}
                record={record}
                copy={copy}
                locating={locatingId === record.id}
                locateDisabled={Boolean(locatingId)}
                onDetails={() => setDetailTarget(record)}
                onPreview={() => setPreviewTarget(record)}
                onLocate={() => void locateOriginal(record)}
                onChoose={() => choose(record)}
              />)}
            </div></Suspense>
          )}

          {hasIndexedContent && records.length ? (
            <div className="flex items-center justify-center gap-3">
              <Button size="sm" variant="ghost" disabled={page === 0 || content.isFetching} onClick={previousPage}><ChevronLeft aria-hidden />{copy.previous}</Button>
              <span className="text-xs text-muted-foreground">{copy.page.replace("{{page}}", String(page + 1))}</span>
              <Button size="sm" variant="ghost" disabled={!content.data?.nextCursor || content.isFetching} onClick={() => nextPage(content.data?.nextCursor)}>{copy.next}<ChevronRight aria-hidden /></Button>
            </div>
          ) : null}
        </div>
      </div>
      </div> : null}

      {selectedTarget ? <Suspense fallback={null}><AddToTaskModal
        open={Boolean(selectedTarget)}
        copy={copy}
        adding={adding}
        addedTask={addedTask}
        candidates={candidates}
        targetTaskId={targetTaskId}
        purpose={purpose}
        projects={taskProjects}
        createProjectId={createProjectId}
        createTaskTitle={createTaskTitle}
        creatingTask={creatingTask}
        taskListTruncated={Boolean(workItems.data?.hasMore)}
        taskListLimit={MAX_TASK_CANDIDATES}
        error={addError}
        tasksLoading={workItems.isLoading}
        tasksError={workItems.isError}
        onClose={closePicker}
        onOpenTask={goToAddedTask}
        onRetryTasks={() => void workItems.refetch()}
        onTargetChange={setTargetTaskId}
        onPurposeChange={setPurpose}
        onCreateProjectChange={setCreateProjectId}
        onCreateTaskTitleChange={setCreateTaskTitle}
        onAdd={() => void addReference()}
        onCreateTask={() => void createTaskAndAddReference()}
      /></Suspense> : null}

      {previewTarget ? <Suspense fallback={null}><PreviewModal
        target={previewTarget}
        copy={copy}
        locale={i18n.language}
        loading={preview.isLoading}
        error={preview.isError}
        errorMessage={previewErrorCopy}
        preview={preview.data?.preview ?? null}
        locating={Boolean(locatingId)}
        onClose={() => setPreviewTarget(null)}
        onRetry={() => void preview.refetch()}
        onLocate={(record) => void locateOriginal(record)}
        onChoose={(record) => { setPreviewTarget(null); choose(record); }}
      /></Suspense> : null}

      {detailTarget ? <Suspense fallback={null}><LocalContentDetailModal
        target={detailTarget}
        copy={copy}
        locale={i18n.language}
        onClose={() => setDetailTarget(null)}
        onPreview={(record) => { setDetailTarget(null); setPreviewTarget(record); }}
        onLocate={(record) => void locateOriginal(record)}
        onChoose={(record) => { setDetailTarget(null); choose(record); }}
        onRemoved={handleRemovedFromLibrary}
      /></Suspense> : null}
    </div>
  );
}

export { openTasksFor };
