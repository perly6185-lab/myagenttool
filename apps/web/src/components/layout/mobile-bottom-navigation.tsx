import { FolderKanban, Home, Mail, SquareCheckBig, UserRound } from "lucide-react";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { type SectionKey, useUiStore } from "@/store/ui-store";
import { pageRegistration } from "@/app/sections";

type MobileDestination = "home" | "mail" | "tasks" | "projects" | "me";

const ITEMS: Array<{
  key: MobileDestination;
  section: SectionKey;
  icon: typeof Home;
}> = [
  { key: "home", section: "dashboard", icon: Home },
  { key: "mail", section: "mail", icon: Mail },
  { key: "tasks", section: "task", icon: SquareCheckBig },
  { key: "projects", section: "projects", icon: FolderKanban },
  { key: "me", section: "me", icon: UserRound },
];

function activeDestination(section: SectionKey): MobileDestination | null {
  if (section === "dashboard") return "home";
  if (section === "mail") return "mail";
  if (section === "task") return "tasks";
  if (section === "projects") return "projects";
  if (section === "workBoard" || section === "autoRuns" || section === "approvals") return "tasks";
  if (section === "me" || pageRegistration(section).surface !== "entry") return "me";
  return null;
}

export function MobileBottomNavigation() {
  const { t } = useAppTranslation();
  const section = useUiStore((state) => state.section);
  const settingsDialogOpen = useUiStore((state) => state.settingsDialogOpen);
  const navigate = usePageNavigation();
  const active = settingsDialogOpen ? "me" : activeDestination(section);

  return (
    <nav
      aria-label={t("shell.mobileNav.label")}
      className="z-30 shrink-0 border-t border-border bg-background/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.25rem)" }}
    >
      <div className="grid min-h-14 grid-cols-5">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const selected = active === item.key;
          const label = t(`shell.mobileNav.${item.key}`);
          return (
            <button
              key={item.key}
              type="button"
              aria-label={label}
              aria-current={selected ? "page" : undefined}
              onClick={() => navigate(item.section)}
              className={cn(
                "relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-1 text-center text-[clamp(0.55rem,2.5vw,0.7rem)] leading-tight",
                selected ? "font-semibold text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <span>
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="max-w-full whitespace-normal break-words">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
