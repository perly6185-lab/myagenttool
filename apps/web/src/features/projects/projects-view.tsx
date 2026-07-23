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
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type {
  BudgetStatus,
  ProjectSnapshot,
  ProjectTargetSnapshot,
  WorktreeSnapshot,
} from "@/lib/console-state";

export function ProjectsView() {
  const { t } = useAppTranslation();
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
          <CardTitle>{t("projects.title")}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("projects.description")}
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {projects.length === 0 ? (
            <EmptyState title={t("projects.empty")} hint={t("projects.emptyHint")} />
          ) : (
            projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                target={targets.find((t) => t.projectId === project.id)}
                worktrees={worktrees.filter((w) => w.projectId === project.id)}
                budget={budgetByProject.get(project.id)}
                active={project.id === activeId}
                current={project.id === state?.currentProjectId}
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
          <CardTitle>{t("projects.register")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("projects.registerHint")}</p>
        </CardHeader>
        <CardContent>
          <ProjectRegisterForm />
        </CardContent>
      </Card>
    </div>
  );
}

// Where a project pushes, in one line. A `file://` remote IS a local repo — that
// is the URL scheme, not a guess about who created it — so nothing on the server
// has to carry a flag for this.
export function originOf(project: ProjectSnapshot): "none" | "local" | "remote" | "not-a-repo" {
  if (!project.git?.isRepo) return "not-a-repo";
  const url = project.git.remoteUrl;
  if (!url) return "none";
  return url.startsWith("file://") ? "local" : "remote";
}

// Where this project pushes, and — when the answer is "nowhere" — the one click
// that fixes it without an account.
function OriginRow({ project }: { project: ProjectSnapshot }) {
  const { t } = useAppTranslation();
  const { execute, pending, error } = useAsyncAction();
  const kind = originOf(project);
  if (kind === "not-a-repo") return null;

  return (
    <div className="mt-1.5 flex items-center gap-2 text-xs">
      {kind === "local" ? (
        <span className="text-muted-foreground">{t("projects.localRepo")}</span>
      ) : kind === "remote" ? (
        <span className="min-w-0 truncate text-muted-foreground" title={project.git?.remoteUrl ?? ""}>
          {t("projects.remote")} · {project.git?.remoteUrl}
        </span>
      ) : (
        <>
          {/* Said here rather than at publish time, where it currently surfaces as
              "No 'origin' remote to publish to. Add a remote first." — too late,
              and it reads as "go get a GitHub account". */}
          <span className="text-amber-600 dark:text-amber-500">{t("projects.noOrigin")}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => void execute(() => api.createLocalOrigin(project.id))}
            title={t("projects.createLocalTitle")}
          >
            {t(pending ? "projects.creating" : "projects.createLocal")}
          </Button>
          {error ? (
            <span className="min-w-0 truncate text-destructive" title={error}>
              {error}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

function ProjectRow({
  project,
  target,
  worktrees,
  budget,
  active,
  current,
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
  current: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onToggleIsolation: () => void;
  onRemoveWorktree: (id: string) => void;
  selectedWorktreeId: string | null;
  busy: boolean;
}) {
  const { t, i18n } = useAppTranslation();
  const isolated = project.isolation === "worktree";
  return (
    <div className={cn("rounded-lg border px-3 py-2.5", active ? "border-primary bg-primary/5" : "border-border")}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <button type="button" onClick={onSelect} className="flex min-w-0 items-center gap-2.5 text-left">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium">{project.name}</span>
              {current ? <Badge tone="success">{t("projects.current")}</Badge> : null}
              {active ? <Badge tone="neutral">{t("projects.active")}</Badge> : null}
              {project.status === "archived" ? <Badge tone="warning">{t("projects.archived")}</Badge> : null}
            </span>
            <span className="block text-xs text-muted-foreground">
              {budget?.exists
                ? t("projects.budget", { spent: formatProjectUsd(budget.spentUsd, i18n.language), limit: formatProjectUsd(budget.limitUsd ?? 0, i18n.language), over: budget.over ? t("projects.over") : "" })
                : t("projects.noBudget")}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {target ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={onToggleIsolation}
              title={t("projects.isolationTitle")}
            >
              {t(isolated ? "projects.isolationRun" : "projects.isolationShared")}
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" disabled={busy} onClick={onArchive}>
            {t(project.status === "archived" ? "projects.restore" : "projects.archive")}
          </Button>
        </div>
      </div>

      {/* Its own row: the name is the thing that must stay readable, and three
          buttons beside it truncated it to "s…" at 1440px (caught in visual QA). */}
      <OriginRow project={project} />

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
  const { t } = useAppTranslation();
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
        <Badge tone={tone}>{t(`projects.targetState.${target.state}` as "projects.targetState.ready")}</Badge>
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
        <WorktreeNode key={w.id} worktree={w} label={t("projects.mainWorktree")} selected={w.id === selectedWorktreeId} />
      ))}

      {named.map((w) => (
        <WorktreeNode
          key={w.id}
          worktree={w}
          label={t("projects.worktree")}
          selected={w.id === selectedWorktreeId}
          onRemove={() => onRemoveWorktree(w.id)}
          busy={busy}
        />
      ))}

      {target.state === "ready" ? <WorktreeCreator projectId={projectId} /> : null}

      {isolated ? (
        <p className="mt-1.5 pl-3 text-xs text-muted-foreground">
          {ephemeral.length > 0
            ? t("projects.isolatedRuns", { count: ephemeral.length })
            : t("projects.isolationOn")}
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
  const { t } = useAppTranslation();
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
            title={t("projects.removeWorktreeTitle")}
          >
            {t("projects.remove")}
          </button>
        ) : null}
      </div>
      {selected ? (
        <p className="select-all break-all pb-1.5 pl-5 font-mono text-[11px] text-muted-foreground">{worktree.path}</p>
      ) : null}
    </div>
  );
}

function formatProjectUsd(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: value < 1 ? 4 : 2, maximumFractionDigits: value < 1 ? 4 : 2 }).format(value);
}
