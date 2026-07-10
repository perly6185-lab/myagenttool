import { SECTIONS } from "@/app/sections";
import { LoginControl } from "@/components/layout/login-control";
import { StatusBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { codexOpsSummary } from "@/features/tools/codex-ops";
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

export function Topbar() {
  const section = useUiStore((s) => s.section);
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedToolName = useUiStore((s) => s.setSelectedToolName);
  const setSelectedToolFocus = useUiStore((s) => s.setSelectedToolFocus);
  const { data: state, isError, isLoading } = useConsoleState();
  const current = SECTIONS.find((item) => item.key === section);
  const codexOps = codexOpsSummary(state);

  const connection = isError
    ? { tone: "danger" as const, label: "Server offline" }
    : isLoading
      ? { tone: "running" as const, label: "Connecting" }
      : { tone: "success" as const, label: "Connected" };

  function openCodexOps() {
    setSelectedToolName("codex");
    setSelectedToolFocus("ops");
    setSection("tools");
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/80 px-4 backdrop-blur sm:gap-4 sm:px-6">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold">{current?.label ?? "Overview"}</h1>
        <p className="truncate text-xs text-muted-foreground">{current?.blurb}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <Select
          aria-label="Current section"
          className="h-8 w-36 lg:hidden"
          value={section}
          onChange={(event) => setSection(event.target.value as typeof section)}
        >
          {SECTIONS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </Select>
        {codexOps.pendingCount > 0 ? (
          <button
            type="button"
            className="hidden rounded-full border border-warning/40 bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/20 md:inline-flex"
            onClick={openCodexOps}
          >
            Codex Ops {codexOps.pendingCount}
          </button>
        ) : null}
        <ProjectSwitcher />
        {state?.device ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {state.device.name} · {readableDeviceStatus(state.device.status)}
          </span>
        ) : null}
        <span className="hidden sm:inline-flex">
          <StatusBadge tone={connection.tone}>{connection.label}</StatusBadge>
        </span>
        <div className="hidden sm:block">
          <LoginControl />
        </div>
      </div>
    </header>
  );
}
