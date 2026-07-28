import { FolderKanban } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanningProjectsPanel } from "@/features/tasks/task-view";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

export function PlanningProjectsView() {
  const { t } = useAppTranslation();
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <FolderKanban className="size-5" />
          </div>
          <div>
            <CardTitle>{t("planningWorkspace.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("planningWorkspace.description")}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <PlanningProjectsPanel />
      </CardContent>
    </Card>
  );
}
