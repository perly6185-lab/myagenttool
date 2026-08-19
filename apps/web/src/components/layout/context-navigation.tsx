import { ArrowLeft, ChevronRight } from "lucide-react";
import { pageNavigationLabelKey, pageRegistration } from "@/app/sections";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { type SectionKey, type TaskArea, useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";

type ContextLabelKey = `shell.contextNav.${"overview" | "process" | "assets" | "verification" | "report" | "trace" | "tasks" | "worktrees" | "automation" | "settings"}`;

const TASK_NAV: Array<[ContextLabelKey, TaskArea]> = [
  ["shell.contextNav.overview", "overview"],
  ["shell.contextNav.process", "process"],
  ["shell.contextNav.assets", "assets"],
  ["shell.contextNav.verification", "verification"],
  ["shell.contextNav.trace", "trace"],
];

const PROJECT_NAV: Array<[ContextLabelKey, SectionKey]> = [
  ["shell.contextNav.overview", "projects"],
  ["shell.contextNav.tasks", "task"],
  ["shell.contextNav.assets", "documents"],
  ["shell.contextNav.worktrees", "workspace"],
  ["shell.contextNav.automation", "automation"],
  ["shell.contextNav.settings", "projects"],
];

export function ContextNavigation({
  taskArea,
  onTaskAreaChange,
}: {
  taskArea: TaskArea;
  onTaskAreaChange: (area: TaskArea) => void;
}) {
  const { t } = useAppTranslation();
  const section = useUiStore((state) => state.section);
  const professionalTaskNavigation = useUiStore((state) => state.workItemDetailPreference) === "expert";
  const returnSection = useUiStore((state) => state.surfaceReturnSection);
  const setReturnSection = useUiStore((state) => state.setSurfaceReturnSection);
  const navigate = usePageNavigation();
  const page = pageRegistration(section);

  if (returnSection && returnSection !== section) {
    const origin = pageRegistration(returnSection);
    return (
      <div className="flex min-h-10 items-center gap-2 border-b border-border bg-muted/30 px-3 sm:px-6">
        <button
          type="button"
          className="flex items-center gap-2 rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => {
            navigate(returnSection);
            setReturnSection(null);
          }}
        >
          <ArrowLeft className="size-4" />
          {t("shell.contextNav.returnTo", { destination: t(pageNavigationLabelKey(origin)) })}
        </button>
        <span className="text-xs text-muted-foreground">
          {t(`shell.navigation.${page.surface}Hint`)}
        </span>
        {section !== "settings" && (page.surface !== "entry" || returnSection === "me") ? (
          <button type="button" className="ml-auto rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => navigate("settings")}>
            {t("me.settings")}
          </button>
        ) : null}
      </div>
    );
  }

  if (page.surface !== "entry") {
    return (
      <nav aria-label={t("me.settings")} className="flex min-h-10 items-center gap-1 overflow-x-auto border-b border-border bg-muted/30 px-3 text-xs sm:px-6">
        {section === "settings" ? (
          <span className="px-2 py-1 font-medium">{t("me.settings")}</span>
        ) : (
          <>
            <button type="button" className="rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => navigate("settings")}>{t("me.settings")}</button>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="whitespace-nowrap px-2 py-1 font-medium">{t(pageNavigationLabelKey(page))}</span>
          </>
        )}
      </nav>
    );
  }

  const taskMode = section === "task";
  if (taskMode && !professionalTaskNavigation) {
    if (taskArea === "overview") return null;
    const currentLabel = TASK_NAV.find(([, target]) => target === taskArea)?.[0] ?? "shell.contextNav.overview";
    return (
      <nav
        aria-label={t("shell.contextNav.task")}
        className="flex min-h-10 items-center gap-1 border-b border-border px-3 text-xs sm:px-6"
      >
        <button
          type="button"
          className="flex items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => onTaskAreaChange("overview")}
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {t("shell.contextNav.tasks")}
        </button>
        <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="px-2 py-1 font-medium">{t(currentLabel)}</span>
      </nav>
    );
  }
  const items = taskMode ? TASK_NAV : section === "projects" ? PROJECT_NAV : null;
  if (!items) return null;
  return (
    <nav
      role={taskMode ? "tablist" : undefined}
      aria-label={t(taskMode ? "shell.contextNav.task" : "shell.contextNav.project")}
      className="flex min-h-10 items-center gap-1 overflow-x-auto border-b border-border px-3 sm:px-6"
    >
      {items.map(([label, target], index) => {
        const active = taskMode ? target === taskArea : index === 0;
        return (
          <button
            key={label}
            type="button"
            role={taskMode ? "tab" : undefined}
            aria-selected={taskMode ? active : undefined}
            onClick={() => taskMode
              ? onTaskAreaChange(target as TaskArea)
              : navigate(target as SectionKey)}
            className={cn(
              "whitespace-nowrap rounded px-2 py-1 text-xs",
              active
                ? "bg-primary/10 font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t(label)}
          </button>
        );
      })}
    </nav>
  );
}
