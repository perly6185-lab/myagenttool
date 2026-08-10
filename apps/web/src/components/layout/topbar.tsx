import { lazy, Suspense } from "react";
import { SECTIONS } from "@/app/sections";
import { LoginControl } from "@/components/layout/login-control";
import { useWindowControlsOverlay } from "@/lib/window-controls-overlay";
import { Select } from "@/components/ui/input";
import { useConsoleState } from "@/data/use-console-state";
import { useCurrentProjectSelection } from "@/hooks/use-current-project-selection";
import { useUiStore } from "@/store/ui-store";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

const NotificationCenter = lazy(() =>
  import("@/components/layout/notification-center").then((module) => ({ default: module.NotificationCenter })));

/** The server-persisted current project — survives refresh via /api/state. */
function ProjectSwitcher() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const { selectProject, pending, error } = useCurrentProjectSelection();
  const projects = state?.projects ?? [];
  const currentProjectId = state?.currentProjectId ?? "";

  if (!projects.length) return null;

  return (
    <div className="relative hidden md:block">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{t("shell.project")}</span>
        <Select
          aria-label={t("shell.currentProject")}
          title={projects.find((p) => p.id === currentProjectId)?.name ?? undefined}
          className="h-8 w-44"
          value={currentProjectId}
          disabled={pending}
          onChange={(event) => void selectProject(event.target.value, currentProjectId)}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      </label>
      {error ? (
        <p role="alert" className="absolute right-0 top-9 z-50 w-64 rounded-md border border-destructive/30 bg-popover px-3 py-2 text-xs text-destructive shadow-md">
          {t("shell.projectSwitchFailed")}: {error}
        </p>
      ) : null}
    </div>
  );
}

export function Topbar() {
  const { t } = useAppTranslation();
  const section = useUiStore((s) => s.section);
  const current = SECTIONS.find((item) => item.key === section);
  const wcoVisible = useWindowControlsOverlay();

  return (
    <header className="app-titlebar relative z-40 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/80 px-3 backdrop-blur sm:gap-4 sm:px-6">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold">
          <span className="md:hidden">{current ? t(current.labelKey) : t("sections.dashboard.label")}</span>
          <span className="hidden md:inline">{current ? t(current.labelKey) : t("sections.dashboard.label")}</span>
        </h1>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">{current ? t(current.blurbKey) : null}</p>
      </div>
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <ProjectSwitcher />
        <Suspense fallback={<span className="size-11" aria-hidden="true" />}>
          <NotificationCenter />
        </Suspense>
        <span className="hidden md:inline"><LoginControl /></span>
        {wcoVisible ? <div className="app-wco-spacer" aria-hidden="true" /> : null}
      </div>
    </header>
  );
}
