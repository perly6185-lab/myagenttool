import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { ProjectRegisterForm } from "@/features/projects/project-register-form";
import { WorktreeCreator } from "@/features/projects/worktree-creator";
import { WorktreeLinkPopover } from "@/features/projects/worktree-link-popover";
import { WorktreeView } from "@/features/projects/worktree-view";
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

export function ProjectsView() {
  const { data: state } = useConsoleState();
  const { execute, pending } = useAsyncAction();
  const projects = state?.projects ?? [];
  const targets = state?.projectTargets ?? [];
  const worktrees = state?.worktrees ?? [];
  const budgetByProject = new Map((state?.budgetStatuses ?? []).map((b) => [b.projectId, b]));

  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  const selectedWorktreeId = useUiStore((s) => s.selectedWorktreeId);
  const setSelectedWorktreeId = useUiStore((s) => s.setSelectedWorktreeId);
  const activeId = selectedProjectId ?? projects[0]?.id ?? null;

  // A selected worktree opens its focused session view in place of the list.
  const openWorktree = worktrees.find((w) => w.id === selectedWorktreeId);
  if (openWorktree) return <WorktreeView worktree={openWorktree} />;

  function archive(project: ProjectSnapshot) {
    const next = project.status === "archived" ? "active" : "archived";
    void execute(() => api.updateProject(project.id, { status: next }));
  }

  function toggleIsolation(project: ProjectSnapshot) {
    const next = project.isolation === "worktree" ? "shared" : "worktree";
    void execute(() => api.updateProject(project.id, { isolation: next }));
  }

  function removeWorktree(id: string) {
    if (id === selectedWorktreeId) setSelectedWorktreeId(null);
    void execute(() => api.removeWorktree(id));
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
                onToggleIsolation={() => toggleIsolation(project)}
                onRemoveWorktree={removeWorktree}
                selectedWorktreeId={selectedWorktreeId}
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
        <CardContent>
          <ProjectRegisterForm />
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
  onToggleIsolation,
  onRemoveWorktree,
  selectedWorktreeId,
  busy,
}: {
  project: ProjectSnapshot;
  target?: ProjectTargetSnapshot;
  worktrees: WorktreeSnapshot[];
  budget?: BudgetStatus;
  active: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onToggleIsolation: () => void;
  onRemoveWorktree: (id: string) => void;
  selectedWorktreeId: string | null;
  busy: boolean;
}) {
  const isolated = project.isolation === "worktree";
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
        <div className="flex items-center gap-2">
          {target ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={onToggleIsolation}
              title="Toggle per-invocation git worktree isolation"
            >
              {isolated ? "Isolation: per-run" : "Isolation: shared"}
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" disabled={busy} onClick={onArchive}>
            {project.status === "archived" ? "Restore" : "Archive"}
          </Button>
        </div>
      </div>

      {target ? (
        <TargetBlock
          target={target}
          projectId={project.id}
          worktrees={worktrees}
          isolated={isolated}
          onRemoveWorktree={onRemoveWorktree}
          selectedWorktreeId={selectedWorktreeId}
          busy={busy}
        />
      ) : null}
    </div>
  );
}

function TargetBlock({
  target,
  projectId,
  worktrees,
  isolated,
  onRemoveWorktree,
  selectedWorktreeId,
  busy,
}: {
  target: ProjectTargetSnapshot;
  projectId: string;
  worktrees: WorktreeSnapshot[];
  isolated: boolean;
  onRemoveWorktree: (id: string) => void;
  selectedWorktreeId: string | null;
  busy: boolean;
}) {
  const tone = target.state === "ready" ? "success" : target.state === "failed" ? "danger" : "neutral";
  const mainWorktrees = worktrees.filter((w) => w.isMain);
  const named = worktrees.filter((w) => !w.isMain && !w.ephemeral);
  const ephemeral = worktrees.filter((w) => w.ephemeral);
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

      {mainWorktrees.map((w) => (
        <WorktreeNode key={w.id} worktree={w} label="Main worktree" selected={w.id === selectedWorktreeId} />
      ))}

      {named.map((w) => (
        <WorktreeNode
          key={w.id}
          worktree={w}
          label="worktree"
          selected={w.id === selectedWorktreeId}
          onRemove={() => onRemoveWorktree(w.id)}
          busy={busy}
        />
      ))}

      {target.state === "ready" ? <WorktreeCreator projectId={projectId} /> : null}

      {isolated ? (
        <p className="mt-1.5 pl-3 text-xs text-muted-foreground">
          {ephemeral.length > 0
            ? `${ephemeral.length} isolated run(s) active — each on its own agent/<id> worktree`
            : "Per-run isolation on — each invocation gets a fresh git worktree"}
        </p>
      ) : null}
    </div>
  );
}

// One worktree row. Selecting it from the nav tree highlights the row and
// reveals its on-disk path ("inspect that location").
function WorktreeNode({
  worktree,
  label,
  selected,
  onRemove,
  busy,
}: {
  worktree: WorktreeSnapshot;
  label: string;
  selected: boolean;
  onRemove?: () => void;
  busy?: boolean;
}) {
  return (
    <div
      className={cn(
        "mt-1.5 rounded-md pl-3 text-xs",
        selected ? "bg-primary/10 ring-1 ring-primary/40" : "",
      )}
    >
      <div className="flex items-center justify-between gap-2 py-1 pr-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-muted-foreground">⌐</span>
          <span className="truncate font-medium" title={worktree.path}>
            {worktree.branch}
          </span>
          <Badge tone="neutral">{label}</Badge>
          {worktree.link ? <WorktreeLinkPopover worktree={worktree} /> : null}
        </span>
        {onRemove ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-50"
            title="Remove worktree (keeps the branch)"
          >
            Remove
          </button>
        ) : null}
      </div>
      {selected ? (
        <p className="select-all break-all pb-1.5 pl-5 font-mono text-[11px] text-muted-foreground">{worktree.path}</p>
      ) : null}
    </div>
  );
}
