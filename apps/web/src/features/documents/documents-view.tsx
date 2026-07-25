import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, DraftingCompass, FileImage, FilePlus2, FileSpreadsheet, FileText, FileVideo, FolderOpen, Loader2, Move, Pencil, Pin, PinOff, Presentation, Search, Trash2, X } from "lucide-react";
import { api } from "@/data/use-console-actions";
import { useConsoleState, useRefreshConsoleState } from "@/data/use-console-state";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { OfficeDocumentFrame } from "@/components/common/office-document-frame";
import { MarkdownBlock } from "@/components/ui/markdown-block";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import type { ProjectDocumentEntry } from "@/lib/console-state";
import { ApiError } from "@/lib/api-client";
import { useUiStore } from "@/store/ui-store";
import { clearRecentDocuments, readRecentDocuments, recordRecentDocument, removeRecentDocument, toggleRecentDocumentPinned, type RecentDocument } from "@/features/documents/recent-documents";
import { readDocumentTemplates, removeDocumentTemplate, saveDocumentTemplate, type DocumentTemplate } from "@/features/documents/document-templates";
import { classifyLocalDocumentPath, directoryOfLocalPath, type LocalOfficeDocumentSelection } from "@/features/documents/local-document-location";
import { PdfDocumentViewer } from "@/features/documents/pdf-document-viewer";
import { CadDocumentViewer } from "@/features/documents/cad-document-viewer";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

type OfficeDocumentType = "docx" | "xlsx" | "pptx";
type DocumentType = "all" | OfficeDocumentType | "pdf" | "dxf" | "dwg" | "md" | "canvas" | "image" | "video";
const FILTERS: Array<{ value: DocumentType; label: string }> = [
  { value: "all", label: "All" },
  { value: "docx", label: "Word" },
  { value: "xlsx", label: "Excel" },
  { value: "pptx", label: "PowerPoint" },
  { value: "pdf", label: "PDF" },
  { value: "dxf", label: "DXF" },
  { value: "dwg", label: "DWG" },
  { value: "md", label: "Markdown" },
  { value: "canvas", label: "Canvas" },
  { value: "image", label: "Images" },
  { value: "video", label: "Video" },
];

function DocumentIcon({ type }: { type: ProjectDocumentEntry["type"] }) {
  if (type === "xlsx") return <FileSpreadsheet className="size-4 text-emerald-600" />;
  if (type === "pptx") return <Presentation className="size-4 text-orange-600" />;
  if (type === "pdf") return <FileText className="size-4 text-red-600" />;
  if (type === "dxf" || type === "dwg") return <DraftingCompass className="size-4 text-cyan-600" />;
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(type)) return <FileImage className="size-4 text-violet-600" />;
  if (["mp4", "webm", "mov"].includes(type)) return <FileVideo className="size-4 text-rose-600" />;
  if (["canvas", "excalidraw"].includes(type)) return <DraftingCompass className="size-4 text-indigo-600" />;
  return <FileText className="size-4 text-blue-600" />;
}

