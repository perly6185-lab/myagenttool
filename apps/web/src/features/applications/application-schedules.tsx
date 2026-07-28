import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import {
  healthFor,
  scheduleHealthTone,
} from "@/features/automation/schedule-health-ui";
import type { ApplicationSnapshot } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

/**
 * The schedules an application owns, in its Inspector (#849).
 *
 * A schedule is only recoverable if the things that recover it are here: run it
 * now, pause it, delete it, and reach the run (or the approval) it is stuck on.
 * Reading that a schedule is broken and then having to go somewhere else to do
 * anything about it is most of the friction this slice exists to remove.
 */
export function ApplicationSchedules({ application }: { application: ApplicationSnapshot }) {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const { execute, pending } = useAsyncAction();
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSelectedAutomationId = useUiStore((s) => s.setSelectedAutomationId);

  const rows = (state?.scheduleHealth ?? []).filter((row) => row.applicationId === application.id);
  if (rows.length === 0) return null;

  const automations = state?.automations ?? [];

  function openRun(invocationId: string) {
    setSelectedInvocationId(invocationId);
    setSection("invocations");
  }

  function openSchedule(automationId: string) {
    setSelectedAutomationId(automationId);
    setSection("automation");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{t("applicationSchedules.title")}</CardTitle>
          <Badge tone={application.scheduleHealth?.needsAttention ? "warning" : "neutral"}>
            {t("applicationSchedules.count", { count: rows.length })}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => {
          const automation = automations.find((item) => item.id === row.automationId);
          const health = healthFor(row.automationId, state?.scheduleHealth);
          if (!automation || !health) return null;
          return (
            <div key={row.automationId} className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <button
                    type="button"
                    className="truncate text-sm font-medium hover:underline"
                    onClick={() => openSchedule(row.automationId)}
                  >
                    {automation.name}
                  </button>
                  <p className="truncate text-xs text-muted-foreground">
                    {automation.schedule.label}
                    {row.capability ? ` · ${row.capability}` : ""}
                  </p>
                </div>
                <Badge tone={scheduleHealthTone(health.state)}>{t(`automationHealth.${health.state}` as never)}</Badge>
              </div>

              {/* The reason, in words. A parked schedule has no error to show. */}
              {health.reason ? (
                <p className={`mt-1 text-xs ${health.needsAttention ? "text-warning" : "text-muted-foreground"}`}>
                  {health.reason}
                </p>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void execute(() => api.runAutomation(automation.id))}
                >
                  {t("applicationSchedules.runNow")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void execute(() => api.updateAutomation(automation.id, { enabled: !automation.enabled }))}
                >
                  {t(automation.enabled ? "applicationSchedules.pause" : "applicationSchedules.resume")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void execute(() => api.deleteAutomation(automation.id))}
                >
                  {t("applicationSchedules.delete")}
                </Button>
                {health.latestInvocationId ? (
                  <Button size="sm" variant="secondary" onClick={() => openRun(health.latestInvocationId!)}>
                    {t(health.state === "approval_pending" ? "applicationSchedules.reviewApproval" : "applicationSchedules.latestRun")}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
