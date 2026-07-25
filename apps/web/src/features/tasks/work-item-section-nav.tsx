import { Button } from "@/components/ui/button";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { type WorkItemSection, useUiStore } from "@/store/ui-store";

export function WorkItemSectionNav({ itemId }: { itemId: string }) {
  const { t } = useAppTranslation();
  const activeSection = useUiStore((state) => state.selectedWorkItemSection) ?? "overview";
  const setActiveSection = useUiStore((state) => state.setSelectedWorkItemSection);
  const sections: Array<[WorkItemSection, string, string]> = [
    ["overview", "work-item-overview", t("shell.contextNav.overview")],
    ["process", "work-item-execution", t("shell.contextNav.process")],
    ["assets", "work-item-details", t("shell.contextNav.assets")],
    ["verification", "work-item-acceptance", t("shell.contextNav.verification")],
    ["trace", "work-item-observability", t("shell.contextNav.trace")],
  ];
  return (
    <nav aria-label={t("taskCockpit.title")} className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-border bg-background/95 py-2 backdrop-blur">
      {sections.map(([section, target, label]) => (
        <Button key={section} type="button" variant={activeSection === section ? "secondary" : "ghost"} size="sm"
          aria-current={activeSection === section ? "page" : undefined}
          onClick={() => {
            setActiveSection?.(section);
            document.getElementById(`${target}-${itemId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}>
          {label}
        </Button>
      ))}
    </nav>
  );
}
