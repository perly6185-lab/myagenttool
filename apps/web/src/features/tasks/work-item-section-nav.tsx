import { Button } from "@/components/ui/button";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

export function WorkItemSectionNav({ itemId }: { itemId: string }) {
  const { t } = useAppTranslation();
  return (
    <nav aria-label={t("taskCockpit.title")} className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-border bg-background/95 py-2 backdrop-blur">
      {[
        ["work-item-overview", t("taskCockpit.title")],
        ["work-item-execution", t("taskCockpit.routingTitle")],
        ["work-item-details", t("taskCockpit.details")],
        ["work-item-collaboration", t("taskLocal.comments")],
      ].map(([target, label]) => (
        <Button key={target} type="button" variant="ghost" size="sm"
          onClick={() => document.getElementById(`${target}-${itemId}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          {label}
        </Button>
      ))}
    </nav>
  );
}
