import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { Field } from "@/components/common/field";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { workResourceApi } from "./local-content-api";
import type { WorkResource } from "./local-content-types";
import type { COPY } from "./local-library-copy";

const WorkResourceCard = lazy(() => import("./work-resource-card").then((module) => ({ default: module.WorkResourceCard })));
const WorkResourceDetailModal = lazy(() => import("./work-resource-card").then((module) => ({ default: module.WorkResourceDetailModal })));
const WorkResourcePreviewModal = lazy(() => import("./work-resource-card").then((module) => ({ default: module.WorkResourcePreviewModal })));

type Copy = (typeof COPY)[keyof typeof COPY];

type Props = {
  mode: "all" | "tables";
  query: string;
  projectId: string;
  projects: Array<{ id: string; name: string }>;
  locale: string;
  copy: Copy;
  onQueryChange: (value: string) => void;
  onProjectChange: (value: string) => void;
  onChoose: (resource: WorkResource) => void;
  onManage: (resource: WorkResource) => void;
};

function ResourceGrid({ resources, locale, onDetails, onPreview, onChoose }: {
  resources: WorkResource[];
  locale: string;
  onDetails: (resource: WorkResource) => void;
  onPreview: (resource: WorkResource) => void;
  onChoose: (resource: WorkResource) => void;
}) {
  return (
    <Suspense fallback={<div className="grid gap-3 md:grid-cols-2" aria-busy="true"><div className="h-40 animate-pulse rounded-xl border border-border bg-muted/40" /></div>}>
      <div className="grid gap-3 md:grid-cols-2">
        {resources.map((resource) => (
          <WorkResourceCard
            key={resource.id}
            resource={resource}
            locale={locale}
            onDetails={() => onDetails(resource)}
            onPreview={() => onPreview(resource)}
            onChoose={() => onChoose(resource)}
          />
        ))}
      </div>
    </Suspense>
  );
}

export function WorkResourceDirectorySection({
  mode,
  query,
  projectId,
  projects,
  locale,
  copy,
  onQueryChange,
  onProjectChange,
  onChoose,
  onManage,
}: Props) {
  const [locality, setLocality] = useState<"all" | "local" | "remote">("all");
  const [previewTarget, setPreviewTarget] = useState<WorkResource | null>(null);
  const [detailTarget, setDetailTarget] = useState<WorkResource | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const resources = useQuery({
    queryKey: ["work-resources", mode, query, projectId, locality],
    queryFn: () => workResourceApi.list({
      resourceKind: mode === "tables" ? "table" : undefined,
      q: query.trim() || undefined,
      projectId: projectId === "all" ? undefined : projectId,
      locality: mode === "tables" && locality !== "all" ? locality : undefined,
      limit: 100,
    }),
  });
  const preview = useQuery({
    queryKey: ["work-resources", "preview", previewTarget?.id],
    queryFn: () => workResourceApi.preview(previewTarget!.id),
    enabled: Boolean(previewTarget),
    retry: false,
  });
  const detail = useQuery({
    queryKey: ["work-resources", "detail", detailTarget?.id],
    queryFn: () => workResourceApi.get(detailTarget!.id),
    enabled: Boolean(detailTarget),
    retry: false,
  });

  const visibleResources = mode === "tables"
    ? (resources.data?.resources ?? [])
    : (resources.data?.resources ?? []).filter((resource) =>
      resource.source.type === "connector" || (resource.source.type === "local_file" && !resource.source.localContentLinked));

  function openDetails(resource: WorkResource) {
    setRefreshError(false);
    setDetailTarget(resource);
  }

  async function refreshResource() {
    if (!detailTarget || refreshing) return;
    setRefreshing(true);
    setRefreshError(false);
    try {
      const response = await workResourceApi.refresh(detailTarget.id);
      setDetailTarget(response.resource);
      await Promise.all([detail.refetch(), resources.refetch()]);
    } catch {
      setRefreshError(true);
    } finally {
      setRefreshing(false);
    }
  }

  const content = mode === "tables" ? (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{copy.tablesViewHint}</p>
      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[minmax(16rem,1fr)_14rem_12rem]">
        <Field label={copy.tableSearch}><div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden /><Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={copy.tableSearch} className="pl-9" /></div></Field>
        <Field label={copy.project}><Select value={projectId} onChange={(event) => onProjectChange(event.target.value)}><option value="all">{copy.allProjects}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</Select></Field>
        <Field label={copy.locality}><Select value={locality} onChange={(event) => setLocality(event.target.value as typeof locality)}><option value="all">{copy.allLocalities}</option><option value="local">{copy.localOnly}</option><option value="remote">{copy.remoteOnly}</option></Select></Field>
      </div>
      {resources.isError ? <EmptyState title={copy.loadFailed} action={<Button size="sm" variant="secondary" onClick={() => void resources.refetch()}>{copy.retry}</Button>} />
        : resources.isLoading ? <div className="grid gap-3 md:grid-cols-2" aria-busy="true">{[0, 1, 2, 3].map((item) => <div key={item} className="h-40 animate-pulse rounded-xl border border-border bg-muted/40" />)}</div>
          : !visibleResources.length ? <EmptyState title={copy.noTableResources} hint={copy.noTableResourcesHint} />
            : <ResourceGrid resources={visibleResources} locale={locale} onDetails={openDetails} onPreview={setPreviewTarget} onChoose={onChoose} />}
    </div>
  ) : resources.isError ? (
    <p className="rounded-lg border border-warning/40 bg-warning/[0.07] px-3 py-2 text-sm" role="status">{copy.connectedLoadFailed}</p>
  ) : resources.isLoading ? (
    <div className="grid gap-3 md:grid-cols-2" aria-label={copy.connectedResources} aria-busy="true"><div className="h-40 animate-pulse rounded-xl border border-border bg-muted/40" /></div>
  ) : visibleResources.length ? (
    <section className="space-y-3" aria-labelledby="connected-resources-title">
      <div><h2 id="connected-resources-title" className="text-sm font-semibold">{copy.connectedResources}</h2><p className="mt-1 text-xs text-muted-foreground">{copy.connectedResourcesHint}</p></div>
      <ResourceGrid resources={visibleResources} locale={locale} onDetails={openDetails} onPreview={setPreviewTarget} onChoose={onChoose} />
    </section>
  ) : null;

  return (
    <>
      {content}
      {detailTarget ? <Suspense fallback={null}><WorkResourceDetailModal
        resource={detail.data?.resource ?? detailTarget}
        locale={locale}
        refreshing={refreshing}
        refreshError={refreshError || detail.isError}
        onClose={() => { setDetailTarget(null); setRefreshError(false); }}
        onManage={() => { const resource = detail.data?.resource ?? detailTarget; setDetailTarget(null); setRefreshError(false); onManage(resource); }}
        onRefresh={() => void refreshResource()}
        onPreview={() => { setPreviewTarget(detail.data?.resource ?? detailTarget); setDetailTarget(null); }}
        onChoose={() => { onChoose(detail.data?.resource ?? detailTarget); setDetailTarget(null); }}
      /></Suspense> : null}
      {previewTarget ? <Suspense fallback={null}><WorkResourcePreviewModal
        resource={previewTarget}
        preview={preview.data?.preview ?? null}
        loading={preview.isLoading}
        error={preview.isError}
        locale={locale}
        onClose={() => setPreviewTarget(null)}
        onRetry={() => void preview.refetch()}
      /></Suspense> : null}
    </>
  );
}
