import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { formatUsd as usd } from "@/lib/money";
import type {
  BudgetStatus,
  ProjectSnapshot,
  ProjectTargetSnapshot,
  WorktreeSnapshot,
} from "@/lib/console-state";

const SWATCHES = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#a855f7"];
type Mode = "clone" | "local" | "empty";

export function ProjectsView() {
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const projects = state?.projects ?? [];
  const targets = state?.projectTargets ?? [];
  const worktrees = state?.worktrees ?? [];
  const budgetByProject = new Map((state?.budgetStatuses ?? []).map((b) => [b.projectId, b]));

  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  const activeId = selectedProjectId ?? projects[0]?.id ?? null;

  const [mode, setMode] = useState<Mode>("clone");
  const [color, setColor] = useState(SWATCHES[0]);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [repoPath, setRepoPath] = useState("");

  function afterCreate(created: { project?: { id: string } }) {
    if (created.project?.id) setSelectedProjectId(created.project.id);
    setName("");
    setRepoUrl("");
    setRepoPath("");
  }

  function submit() {
    if (mode === "clone") {
      if (!repoUrl.trim() || !parentDir.trim()) return;
      void execute(async () => {
        const r = (await api.cloneProject({
          repoUrl: repoUrl.trim(),
          parentDir: parentDir.trim(),
          name: name.trim() || undefined,
          color,
        })) as { project?: { id: string } };
        afterCreate(r);
        return r;
      });
    } else if (mode === "local") {
      if (!repoPath.trim()) return;
      void execute(async () => {
        const r = (await api.bindProject({
          repoPath: repoPath.trim(),
          name: name.trim() || undefined,
          color,
        })) as { project?: { id: string } };
        afterCreate(r);
        return r;
      });
    } else {
      if (!name.trim()) return;
      void execute(async () => {
        const r = (await api.createProject({ name: name.trim(), color })) as { project?: { id: string } };
        afterCreate(r);
        return r;
      });
    }
  }

  function archive(project: ProjectSnapshot) {
    const next = project.status === "archived" ? "active" : "archived";
    void execute(() => api.updateProject(project.id, { status: next }));
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <p className="text-sm text-muted-foreground">
            A project groups invocations and owns a budget. Repo-backed projects show their main worktree.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {projects.length === 0 ? (
            <EmptyState title="No projects" hint="Register your first project on the right." />
          ) : (
            projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                target={targets.find((t) => t.projectId === project.id)}
                worktrees={worktrees.filter((w) => w.projectId === project.id)}
                budget={budgetByProject.get(project.id)}
                active={project.id === activeId}
                onSelect={() => setSelectedProjectId(project.id)}
                onArchive={() => archive(project)}
                busy={pending}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Register a project</CardTitle>
          <p className="text-sm text-muted-foreground">Clone a repo, link a local checkout, or create an empty project.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(
              [
                ["clone", "Clone URL"],
                ["local", "Local path"],
                ["empty", "Empty"],
              ] as [Mode, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition",
                  mode === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "clone" ? (
            <>
              <Field label="Git URL">
                <Input
                  value={repoUrl}
                  placeholder="https://github.com/owner/repo.git"
                  onChange={(e) => setRepoUrl(e.target.value)}
                />
              </Field>
              <Field label="Parent folder">
                <Input value={parentDir} placeholder="/Users/you/projects" onChange={(e) => setParentDir(e.target.value)} />
              </Field>
            </>
          ) : null}

          {mode === "local" ? (
            <Field label="Repository path">
              <Input value={repoPath} placeholder="/Users/you/projects/repo" onChange={(e) => setRepoPath(e.target.value)} />
            </Field>
          ) : null}

          <Field label={mode === "empty" ? "Name" : "Name (optional — derived from repo)"}>
            <Input
              value={name}
              placeholder="e.g. Migrations"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </Field>

          <Field label="Color">
            <div className="flex flex-wrap gap-2">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className="h-7 w-7 rounded-full border-2 transition"
                  style={{ backgroundColor: c, borderColor: color === c ? "var(--foreground)" : "transparent" }}
                />
              ))}
            </div>
          </Field>

          <Button onClick={submit} disabled={pending}>
            {mode === "clone" ? "Clone…" : mode === "local" ? "Link repository" : "Create project"}
          </Button>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ProjectRow({
  project,
  target,
  worktrees,
  budget,
  active,
  onSelect,
  onArchive,
  busy,
}: {
  project: ProjectSnapshot;
  target?: ProjectTargetSnapshot;
  worktrees: WorktreeSnapshot[];
  budget?: BudgetStatus;
  active: boolean;
  onSelect: () => void;
  onArchive: () => void;
  busy: boolean;
}) {
  return (
    <div className={cn("rounded-lg border px-3 py-2.5", active ? "border-primary bg-primary/5" : "border-border")}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <button type="button" onClick={onSelect} className="flex min-w-0 items-center gap-2.5 text-left">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium">{project.name}</span>
              {active ? <Badge tone="neutral">Active</Badge> : null}
              {project.status === "archived" ? <Badge tone="warning">Archived</Badge> : null}
            </span>
            <span className="block text-xs text-muted-foreground">
              {budget?.exists
                ? `Budget ${usd(budget.spentUsd)} / ${usd(budget.limitUsd ?? 0)}${budget.over ? " · over" : ""}`
                : "No budget set"}
            </span>
          </span>
        </button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={onArchive}>
          {project.status === "archived" ? "Restore" : "Archive"}
        </Button>
      </div>

      {target ? <TargetBlock target={target} worktrees={worktrees} /> : null}
    </div>
  );
}

function TargetBlock({ target, worktrees }: { target: ProjectTargetSnapshot; worktrees: WorktreeSnapshot[] }) {
  const tone = target.state === "ready" ? "success" : target.state === "failed" ? "danger" : "neutral";
  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-mono text-muted-foreground" title={target.rootPath}>
          {target.kind === "clone" ? "⬇ " : "📁 "}
          {target.rootPath}
        </span>
        <Badge tone={tone}>{target.state}</Badge>
      </div>

      {target.state === "cloning" ? (
        <div className="mt-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${target.progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{target.message}</p>
        </div>
      ) : null}

      {target.state === "failed" ? <p className="mt-1 text-xs text-destructive">{target.message}</p> : null}

      {worktrees.map((w) => (
        <div key={w.id} className="mt-1.5 flex items-center gap-2 pl-3 text-xs">
          <span className="text-muted-foreground">⌐</span>
          <span className="font-medium">{w.branch}</span>
          {w.isMain ? <Badge tone="neutral">Main worktree</Badge> : null}
        </div>
      ))}
    </div>
  );
}
