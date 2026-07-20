import { useEffect, useState } from "react";
import { FolderGit2, FolderPlus, PanelsTopLeft } from "lucide-react";
import { useConsoleState, useRefreshConsoleState } from "@/data/use-console-state";
import { useUiStore } from "@/store/ui-store";
import { Button } from "@/components/ui/button";
import { api } from "@/data/use-console-actions";
import { ProjectTree } from "@/features/projects/project-tree";
import { DashboardView } from "@/features/dashboard/dashboard-view";
import { SessionHistory } from "@/features/invocations/session-history";
import { OfficecliPreview } from "@/features/workspace/officecli-preview";

// Agent Workspace MVP (#158): the interactive, project-scoped surface. Instead of
// the file browser, transcript, and history competing across separate sections
// (#151), this composes them into ONE three-pane workspace bound to the selected
// project: LEFT project files · CENTER task transcript + composer · RIGHT history.
// The panes reuse the existing, already project-scoped components — this slice is
// composition + a project switcher, not new machinery.

interface GitFacts {
  isRepo?: boolean;
  remoteUrl?: string | null;
  defaultBranch?: string | null;
  currentBranch?: string | null;
}

export function shortRemote(url: string): string {
  // Strip only a trailing `.git` — a dotted repo name (foo.js, o.github.io) must survive.
  const m = url.match(/github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : url.replace(/^https?:\/\//, "").replace(/\.git$/, "").slice(0, 40);
}

export function WorkspaceView() {
  const { data: state } = useConsoleState();
  const refresh = useRefreshConsoleState();
  const setSection = useUiStore((s) => s.setSection);
  const previewPath = useUiStore((s) => s.officecliPreviewPath);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Selecting an Office file in the tree opens the preview panel (#1347).
  useEffect(() => {
    if (previewPath) setPreviewOpen(true);
  }, [previewPath]);
  const projects = (state?.projects ?? []) as Array<{ id: string; name: string; git?: GitFacts }>;
  const currentId = state?.currentProjectId ?? null;
  const current = projects.find((p) => p.id === currentId) ?? null;
  const git = current?.git;

  // Empty-browser state (#158): guide the add-project step instead of showing an
  // inert shell. Gate on state being LOADED so it doesn't flash on the first poll.
  if (state && projects.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <PanelsTopLeft className="size-8 text-muted-foreground" />
        <div>
          <p className="font-medium">No projects yet</p>
          <p className="text-sm text-muted-foreground">Register a local project to browse its files and run tasks against it.</p>
        </div>
        <Button variant="primary" onClick={() => setSection("projects")}>
          <FolderPlus className="mr-1.5 size-4" /> Register a project
        </Button>
      </div>
    );
  }

  const onSwitch = async (id: string) => {
    if (!id || id === currentId) return;
    await api.selectProject(id);
    await refresh();
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <header className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
        <PanelsTopLeft className="size-4 shrink-0 text-muted-foreground" />
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Project</span>
          <select
            value={currentId ?? ""}
            onChange={(e) => void onSwitch(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            {projects.length === 0 ? <option value="">No projects registered</option> : <option value="" disabled>Select a project…</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        {!current ? (
          <span className="text-xs text-muted-foreground">Register or select a project to start.</span>
        ) : (git?.isRepo === false || git?.currentBranch || git?.defaultBranch || git?.remoteUrl) ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FolderGit2 className="size-3.5" />
            {git?.isRepo === false
              ? "not a git repository"
              : <>{git?.currentBranch ?? git?.defaultBranch ?? ""}{git?.remoteUrl ? <> · {shortRemote(git.remoteUrl)}</> : null}</>}
          </span>
        ) : null}
      </header>

      {current ? (
        <details
          className="shrink-0 rounded-lg border border-border bg-card"
          open={previewOpen}
          onToggle={(e) => setPreviewOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-foreground/90">
            Office preview <span className="text-xs font-normal text-muted-foreground">— click a .docx / .xlsx / .pptx in the file tree, or enter a path</span>
          </summary>
          <div className="border-t border-border p-3">
            <OfficecliPreview projectId={current.id} />
          </div>
        </details>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(200px,260px)_minmax(0,1fr)_minmax(220px,300px)]">
        <aside className="hidden min-h-0 overflow-y-auto rounded-lg border border-border bg-card p-2 lg:block" aria-label="Project files">
          <ProjectTree />
        </aside>
        <main className="min-h-0 overflow-hidden" aria-label="Agent transcript">
          <DashboardView surface="workspace" />
        </main>
        <aside className="hidden min-h-0 overflow-y-auto rounded-lg border border-border bg-card p-2 lg:block" aria-label="Session history">
          <SessionHistory />
        </aside>
      </div>
    </div>
  );
}
