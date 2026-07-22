import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, FilePlus2, FileSpreadsheet, FileText, Loader2, Move, Pencil, Pin, PinOff, Presentation, Search, Trash2, Upload, X } from "lucide-react";
import { api } from "@/data/use-console-actions";
import { useConsoleState, useRefreshConsoleState } from "@/data/use-console-state";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { OfficeDocumentFrame } from "@/components/common/office-document-frame";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import type { ProjectDocumentEntry } from "@/lib/console-state";
import { ApiError } from "@/lib/api-client";
import { useUiStore } from "@/store/ui-store";
import { clearRecentDocuments, readRecentDocuments, recordRecentDocument, removeRecentDocument, toggleRecentDocumentPinned, type RecentDocument } from "@/features/documents/recent-documents";
import { readDocumentTemplates, removeDocumentTemplate, saveDocumentTemplate, type DocumentTemplate } from "@/features/documents/document-templates";

type DocumentType = "all" | "docx" | "xlsx" | "pptx";
const FILTERS: Array<{ value: DocumentType; label: string }> = [
  { value: "all", label: "All" },
  { value: "docx", label: "Word" },
  { value: "xlsx", label: "Excel" },
  { value: "pptx", label: "PowerPoint" },
];

function DocumentIcon({ type }: { type: ProjectDocumentEntry["type"] }) {
  if (type === "xlsx") return <FileSpreadsheet className="size-4 text-emerald-600" />;
  if (type === "pptx") return <Presentation className="size-4 text-orange-600" />;
  return <FileText className="size-4 text-blue-600" />;
}

