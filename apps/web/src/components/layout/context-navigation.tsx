import { ArrowLeft } from "lucide-react";
import { pageNavigationLabelKey, pageRegistration } from "@/app/sections";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { type SectionKey, useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";

type ContextLabelKey = `shell.contextNav.${"overview" | "process" | "assets" | "verification" | "trace" | "tasks" | "worktrees" | "automation" | "settings"}`;

const TASK_NAV: Array<[ContextLabelKey, SectionKey]> = [
  ["shell.contextNav.overview", "task"],
  ["shell.contextNav.process", "workBoard"],
  ["shell.contextNav.assets", "documents"],
  ["shell.contextNav.verification", "review"],
  ["shell.contextNav.trace", "invocations"],
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
  taskViewSection,
  onTaskViewSectionChange,
}: {
  taskViewSection: SectionKey;
  onTaskViewSectionChange: (section: SectionKey) => void;
}) {
  const { t } = useAppTranslation();
  const section = useUiStore((state) => state.section);
  const returnSection = useUiStore((state) => state.surfaceReturnSection);
  const setReturnSection = useUiStore((state) => state.setSurfaceReturnSection);
  const navigate = usePageNavigation();
  const page = pageRegistration(section);

  if (page.surface !== "entry" && returnSection) {
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
          {t(page.surface === "settings" ? "shell.navigation.settingsHint" : "shell.navigation.traceHint")}
        </span>
      </div>
    );
  }

  const taskMode = section === "task";
  const items = taskMode ? TASK_NAV : section === "projects" ? PROJECT_NAV : null;
  if (!items) return null;
  return (
    <nav
      role={taskMode ? "tablist" : undefined}
      aria-label={t(taskMode ? "shell.contextNav.task" : "shell.contextNav.project")}
      className="flex min-h-10 items-center gap-1 overflow-x-auto border-b border-border px-3 sm:px-6"
    >
      {items.map(([label, target], index) => {
        const active = taskMode ? target === taskViewSection : index === 0;
        return (
          <button
            key={label}
            type="button"
            role={taskMode ? "tab" : undefined}
            aria-selected={taskMode ? active : undefined}
            onClick={() => taskMode
              ? onTaskViewSectionChange(target)
              : navigate(target)}
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
