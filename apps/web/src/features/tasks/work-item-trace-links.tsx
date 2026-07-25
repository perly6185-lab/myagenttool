import { Button } from "@/components/ui/button";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useUiStore } from "@/store/ui-store";
import type { LocalWorkItem, LocalWorkItemObservability } from "./task-view-types";

export function WorkItemTraceLinks({
  item,
  observability,
}: {
  item: LocalWorkItem;
  observability: LocalWorkItemObservability | null;
}) {
  const { t } = useAppTranslation();
  const navigate = usePageNavigation();
  const setSelectedInvocationId = useUiStore((state) => state.setSelectedInvocationId);
  const invocationId = observability?.latestRun?.invocationId ?? observability?.timeline
    ?.map((event) => event.data.invocationId)
    .find((value): value is string => typeof value === "string" && value.length > 0) ?? null;
  const hasEvidence = (item.verificationRecords ?? []).some((record) => record.evidence.length > 0);

  return (
    <nav aria-label={t("shell.contextNav.trace")} className="flex flex-wrap gap-2 rounded-md border border-border p-3">
      <Button variant="secondary" size="sm" onClick={() => navigate("autoRuns")}>
        {t("shell.navigation.queue")}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => navigate("automation")}>
        {t("shell.taskTrace.schedulingSettings")}
      </Button>
      {observability?.attention.length ? (
        <Button variant="secondary" size="sm" onClick={() => navigate("approvals")}>
          {t("shell.navigation.attention")}
        </Button>
      ) : null}
      {invocationId ? (
        <Button variant="secondary" size="sm" onClick={() => {
          setSelectedInvocationId(invocationId);
          navigate("invocations");
        }}>
          {t("sections.invocations.label")}
        </Button>
      ) : null}
      {hasEvidence ? (
        <Button variant="secondary" size="sm" onClick={() => navigate("evidence")}>
          {t("sections.evidence.label")}
        </Button>
      ) : null}
    </nav>
  );
}
