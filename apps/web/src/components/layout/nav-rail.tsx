import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ChevronRight, GitBranch, Hexagon, Plus, Settings } from "lucide-react";
import {
  ENTRY_SECTIONS,
  SURFACE_GROUPS,
  pageNavigationLabelKey,
  pageRegistration,
} from "@/app/sections";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/store/ui-store";
import { useConsoleState } from "@/data/use-console-state";
import { api } from "@/data/use-console-actions";
import { Modal } from "@/components/ui/modal";
import { ProjectRegisterForm } from "@/features/projects/project-register-form";
import { ProjectSettingsForm } from "@/features/projects/project-settings-form";
import { WorktreeCreator } from "@/features/projects/worktree-creator";
import { WorktreeLinkPopover } from "@/features/projects/worktree-link-popover";
import type { ProjectSnapshot } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useCurrentProjectSelection } from "@/hooks/use-current-project-selection";

export function NavRail() {
  const { t } = useAppTranslation();
  const section = useUiStore((s) => s.section);
  const settingsDialogOpen = useUiStore((s) => s.settingsDialogOpen)
    || section === "me"
    || section === "settings"
    || pageRegistration(section).surface !== "entry";
  const navigate = usePageNavigation();
  const { data: state } = useConsoleState();
  const pendingCount = state?.pendingDecisions?.length ?? 0;
  const attentionCount = state?.evidenceLedger?.filter((r) => r.attention).length ?? 0;
  const [showRegister, setShowRegister] = useState(false);

  return (
    <nav
      aria-label={t("shell.navLabel")}
      className="hidden h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex"
    >
      <div className="flex items-center gap-2.5 px-5 py-4">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Hexagon className="size-4" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold">MyAgentTool</p>
          <p className="text-xs text-muted-foreground">{t("shell.controlPlane")}</p>
        </div>
      </div>

      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
        {SURFACE_GROUPS.filter((grp) => grp.key === "entry").map((grp) => {
          return (
          <li key={grp.key}>
            <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">{t(grp.labelKey)}</p>
            <ul className="flex flex-col gap-0.5">
              {ENTRY_SECTIONS.map((item) => {
          const Icon = item.icon;
          const active = item.key === "me" ? settingsDialogOpen : item.key === section && !settingsDialogOpen;
          const isProjects = item.key === "projects";
          return (
            <li key={item.key}>
              <div
                className={cn(
                  "flex items-center rounded-md text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  title={t(item.blurbKey)}
                  onClick={() => navigate(item.key)}
                  className="flex flex-1 items-center gap-3 px-3 py-2 text-left"
                >
                  <Icon className="size-4 shrink-0" />
                  {t(pageNavigationLabelKey(item))}
                  {item.key === "approvals" && pendingCount > 0 ? (
                    <span
                      aria-label={t("shell.pending", { count: pendingCount })}
                      className={cn(
                        "ml-auto min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold",
                        active ? "bg-sidebar-foreground/15 text-sidebar-accent-foreground" : "bg-primary text-primary-foreground",
                      )}
                    >
                      {pendingCount}
                    </span>
                  ) : null}
                  {item.key === "evidence" && attentionCount > 0 ? (
                    <span
                      aria-label={t("shell.attention", { count: attentionCount })}
                      className={cn(
                        "ml-auto min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold",
                        active ? "bg-sidebar-foreground/15 text-sidebar-accent-foreground" : "bg-warning text-warning-foreground",
                      )}
                    >
                      {attentionCount}
                    </span>
                  ) : null}
                </button>
                {isProjects ? (
                  <button
                    type="button"
                    aria-label={t("shell.registerProject")}
                    title={t("shell.registerProject")}
                    onClick={() => setShowRegister(true)}
                    className="mr-1 grid size-6 shrink-0 place-items-center rounded hover:bg-sidebar-accent"
                  >
                    <Plus className="size-4" />
                  </button>
                ) : null}
              </div>
              {isProjects && section !== "workflowMemory" ? <ProjectTree /> : null}
            </li>
          );
              })}
            </ul>
          </li>
          );
        })}
      </ul>

      <p className="px-5 py-4 text-xs text-muted-foreground">
        {t("shell.footer")}
      </p>

      <Modal
        open={showRegister}
        onClose={() => setShowRegister(false)}
        title={t("navProject.register")}
        description={t("navProject.registerHint")}
      >
        <ProjectRegisterForm onDone={() => setShowRegister(false)} />
      </Modal>
    </nav>
  );
}

// Orca-style tree under the Projects nav item: each project expands to its
// worktrees. Clicking a node selects it and routes to the Projects section.
function ProjectTree() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const projectSelection = useCurrentProjectSelection();
  const navigate = usePageNavigation();
  const selectedWorktreeId = useUiStore((s) => s.selectedWorktreeId);
  const setSelectedWorktreeId = useUiStore((s) => s.setSelectedWorktreeId);

  const projects = (state?.projects ?? []).filter((p) => p.status !== "archived");
  const worktrees = state?.worktrees ?? [];
  const readyProjectIds = new Set((state?.projectTargets ?? []).filter((t) => t.state === "ready").map((t) => t.projectId));

  // A repo-backed project is always sitting on a branch (its own checkout), even
  // before any explicit worktree exists. Fetch that branch so the tree can show
  // it as the project's baseline node — otherwise the row has nothing to expand.
  const repoProjects = projects.filter((p) => readyProjectIds.has(p.id));
  const summaries = useQueries({
    queries: repoProjects.map((p) => ({
      queryKey: ["git-summary", p.id],
      queryFn: () => api.gitSummary(p.id) as Promise<{ branch?: string }>,
      staleTime: 30_000,
    })),
  });
  const branchByProject = new Map(repoProjects.map((p, i) => [p.id, summaries[i]?.data?.branch ?? null]));

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [settingsFor, setSettingsFor] = useState<ProjectSnapshot | null>(null);
  const [createWtFor, setCreateWtFor] = useState<ProjectSnapshot | null>(null);

  if (projects.length === 0) return null;

  function openProject(id: string) {
    navigate("projects");
    void projectSelection.selectProject(id, state?.currentProjectId);
  }
  function openWorktree(projectId: string, worktreeId: string) {
    navigate("projects");
    void projectSelection.selectProject(projectId, state?.currentProjectId).then((succeeded) => {
      if (succeeded) setSelectedWorktreeId(worktreeId);
    });
  }

  return (
    <>
    <ul className="mb-1 ml-3 mt-0.5 space-y-0.5 border-l border-sidebar-border/70 pl-2">
      {projectSelection.error ? <li role="alert" className="px-1 py-1 text-xs text-destructive">{t("shell.projectSwitchFailed")}</li> : null}
      {projects.map((project) => {
        const projWorktrees = worktrees.filter((w) => w.projectId === project.id && !w.ephemeral);
        const isRepo = readyProjectIds.has(project.id);
        const mainBranch = branchByProject.get(project.id) ?? null;
        // Repo-backed projects always have a branch node to reveal; others need
        // an explicit worktree before the row is expandable.
        const hasChildren = isRepo || projWorktrees.length > 0;
        const isOpen = expanded[project.id] ?? false;
        const projActive = project.id === state?.currentProjectId && !selectedWorktreeId;
        return (
          <li key={project.id}>
            <div
              className={cn(
                "flex items-center gap-1 rounded-md pr-1 text-sm",
                projActive ? "bg-sidebar-accent/70 text-sidebar-accent-foreground" : "text-muted-foreground",
              )}
            >
              <button
                type="button"
                aria-label={isOpen ? t("navProject.collapse") : t("navProject.expand")}
                onClick={() => setExpanded((e) => ({ ...e, [project.id]: !isOpen }))}
                className="grid size-5 shrink-0 place-items-center rounded hover:bg-sidebar-accent/60"
                disabled={!hasChildren}
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 transition-transform",
                    !hasChildren ? "opacity-30" : isOpen ? "rotate-90" : "",
                  )}
                />
              </button>
              <button
                type="button"
                onClick={() => openProject(project.id)}
                className="group flex min-w-0 flex-1 items-center gap-2 py-1 text-left hover:text-sidebar-foreground"
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
                <span className="truncate">{project.name}</span>
              </button>
              <button
                type="button"
                aria-label={t("navProject.settingsFor", { name: project.name })}
                title={t("navProject.settings")}
                onClick={() => setSettingsFor(project)}
                className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-60 hover:bg-sidebar-accent hover:text-sidebar-foreground hover:opacity-100"
              >
                <Settings className="size-3.5" />
              </button>
              {readyProjectIds.has(project.id) ? (
                <button
                  type="button"
                  aria-label={t("navProject.createIn", { name: project.name })}
                  title={t("navProject.createWorktree")}
                  onClick={() => setCreateWtFor(project)}
                  className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-60 hover:bg-sidebar-accent hover:text-sidebar-foreground hover:opacity-100"
                >
                  <Plus className="size-3.5" />
                </button>
              ) : null}
            </div>

            {isOpen && hasChildren ? (
              <ul className="ml-3 space-y-0.5 border-l border-sidebar-border/60 pl-2">
                {isRepo ? (
                  <li>
                    <button
                      type="button"
                      title={t("navProject.checkoutHint")}
                      onClick={() => openProject(project.id)}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors",
                        projActive
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                      )}
                    >
                      <GitBranch className="size-3 shrink-0 opacity-70" />
                      <span className="truncate" title={mainBranch ?? t("navProject.branchUnknown")}>{mainBranch ?? "…"}</span>
                      <span className="ml-auto shrink-0 text-[10px] opacity-70">{t("navProject.checkout")}</span>
                    </button>
                  </li>
                ) : null}
                {projWorktrees.map((w) => {
                  const wtActive = w.id === selectedWorktreeId;
                  return (
                    <li key={w.id}>
                      <div
                        className={cn(
                          "flex items-center gap-1 rounded-md pr-1 text-xs transition-colors",
                          wtActive
                            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                        )}
                      >
                        <button
                          type="button"
                          title={w.path}
                          onClick={() => openWorktree(project.id, w.id)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left"
                        >
                          <GitBranch className="size-3 shrink-0 opacity-70" />
                          <span className="truncate" title={w.branch}>{w.branch}</span>
                          {w.isMain ? <span className="shrink-0 text-[10px] opacity-70">{t("navProject.main")}</span> : null}
                        </button>
                        {w.link ? <WorktreeLinkPopover worktree={w} /> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>

      <Modal
        open={Boolean(settingsFor)}
        onClose={() => setSettingsFor(null)}
        title={settingsFor ? t("navProject.namedSettings", { name: settingsFor.name }) : t("navProject.settings")}
        description={t("navProject.settingsHint")}
      >
        {settingsFor ? <ProjectSettingsForm project={settingsFor} onDone={() => setSettingsFor(null)} /> : null}
      </Modal>

      <Modal
        open={Boolean(createWtFor)}
        onClose={() => setCreateWtFor(null)}
        title={t("navProject.createWorktree")}
        size="lg"
      >
        {createWtFor ? (
          <WorktreeCreator projectId={createWtFor.id} showProjectPicker onDone={() => setCreateWtFor(null)} />
        ) : null}
      </Modal>
    </>
  );
}
