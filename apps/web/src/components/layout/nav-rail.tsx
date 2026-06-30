import { useState } from "react";
import { ChevronRight, GitBranch, Hexagon, Plus, Settings } from "lucide-react";
import { SECTIONS } from "@/app/sections";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/store/ui-store";
import { useConsoleState } from "@/data/use-console-state";
import { Modal } from "@/components/ui/modal";
import { ProjectRegisterForm } from "@/features/projects/project-register-form";
import { ProjectSettingsForm } from "@/features/projects/project-settings-form";
import { WorktreeCreator } from "@/features/projects/worktree-creator";
import { WorktreeLinkPopover } from "@/features/projects/worktree-link-popover";
import type { ProjectSnapshot } from "@/lib/console-state";

export function NavRail() {
  const section = useUiStore((s) => s.section);
  const setSection = useUiStore((s) => s.setSection);
  const [showRegister, setShowRegister] = useState(false);

  return (
    <nav
      aria-label="Control plane sections"
      className="flex h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
    >
      <div className="flex items-center gap-2.5 px-5 py-4">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Hexagon className="size-4" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold">MyAgentTool</p>
          <p className="text-xs text-muted-foreground">Control plane</p>
        </div>
      </div>

      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
        {SECTIONS.map((item) => {
          const Icon = item.icon;
          const active = item.key === section;
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
                  onClick={() => setSection(item.key)}
                  className="flex flex-1 items-center gap-3 px-3 py-2 text-left"
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </button>
                {isProjects ? (
                  <button
                    type="button"
                    aria-label="Register a project"
                    title="Register a project"
                    onClick={() => setShowRegister(true)}
                    className="mr-1 grid size-6 shrink-0 place-items-center rounded hover:bg-sidebar-accent"
                  >
                    <Plus className="size-4" />
                  </button>
                ) : null}
              </div>
              {isProjects ? <ProjectTree /> : null}
            </li>
          );
        })}
      </ul>

      <p className="px-5 py-4 text-xs text-muted-foreground">
        Register agents, route calls, enforce permission, and record what happened.
      </p>

      <Modal
        open={showRegister}
        onClose={() => setShowRegister(false)}
        title="Register a project"
        description="Clone a repo, link a local checkout, or create an empty project."
      >
        <ProjectRegisterForm onDone={() => setShowRegister(false)} />
      </Modal>
    </nav>
  );
}

// Orca-style tree under the Projects nav item: each project expands to its
// worktrees. Clicking a node selects it and routes to the Projects section.
function ProjectTree() {
  const { data: state } = useConsoleState();
  const setSection = useUiStore((s) => s.setSection);
  const selectedProjectId = useUiStore((s) => s.selectedProjectId);
  const selectedWorktreeId = useUiStore((s) => s.selectedWorktreeId);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  const setSelectedWorktreeId = useUiStore((s) => s.setSelectedWorktreeId);

  const projects = (state?.projects ?? []).filter((p) => p.status !== "archived");
  const worktrees = state?.worktrees ?? [];
  const readyProjectIds = new Set((state?.projectTargets ?? []).filter((t) => t.state === "ready").map((t) => t.projectId));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [settingsFor, setSettingsFor] = useState<ProjectSnapshot | null>(null);
  const [createWtFor, setCreateWtFor] = useState<ProjectSnapshot | null>(null);

  if (projects.length === 0) return null;

  function openProject(id: string) {
    setSelectedProjectId(id);
    setSelectedWorktreeId(null);
    setSection("projects");
  }
  function openWorktree(projectId: string, worktreeId: string) {
    setSelectedProjectId(projectId);
    setSelectedWorktreeId(worktreeId);
    setSection("projects");
  }

  return (
    <>
    <ul className="mb-1 ml-3 mt-0.5 space-y-0.5 border-l border-sidebar-border/70 pl-2">
      {projects.map((project) => {
        const projWorktrees = worktrees.filter((w) => w.projectId === project.id && !w.ephemeral);
        const isOpen = expanded[project.id] ?? true;
        const projActive = project.id === selectedProjectId && !selectedWorktreeId;
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
                aria-label={isOpen ? "Collapse" : "Expand"}
                onClick={() => setExpanded((e) => ({ ...e, [project.id]: !isOpen }))}
                className="grid size-5 shrink-0 place-items-center rounded hover:bg-sidebar-accent/60"
                disabled={projWorktrees.length === 0}
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 transition-transform",
                    projWorktrees.length === 0 ? "opacity-30" : isOpen ? "rotate-90" : "",
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
                aria-label={`Settings for ${project.name}`}
                title="Project settings"
                onClick={() => setSettingsFor(project)}
                className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-60 hover:bg-sidebar-accent hover:text-sidebar-foreground hover:opacity-100"
              >
                <Settings className="size-3.5" />
              </button>
              {readyProjectIds.has(project.id) ? (
                <button
                  type="button"
                  aria-label={`Create worktree in ${project.name}`}
                  title="Create worktree"
                  onClick={() => setCreateWtFor(project)}
                  className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-60 hover:bg-sidebar-accent hover:text-sidebar-foreground hover:opacity-100"
                >
                  <Plus className="size-3.5" />
                </button>
              ) : null}
            </div>

            {isOpen && projWorktrees.length > 0 ? (
              <ul className="ml-3 space-y-0.5 border-l border-sidebar-border/60 pl-2">
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
                          <span className="truncate">{w.branch}</span>
                          {w.isMain ? <span className="shrink-0 text-[10px] opacity-60">main</span> : null}
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
        title={settingsFor ? `${settingsFor.name} settings` : "Project settings"}
        description="Rename, recolor, set run isolation, or archive this project."
      >
        {settingsFor ? <ProjectSettingsForm project={settingsFor} onDone={() => setSettingsFor(null)} /> : null}
      </Modal>

      <Modal
        open={Boolean(createWtFor)}
        onClose={() => setCreateWtFor(null)}
        title="Create worktree"
        size="lg"
      >
        {createWtFor ? (
          <WorktreeCreator projectId={createWtFor.id} showProjectPicker onDone={() => setCreateWtFor(null)} />
        ) : null}
      </Modal>
    </>
  );
}
