import { useEffect, useRef, useState, type ComponentType } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, File, FileText, Folder, GitBranch, GitCompare, Images, ListChecks, MessageSquare, Paperclip, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/common/empty-state";
import { DecisionAction } from "@/features/invocations/decision-action";
import { InvocationEventHistory } from "@/features/invocations/invocation-event-history";
import { InvocationRefusalHistory } from "@/features/invocations/invocation-refusal-history";
import { WorktreeLinkPopover } from "@/features/projects/worktree-link-popover";
import { OfficecliVisualDiff, OfficecliFilePreview } from "@/features/projects/officecli-visual-diff";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import type { InvocationSnapshot, WorktreeSnapshot } from "@/lib/console-state";

const RUNNING = ["queued", "dispatching", "waiting_for_local_approval", "running", "cancelling"];
// `children` absent = this directory has not been read yet; `[]` = read, empty.
// The distinction is the whole fix in #1200: the two were conflated, so an
// unfetched directory and an empty one both rendered as nothing.
export type TreeNode = { name: string; path: string; dir: boolean; children?: TreeNode[] };

export function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const hit = node.children ? findNode(node.children, path) : null;
    if (hit) return hit;
  }
  return null;
}

export function withChildren(nodes: TreeNode[], path: string, children: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === path) return { ...node, children };
    if (node.children) return { ...node, children: withChildren(node.children, path, children) };
    return node;
  });
}
type SearchMatch = { path: string; line?: number; text?: string };
type PaneTab = "project" | "sessions" | "changes" | "checks";
const PANE_TABS: [PaneTab, string, ComponentType<{ className?: string }>][] = [
  ["project", "Project", Folder],
  ["sessions", "Sessions", MessageSquare],
  ["changes", "Changes", GitBranch],
  ["checks", "Checks", ListChecks],
];
type GitStatus = {
  branch: string;
  changedFiles: number;
  clean: boolean;
  hasUpstream: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
};
type DiffFile = { path: string; index: string; work: string; untracked: boolean };
type WorktreeDiff = { files: DiffFile[]; base: string; diff: string; truncated: boolean };
// Reserved tab id for the unified diff view in the main pane.
const DIFF_TAB = "__changes__";