export function DocumentsView() {
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
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
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
  }, [pendingSelectionPath, rows, projectId]);

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

  if (state && projects.length === 0) return <DocumentsEmptyProjects />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Project</span>
          <Select value={projectId} onChange={(event) => void switchProject(event.target.value)} className="h-8 min-w-44">
            {!projectId ? <option value="">Select a project…</option> : null}
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </Select>
        </label>
        <div className="flex overflow-hidden rounded-md border border-border text-xs">
          {FILTERS.map((filter) => (
            <button key={filter.value} type="button" onClick={() => setType(filter.value)} className={cn("px-3 py-1.5", type === filter.value ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground")}>{filter.label}</button>
          ))}
        </div>
        <Select aria-label="Document source" className="h-8 w-40" value={browseScope} onChange={(event) => setBrowseScope(event.target.value as "base" | "worktree")}>
          <option value="base">Base project</option>
          <option value="worktree" disabled={!worktreeId}>Selected worktree</option>
        </Select>
        <label className="relative ml-auto min-w-52 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search documents…" className="h-8 pl-8" />
        </label>
        <Button size="sm" variant="secondary" disabled={!projectId} onClick={() => setImportOpen(true)}><Upload className="mr-1 size-3.5" /> Import</Button>
        <Button size="sm" disabled={!projectId} onClick={() => setCreateOpen(true)}><FilePlus2 className="mr-1 size-3.5" /> New</Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
        <section className="min-h-0 overflow-y-auto rounded-lg border border-border bg-card" aria-label="Office documents">
          {templates.length > 0 ? <div className="border-b border-border p-2"><p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Templates</p><div className="space-y-1">{templates.filter((item) => (type === "all" || item.type === type) && (!search.trim() || item.name.toLowerCase().includes(search.trim().toLowerCase()))).map((item) => <div key={item.id} className="flex items-center gap-1"><button type="button" className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-left text-xs" onClick={() => { setTemplateSource(item); setTemplateOpen(true); }}>{item.name}</button><button type="button" className="px-1 text-xs text-muted-foreground hover:text-destructive" aria-label={`Remove template ${item.name}`} onClick={() => setTemplates(removeDocumentTemplate(item.id))}>×</button></div>)}</div></div> : null}
          <RecentDocuments items={recent} projects={projects} worktrees={state?.worktrees ?? []} onOpen={(item) => openRecent(item, projects, projectId, setWorktreeId, setBrowseScope, setPendingSelectionPath, switchProject)} onPin={(item) => setRecent(toggleRecentDocumentPinned(item))} onRemove={(item) => setRecent(removeRecentDocument(item))} onClear={() => setRecent(clearRecentDocuments())} />
          <DocumentList loading={documents.isLoading} error={documents.error} rows={rows} selected={selected} onSelect={(row) => { setSelected(row); setRecent(recordRecentDocument(row)); writeDocumentUrl(projectId, row.path, row.worktreeId ?? undefined); }} />
          {documents.data?.truncated ? <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Showing the first 200 documents. Refine the search to narrow the list.</p> : null}
        </section>
        <DocumentPreview projectId={projectId} document={selected} worktrees={projectWorktrees} worktreeId={worktreeId} onWorktreeChange={setWorktreeId} onUseTemplate={() => { setTemplateSource(null); setTemplateOpen(true); }} onSaveTemplate={() => setSaveTemplateOpen(true)} onManage={setManageOperation} />
      </div>
      <DocumentWriteModal mode="create" open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} worktrees={projectWorktrees} defaultWorktreeId={worktreeId} onComplete={(targetWorktreeId, path) => { setWorktreeId(targetWorktreeId); setBrowseScope("worktree"); setPendingSelectionPath(path); }} />
      <DocumentWriteModal mode="import" open={importOpen} onClose={() => setImportOpen(false)} projectId={projectId} worktrees={projectWorktrees} defaultWorktreeId={worktreeId} onComplete={(targetWorktreeId, path) => { setWorktreeId(targetWorktreeId); setBrowseScope("worktree"); setPendingSelectionPath(path); }} />
      <DocumentWriteModal mode="template" open={templateOpen} onClose={() => setTemplateOpen(false)} projectId={projectId} worktrees={projectWorktrees} defaultWorktreeId={templateSource?.worktreeId ?? selected?.worktreeId ?? worktreeId} template={templateSource ? { ...templateSource, name: templateSource.path.split("/").at(-1) ?? templateSource.name, gitStatus: "clean" } : selected ?? undefined} templateDefinition={templateSource ?? undefined} onComplete={(targetWorktreeId, path) => { setWorktreeId(targetWorktreeId); setBrowseScope("worktree"); setPendingSelectionPath(path); }} />
      <SaveTemplateModal open={saveTemplateOpen} document={selected} onClose={() => setSaveTemplateOpen(false)} onSave={(name, fields) => { if (selected) setTemplates(saveDocumentTemplate(selected, name, fields)); setSaveTemplateOpen(false); }} />
      <DocumentManageModal operation={manageOperation} document={selected} onClose={() => setManageOperation(null)} onComplete={(path) => { setManageOperation(null); if (path) setPendingSelectionPath(path); else setSelected(null); }} />
    </div>
  );
}

function RecentDocuments({ items, projects, worktrees, onOpen, onPin, onRemove, onClear }: { items: RecentDocument[]; projects: Array<{ id: string }>; worktrees: Array<{ id: string; projectId?: string }>; onOpen: (item: RecentDocument) => void; onPin: (item: RecentDocument) => void; onRemove: (item: RecentDocument) => void; onClear: () => void }) {
  if (items.length === 0) return null;
  return <div className="border-b border-border p-2"><div className="mb-1 flex items-center justify-between px-1"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Recent</p><button type="button" className="text-[10px] text-muted-foreground hover:text-foreground" onClick={onClear}>Clear</button></div><div className="space-y-1">{items.map((item) => {
    const projectMissing = !projects.some((project) => project.id === item.projectId);
    const worktreeMissing = Boolean(item.worktreeId && !worktrees.some((worktree) => worktree.id === item.worktreeId));
    const unavailable = projectMissing || worktreeMissing;
    return <div key={`${item.projectId}:${item.worktreeId}:${item.path}`} className="flex items-center gap-1"><button type="button" disabled={unavailable} className={cn("min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-left text-xs", unavailable && "line-through opacity-60")} title={unavailable ? (projectMissing ? "Project no longer exists" : "Worktree no longer exists") : item.path} onClick={() => onOpen(item)}>{item.name}{unavailable ? " · unavailable" : ""}</button><button type="button" className="p-1 text-muted-foreground hover:text-foreground" aria-label={`${item.pinned ? "Unpin" : "Pin"} ${item.name}`} onClick={() => onPin(item)}>{item.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}</button><button type="button" className="p-1 text-muted-foreground hover:text-destructive" aria-label={`Remove recent ${item.name}`} onClick={() => onRemove(item)}><X className="size-3" /></button></div>;
  })}</div></div>;
}

function DocumentList({ loading, error, rows, selected, onSelect }: { loading: boolean; error: Error | null; rows: ProjectDocumentEntry[]; selected: ProjectDocumentEntry | null; onSelect: (row: ProjectDocumentEntry) => void }) {
  if (loading) return <p className="flex items-center gap-1 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading documents…</p>;
  if (error) return <p className="p-4 text-sm text-destructive">{error.message || "Could not load documents."}</p>;
  if (rows.length === 0) return <p className="p-4 text-sm text-muted-foreground">No Word, Excel, or PowerPoint files found in this project.</p>;
  return <ul className="divide-y divide-border">{rows.map((row) => (
    <li key={row.path}>
      <button type="button" onClick={() => onSelect(row)} className={cn("flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/60", selected?.path === row.path && "bg-muted")}>
        <DocumentIcon type={row.type} />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{row.name}</span><span className="block truncate font-mono text-[11px] text-muted-foreground">{row.path}</span></span>
        {row.gitStatus !== "clean" ? <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{row.gitStatus}</span> : null}
      </button>
    </li>
  ))}</ul>;
}

function DocumentPreview({ projectId, document, worktrees, worktreeId, onWorktreeChange, onUseTemplate, onSaveTemplate, onManage }: { projectId: string; document: ProjectDocumentEntry | null; worktrees: Array<{ id: string; name?: string; branchName?: string; branch?: string }>; worktreeId: string; onWorktreeChange: (id: string) => void; onUseTemplate: () => void; onSaveTemplate: () => void; onManage: (operation: "rename" | "move" | "copy" | "delete") => void }) {
  const setSection = useUiStore((state) => state.setSection);
  const setOfficecliPreviewPath = useUiStore((state) => state.setOfficecliPreviewPath);
  const setSelectedProjectId = useUiStore((state) => state.setSelectedProjectId);
  const setSelectedWorktreeId = useUiStore((state) => state.setSelectedWorktreeId);
  const preview = useQuery({
    queryKey: ["office-document-preview", projectId, document?.path],
    queryFn: () => api.officecliPreview(projectId, document?.path ?? "", document?.worktreeId ?? undefined),
    enabled: Boolean(projectId && document),
  });
  if (!document) return <section className="grid min-h-[24rem] place-items-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">Select a document to preview it.</section>;
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
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"><DocumentIcon type={document.type} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{document.name}</p><p className="truncate font-mono text-[10px] text-muted-foreground">{document.path}</p></div><Button size="sm" variant="secondary" onClick={openWorkspace}>Open in Workspace</Button>{document.worktreeId ? <><Button size="sm" variant="secondary" onClick={onUseTemplate}>Use as template</Button><Button size="sm" variant="secondary" onClick={onSaveTemplate}>Add to templates</Button><Button size="icon" variant="ghost" aria-label="Rename document" onClick={() => onManage("rename")}><Pencil /></Button><Button size="icon" variant="ghost" aria-label="Move document" onClick={() => onManage("move")}><Move /></Button><Button size="icon" variant="ghost" aria-label="Copy document" onClick={() => onManage("copy")}><Copy /></Button><Button size="icon" variant="ghost" aria-label="Delete document" className="text-destructive" onClick={() => onManage("delete")}><Trash2 /></Button></> : null}{worktrees.length > 0 ? <><Select aria-label="Worktree" className="h-8 max-w-44" value={worktreeId} onChange={(event) => onWorktreeChange(event.target.value)}>{worktrees.map((worktree) => <option key={worktree.id} value={worktree.id}>{worktree.name ?? worktree.branchName ?? worktree.branch ?? worktree.id}</option>)}</Select><Button size="sm" onClick={openWorktree} disabled={!worktreeId}>Edit in worktree</Button></> : <Button size="sm" variant="secondary" onClick={() => { setSelectedProjectId(projectId); setSelectedWorktreeId(null); setSection("projects"); }}>Create a worktree to edit</Button>}</header>
      {preview.isLoading ? <p className="flex items-center gap-1 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Rendering…</p>
        : preview.error ? <PreviewFailure error={preview.error} onOpenApplications={() => setSection("applications")} onRetry={() => void preview.refetch()} />
        : preview.data ? <OfficeDocumentFrame title={document.path} content={preview.data.content} className="min-h-[32rem] flex-1" /> : null}
    </section>
  );
}

export function previewFailureCopy(error: Error): { title: string; detail: string; showApplications: boolean } {
  const code = error instanceof ApiError ? error.code : "preview_failed";
  switch (code) {
    case "officecli_unavailable":
      return { title: "OfficeCLI is not installed", detail: "Install OfficeCLI on this device, then register or retry the application.", showApplications: true };
    case "not_found":
      return { title: "Document not found", detail: "The file may have moved or only exist in another worktree.", showApplications: false };
    case "render_timeout":
      return { title: "Preview timed out", detail: "The document may be large or OfficeCLI may be busy. Try again.", showApplications: false };
    case "unsupported_type":
      return { title: "Unsupported document type", detail: "Documents supports .docx, .xlsx, and .pptx files.", showApplications: false };
    default:
      return { title: "Preview unavailable", detail: error.message || "OfficeCLI could not render this document.", showApplications: true };
  }
}

function PreviewFailure({ error, onOpenApplications, onRetry }: { error: Error; onOpenApplications: () => void; onRetry: () => void }) {
  const copy = previewFailureCopy(error);
  return <div className="space-y-3 p-4"><div><p className="text-sm font-medium text-destructive">{copy.title}</p><p className="mt-1 text-xs text-muted-foreground">{copy.detail}</p></div><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>{copy.showApplications ? <Button size="sm" variant="secondary" onClick={onOpenApplications}>Open Applications</Button> : null}</div></div>;
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
  const setSection = useUiStore((state) => state.setSection);
  return <div className="grid h-full place-items-center"><div className="space-y-3 text-center"><FileText className="mx-auto size-8 text-muted-foreground" /><div><p className="font-medium">No projects yet</p><p className="text-sm text-muted-foreground">Register a project before browsing Office documents.</p></div><Button onClick={() => setSection("projects")}>Register a project</Button></div></div>;
}

export function normalizeDocumentDestination(input: string, type: Exclude<DocumentType, "all">): string {
  const trimmed = input.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!trimmed) return `untitled.${type}`;
  const withoutOfficeExtension = trimmed.replace(/\.(docx|xlsx|pptx)$/i, "");
  return `${withoutOfficeExtension}.${type}`;
}