export function DocumentsView() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const refresh = useRefreshConsoleState();
  const projects = state?.projects ?? [];
  const projectId = state?.currentProjectId ?? "";
  const [type, setType] = useState<DocumentType>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selected, setSelected] = useState<ProjectDocumentEntry | null>(null);
  const [worktreeId, setWorktreeId] = useState("");
  const [browseScope, setBrowseScope] = useState<"base" | "worktree">("base");
  const [pendingSelectionPath, setPendingSelectionPath] = useState<string | null>(null);
  const [pendingSelectionError, setPendingSelectionError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [externalSelection, setExternalSelection] = useState<LocalOfficeDocumentSelection | null>(null);
  const [openLocalError, setOpenLocalError] = useState<string | null>(null);
  const setPendingLocalDocumentRegistration = useUiStore((state) => state.setPendingLocalDocumentRegistration);
  const setSection = useUiStore((state) => state.setSection);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [manageOperation, setManageOperation] = useState<"rename" | "move" | "copy" | "delete" | null>(null);
  const [recent, setRecent] = useState<RecentDocument[]>(() => readRecentDocuments());
  const [templates, setTemplates] = useState<DocumentTemplate[]>(() => readDocumentTemplates());
  const [templateSource, setTemplateSource] = useState<DocumentTemplate | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const requestedProjectId = urlParam("project");
  const requestedDocumentPath = urlParam("document");
  const requestedWorktreeId = urlParam("worktree");
  const projectWorktrees = useMemo(() => (state?.worktrees ?? []).filter((worktree) => worktree.projectId === projectId), [state?.worktrees, projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const documents = useQuery({
    queryKey: ["project-documents", projectId, browseScope, worktreeId, type, debouncedSearch],
    queryFn: () => api.projectDocuments(projectId, { type, search: debouncedSearch, worktreeId: browseScope === "worktree" ? worktreeId : undefined }),
    enabled: Boolean(projectId && (browseScope === "base" || worktreeId)),
    placeholderData: (previous) => previous,
    refetchInterval: pendingSelectionPath ? 1_000 : false,
  });
  const rows = documents.data?.documents ?? [];

  useEffect(() => {
    if (selected && !rows.some((item) => item.path === selected.path)) setSelected(null);
  }, [rows, selected]);

  useEffect(() => {
    if (!state || !requestedProjectId || requestedProjectId === projectId) return;
    if (!projects.some((project) => project.id === requestedProjectId)) return;
    void api.selectProject(requestedProjectId).then(refresh);
  }, [state, requestedProjectId, projectId, projects, refresh]);

  useEffect(() => {
    if (!requestedDocumentPath || selected?.path === requestedDocumentPath) return;
    const match = rows.find((item) => item.path === requestedDocumentPath);
    if (match) setSelected(match);
  }, [requestedDocumentPath, rows, selected]);

  useEffect(() => {
    if (!pendingSelectionPath) return;
    const match = rows.find((item) => item.path === pendingSelectionPath);
    if (!match) return;
    setSelected(match);
    writeDocumentUrl(projectId, match.path, match.worktreeId ?? undefined);
    setPendingSelectionPath(null);
    setPendingSelectionError(null);
  }, [pendingSelectionPath, rows, projectId]);

  useEffect(() => {
    if (!pendingSelectionPath) return;
    const timer = window.setTimeout(() => { setPendingSelectionError(t("documents.locateFailed", { path: pendingSelectionPath })); setPendingSelectionPath(null); }, 5_000);
    return () => window.clearTimeout(timer);
  }, [pendingSelectionPath, t]);

  useEffect(() => {
    if (projectWorktrees.some((worktree) => worktree.id === worktreeId)) return;
    setWorktreeId(projectWorktrees[0]?.id ?? "");
  }, [projectWorktrees, worktreeId]);

  useEffect(() => {
    if (!requestedWorktreeId || !projectWorktrees.some((worktree) => worktree.id === requestedWorktreeId)) return;
    setWorktreeId(requestedWorktreeId);
    setBrowseScope("worktree");
  }, [requestedWorktreeId, projectWorktrees]);

  const switchProject = async (nextId: string) => {
    if (!nextId || nextId === projectId) return;
    setSelected(null);
    await api.selectProject(nextId);
    await refresh();
  };

  const openLocalDocument = async () => {
    setOpenLocalError(null);
    const picker = window.myagenttoolDesktop?.pickLocalOfficeDocument;
    if (!picker) { setOpenLocalError(t("documents.desktopOnly")); return; }
    try {
      const selection = await picker();
      if (!selection) return;
      const location = classifyLocalDocumentPath(selection.absolutePath, projects, state?.worktrees ?? []);
      if (location.scope === "external") { setExternalSelection(selection); return; }
      if (location.projectId !== projectId) await switchProject(location.projectId);
      if (location.scope === "worktree") setWorktreeId(location.worktreeId);
      setBrowseScope(location.scope === "worktree" ? "worktree" : "base");
      setPendingSelectionPath(location.relativePath);
    } catch (caught) { setOpenLocalError(caught instanceof Error ? caught.message : t("documents.openFailed")); }
  };

  if (state && projects.length === 0) return <DocumentsEmptyProjects />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("documents.project")}</span>
          <Select value={projectId} onChange={(event) => void switchProject(event.target.value)} className="h-8 min-w-44">
            {!projectId ? <option value="">{t("documents.selectProject")}</option> : null}
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </Select>
        </label>
        <div className="flex overflow-hidden rounded-md border border-border text-xs">
          {FILTERS.map((filter) => (
            <button key={filter.value} type="button" onClick={() => setType(filter.value)} className={cn("px-3 py-1.5", type === filter.value ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground")}>{filter.value === "all" ? t("documents.all") : filter.label}</button>
          ))}
        </div>
        <Select aria-label={t("documents.source")} className="h-8 w-40" value={browseScope} onChange={(event) => setBrowseScope(event.target.value as "base" | "worktree")}>
          <option value="base">{t("documents.baseProject")}</option>
          <option value="worktree" disabled={!worktreeId}>{t("documents.selectedWorktree")}</option>
        </Select>
        <label className="relative ml-auto min-w-52 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("documents.search")} className="h-8 pl-8" />
        </label>
        <Button size="sm" variant="secondary" disabled={!projectId} onClick={() => void openLocalDocument()}><FolderOpen className="mr-1 size-3.5" /> {t("documents.openLocal")}</Button>
        <Button size="sm" disabled={!projectId} onClick={() => setCreateOpen(true)}><FilePlus2 className="mr-1 size-3.5" /> {t("documents.new")}</Button>
      </header>
      {openLocalError ? <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{openLocalError}</p> : null}
      {pendingSelectionError ? <div className="flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"><span>{pendingSelectionError}</span><Button size="sm" variant="secondary" onClick={() => void openLocalDocument()}>{t("documents.selectAgain")}</Button></div> : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
        <section className="min-h-0 overflow-y-auto rounded-lg border border-border bg-card" aria-label={t("documents.label")}>
          {templates.length > 0 ? <div className="border-b border-border p-2"><p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("documents.templates")}</p><div className="space-y-1">{templates.filter((item) => (type === "all" || item.type === type) && (!search.trim() || item.name.toLowerCase().includes(search.trim().toLowerCase()))).map((item) => <div key={item.id} className="flex items-center gap-1"><button type="button" className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-left text-xs" onClick={() => { setTemplateSource(item); setTemplateOpen(true); }}>{item.name}</button><button type="button" className="px-1 text-xs text-muted-foreground hover:text-destructive" aria-label={t("documents.removeTemplate", { name: item.name })} onClick={() => setTemplates(removeDocumentTemplate(item.id))}>×</button></div>)}</div></div> : null}
          <RecentDocuments items={recent} projects={projects} worktrees={state?.worktrees ?? []} onOpen={(item) => openRecent(item, projects, projectId, setWorktreeId, setBrowseScope, setPendingSelectionPath, switchProject)} onPin={(item) => setRecent(toggleRecentDocumentPinned(item))} onRemove={(item) => setRecent(removeRecentDocument(item))} onClear={() => setRecent(clearRecentDocuments())} />
          <DocumentList loading={documents.isLoading} error={documents.error} rows={rows} selected={selected} onSelect={(row) => { setSelected(row); setRecent(recordRecentDocument(row)); writeDocumentUrl(projectId, row.path, row.worktreeId ?? undefined); }} />
          {documents.data?.truncated ? <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{t("documents.truncated")}</p> : null}
        </section>
        <DocumentPreview projectId={projectId} document={selected} worktrees={projectWorktrees} worktreeId={worktreeId} onWorktreeChange={setWorktreeId} onUseTemplate={() => { setTemplateSource(null); setTemplateOpen(true); }} onSaveTemplate={() => setSaveTemplateOpen(true)} onManage={setManageOperation} />
      </div>
      <DocumentWriteModal mode="create" open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} worktrees={projectWorktrees} defaultWorktreeId={worktreeId} onComplete={(targetWorktreeId, path) => { setWorktreeId(targetWorktreeId); setBrowseScope("worktree"); setPendingSelectionPath(path); }} />
      <ExternalDocumentModal selection={externalSelection} worktrees={projectWorktrees} defaultWorktreeId={worktreeId} onClose={() => setExternalSelection(null)} onRegister={() => { if (!externalSelection) return; setPendingLocalDocumentRegistration({ directory: directoryOfLocalPath(externalSelection.absolutePath), documentName: externalSelection.name }); setExternalSelection(null); setSection("projects"); }} onCopied={(targetWorktreeId, path) => { setExternalSelection(null); setWorktreeId(targetWorktreeId); setBrowseScope("worktree"); setPendingSelectionPath(path); }} />
      <DocumentWriteModal mode="template" open={templateOpen} onClose={() => setTemplateOpen(false)} projectId={projectId} worktrees={projectWorktrees} defaultWorktreeId={templateSource?.worktreeId ?? selected?.worktreeId ?? worktreeId} template={templateSource ? { ...templateSource, name: templateSource.path.split("/").at(-1) ?? templateSource.name, gitStatus: "clean" } : selected ?? undefined} templateDefinition={templateSource ?? undefined} onComplete={(targetWorktreeId, path) => { setWorktreeId(targetWorktreeId); setBrowseScope("worktree"); setPendingSelectionPath(path); }} />
      <SaveTemplateModal open={saveTemplateOpen} document={selected} onClose={() => setSaveTemplateOpen(false)} onSave={(name, fields) => { if (selected) setTemplates(saveDocumentTemplate(selected, name, fields)); setSaveTemplateOpen(false); }} />
      <DocumentManageModal operation={manageOperation} document={selected} onClose={() => setManageOperation(null)} onComplete={(path) => { setManageOperation(null); if (path) setPendingSelectionPath(path); else setSelected(null); }} />
    </div>
  );
}

function RecentDocuments({ items, projects, worktrees, onOpen, onPin, onRemove, onClear }: { items: RecentDocument[]; projects: Array<{ id: string }>; worktrees: Array<{ id: string; projectId?: string }>; onOpen: (item: RecentDocument) => void; onPin: (item: RecentDocument) => void; onRemove: (item: RecentDocument) => void; onClear: () => void }) {
  const { t } = useAppTranslation();
  if (items.length === 0) return null;
  return <div className="border-b border-border p-2"><div className="mb-1 flex items-center justify-between px-1"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("documents.recent")}</p><button type="button" className="text-[10px] text-muted-foreground hover:text-foreground" onClick={onClear}>{t("documents.clear")}</button></div><div className="space-y-1">{items.map((item) => {
    const projectMissing = !projects.some((project) => project.id === item.projectId);
    const worktreeMissing = Boolean(item.worktreeId && !worktrees.some((worktree) => worktree.id === item.worktreeId));
    const unavailable = projectMissing || worktreeMissing;
    return <div key={`${item.projectId}:${item.worktreeId}:${item.path}`} className="flex items-center gap-1"><button type="button" disabled={unavailable} className={cn("min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-left text-xs", unavailable && "line-through opacity-60")} title={unavailable ? t(projectMissing ? "documents.projectMissing" : "documents.worktreeMissing") : item.path} onClick={() => onOpen(item)}>{item.name}{unavailable ? ` · ${t("documents.unavailable")}` : ""}</button><button type="button" className="p-1 text-muted-foreground hover:text-foreground" aria-label={t(item.pinned ? "documents.unpin" : "documents.pin", { name: item.name })} onClick={() => onPin(item)}>{item.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}</button><button type="button" className="p-1 text-muted-foreground hover:text-destructive" aria-label={t("documents.removeRecent", { name: item.name })} onClick={() => onRemove(item)}><X className="size-3" /></button></div>;
  })}</div></div>;
}

function DocumentList({ loading, error, rows, selected, onSelect }: { loading: boolean; error: Error | null; rows: ProjectDocumentEntry[]; selected: ProjectDocumentEntry | null; onSelect: (row: ProjectDocumentEntry) => void }) {
  const { t } = useAppTranslation();
  if (loading) return <p className="flex items-center gap-1 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t("documents.loading")}</p>;
  if (error) return <p className="p-4 text-sm text-destructive">{error.message || t("documents.loadFailed")}</p>;
  if (rows.length === 0) return <p className="p-4 text-sm text-muted-foreground">{t("documents.empty")}</p>;
  return <ul className="divide-y divide-border">{rows.map((row) => (
    <li key={row.path}>
      <button type="button" onClick={() => onSelect(row)} className={cn("flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/60", selected?.path === row.path && "bg-muted")}>
        <DocumentIcon type={row.type} />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{row.name}</span><span className="block truncate font-mono text-[11px] text-muted-foreground">{row.path}</span><span className="mt-1 flex flex-wrap gap-1" aria-label={t("assetActions.label")}>{assetActionLabels(row).map((label) => <span key={label} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t(`assetActions.${label === "Preview" ? "preview" : label === "Edit" ? "edit" : label === "Open externally" ? "openExternal" : "unavailable"}` as never)}</span>)}</span></span>
        {row.gitStatus !== "clean" ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{row.gitStatus}</span> : null}
      </button>
    </li>
  ))}</ul>;
}

export function assetActionLabels(asset: Pick<ProjectDocumentEntry, "capabilities" | "readiness">): string[] {
  if (asset.readiness?.state === "waiting_capability") return ["Not available"];
  const labels = [];
  if (asset.capabilities?.includes("preview")) labels.push("Preview");
  if (asset.capabilities?.includes("edit")) labels.push("Edit");
  if (asset.capabilities?.includes("open_external")) labels.push("Open externally");
  return labels.length > 0 ? labels : ["Not available"];
}

function DocumentPreview({ projectId, document, worktrees, worktreeId, onWorktreeChange, onUseTemplate, onSaveTemplate, onManage }: { projectId: string; document: ProjectDocumentEntry | null; worktrees: Array<{ id: string; name?: string; branchName?: string; branch?: string }>; worktreeId: string; onWorktreeChange: (id: string) => void; onUseTemplate: () => void; onSaveTemplate: () => void; onManage: (operation: "rename" | "move" | "copy" | "delete") => void }) {
  const { t } = useAppTranslation();
  const setSection = useUiStore((state) => state.setSection);
  const setOfficecliPreviewPath = useUiStore((state) => state.setOfficecliPreviewPath);
  const setSelectedProjectId = useUiStore((state) => state.setSelectedProjectId);
  const setSelectedWorktreeId = useUiStore((state) => state.setSelectedWorktreeId);
  const preview = useQuery({
    queryKey: ["office-document-preview", projectId, document?.path],
    queryFn: () => api.officecliPreview(projectId, document?.path ?? "", document?.worktreeId ?? undefined),
    enabled: Boolean(projectId && document && ["docx", "xlsx", "pptx"].includes(document.type)),
  });
  if (!document) return <section className="grid min-h-[24rem] place-items-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">{t("documentsPreview.select")}</section>;
  if (document.type === "md" || document.type === "mdx") return <MarkdownAssetPreview projectId={projectId} document={document} />;
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(document.type)) return <ImageAssetPreview projectId={projectId} document={document} />;
  if (["mp4", "webm", "mov"].includes(document.type)) return <VideoAssetPreview projectId={projectId} document={document} />;
  if (["canvas", "excalidraw"].includes(document.type)) return <AssetPreviewNotice document={document} message="Open Canvas to preview or edit this governed scene." />;
  if (document.type === "pdf") return <section className="flex min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card"><header className="flex items-center gap-2 border-b border-border px-3 py-2"><DocumentIcon type={document.type} /><div className="min-w-0"><p className="truncate text-sm font-medium">{document.name}</p><p className="truncate font-mono text-[10px] text-muted-foreground">{document.path}</p></div></header><PdfDocumentViewer projectId={projectId} path={document.path} worktreeId={document.worktreeId} /></section>;
  if (document.type === "dxf" || document.type === "dwg") return <section className="flex min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card"><header className="flex items-center gap-2 border-b border-border px-3 py-2"><DocumentIcon type={document.type} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{document.name}</p><p className="truncate font-mono text-[10px] text-muted-foreground">{document.path}</p></div><span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{t("documentsPreview.cadReadonly")}</span></header><CadDocumentViewer projectId={projectId} path={document.path} type={document.type} worktreeId={document.worktreeId} /></section>;
  const openWorkspace = () => { setOfficecliPreviewPath(document.path); setSection("workspace"); };
  const openWorktree = () => {
    if (!worktreeId) return;
    setOfficecliPreviewPath(document.path);
    setSelectedProjectId(projectId);
    setSelectedWorktreeId(worktreeId);
    setSection("projects");
  };
  return (
    <section className="flex min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"><DocumentIcon type={document.type} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{document.name}</p><p className="truncate font-mono text-[10px] text-muted-foreground">{document.path}</p></div><Button size="sm" variant="secondary" onClick={openWorkspace}>{t("documentsPreview.openWorkspace")}</Button>{document.worktreeId ? <><Button size="sm" variant="secondary" onClick={onUseTemplate}>{t("documentsPreview.useTemplate")}</Button><Button size="sm" variant="secondary" onClick={onSaveTemplate}>{t("documentsPreview.addTemplate")}</Button><Button size="icon" variant="ghost" aria-label={t("documentsPreview.rename")} onClick={() => onManage("rename")}><Pencil /></Button><Button size="icon" variant="ghost" aria-label={t("documentsPreview.move")} onClick={() => onManage("move")}><Move /></Button><Button size="icon" variant="ghost" aria-label={t("documentsPreview.copy")} onClick={() => onManage("copy")}><Copy /></Button><Button size="icon" variant="ghost" aria-label={t("documentsPreview.delete")} className="text-destructive" onClick={() => onManage("delete")}><Trash2 /></Button></> : null}{worktrees.length > 0 ? <><Select aria-label={t("documentsPreview.worktree")} className="h-8 max-w-44" value={worktreeId} onChange={(event) => onWorktreeChange(event.target.value)}>{worktrees.map((worktree) => <option key={worktree.id} value={worktree.id}>{worktree.name ?? worktree.branchName ?? worktree.branch ?? worktree.id}</option>)}</Select><Button size="sm" onClick={openWorktree} disabled={!worktreeId}>{t("documentsPreview.editWorktree")}</Button></> : <Button size="sm" variant="secondary" onClick={() => { setSelectedProjectId(projectId); setSelectedWorktreeId(null); setSection("projects"); }}>{t("documentsPreview.createWorktree")}</Button>}</header>
      {preview.isLoading ? <p className="flex items-center gap-1 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t("documentsPreview.rendering")}</p>
        : preview.error ? <PreviewFailure
          key={`${document.worktreeId ?? "base"}:${document.path}`}
          error={preview.error}
          onOpenApplications={() => setSection("applications")}
          onRetry={() => void preview.refetch()}
          onOpenSystem={window.myagenttoolDesktop?.openContainedOfficeDocument ? () => window.myagenttoolDesktop!.openContainedOfficeDocument!({ projectId, relativePath: document.path, ...(document.worktreeId ? { worktreeId: document.worktreeId } : {}) }) : undefined}
        />
        : preview.data ? <OfficeDocumentFrame title={document.path} content={preview.data.content} className="min-h-[32rem] flex-1" /> : null}
    </section>
  );
}

function MarkdownAssetPreview({ projectId, document }: { projectId: string; document: ProjectDocumentEntry }) {
  const preview = useQuery({
    queryKey: ["asset-preview", projectId, document.worktreeId, document.path],
    queryFn: () => api.projectAssetPreview(projectId, document.path, document.worktreeId ?? undefined),
  });
  return <section className="min-h-[24rem] overflow-auto rounded-lg border border-border bg-card p-4">
    <h2 className="mb-3 text-sm font-semibold">{document.name}</h2>
    {preview.isLoading ? <p className="text-sm text-muted-foreground">Preparing preview…</p>
      : preview.error ? <p role="alert" className="text-sm text-destructive">Preview is not available.</p>
        : <MarkdownBlock text={preview.data?.text ?? ""} />}
  </section>;
}

function ImageAssetPreview({ projectId, document }: { projectId: string; document: ProjectDocumentEntry }) {
  const preview = useQuery({
    queryKey: ["asset-preview-bytes", projectId, document.worktreeId, document.path],
    queryFn: () => api.projectAssetPreviewBytes(projectId, document.path, document.worktreeId ?? undefined),
    enabled: document.type !== "svg",
  });
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    if (!preview.data) { setSource(null); return; }
    const url = URL.createObjectURL(new Blob([preview.data]));
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [preview.data]);
  if (document.type === "svg") return <AssetPreviewNotice document={document} message="Preview is disabled because SVG can contain active content. Open externally if you trust this file." />;
  return <section className="grid min-h-[24rem] place-items-center overflow-auto rounded-lg border border-border bg-card p-4">
    {preview.isLoading ? <p className="text-sm text-muted-foreground">Preparing preview…</p>
      : preview.error ? <p role="alert" className="text-sm text-destructive">Preview is not available.</p>
        : source ? <img src={source} alt={document.name} className="max-h-full max-w-full object-contain" /> : null}
  </section>;
}