// Worktree session view: run an agent in this worktree's checkout, watch its
// output, and browse its files — the focused workspace for one branch.
export function WorktreeView({ worktree }: { worktree: WorktreeSnapshot }) {
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
  // Outward git actions (publish / open PR) use their own async slot so they
  // don't share pending/error state with the run button.
  const { execute: execGit, pending: gitPending, error: gitError } = useAsyncAction();
  const setSelectedWorktreeId = useUiStore((s) => s.setSelectedWorktreeId);
  const selectedInvocationId = useUiStore((s) => s.selectedInvocationId);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);

  const agents = state?.agents ?? [];
  const project = (state?.projects ?? []).find((p) => p.id === worktree.projectId);
  const [task, setTask] = useState("Summarize this repository and the open work.");
  const [agentId, setAgentId] = useState(worktree.agentId ?? agents[0]?.id ?? "");
  const [permissionLevel, setPermissionLevel] = useState<"ask" | "auto" | "full">("ask");
  // Pasted/picked files to save into the worktree before the run (so the agent
  // can read them). Held as base64 until the run uploads them.
  const [attachments, setAttachments] = useState<{ name: string; dataBase64: string; size: number; type: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [fileQuery, setFileQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"name" | "content">("name");
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [paneTab, setPaneTab] = useState<PaneTab>("project");
  const [git, setGit] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState<WorktreeDiff | null>(null);
  // Per file-tab view: show the file's current content or just its changes.
  const [fileView, setFileView] = useState<"content" | "diff" | "visual">("content");
  // Tracks the latest run's status across renders so we can detect the
  // running→finished edge and refresh the workspace once.
  const prevStatusRef = useRef<string | null>(null);
  const selectionWorktreeRef = useRef(worktree.id);
  // Bridge the short gap between POST /invocations succeeding and the next
  // console-state refresh. Without this, the selection repair effect can snap
  // back to the previous run before the newly-created invocation is visible.
  const [createdInvocation, setCreatedInvocation] = useState<InvocationSnapshot | null>(null);
  const [sessionScope, setSessionScope] = useState<"worktree" | "all">("worktree");
  const [sessionQuery, setSessionQuery] = useState("");
  const [prOpen, setPrOpen] = useState(false);
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  // Open file tabs are kept per worktree so switching away and back preserves
  // them. Active tab + open files are stored by worktree id; file contents are
  // cached under a "<worktreeId>::<path>" key.
  const [tabsByWt, setTabsByWt] = useState<Record<string, { openFiles: { path: string; name: string }[]; activeTab: string }>>({});
  const [fileCache, setFileCache] = useState<Record<string, { content: string; truncated?: boolean; message?: string }>>({});
  const tabs = tabsByWt[worktree.id] ?? { openFiles: [], activeTab: "session" };
  const openFiles = tabs.openFiles;
  const activeTab = tabs.activeTab;
  const cacheKey = `${worktree.id}::${activeTab}`;
  const isFileTab = activeTab !== "session" && activeTab !== DIFF_TAB;
  // Office documents get a third file view: a rendered before/after visual diff
  // (worktree vs base) via the officecli preview route (#1349 polish).
  const activeIsOfficeDoc = isFileTab && /\.(docx|xlsx|pptx)$/i.test(activeTab);

  function updateTabs(fn: (t: { openFiles: { path: string; name: string }[]; activeTab: string }) => { openFiles: { path: string; name: string }[]; activeTab: string }) {
    setTabsByWt((prev) => ({ ...prev, [worktree.id]: fn(prev[worktree.id] ?? { openFiles: [], activeTab: "session" }) }));
  }
  function selectTab(path: string) {
    updateTabs((t) => ({ ...t, activeTab: path }));
  }
  // Fetch a file's content into the cache. `force` re-reads even when cached —
  // used after a run finishes, since the agent may have rewritten the file.
  function loadFile(path: string, force = false) {
    const key = `${worktree.id}::${path}`;
    if (!force && fileCache[key]) return;
    (api.readWorktreeFile(worktree.id, path) as Promise<{ content: string; truncated?: boolean; message?: string }>)
      .then((r) => setFileCache((c) => ({ ...c, [key]: { content: r.content ?? "", truncated: r.truncated, message: r.message } })))
      .catch((e) => setFileCache((c) => ({ ...c, [key]: { content: "", message: e instanceof Error ? e.message : "Failed to load." } })));
  }
  function openFile(path: string, name: string) {
    updateTabs((t) => ({
      openFiles: t.openFiles.some((f) => f.path === path) ? t.openFiles : [...t.openFiles, { path, name }],
      activeTab: path,
    }));
    loadFile(path);
  }
  function closeFile(path: string) {
    updateTabs((t) => {
      const next = t.openFiles.filter((f) => f.path !== path);
      return { openFiles: next, activeTab: t.activeTab === path ? next[next.length - 1]?.path ?? "session" : t.activeTab };
    });
  }

  // Load (or reload) the root of the file tree. Directories start collapsed and
  // their contents are fetched on first expand (#1200): the server returns one
  // level, so eagerly expanding everything would fan out a request per directory
  // and still show nothing until each lands.
  function loadTree() {
    setExpanded(new Set());
    setLoadingDirs(new Set());
    (api.listWorktreeFiles(worktree.id) as Promise<{ tree: TreeNode[] }>)
      .then((r) => setTree(r.tree ?? []))
      .catch(() => {
        setTree([]);
        setExpanded(new Set());
      });
  }

  // Fetch one directory's entries and splice them in. `children` absent means
  // "not read yet" and `[]` means "empty", so a directory that genuinely has no
  // entries resolves to [] and is not re-fetched on the next expand.
  function loadDir(path: string) {
    setLoadingDirs((prev) => new Set(prev).add(path));
    (api.listWorktreeFiles(worktree.id, path) as Promise<{ tree: TreeNode[] }>)
      .then((r) => setTree((prev) => withChildren(prev, path, r.tree ?? [])))
      .catch(() =>
        // Leave `children` absent so the directory stays unread and a later
        // expand retries. Marking it [] here would present a failed fetch as an
        // empty directory — the exact lie #1200 was about.
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        }),
      )
      .finally(() =>
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        }),
      );
  }

  function toggleDir(path: string) {
    const willOpen = !expanded.has(path);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (willOpen && !findNode(tree, path)?.children && !loadingDirs.has(path)) loadDir(path);
  }

  useEffect(() => {
    if (!agentId && agents.length > 0) setAgentId(worktree.agentId ?? agents[0].id);
  }, [agents, agentId, worktree.agentId]);

  useEffect(() => {
    setGit(null);
    setDiff(null);
    prevStatusRef.current = null;
    setFileQuery("");
    setTree([]);
    setResults([]);
    setPaneTab("project");
    setFileView("content");
    setSessionScope("worktree");
    setSessionQuery("");
    setCreatedInvocation(null);
    // Reset the run target to this worktree's own agent (the instance is reused
    // across worktree switches, so a stale agent would otherwise carry over).
    setAgentId(worktree.agentId ?? agents[0]?.id ?? "");
    loadTree();
  }, [worktree.id]);

  // Debounced file search (by name or content) when the box has a query.
  useEffect(() => {
    const q = fileQuery.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      (api.searchWorktree(worktree.id, q, searchMode) as Promise<{ matches: SearchMatch[] }>)
        .then((r) => setResults(r.matches ?? []))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [fileQuery, searchMode, worktree.id]);

  useEffect(() => {
    if ((paneTab !== "changes" && paneTab !== "checks") || git) return;
    (api.worktreeGit(worktree.id) as Promise<GitStatus>).then(setGit).catch(() => setGit(null));
  }, [paneTab, git, worktree.id]);

  // Load the unified diff when the Changes tab (or its diff view) is showing and
  // we don't have one cached. Cleared on worktree switch and after a run.
  useEffect(() => {
    // The unified diff backs the Changes tab/diff view AND a file tab's "changes"
    // toggle (which slices this file's section out of it).
    const wantsDiff = paneTab === "changes" || activeTab === DIFF_TAB || fileView === "diff";
    if (!wantsDiff || diff) return;
    (api.worktreeDiff(worktree.id) as Promise<WorktreeDiff>).then(setDiff).catch(() => setDiff(null));
  }, [paneTab, activeTab, fileView, diff, worktree.id]);

  const invocations = (state?.invocations ?? [])
    .filter((i) => i.worktreeId === worktree.id)
    .sort((left, right) => {
      const byTime = String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""));
      return byTime || right.id.localeCompare(left.id);
    });
  const latestInvocation = invocations[0];

  // When a run in this worktree finishes, the agent may have rewritten or added
  // files — drop this worktree's cached contents, refetch what's open, and
  // refresh the tree + git/diff so the workspace reflects the agent's output.
  useEffect(() => {
    const status = latestInvocation?.status ?? null;
    const justFinished = RUNNING.includes(prevStatusRef.current ?? "") && status !== null && !RUNNING.includes(status);
    prevStatusRef.current = status;
    if (!justFinished) return;
    setFileCache((c) => {
      const next: typeof c = {};
      for (const [k, v] of Object.entries(c)) if (!k.startsWith(`${worktree.id}::`)) next[k] = v;
      return next;
    });
    (tabsByWt[worktree.id]?.openFiles ?? []).forEach((f) => loadFile(f.path, true));
    setGit(null);
    setDiff(null);
    loadTree();
  }, [latestInvocation?.status, latestInvocation?.id, worktree.id]);

  // Sessions tab: agent session history, scoped to this worktree or the project.
  const scopedSessions =
    sessionScope === "all"
      ? (state?.invocations ?? [])
          .filter((i) => i.projectId === worktree.projectId)
          .sort((left, right) => {
            const byTime = String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""));
            return byTime || right.id.localeCompare(left.id);
          })
      : invocations;
  const sessions = scopedSessions.filter((i) => i.id.toLowerCase().includes(sessionQuery.trim().toLowerCase()));
  // Keep a selection only while it belongs to the visible session scope. A
  // stale selection from another worktree falls back to this worktree's latest
  // run, including on the first render after switching worktrees.
  const selectedInvocation =
    selectionWorktreeRef.current === worktree.id
      ? scopedSessions.find((invocation) => invocation.id === selectedInvocationId)
        ?? (createdInvocation?.id === selectedInvocationId ? createdInvocation : null)
        ?? latestInvocation
      : latestInvocation;

  useEffect(() => {
    if (!state) return;
    selectionWorktreeRef.current = worktree.id;
    const nextId = selectedInvocation?.id ?? null;
    if (nextId !== selectedInvocationId) setSelectedInvocationId(nextId);
  }, [state, worktree.id, selectedInvocation?.id, selectedInvocationId, setSelectedInvocationId]);

  // Checks tab: a readiness checklist for this worktree.
  const checks = [
    { label: "Repository ready", ok: true },
    { label: "Agent assigned", ok: Boolean(worktree.agentId) },
    { label: "Branch published", ok: Boolean(git?.hasUpstream) },
    { label: "Linked to issue/PR", ok: Boolean(worktree.link) },
    { label: "Latest run succeeded", ok: latestInvocation?.status === "succeeded" },
  ];
  const createdInvocationAwaitingSnapshot = Boolean(
    createdInvocation
      && !invocations.some((invocation) => invocation.id === createdInvocation.id),
  );
  const latestIsRunning = RUNNING.includes(latestInvocation?.status ?? "")
    || (createdInvocationAwaitingSnapshot && RUNNING.includes(createdInvocation?.status ?? ""));
  const selectedIsRunning = RUNNING.includes(selectedInvocation?.status ?? "");
  const agent = agents.find((a) => a.id === agentId);
  const runDisabled = !state || !task.trim() || !agent || latestIsRunning || pending;

  // Read picked/pasted files into base64 and stage them. Awaits all reads so a
  // run that starts right after a paste sees the files; the count cap is applied
  // across accumulated state (not per call) and matches the server's limits.
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  async function addFiles(files: FileList | File[]) {
    const read = await Promise.all(
      Array.from(files)
        .filter((f) => f.size > 0 && f.size <= MAX_FILE_BYTES)
        .map(
          (f) =>
            new Promise<{ name: string; dataBase64: string; size: number; type: string } | null>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve({ name: f.name || "file", dataBase64: String(reader.result ?? "").split(",")[1] ?? "", size: f.size, type: f.type });
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(f);
            }),
        ),
    );
    const valid = read.filter((a): a is NonNullable<typeof a> => Boolean(a?.dataBase64));
    if (valid.length > 0) setAttachments((prev) => [...prev, ...valid].slice(0, 6));
  }

  function run() {
    if (runDisabled) return;
    void execute(async () => {
      let finalTask = task.trim();
      // Save attachments into the worktree, then reference their paths in the task.
      if (attachments.length > 0) {
        const r = (await api.uploadWorktreeAttachments(
          worktree.id,
          attachments.map((a) => ({ name: a.name, dataBase64: a.dataBase64 })),
        )) as { attachments?: { name: string; path: string }[] };
        const saved = r.attachments ?? [];
        if (saved.length > 0) {
          finalTask += `\n\nAttached files (in the worktree):\n${saved.map((a) => `- ${a.path}`).join("\n")}`;
        }
      }
      const created = (await api.createInvocation(finalTask, agentId || null, worktree.projectId, worktree.id, { permissionLevel })) as {
        invocation?: InvocationSnapshot;
      };
      if (created.invocation?.id) {
        setCreatedInvocation(created.invocation);
        setSelectedInvocationId(created.invocation.id);
        selectTab("session");
      }
      // Clear only after the run is created, so a failed create keeps the staged
      // files for a retry instead of silently dropping them.
      setAttachments([]);
      return created;
    });
  }

  // Push the branch to origin, then refresh git/diff so the published state shows.
  function publishBranch() {
    void execGit(async () => {
      await api.publishWorktreeBranch(worktree.id);
      setGit(null);
      setDiff(null);
    });
  }
  function openPrDialog() {
    // Seed a sensible title from the branch; the user edits before submitting.
    setPrTitle(worktree.branch.replace(/^.*\//, "").replace(/[-_]+/g, " ").trim() || worktree.branch);
    setPrBody("");
    setPrOpen(true);
  }
  function submitPr() {
    void execGit(async () => {
      await api.createWorktreePr(worktree.id, { title: prTitle.trim(), body: prBody.trim() });
      setPrOpen(false);
      setGit(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSelectedWorktreeId(null)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {project?.name ?? "Project"}
        </button>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">{worktree.branch}</span>
        {worktree.isMain ? <Badge tone="neutral">main</Badge> : <Badge tone="neutral">worktree</Badge>}
        {worktree.link ? <WorktreeLinkPopover worktree={worktree} /> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-3">
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border">
            <button
              type="button"
              onClick={() => selectTab("session")}
              className={cn(
                "shrink-0 rounded-t-md border-b-2 px-3 py-1.5 text-sm transition",
                activeTab === "session" ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              Session
            </button>
            {openFiles.map((f) => (
              <div
                key={f.path}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-t-md border-b-2 pl-3 pr-1 text-sm transition",
                  activeTab === f.path ? "border-primary text-foreground" : "border-transparent text-muted-foreground",
                )}
              >
                <button type="button" onClick={() => selectTab(f.path)} className="py-1.5 hover:text-foreground" title={f.path}>
                  {f.name}
                </button>
                <button type="button" onClick={() => closeFile(f.path)} aria-label={`Close ${f.name}`} className="grid size-5 place-items-center rounded hover:bg-muted">
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {activeTab === DIFF_TAB ? (
              <div className="flex shrink-0 items-center gap-1 rounded-t-md border-b-2 border-primary pl-3 pr-1 text-sm text-foreground">
                <span className="py-1.5">Changes</span>
                <button type="button" onClick={() => selectTab("session")} aria-label="Close diff" className="grid size-5 place-items-center rounded hover:bg-muted">
                  <X className="size-3" />
                </button>
              </div>
            ) : null}

            {/* File tab: toggle between the file's content and just its changes. */}
            {isFileTab ? (
              <div className="ml-auto flex shrink-0 items-center gap-0.5 self-center rounded-lg bg-muted p-0.5">
                {(
                  [
                    ["content", "File content", FileText],
                    ["diff", "File changes", GitCompare],
                    // Rendered before/after — Office documents only.
                    ...(activeIsOfficeDoc ? [["visual", "Visual diff (rendered)", Images]] : []),
                  ] as ["content" | "diff" | "visual", string, ComponentType<{ className?: string }>][]
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={fileView === key}
                    onClick={() => setFileView(key)}
                    className={cn(
                      "grid size-6 place-items-center rounded-md transition",
                      fileView === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {activeTab === "session" ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Run an agent in this worktree</CardTitle>
                  <p className="select-all break-all font-mono text-[11px] text-muted-foreground">{worktree.path}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea
                    rows={4}
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                    onPaste={(e) => {
                      if (e.clipboardData.files.length > 0) {
                        e.preventDefault();
                        addFiles(e.clipboardData.files);
                      }
                    }}
                    aria-label="Task"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) addFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                    <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} title="Attach files (or paste an image)">
                      <Paperclip className="mr-1 size-3.5" /> Attach
                    </Button>
                    {attachments.map((a, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 py-1 pl-1.5 pr-2 text-xs">
                        {a.type.startsWith("image/") ? (
                          <img
                            src={`data:${a.type};base64,${a.dataBase64}`}
                            alt={a.name}
                            className="size-8 rounded object-cover"
                          />
                        ) : (
                          <File className="size-3 opacity-60" />
                        )}
                        <span className="max-w-[160px] truncate">{a.name}</span>
                        <span className="text-muted-foreground">{(a.size / 1024).toFixed(0)}KB</span>
                        <button
                          type="button"
                          onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                          aria-label={`Remove ${a.name}`}
                          className="ml-0.5 grid size-4 place-items-center rounded hover:text-destructive"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <Field label="Agent">
                      <Select value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Agent">
                        {agents.length === 0 ? <option value="">No agent</option> : null}
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Permissions">
                      <Select
                        value={permissionLevel}
                        onChange={(e) => setPermissionLevel(e.target.value as "ask" | "auto" | "full")}
                        aria-label="Permission level"
                        title="How risky operations are gated for this run"
                      >
                        <option value="ask">Ask before edits</option>
                        <option value="auto">Auto-approve</option>
                        <option value="full">Full access</option>
                      </Select>
                    </Field>
                    <Button onClick={run} disabled={runDisabled}>
                      {latestIsRunning ? "Running…" : "Run in this worktree"}
                    </Button>
                  </div>
                  {error ? <p className="text-xs text-destructive">{error}</p> : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Session output</CardTitle>
                  {selectedInvocation ? (
                    <p className="text-sm text-muted-foreground">
                      {selectedInvocation.id} · {selectedInvocation.status}
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {selectedInvocation ? (
                    <>
                      <InvocationEventHistory
                        invocationId={selectedInvocation.id}
                        live={selectedIsRunning}
                        renderAction={(event) => <DecisionAction event={event} />}
                      />
                      <InvocationRefusalHistory invocationId={selectedInvocation.id} />
                    </>
                  ) : (
                    <EmptyState title="No runs yet" hint="Run an agent above to start a session in this worktree." />
                  )}
                </CardContent>
              </Card>
            </>
          ) : activeTab === DIFF_TAB ? (
            <DiffView diff={diff} onOpenFile={openFile} />
          ) : fileView === "visual" && activeIsOfficeDoc ? (
            <OfficecliVisualDiff projectId={worktree.projectId} worktreeId={worktree.id} path={activeTab} />
          ) : fileView === "diff" ? (
            <FileDiffView path={activeTab} diff={diff} />
          ) : activeIsOfficeDoc ? (
            // An Office document is binary OOXML — render it instead of dumping raw
            // bytes into the code view (which reads as garbage). Browses like any file,
            // and (in a worktree) offers a governed inline edit.
            <OfficecliFilePreview projectId={worktree.projectId} worktreeId={worktree.id} path={activeTab} editable />
          ) : (
            <FileCodeView path={activeTab} data={fileCache[cacheKey]} />
          )}
        </div>

        <Card>
          <CardContent className="p-3">
            <div className="mb-3 flex gap-1 rounded-lg bg-muted p-0.5 text-xs">
              {PANE_TABS.map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  title={label}
                  aria-label={label}
                  onClick={() => setPaneTab(key)}
                  className={cn(
                    "flex flex-1 items-center justify-center rounded-md px-2 py-1.5 transition",
                    paneTab === key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                </button>
              ))}
            </div>

            {paneTab === "project" ? (
              <div className="space-y-2">
                <Input
                  value={fileQuery}
                  placeholder="Find files"
                  className="h-7 text-xs"
                  onChange={(e) => setFileQuery(e.target.value)}
                />
                <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-[11px]">
                  {(
                    [
                      ["name", "Name"],
                      ["content", "Content"],
                    ] as ["name" | "content", string][]
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setSearchMode(k)}
                      className={cn(
                        "flex-1 rounded-md px-2 py-1 font-medium transition",
                        searchMode === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>

                {fileQuery.trim() ? (
                  results.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No matches.</p>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {results.map((m, i) => (
                        <li key={`${m.path}:${m.line ?? i}`} className="min-w-0">
                          <button
                            type="button"
                            onClick={() => openFile(m.path, m.path.split("/").pop() ?? m.path)}
                            className="flex w-full items-center gap-1.5 rounded text-left hover:bg-muted"
                          >
                            <File className="size-3 shrink-0 text-muted-foreground" />
                            <span className="truncate font-mono text-[11px]">
                              {m.path}
                              {m.line ? `:${m.line}` : ""}
                            </span>
                          </button>
                          {m.text ? <p className="truncate pl-4 font-mono text-[10px] text-muted-foreground">{m.text.trim()}</p> : null}
                        </li>
                      ))}
                    </ul>
                  )
                ) : tree.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Empty or unavailable.</p>
                ) : (
                  <FileTree
                    nodes={tree}
                    depth={0}
                    expanded={expanded}
                    loadingDirs={loadingDirs}
                    activePath={activeTab}
                    onOpen={openFile}
                    toggle={toggleDir}
                  />
                )}
              </div>
            ) : null}

            {paneTab === "changes" ? (
              !git ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : (
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <GitBranch className="size-3.5 shrink-0 opacity-70" />
                    <span className="font-medium">{git.branch}</span>
                  </div>
                  {git.hasUpstream ? (
                    git.clean && git.ahead === 0 ? (
                      <div>
                        <p className="font-medium text-foreground">No changes on this branch</p>
                        <p className="text-muted-foreground">
                          Clean and up to date with <span className="font-mono">{git.upstream}</span>.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1 text-muted-foreground">
                        {git.changedFiles > 0 ? <p>{git.changedFiles} uncommitted change(s)</p> : null}
                        <p>
                          {git.ahead} ahead · {git.behind} behind <span className="font-mono">{git.upstream}</span>
                        </p>
                      </div>
                    )
                  ) : (
                    <div>
                      <p className="font-medium text-foreground">Branch not published</p>
                      <p className="text-muted-foreground">
                        Publish this branch before creating a pull request.
                        {git.changedFiles > 0 ? ` ${git.changedFiles} uncommitted change(s).` : ""}
                      </p>
                    </div>
                  )}
                  {diff && diff.files.length > 0 ? (
                    <ul className="space-y-0.5 border-t border-border pt-2">
                      {diff.files.map((f) => (
                        <li key={f.path} className="min-w-0">
                          <button
                            type="button"
                            onClick={() => selectTab(DIFF_TAB)}
                            className="flex w-full items-center gap-1.5 rounded py-0.5 text-left hover:bg-muted"
                            title={f.path}
                          >
                            <span className={cn("w-3 shrink-0 text-center font-mono", statusColor(f))}>{statusLetter(f)}</span>
                            <span className="truncate font-mono text-[11px]">{f.path}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="space-y-1.5 border-t border-border pt-2">
                    {!git.hasUpstream ? (
                      <Button onClick={publishBranch} disabled={gitPending} size="sm" className="w-full">
                        {gitPending ? "Publishing…" : "Publish branch"}
                      </Button>
                    ) : git.ahead > 0 ? (
                      <Button onClick={publishBranch} disabled={gitPending} size="sm" className="w-full">
                        {gitPending ? "Pushing…" : `Push ${git.ahead} commit(s)`}
                      </Button>
                    ) : null}
                    {worktree.link && worktree.link.type === "pr" ? (
                      <a
                        href={worktree.link.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-md border border-border py-1.5 text-center text-xs text-primary hover:bg-muted"
                      >
                        PR #{worktree.link.number} ↗
                      </a>
                    ) : (
                      <Button onClick={openPrDialog} disabled={gitPending} variant="secondary" size="sm" className="w-full">
                        Open pull request
                      </Button>
                    )}
                    {gitError ? <p className="text-[11px] text-destructive">{gitError}</p> : null}
                  </div>
                </div>
              )
            ) : null}

            {paneTab === "sessions" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">Showing {sessions.length} session(s)</p>
                  <div className="flex gap-0.5 rounded-md bg-muted p-0.5 text-[10px]">
                    {(
                      [
                        ["worktree", "Worktree"],
                        ["all", "All"],
                      ] as ["worktree" | "all", string][]
                    ).map(([k, l]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setSessionScope(k)}
                        className={cn(
                          "rounded px-1.5 py-0.5 font-medium transition",
                          sessionScope === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <Input
                  value={sessionQuery}
                  placeholder="Search sessions"
                  className="h-7 text-xs"
                  onChange={(e) => setSessionQuery(e.target.value)}
                />
                {sessions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No agent sessions yet.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {sessions.slice(0, 30).map((inv) => (
                      <li key={inv.id}>
                        <button
                          type="button"
                          aria-pressed={inv.id === selectedInvocation?.id}
                          onClick={() => {
                            setSelectedInvocationId(inv.id);
                            selectTab("session");
                          }}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded border px-2 py-1 text-left transition-colors",
                            inv.id === selectedInvocation?.id
                              ? "border-primary bg-primary/5"
                              : "border-border hover:bg-accent",
                          )}
                        >
                          <span className="truncate font-mono text-[11px]">{inv.id}</span>
                          <Badge tone={inv.status === "succeeded" ? "success" : RUNNING.includes(inv.status ?? "") ? "neutral" : "warning"}>
                            {inv.status}
                          </Badge>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {paneTab === "checks" ? (
              <ul className="space-y-1.5 text-xs">
                {checks.map((c) => (
                  <li key={c.label} className="flex items-center gap-2">
                    <span className={c.ok ? "text-emerald-500" : "text-muted-foreground"}>{c.ok ? "✓" : "○"}</span>
                    <span className={c.ok ? "" : "text-muted-foreground"}>{c.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Modal
        open={prOpen}
        onClose={() => setPrOpen(false)}
        title="Open pull request"
        description={`Pushes ${worktree.branch} to origin and opens a PR via gh.`}
      >
        <div className="space-y-3">
          <Field label="Title">
            <Input value={prTitle} onChange={(e) => setPrTitle(e.target.value)} placeholder="Pull request title" />
          </Field>
          <Field label="Description">
            <Textarea rows={5} value={prBody} onChange={(e) => setPrBody(e.target.value)} placeholder="Optional summary of the change" />
          </Field>
          {gitError ? <p className="text-xs text-destructive">{gitError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPrOpen(false)} disabled={gitPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={submitPr} disabled={gitPending || !prTitle.trim()}>
              {gitPending ? "Creating…" : "Create pull request"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function FileTree({
  nodes,
  depth,
  expanded,
  loadingDirs,
  activePath,
  toggle,
  onOpen,
}: {
  nodes: TreeNode[];
  depth: number;
  expanded: Set<string>;
  loadingDirs: Set<string>;
  activePath: string;
  toggle: (path: string) => void;
  onOpen: (path: string, name: string) => void;
}) {
  return (
    <ul className="text-xs">
      {nodes.map((n) => {
        const open = expanded.has(n.path);
        return (
          <li key={n.path}>
            <button
              type="button"
              onClick={() => (n.dir ? toggle(n.path) : onOpen(n.path, n.name))}
              style={{ paddingLeft: depth * 12 }}
              className={cn(
                "flex w-full items-center gap-1 rounded py-0.5 text-left hover:bg-muted",
                !n.dir && activePath === n.path ? "bg-primary/10 text-foreground" : "",
              )}
            >
              {n.dir ? (
                open ? (
                  <ChevronDown className="size-3 shrink-0 opacity-60" />
                ) : (
                  <ChevronRight className="size-3 shrink-0 opacity-60" />
                )
              ) : (
                <span className="w-3 shrink-0" />
              )}
              {n.dir ? (
                <Folder className="size-3.5 shrink-0 text-sky-500" />
              ) : (
                <File className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{n.name}</span>
            </button>
            {n.dir && open ? (
              n.children ? (
                n.children.length > 0 ? (
                  <FileTree
                    nodes={n.children}
                    depth={depth + 1}
                    expanded={expanded}
                    loadingDirs={loadingDirs}
                    activePath={activePath}
                    toggle={toggle}
                    onOpen={onOpen}
                  />
                ) : (
                  <p style={{ paddingLeft: (depth + 1) * 12 + 16 }} className="py-0.5 text-[11px] text-muted-foreground">
                    Empty
                  </p>
                )
              ) : (
                // Not read yet — say so, rather than render nothing and look broken.
                <p style={{ paddingLeft: (depth + 1) * 12 + 16 }} className="py-0.5 text-[11px] text-muted-foreground">
                  {loadingDirs.has(n.path) ? "Loading…" : "Could not load."}
                </p>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function FileCodeView({ path, data }: { path: string; data?: { content: string; truncated?: boolean; message?: string } }) {
  if (!data) {
    return (
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">Loading {path}…</CardContent>
      </Card>
    );
  }
  if (data.message && !data.content) {
    return (
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">{data.message}</CardContent>
      </Card>
    );
  }
  const lines = data.content.split("\n");
  return (
    <Card>
      <CardHeader className="border-b border-border py-2">
        <p className="select-all break-all font-mono text-[11px] text-muted-foreground">{path}</p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full border-collapse font-mono text-[12px]">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="align-top">
                  <td className="select-none border-r border-border px-2 text-right text-muted-foreground">{i + 1}</td>
                  <td className="whitespace-pre px-3">{line || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.truncated ? <p className="px-3 py-1 text-[11px] text-muted-foreground">{data.message}</p> : null}
      </CardContent>
    </Card>
  );
}

// Tailwind classes for one unified-diff line (hunk header / metadata / +/-).
// Shared by the whole-branch DiffView and a single file's FileDiffView.
function diffLineClass(line: string): string {
  if (line.startsWith("@@")) return "text-sky-500 bg-muted/50";
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("new file") ||
    line.startsWith("deleted file") ||
    line.startsWith("rename ") ||
    line.startsWith("similarity ")
  ) {
    return "text-muted-foreground";
  }
  if (line[0] === "+") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (line[0] === "-") return "bg-destructive/10 text-destructive";
  return "text-muted-foreground";
}

// Slice one file's section out of the worktree's full unified diff: capture from
// its `diff --git a/… b/<path>` header until the next file's header.
function fileDiffText(full: string, path: string): string {
  const out: string[] = [];
  let capturing = false;
  for (const line of full.split("\n")) {
    const m = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (m) capturing = m[1] === path;
    if (capturing) out.push(line);
  }
  return out.join("\n").trim();
}

// One file's changes (the "diff" toggle on a file tab), reusing the worktree
// diff already fetched for the Changes tab.
function FileDiffView({ path, diff }: { path: string; diff: WorktreeDiff | null }) {
  if (!diff) {
    return (
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">Loading changes…</CardContent>
      </Card>
    );
  }
  const text = fileDiffText(diff.diff, path);
  if (!text) {
    return (
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">No changes for this file on this branch.</CardContent>
      </Card>
    );
  }
  const lines = text.split("\n");
  return (
    <Card>
      <CardHeader className="border-b border-border py-2">
        <p className="select-all break-all font-mono text-[11px] text-muted-foreground">{path} · changes</p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[60vh] overflow-auto font-mono text-[12px] leading-[1.5]">
          {lines.map((line, i) => (
            <div key={i} className={cn("whitespace-pre px-3", diffLineClass(line))}>
              {line || " "}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Single-letter status for a changed file, mirroring git's porcelain codes.
function statusLetter(f: DiffFile): string {
  if (f.untracked) return "A";
  const c = f.work && f.work !== " " ? f.work : f.index;
  return (c || "M").toUpperCase();
}
function statusColor(f: DiffFile): string {
  switch (statusLetter(f)) {
    case "A":
      return "text-emerald-500";
    case "D":
      return "text-destructive";
    case "R":
      return "text-sky-500";
    default:
      return "text-amber-500";
  }
}

// Renders a unified diff with per-line +/- coloring. File headers ("diff --git")
// are clickable to open that file in its own tab.
function DiffView({ diff, onOpenFile }: { diff: WorktreeDiff | null; onOpenFile: (path: string, name: string) => void }) {
  if (!diff) {
    return (
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">Loading diff…</CardContent>
      </Card>
    );
  }
  if (!diff.diff.trim()) {
    return (
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">No changes to show on this branch.</CardContent>
      </Card>
    );
  }
  const lines = diff.diff.split("\n");
  return (
    <Card>
      <CardHeader className="border-b border-border py-2">
        <p className="text-[11px] text-muted-foreground">
          Diff vs <span className="font-mono">{diff.base === "HEAD" ? "HEAD" : diff.base.slice(0, 12)}</span> · {diff.files.length} file(s)
          {diff.truncated ? " · truncated" : ""}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[60vh] overflow-auto font-mono text-[12px] leading-[1.5]">
          {lines.map((line, i) => {
            const fileMatch = /^diff --git a\/.+ b\/(.+)$/.exec(line);
            if (fileMatch) {
              const p = fileMatch[1];
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onOpenFile(p, p.split("/").pop() ?? p)}
                  className="mt-1 flex w-full items-center gap-1 border-t border-border bg-muted px-3 py-1 text-left font-medium text-foreground hover:underline"
                  title={`Open ${p}`}
                >
                  <File className="size-3 shrink-0 opacity-60" />
                  <span className="truncate">{p}</span>
                </button>
              );
            }
            return (
              <div key={i} className={cn("whitespace-pre px-3", diffLineClass(line))}>
                {line || " "}
              </div>
            );
          })}
        </div>
        {diff.truncated ? <p className="px-3 py-1 text-[11px] text-muted-foreground">Diff truncated at 1 MB.</p> : null}
      </CardContent>
    </Card>
  );
}