function DocumentWriteModal({ mode, open, onClose, projectId, worktrees, defaultWorktreeId, onComplete, template, templateDefinition }: { mode: "create" | "import" | "template"; open: boolean; onClose: () => void; projectId: string; worktrees: Array<{ id: string; name?: string; branchName?: string; branch?: string }>; defaultWorktreeId: string; onComplete: (worktreeId: string, path: string) => void; template?: ProjectDocumentEntry; templateDefinition?: DocumentTemplate }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<Exclude<DocumentType, "all">>("docx");
  const [destination, setDestination] = useState("untitled.docx");
  const [worktreeId, setWorktreeId] = useState(defaultWorktreeId);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateData, setTemplateData] = useState("{}");
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({});

  useEffect(() => { if (open) setWorktreeId(defaultWorktreeId || worktrees[0]?.id || ""); }, [open, defaultWorktreeId, worktrees]);
  useEffect(() => { if (mode === "create") setDestination((value) => normalizeDocumentDestination(value, type)); }, [mode, type]);
  useEffect(() => {
    if (!open || mode !== "template" || !template) return;
    setType(template.type);
    setDestination(normalizeDocumentDestination(`copy-of-${template.name}`, template.type));
    setTemplateValues(Object.fromEntries((templateDefinition?.fields ?? []).map((field) => [field.key, field.defaultValue])));
  }, [open, mode, template, templateDefinition]);

  const submit = async () => {
    if (!worktreeId) { setError("Create or select a worktree first."); return; }
    const path = mode === "create" ? normalizeDocumentDestination(destination, type) : destination.trim().replaceAll("\\", "/");
    if (!path || path.startsWith("/") || path.split("/").includes("..")) { setError("Destination must be a relative path inside the worktree."); return; }
    setPending(true);
    setError(null);
    try {
      if (mode === "create") {
        const grant = (await api.issueApprovalGrant("wrapper:create", "app_officecli")) as { token: string };
        await api.invokeCapability("app.app_officecli.apply.create", { projectId, worktreeId, file: path, approvalToken: grant.token });
      } else if (mode === "import") {
        if (!file) throw new Error("Choose a Word, Excel, or PowerPoint file to import.");
        const dataBase64 = await readFileBase64(file);
        await api.importOfficeDocument(worktreeId, { destination: path, dataBase64 });
      } else {
        if (!template?.worktreeId || template.worktreeId !== worktreeId) throw new Error("Template and output must use the same worktree.");
        const data = templateDefinition?.fields.length ? templateValues : JSON.parse(templateData) as Record<string, unknown>;
        if (!data || Array.isArray(data) || typeof data !== "object") throw new Error("Template data must be a JSON object.");
        const grant = (await api.issueApprovalGrant("wrapper:merge", "app_officecli")) as { token: string };
        await api.invokeCapability("app.app_officecli.apply.merge", { projectId, worktreeId, template: template.path, output: path, data, approvalToken: grant.token } as unknown as Record<string, string>);
      }
      await queryClient.invalidateQueries({ queryKey: ["project-documents", projectId] });
      onComplete(worktreeId, path);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Document write failed.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onClose={pending ? () => undefined : onClose} title={mode === "create" ? "New Office document" : mode === "import" ? "Import Office document" : "Create from template"} description="Writes are confined to a worktree so changes remain reviewable before promotion.">
      <div className="space-y-3">
        {worktrees.length === 0 ? <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">This project has no worktree. Create one from Projects before writing documents.</p> : <label className="block space-y-1 text-sm"><span>Worktree</span><Select value={worktreeId} onChange={(event) => setWorktreeId(event.target.value)}>{worktrees.map((worktree) => <option key={worktree.id} value={worktree.id}>{worktree.name ?? worktree.branchName ?? worktree.branch ?? worktree.id}</option>)}</Select></label>}
        {mode === "create" ? <label className="block space-y-1 text-sm"><span>Document type</span><Select value={type} onChange={(event) => setType(event.target.value as Exclude<DocumentType, "all">)}><option value="docx">Word (.docx)</option><option value="xlsx">Excel (.xlsx)</option><option value="pptx">PowerPoint (.pptx)</option></Select></label> : mode === "import" ? <label className="block space-y-1 text-sm"><span>Office file</span><Input type="file" accept=".docx,.xlsx,.pptx" onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next) setDestination(`docs/${next.name}`); }} /></label> : <><p className="rounded bg-muted p-2 font-mono text-xs">Template: {template?.path}</p>{templateDefinition?.fields.length ? templateDefinition.fields.map((field) => <label key={field.key} className="block space-y-1 text-sm"><span>{field.label}</span><Input aria-label={field.label} value={templateValues[field.key] ?? ""} onChange={(event) => setTemplateValues((values) => ({ ...values, [field.key]: event.target.value }))} /></label>) : <label className="block space-y-1 text-sm"><span>Template data (JSON)</span><textarea value={templateData} onChange={(event) => setTemplateData(event.target.value)} rows={5} className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs" /></label>}</>}
        <label className="block space-y-1 text-sm"><span>Destination in worktree</span><Input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="docs/report.docx" spellCheck={false} /></label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button><Button onClick={() => void submit()} disabled={pending || worktrees.length === 0}>{pending ? "Working…" : mode === "create" ? "Create document" : mode === "import" ? "Import document" : "Create from template"}</Button></div>
      </div>
    </Modal>
  );
}