function VideoAssetPreview({ projectId, document }: { projectId: string; document: ProjectDocumentEntry }) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const mime = document.type === "webm" ? "video/webm" : document.type === "mp4" ? "video/mp4" : "video/quicktime";
    if (typeof MediaSource === "undefined" || !MediaSource.isTypeSupported(mime)) { setError(true); return; }
    const mediaSource = new MediaSource();
    const url = URL.createObjectURL(mediaSource);
    let cancelled = false;
    setSource(url);
    setError(false);
    const open = () => {
      const buffer = mediaSource.addSourceBuffer(mime);
      const chunkBytes = 4 * 1024 * 1024;
      let offset = 0;
      let total = Number.POSITIVE_INFINITY;
      const appendNext = async () => {
        if (cancelled || offset >= total) {
          if (!cancelled && mediaSource.readyState === "open") mediaSource.endOfStream();
          return;
        }
        try {
          const result = await api.projectAssetVideoRange(projectId, document.path, offset, offset + chunkBytes, document.worktreeId ?? undefined);
          if (cancelled) return;
          total = result.total;
          offset += result.data.byteLength;
          buffer.appendBuffer(new Uint8Array(result.data));
        } catch {
          if (!cancelled) setError(true);
          if (mediaSource.readyState === "open") mediaSource.endOfStream("network");
        }
      };
      buffer.addEventListener("updateend", () => void appendNext());
      void appendNext();
    };
    mediaSource.addEventListener("sourceopen", open, { once: true });
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [projectId, document.path, document.type, document.worktreeId]);
  if (error) return <AssetPreviewNotice document={document} message="Playback is not available in this browser. Open externally on the owning computer." />;
  return <section className="grid min-h-[24rem] place-items-center rounded-lg border border-border bg-card p-4">
    {source ? <video controls preload="metadata" src={source} className="max-h-full max-w-full" aria-label={`Video preview: ${document.name}`} /> : <p className="text-sm text-muted-foreground">Preparing playback…</p>}
  </section>;
}

