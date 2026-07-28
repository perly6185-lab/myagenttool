import { ArrowLeft } from "lucide-react";
import { pageNavigationLabelKey, pageRegistration } from "@/app/sections";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { type SectionKey, useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";

type ContextLabelKey = `shell.contextNav.${"overview" | "process" | "assets" | "verification" | "trace" | "tasks" | "worktrees" | "automation" | "settings"}`;

const TASK_NAV: Array<{ label: ContextLabelKey; section: SectionKey }> = [
  { label: "shell.contextNav.overview", section: "task" },
  { label: "shell.contextNav.process", section: "workBoard" },
  { label: "shell.contextNav.assets", section: "documents" },
  { label: "shell.contextNav.verification", section: "review" },
  { label: "shell.contextNav.trace", section: "invocations" },
];

const PROJECT_NAV: Array<{ label: ContextLabelKey; section: SectionKey }> = [
  { label: "shell.contextNav.overview", section: "projects" },
  { label: "shell.contextNav.tasks", section: "task" },
  { label: "shell.contextNav.assets", section: "documents" },
  { label: "shell.contextNav.worktrees", section: "workspace" },
  { label: "shell.contextNav.automation", section: "automation" },
  { label: "shell.contextNav.settings", section: "projects" },
];

export function ContextNavigation() {
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

  const items = section === "task" ? TASK_NAV : section === "projects" ? PROJECT_NAV : null;
  if (!items) return null;
  return (
    <nav aria-label={t(section === "task" ? "shell.contextNav.task" : "shell.contextNav.project")} className="flex min-h-10 items-center gap-1 overflow-x-auto border-b border-border px-3 sm:px-6">
      {items.map((item, index) => (
        <button
          key={`${item.label}-${index}`}
          type="button"
          onClick={() => navigate(item.section)}
          className={cn(
            "whitespace-nowrap rounded px-2 py-1 text-xs",
            item.section === section && index === 0
              ? "bg-primary/10 font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {t(item.label)}
        </button>
      ))}
    </nav>
  );
}
