import { ListFilter, Search, X } from "lucide-react";
import { Field } from "@/components/common/field";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import type { LocalWorkItem } from "@/features/tasks/task-view-types";
import type { LocalContentCatalogStats, LocalContentKind } from "./local-content-types";
import { localContentSourceLabels } from "./local-content-source-labels";
import type { COPY } from "./local-library-copy";
import type { useLocalContentFilters } from "./use-local-content-filters";

const KINDS: LocalContentKind[] = ["article", "material", "mail", "task", "task_input", "task_output"];

type Props = {
  copy: (typeof COPY)[keyof typeof COPY];
  filters: ReturnType<typeof useLocalContentFilters>;
  projects: Array<{ id: string; name: string }>;
  catalog?: LocalContentCatalogStats;
  workItems: LocalWorkItem[];
  language: "zh" | "en";
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
};

export function LocalLibraryFilterPanel({
  copy,
  filters,
  projects,
  catalog,
  workItems,
  language,
  advancedOpen,
  onAdvancedOpenChange,
}: Props) {
  const {
    query, setQuery, kind, setKind, projectId, setProjectId, workItemId, setWorkItemId,
    sourceType, setSourceType, yearMonth, setYearMonth, availability, setAvailability,
    indexStatus, setIndexStatus, setMailAccountId, setMailFolderId,
    resetPage, resetFilters, advancedFilterCount, activeFilterCount,
  } = filters;
  const sourceLabels = localContentSourceLabels(language);

  return (
    <>
      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[minmax(16rem,1fr)_11rem_14rem]">
        <Field label={copy.search}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(event) => { setQuery(event.target.value); resetPage(); }} placeholder={copy.searchPlaceholder} className="pl-9" />
          </div>
        </Field>
        <Field label={copy.kind}>
          <Select value={kind} onChange={(event) => {
            const value = event.target.value as typeof kind;
            setKind(value);
            if (value !== "mail") {
              setMailAccountId("all");
              setMailFolderId("all");
            }
            resetPage();
          }}>
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
          <Button size="sm" variant="ghost" onClick={() => onAdvancedOpenChange(!advancedOpen)} aria-expanded={advancedOpen}>
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
              const task = workItems.find((item) => item.id === facet.value);
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
    </>
  );
}