function AssetPreviewNotice({ document, message }: { document: ProjectDocumentEntry; message: string }) {
  return <section className="grid min-h-[24rem] place-items-center rounded-lg border border-border bg-card p-6 text-center">
    <div><p className="font-medium">{document.name}</p><p className="mt-2 max-w-md text-sm text-muted-foreground">{message}</p></div>
  </section>;
}

type Translate = ReturnType<typeof useAppTranslation>["t"];

export function previewFailureCopy(error: Error, t?: Translate): { title: string; detail: string; showApplications: boolean } {
  const copy = (key: "unavailableTitle" | "unavailableDetail" | "missingTitle" | "missingDetail" | "timeoutTitle" | "timeoutDetail" | "unsupportedTitle" | "unsupportedDetail" | "passwordTitle" | "passwordDetail" | "encryptionTitle" | "encryptionDetail" | "corruptTitle" | "corruptDetail" | "genericTitle" | "genericDetail", fallback: string) => t?.(`documentsFailure.${key}`) ?? fallback;
  const code = error instanceof ApiError ? error.code : "preview_failed";
  switch (code) {
    case "officecli_unavailable":
      return { title: copy("unavailableTitle", "OfficeCLI is not installed"), detail: copy("unavailableDetail", "Install OfficeCLI on this device, then register or retry the application."), showApplications: true };
    case "not_found":
      return { title: copy("missingTitle", "Document not found"), detail: copy("missingDetail", "The file may have moved or only exist in another worktree."), showApplications: false };
    case "render_timeout":
      return { title: copy("timeoutTitle", "Preview timed out"), detail: copy("timeoutDetail", "The document may be large or OfficeCLI may be busy. Try again."), showApplications: false };
    case "unsupported_type":
      return { title: copy("unsupportedTitle", "Unsupported document type"), detail: copy("unsupportedDetail", "Documents supports .docx, .xlsx, and .pptx files."), showApplications: false };
    case "office_password_required":
      return { title: copy("passwordTitle", "Password-protected Office document"), detail: copy("passwordDetail", "This encrypted document cannot be previewed here yet. Open it with Word, Excel, or PowerPoint to enter its password."), showApplications: false };
    case "office_encryption_unsupported":
      return { title: copy("encryptionTitle", "Unsupported Office encryption"), detail: copy("encryptionDetail", "Open this document with its system Office application."), showApplications: false };
    case "office_file_corrupted":
      return { title: copy("corruptTitle", "Invalid Office document"), detail: copy("corruptDetail", "The file is damaged or is not a valid OOXML document."), showApplications: false };
    default:
      return { title: copy("genericTitle", "Preview unavailable"), detail: error.message || copy("genericDetail", "OfficeCLI could not render this document."), showApplications: true };
  }
}

