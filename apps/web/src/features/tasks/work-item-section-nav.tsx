import { Button } from "@/components/ui/button";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { WorkItemSection } from "@/store/ui-store";

export function WorkItemSectionNav({
  itemId,
  activeSection,
  onSectionChange,
}: {
  itemId: string;
  activeSection: WorkItemSection;
  onSectionChange: (section: WorkItemSection) => void;
}) {
  const { t } = useAppTranslation();
  const sections: Array<[WorkItemSection, string]> = [
    ["overview", t("shell.contextNav.overview")],
    ["process", t("shell.contextNav.process")],
    ["assets", t("shell.contextNav.assets")],
    ["verification", t("shell.contextNav.verification")],
    ["report", t("shell.contextNav.report")],
    ["trace", t("shell.contextNav.trace")],
  ];
  return (
    <nav
      role="tablist"
      aria-label={t("taskCockpit.title")}
      className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-border bg-background/95 py-2 backdrop-blur"
    >
      {sections.map(([section, label]) => (
        <Button
          key={section}
          id={`work-item-tab-${section}-${itemId}`}
          type="button"
          role="tab"
          variant={activeSection === section ? "secondary" : "ghost"}
          size="sm"
          aria-selected={activeSection === section}
          tabIndex={activeSection === section ? 0 : -1}
          onClick={() => onSectionChange(section)}
        >
          {label}
        </Button>
      ))}
    </nav>
  );
}