function SaveTemplateModal({ open, document, onClose, onSave }: { open: boolean; document: ProjectDocumentEntry | null; onClose: () => void; onSave: (name: string, fields: string[]) => void }) {
  const [name, setName] = useState("");
  const [fields, setFields] = useState("");
  useEffect(() => { if (open && document) { setName(document.name.replace(/\.(docx|xlsx|pptx)$/i, "")); setFields(""); } }, [open, document]);
  if (!document?.worktreeId) return null;
  return <Modal open={open} onClose={onClose} title="Add to templates" description="Define the fields users fill in when creating a document from this template."><div className="space-y-3"><label className="block space-y-1 text-sm"><span>Template name</span><Input aria-label="Template name" value={name} onChange={(event) => setName(event.target.value)} /></label><label className="block space-y-1 text-sm"><span>Field keys</span><Input aria-label="Template field keys" value={fields} onChange={(event) => setFields(event.target.value)} placeholder="title, owner, quarter" /><span className="block text-xs text-muted-foreground">Comma-separated keys matching placeholders in the template.</span></label><div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => onSave(name, fields.split(","))}>Save template</Button></div></div></Modal>;
}

function DocumentManageModal({ operation, document, onClose, onComplete }: { operation: "rename" | "move" | "copy" | "delete" | null; document: ProjectDocumentEntry | null; onClose: () => void; onComplete: (path: string | null) => void }) {
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
  const labels = { rename: "Rename document", move: "Move document", copy: "Copy document", delete: "Delete document" } as const;
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await api.manageOfficeDocument(document.worktreeId!, { operation, source: document.path, ...(operation === "delete" ? {} : { destination: destination.trim().replaceAll("\\", "/") }) });
      await queryClient.invalidateQueries({ queryKey: ["project-documents", document.projectId] });
      onComplete(operation === "delete" ? null : result.destination ?? destination);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Document operation failed.");
    } finally {
      setPending(false);
    }
  };
  return <Modal open onClose={pending ? () => undefined : onClose} closeDisabled={pending} title={labels[operation]} description="This change is confined to the selected worktree and will appear in its Git diff.">
    <div className="space-y-3">
      <p className="rounded bg-muted p-2 font-mono text-xs">{document.path}</p>
      {operation === "delete" ? <p className="text-sm text-destructive">This permanently removes the document from this worktree. The change remains reviewable through Git.</p> : <label className="block space-y-1 text-sm"><span>Destination in worktree</span><Input aria-label="Destination in worktree" value={destination} onChange={(event) => setDestination(event.target.value)} spellCheck={false} /></label>}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button><Button variant={operation === "delete" ? "destructive" : "primary"} onClick={() => void submit()} disabled={pending || (operation !== "delete" && !destination.trim())}>{pending ? "Working…" : labels[operation]}</Button></div>
    </div>
  </Modal>;
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? "").split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}