function PreviewFailure({ error, onOpenApplications, onRetry, onOpenSystem }: { error: Error; onOpenApplications: () => void; onRetry: () => void; onOpenSystem?: () => Promise<{ opened: true }> }) {
  const { t } = useAppTranslation();
  const copy = previewFailureCopy(error, t);
  const encrypted = error instanceof ApiError && (error.code === "office_password_required" || error.code === "office_encryption_unsupported");
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const openSystem = async () => {
    if (!onOpenSystem) return;
    setOpening(true); setOpenError(null);
    try { await onOpenSystem(); }
    catch { setOpenError(t("documentsFailure.systemOpenFailed")); }
    finally { setOpening(false); }
  };
  return <div className="space-y-3 p-4"><div><p className="text-sm font-medium text-destructive">{copy.title}</p><p className="mt-1 text-xs text-muted-foreground">{copy.detail}</p>{encrypted && !onOpenSystem ? <p className="mt-1 text-xs text-muted-foreground">{t("documentsFailure.desktopHint")}</p> : null}{openError ? <p role="alert" className="mt-1 text-xs text-destructive">{openError}</p> : null}</div><div className="flex gap-2">{encrypted && onOpenSystem ? <Button size="sm" variant="secondary" onClick={() => void openSystem()} disabled={opening}>{t(opening ? "documentsFailure.opening" : "documentsFailure.openSystem")}</Button> : <Button size="sm" variant="secondary" onClick={onRetry}>{t("documentsFailure.retry")}</Button>}{copy.showApplications ? <Button size="sm" variant="secondary" onClick={onOpenApplications}>{t("documentsFailure.openApplications")}</Button> : null}</div></div>;
}

