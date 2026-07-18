import { SECTIONS } from "@/app/sections";
import { LoginControl } from "@/components/layout/login-control";
import { StatusBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { readableDeviceStatus } from "@/lib/readable-labels";
import { useUiStore } from "@/store/ui-store";

/** The server-persisted current project — survives refresh via /api/state. */
function ProjectSwitcher() {
  const { data: state } = useConsoleState();
  const { execute, pending } = useAsyncAction();
  const projects = state?.projects ?? [];
  const currentProjectId = state?.currentProjectId ?? "";

  if (!projects.length) return null;

  return (
    <label className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
      <span>Project</span>
      <Select
        aria-label="Current project"
        title={projects.find((p) => p.id === currentProjectId)?.name ?? undefined}
        className="h-8 w-44"
        value={currentProjectId}
        disabled={pending}
        onChange={(e) => void execute(() => api.selectProject(e.target.value))}
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

function MobileSectionSwitcher() {
  const section = useUiStore((s) => s.section);
  const setSection = useUiStore((s) => s.setSection);
  return (
    <Select
      aria-label="Section"
      className="h-8 w-32 md:hidden"
      value={section}
      onChange={(event) => setSection(event.target.value as typeof section)}
    >
      {SECTIONS.map((item) => (
        <option key={item.key} value={item.key}>{item.label}</option>
      ))}
    </Select>
  );
}

export function Topbar() {
  const section = useUiStore((s) => s.section);
  const { data: state, isError, isLoading } = useConsoleState();
  const current = SECTIONS.find((item) => item.key === section);

  const connection = isError
    ? { tone: "danger" as const, label: "Server offline" }
    : isLoading
      ? { tone: "running" as const, label: "Connecting" }
      : { tone: "success" as const, label: "Connected" };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/80 px-3 backdrop-blur sm:gap-4 sm:px-6">
      <div className="hidden min-w-0 sm:block">
        <h1 className="truncate text-sm font-semibold">{current?.label ?? "Overview"}</h1>
        <p className="truncate text-xs text-muted-foreground">{current?.blurb}</p>
      </div>
      <div className="flex items-center gap-3">
        <MobileSectionSwitcher />
        <ProjectSwitcher />
        {state?.device ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {state.device.name} · {readableDeviceStatus(state.device.status)}
          </span>
        ) : null}
        <StatusBadge tone={connection.tone}>{connection.label}</StatusBadge>
        <LoginControl />
      </div>
    </header>
  );
}
