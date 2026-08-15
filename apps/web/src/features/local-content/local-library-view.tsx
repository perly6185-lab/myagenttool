import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Library, ListFilter, RefreshCw, Search, X } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { Field } from "@/components/common/field";
import { SectionHeading } from "@/components/common/section-heading";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useConsoleState } from "@/data/use-console-state";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { ApiError } from "@/lib/api/request";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useUiStore } from "@/store/ui-store";
import type { LocalWorkItem, LocalWorkItemResult } from "@/features/tasks/task-view-types";
import { localContentApi } from "./local-content-api";
import type { LocalContentKind, LocalContentRecord } from "./local-content-types";
import { LocalContentCard } from "./local-content-card";
import { COPY } from "./local-library-copy";
import { useLocalContentFilters } from "./use-local-content-filters";

const AddToTaskModal = lazy(() => import("./local-library-modals").then((module) => ({ default: module.AddToTaskModal })));
const PreviewModal = lazy(() => import("./local-library-modals").then((module) => ({ default: module.PreviewModal })));

const KINDS: LocalContentKind[] = ["article", "mail", "task", "task_input", "task_output"];
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
  const sourceLabels: Record<string, string> = language === "zh"
    ? { article_import: "导入文章", mail_archive: "归档邮件", work_item: "任务", task_material: "任务资料", task_output: "任务结果" }
    : { article_import: "Imported article", mail_archive: "Archived mail", work_item: "Task", task_material: "Task material", task_output: "Task result" };
  const { data: consoleState } = useConsoleState();
  const navigate = usePageNavigation();
  const selectedWorkItemId = useUiStore((state) => state.selectedWorkItemId);
  const openWorkItem = useUiStore((state) => state.openWorkItem);
  const {
    query, setQuery, kind, setKind, projectId, setProjectId, workItemId, setWorkItemId,
    sourceType, setSourceType, yearMonth, setYearMonth, availability, setAvailability,
    indexStatus, setIndexStatus, page, resetPage, previousPage, nextPage, resetFilters,
    advancedFilterCount, activeFilterCount, searchQuery,
  } = useLocalContentFilters();
  const [selected, setSelected] = useState<LocalContentRecord | null>(null);
  const [targetTaskId, setTargetTaskId] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addedTask, setAddedTask] = useState<LocalWorkItem | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<LocalContentRecord | null>(null);
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
  const candidates = useMemo(
    () => selected ? openTasksFor(selected, workItems.data?.workItems ?? []) : [],
    [selected, workItems.data?.workItems],
  );

  useEffect(() => {
    if (!selected || !candidates.length) return;
    if (candidates.some((item) => item.id === targetTaskId)) return;
    setTargetTaskId(candidates.some((item) => item.id === selectedWorkItemId) ? selectedWorkItemId! : candidates[0].id);
  }, [candidates, selected, selectedWorkItemId, targetTaskId]);

  useEffect(() => {
    if (advancedFilterCount) setAdvancedOpen(true);
  }, [advancedFilterCount]);

  function choose(record: LocalContentRecord) {
    setSelected(record);
    setTargetTaskId("");
    setAddError(null);
    setAddedTask(null);
    setPurpose("required_input");
    setCreateProjectId(record.projectId ?? consoleState?.projects?.[0]?.id ?? "");
    setCreateTaskTitle(copy.createTaskDefault.replace("{{title}}", record.title));
  }

  function closePicker() {
    if (adding || creatingTask) return;
    setSelected(null);
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
    if (!selected || !task || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const response = await localContentApi.addToWorkItem(task.id, {
        contentId: selected.id,
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
    if (!selected || !createProjectId || !createTaskTitle.trim() || creatingTask) return;
    setCreatingTask(true);
    setAddError(null);
    let created: LocalWorkItem | null = null;
    try {
      const response = await localContentApi.createTask({
        projectId: createProjectId,
        title: createTaskTitle.trim(),
        body: selected.summary || selected.title,
        idempotencyKey: `local-content:${selected.id}:${createProjectId}:${createTaskTitle.trim().toLocaleLowerCase()}`.slice(0, 200),
      });
      created = response.workItem as LocalWorkItem;
      const attached = await localContentApi.addToWorkItem(created.id, {
        contentId: selected.id,
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

  function goToAddedTask() {
    if (!addedTask) return;
    openWorkItem(addedTask.id, { section: "assets" });
    navigate("task");
    closePicker();
  }

  const catalog = stats.data?.catalog;
  const hasIndexedContent = (catalog?.total ?? 0) > 0;
  const projects = consoleState?.projects ?? [];
  const taskProjects = selected?.projectId
    ? projects.filter((project) => project.id === selected.projectId)
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
        actions={<Button size="sm" variant="secondary" disabled={rebuilding} onClick={() => void rebuild()}>
          <RefreshCw className={cn("size-4", rebuilding && "animate-spin")} aria-hidden />
          {rebuilding ? copy.rebuilding : hasIndexedContent ? copy.refresh : copy.build}
        </Button>}
      />

      {catalog ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" role="status">
          <span>{copy.indexed.replace("{{count}}", String(catalog.total)).replace("{{available}}", String(catalog.available))}</span>
          {catalog.lastRebuiltAt ? <span>{copy.lastIndexed.replace("{{time}}", new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(catalog.lastRebuiltAt)))}</span> : null}
        </div>
      ) : null}
      {rebuildError ? <p className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive" role="alert">{rebuildError}</p> : null}
      {indexing ? <p className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/[0.05] px-3 py-2 text-sm" role="status"><RefreshCw className="size-4 animate-spin text-primary" aria-hidden />{copy.autoIndexing}</p> : null}
      {(catalog?.indexing?.failed ?? 0) > 0 ? <p className="rounded-lg border border-warning/40 bg-warning/[0.07] px-3 py-2 text-sm" role="alert">{copy.autoIndexFailed}</p> : null}
      {truncatedFacetGroups ? <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" role="status">{copy.directoryLimited.replace("{{count}}", String(truncatedFacetGroups))}</p> : null}
      {locateFeedback ? <p className="rounded-lg border border-success/30 bg-success/[0.06] px-3 py-2 text-sm" role="status">{locateFeedback}</p> : null}
      {locateError ? <p className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive" role="alert">{locateError}</p> : null}

      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[minmax(16rem,1fr)_11rem_14rem]">
        <Field label={copy.search}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(event) => { setQuery(event.target.value); resetPage(); }} placeholder={copy.searchPlaceholder} className="pl-9" />
          </div>
        </Field>
        <Field label={copy.kind}>
          <Select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); resetPage(); }}>
            <option value="all">{copy.allKinds}</option>
            {KINDS.map((value) => <option key={value} value={value}>{copy.kinds[value]}</option>)}
          </Select>
        </Field>
        <Field label={copy.project}>
          <Select value={projectId} onChange={(event) => { setProjectId(event.target.value); resetPage(); }}>
            <option value="all">{copy.allProjects}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </Select>
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-3">
          <Button size="sm" variant="ghost" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen}>
            <ListFilter aria-hidden />
            {advancedOpen ? copy.hideFilters : copy.moreFilters}
            {advancedFilterCount ? <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary">{advancedFilterCount}</span> : null}
          </Button>
          {activeFilterCount ? <Button size="sm" variant="ghost" onClick={resetFilters}><X aria-hidden />{copy.clearFilters}</Button> : null}
        </div>
      </div>

      {advancedOpen ? <div className="grid gap-3 rounded-xl border border-border/80 bg-card/70 p-4 sm:grid-cols-2 xl:grid-cols-5">
        <Field label={copy.relatedTask}>
          <Select value={workItemId} onChange={(event) => { setWorkItemId(event.target.value); resetPage(); }}>
            <option value="all">{copy.allTasks}</option>
            {(catalog?.facets?.workItems ?? []).map((facet) => {
              const task = workItems.data?.workItems.find((item) => item.id === facet.value);
              return <option key={facet.value} value={facet.value}>{task?.title ?? facet.value} ({facet.count})</option>;
            })}
          </Select>
        </Field>
        <Field label={copy.sourceType}>
          <Select value={sourceType} onChange={(event) => { setSourceType(event.target.value); resetPage(); }}>
            <option value="all">{copy.allSources}</option>
            {(catalog?.facets?.sources ?? []).map((facet) => <option key={facet.value} value={facet.value}>{sourceLabels[facet.value] ?? facet.value.replaceAll("_", " ")} ({facet.count})</option>)}
          </Select>
        </Field>
        <Field label={copy.month}>
          <Select value={yearMonth} onChange={(event) => { setYearMonth(event.target.value); resetPage(); }}>
            <option value="all">{copy.allMonths}</option>
            {(catalog?.facets?.months ?? []).map((facet) => <option key={facet.value} value={facet.value}>{facet.value} ({facet.count})</option>)}
          </Select>
        </Field>
        <Field label={copy.availability}>
          <Select value={availability} onChange={(event) => { setAvailability(event.target.value as typeof availability); resetPage(); }}>
            <option value="all">{copy.allAvailability}</option>
            <option value="available">{copy.available}</option>
            <option value="unavailable">{copy.unavailable}</option>
          </Select>
        </Field>
        <Field label={copy.indexState}>
          <Select value={indexStatus} onChange={(event) => { setIndexStatus(event.target.value as typeof indexStatus); resetPage(); }}>
            <option value="all">{copy.allIndexStates}</option>
            <option value="ready">{copy.ready}</option>
            <option value="partial">{copy.partial}</option>
            <option value="metadata_only">{copy.metadataOnly}</option>
            <option value="missing">{copy.missing}</option>
          </Select>
        </Field>
      </div> : null}

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
        <div className="grid gap-3 md:grid-cols-2">
          {records.map((record) => <LocalContentCard
            key={record.id}
            record={record}
            copy={copy}
            locating={locatingId === record.id}
            locateDisabled={Boolean(locatingId)}
            onPreview={() => setPreviewTarget(record)}
            onLocate={() => void locateOriginal(record)}
            onChoose={() => choose(record)}
          />)}
        </div>
      )}

      {hasIndexedContent && records.length ? (
        <div className="flex items-center justify-center gap-3">
          <Button size="sm" variant="ghost" disabled={page === 0 || content.isFetching} onClick={previousPage}><ChevronLeft aria-hidden />{copy.previous}</Button>
          <span className="text-xs text-muted-foreground">{copy.page.replace("{{page}}", String(page + 1))}</span>
          <Button size="sm" variant="ghost" disabled={!content.data?.nextCursor || content.isFetching} onClick={() => nextPage(content.data?.nextCursor)}>{copy.next}<ChevronRight aria-hidden /></Button>
        </div>
      ) : null}

      {selected ? <Suspense fallback={null}><AddToTaskModal
        open={Boolean(selected)}
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
    </div>
  );
}

export { openTasksFor };