function urlParam(name: string): string {
  return typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get(name)?.trim() ?? "";
}

function writeDocumentUrl(projectId: string, path: string, worktreeId?: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("section", "documents");
  url.searchParams.set("project", projectId);
  url.searchParams.set("document", path);
  if (worktreeId) url.searchParams.set("worktree", worktreeId);
  else url.searchParams.delete("worktree");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

async function openRecent(
  item: RecentDocument,
  projects: Array<{ id: string }>,
  currentProjectId: string,
  setWorktreeId: (id: string) => void,
  setScope: (scope: "base" | "worktree") => void,
  setPendingPath: (path: string) => void,
  switchProject: (id: string) => Promise<void>,
) {
  if (!projects.some((project) => project.id === item.projectId)) return;
  if (item.projectId !== currentProjectId) await switchProject(item.projectId);
  setWorktreeId(item.worktreeId ?? "");
  setScope(item.worktreeId ? "worktree" : "base");
  setPendingPath(item.path);
  writeDocumentUrl(item.projectId, item.path, item.worktreeId ?? undefined);
}

function DocumentsEmptyProjects() {
  const { t } = useAppTranslation();
  const setSection = useUiStore((state) => state.setSection);
  return <div className="grid h-full place-items-center"><div className="space-y-3 text-center"><FileText className="mx-auto size-8 text-muted-foreground" /><div><p className="font-medium">{t("documentsModal.noProjects")}</p><p className="text-sm text-muted-foreground">{t("documentsModal.noProjectsHint")}</p></div><Button onClick={() => setSection("projects")}>{t("documentsModal.registerProject")}</Button></div></div>;
}

export function normalizeDocumentDestination(input: string, type: OfficeDocumentType): string {
  const trimmed = input.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!trimmed) return `untitled.${type}`;
  const withoutOfficeExtension = trimmed.replace(/\.(docx|xlsx|pptx)$/i, "");
  return `${withoutOfficeExtension}.${type}`;
}

