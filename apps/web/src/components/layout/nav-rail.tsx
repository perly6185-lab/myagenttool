import { useState } from "react";
import { ChevronRight, GitBranch, Hexagon } from "lucide-react";
import { SECTIONS } from "@/app/sections";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/store/ui-store";
import { useConsoleState } from "@/data/use-console-state";

export function NavRail() {
  const section = useUiStore((s) => s.section);
  const setSection = useUiStore((s) => s.setSection);

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
          return (
            <li key={item.key}>
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setSection(item.key)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
              </button>
              {item.key === "projects" ? <ProjectTree /> : null}
            </li>
          );
        })}
      </ul>

      <p className="px-5 py-4 text-xs text-muted-foreground">
        Register agents, route calls, enforce permission, and record what happened.
      </p>
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
                className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left hover:text-sidebar-foreground"
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
                <span className="truncate">{project.name}</span>
              </button>
            </div>

            {isOpen && projWorktrees.length > 0 ? (
              <ul className="ml-3 space-y-0.5 border-l border-sidebar-border/60 pl-2">
                {projWorktrees.map((w) => {
                  const wtActive = w.id === selectedWorktreeId;
                  return (
                    <li key={w.id}>
                      <button
                        type="button"
                        title={w.path}
                        onClick={() => openWorktree(project.id, w.id)}
                        className={cn(
                          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors",
                          wtActive
                            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                        )}
                      >
                        <GitBranch className="size-3 shrink-0 opacity-70" />
                        <span className="truncate">{w.branch}</span>
                        {w.isMain ? <span className="shrink-0 text-[10px] opacity-60">main</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