function DocumentWriteModal({ mode, open, onClose, projectId, worktrees, defaultWorktreeId, onComplete, template, templateDefinition }: { mode: "create" | "template"; open: boolean; onClose: () => void; projectId: string; worktrees: Array<{ id: string; name?: string; branchName?: string; branch?: string }>; defaultWorktreeId: string; onComplete: (worktreeId: string, path: string) => void; template?: ProjectDocumentEntry; templateDefinition?: DocumentTemplate }) {
  const { t } = useAppTranslation();
  const queryClient = useQueryClient();
  const [type, setType] = useState<OfficeDocumentType>("docx");
  const [destination, setDestination] = useState("untitled.docx");
  const [worktreeId, setWorktreeId] = useState(defaultWorktreeId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateData, setTemplateData] = useState("{}");
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({});

  useEffect(() => { if (open) setWorktreeId(defaultWorktreeId || worktrees[0]?.id || ""); }, [open, defaultWorktreeId, worktrees]);
  useEffect(() => { if (mode === "create") setDestination((value) => normalizeDocumentDestination(value, type)); }, [mode, type]);
  useEffect(() => {
    if (!open || mode !== "template" || !template) return;
    if (template.type !== "docx" && template.type !== "xlsx" && template.type !== "pptx") return;
    setType(template.type);
    setDestination(normalizeDocumentDestination(`copy-of-${template.name}`, template.type));
    setTemplateValues(Object.fromEntries((templateDefinition?.fields ?? []).map((field) => [field.key, field.defaultValue])));
  }, [open, mode, template, templateDefinition]);

  const submit = async () => {
    if (!worktreeId) { setError(t("documentsModal.selectWorktreeFirst")); return; }
    const path = mode === "create" ? normalizeDocumentDestination(destination, type) : destination.trim().replaceAll("\\", "/");
    if (!path || path.startsWith("/") || path.split("/").includes("..")) { setError(t("documentsModal.relativePath")); return; }
    setPending(true);
    setError(null);
    try {
      if (mode === "create") {
        const grant = (await api.issueApprovalGrant("wrapper:create", "app_officecli")) as { token: string };
        await api.invokeCapability("app.app_officecli.apply.create", { projectId, worktreeId, file: path, approvalToken: grant.token });
      } else {
        if (!template?.worktreeId || template.worktreeId !== worktreeId) throw new Error(t("documentsModal.sameWorktree"));
        const data = templateDefinition?.fields.length ? templateValues : JSON.parse(templateData) as Record<string, unknown>;
        if (!data || Array.isArray(data) || typeof data !== "object") throw new Error(t("documentsModal.jsonObject"));
        const grant = (await api.issueApprovalGrant("wrapper:merge", "app_officecli")) as { token: string };
        await api.invokeCapability("app.app_officecli.apply.merge", { projectId, worktreeId, template: template.path, output: path, data, approvalToken: grant.token } as unknown as Record<string, string>);
      }
      await queryClient.invalidateQueries({ queryKey: ["project-documents", projectId] });
      onComplete(worktreeId, path);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("documentsModal.writeFailed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onClose={pending ? () => undefined : onClose} title={t(mode === "create" ? "documentsModal.newOffice" : "documentsModal.fromTemplate")} description={t("documentsModal.writeDescription")}>
      <div className="space-y-3">
        {worktrees.length === 0 ? <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">{t("documentsModal.noWorktree")}</p> : <label className="block space-y-1 text-sm"><span>{t("documentsModal.worktree")}</span><Select value={worktreeId} onChange={(event) => setWorktreeId(event.target.value)}>{worktrees.map((worktree) => <option key={worktree.id} value={worktree.id}>{worktree.name ?? worktree.branchName ?? worktree.branch ?? worktree.id}</option>)}</Select></label>}
        {mode === "create" ? <label className="block space-y-1 text-sm"><span>{t("documentsModal.documentType")}</span><Select value={type} onChange={(event) => setType(event.target.value as OfficeDocumentType)}><option value="docx">Word (.docx)</option><option value="xlsx">Excel (.xlsx)</option><option value="pptx">PowerPoint (.pptx)</option></Select></label> : <><p className="rounded bg-muted p-2 font-mono text-xs">{t("documentsModal.template")}: {template?.path}</p>{templateDefinition?.fields.length ? templateDefinition.fields.map((field) => <label key={field.key} className="block space-y-1 text-sm"><span>{field.label}</span><Input aria-label={field.label} value={templateValues[field.key] ?? ""} onChange={(event) => setTemplateValues((values) => ({ ...values, [field.key]: event.target.value }))} /></label>) : <label className="block space-y-1 text-sm"><span>{t("documentsModal.templateData")}</span><textarea value={templateData} onChange={(event) => setTemplateData(event.target.value)} rows={5} className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs" /></label>}</>}
        <label className="block space-y-1 text-sm"><span>{t("documentsModal.destination")}</span><Input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="docs/report.docx" spellCheck={false} /></label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={pending}>{t("documentsModal.cancel")}</Button><Button onClick={() => void submit()} disabled={pending || worktrees.length === 0}>{t(pending ? "documentsModal.working" : mode === "create" ? "documentsModal.createDocument" : "documentsModal.createFromTemplate")}</Button></div>
      </div>
    </Modal>
  );
}

function SaveTemplateModal({ open, document, onClose, onSave }: { open: boolean; document: ProjectDocumentEntry | null; onClose: () => void; onSave: (name: string, fields: string[]) => void }) {
  const { t } = useAppTranslation();
  const [name, setName] = useState("");
  const [fields, setFields] = useState("");
  useEffect(() => { if (open && document) { setName(document.name.replace(/\.(docx|xlsx|pptx)$/i, "")); setFields(""); } }, [open, document]);
  if (!document?.worktreeId) return null;
  return <Modal open={open} onClose={onClose} title={t("documentsActions.addTemplate")} description={t("documentsActions.templateDescription")}><div className="space-y-3"><label className="block space-y-1 text-sm"><span>{t("documentsActions.templateName")}</span><Input aria-label={t("documentsActions.templateName")} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="block space-y-1 text-sm"><span>{t("documentsActions.fieldKeys")}</span><Input aria-label={t("documentsActions.templateFieldKeys")} value={fields} onChange={(event) => setFields(event.target.value)} placeholder="title, owner, quarter" /><span className="block text-xs text-muted-foreground">{t("documentsActions.fieldHint")}</span></label><div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>{t("documentsModal.cancel")}</Button><Button onClick={() => onSave(name, fields.split(","))}>{t("documentsActions.saveTemplate")}</Button></div></div></Modal>;
}

function ExternalDocumentModal({ selection, worktrees, defaultWorktreeId, onClose, onRegister, onCopied }: { selection: LocalOfficeDocumentSelection | null; worktrees: Array<{ id: string; name?: string; branchName?: string; branch?: string }>; defaultWorktreeId: string; onClose: () => void; onRegister: () => void; onCopied: (worktreeId: string, path: string) => void }) {
  const { t } = useAppTranslation();
  const [targetWorktreeId, setTargetWorktreeId] = useState(defaultWorktreeId);
  const [destination, setDestination] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (selection) { setTargetWorktreeId(defaultWorktreeId || worktrees[0]?.id || ""); setDestination(`docs/${selection.name}`); setError(null); } }, [selection, defaultWorktreeId, worktrees]);
  const copy = async (onConflict?: "rename") => {
    const bridge = window.myagenttoolDesktop?.copySelectedOfficeDocument;
    if (!selection || !bridge) { setError(t("documentsActions.copyDesktopOnly")); return; }
    setPending(true); setError(null);
    try { const result = await bridge({ selectionId: selection.selectionId, worktreeId: targetWorktreeId, destination, ...(onConflict ? { onConflict } : {}) }); onCopied(targetWorktreeId, result.path); }
    catch (caught) { setError(caught instanceof Error ? caught.message : t("documentsActions.copyFailed")); }
    finally { setPending(false); }
  };
  return <Modal open={Boolean(selection)} onClose={pending ? () => undefined : onClose} closeDisabled={pending} title={t("documentsActions.externalTitle")} description={t("documentsActions.externalDescription")}><div className="space-y-3"><p className="rounded bg-muted p-2 font-mono text-xs break-all">{selection?.absolutePath}</p><p className="text-sm text-muted-foreground">{t("documentsActions.externalHint")}</p>{worktrees.length ? <><label className="block space-y-1 text-sm"><span>{t("documentsActions.targetWorktree")}</span><Select value={targetWorktreeId} onChange={(event) => setTargetWorktreeId(event.target.value)}>{worktrees.map((item) => <option key={item.id} value={item.id}>{item.name ?? item.branchName ?? item.branch ?? item.id}</option>)}</Select></label><label className="block space-y-1 text-sm"><span>{t("documentsModal.destination")}</span><Input value={destination} onChange={(event) => setDestination(event.target.value)} /></label></> : null}{error ? <div className="space-y-2"><p className="text-sm text-destructive">{error}</p>{error.includes("already exists") ? <Button size="sm" variant="secondary" onClick={() => void copy("rename")}>{t("documentsActions.availableName")}</Button> : null}</div> : null}<div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={pending}>{t("documentsModal.cancel")}</Button><Button variant="secondary" onClick={onRegister} disabled={pending}>{t("documentsActions.goProjects")}</Button>{worktrees.length ? <Button onClick={() => void copy()} disabled={pending || !destination.trim()}>{t("documentsActions.addCopy")}</Button> : null}</div></div></Modal>;
}

function DocumentManageModal({ operation, document, onClose, onComplete }: { operation: "rename" | "move" | "copy" | "delete" | null; document: ProjectDocumentEntry | null; onClose: () => void; onComplete: (path: string | null) => void }) {
  const { t } = useAppTranslation();
  const queryClient = useQueryClient();
  const [destination, setDestination] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!operation || !document) return;
    const slash = document.path.lastIndexOf("/");
    const directory = slash >= 0 ? document.path.slice(0, slash + 1) : "";
    setDestination(operation === "copy" ? `${directory}copy-of-${document.name}` : document.path);
    setError(null);
  }, [operation, document]);
  if (!operation || !document?.worktreeId) return null;
  const labels = { rename: t("documentsPreview.rename"), move: t("documentsPreview.move"), copy: t("documentsPreview.copy"), delete: t("documentsPreview.delete") } as const;
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await api.manageOfficeDocument(document.worktreeId!, { operation, source: document.path, ...(operation === "delete" ? {} : { destination: destination.trim().replaceAll("\\", "/") }) });
      await queryClient.invalidateQueries({ queryKey: ["project-documents", document.projectId] });
      onComplete(operation === "delete" ? null : result.destination ?? destination);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("documentsActions.operationFailed"));
    } finally {
      setPending(false);
    }
  };
  return <Modal open onClose={pending ? () => undefined : onClose} closeDisabled={pending} title={labels[operation]} description={t("documentsActions.manageDescription")}>
    <div className="space-y-3">
      <p className="rounded bg-muted p-2 font-mono text-xs">{document.path}</p>
      {operation === "delete" ? <p className="text-sm text-destructive">{t("documentsActions.deleteWarning")}</p> : <label className="block space-y-1 text-sm"><span>{t("documentsModal.destination")}</span><Input aria-label={t("documentsModal.destination")} value={destination} onChange={(event) => setDestination(event.target.value)} spellCheck={false} /></label>}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={pending}>{t("documentsModal.cancel")}</Button><Button variant={operation === "delete" ? "destructive" : "primary"} onClick={() => void submit()} disabled={pending || (operation !== "delete" && !destination.trim())}>{pending ? t("documentsModal.working") : labels[operation]}</Button></div>
    </div>
  </Modal>;
}
