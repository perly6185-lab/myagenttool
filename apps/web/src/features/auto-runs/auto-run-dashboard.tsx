import type { ConsoleSnapshot } from "@/lib/console-state";
import { AutoRunActivityPanel } from "./auto-run-activity-panel";
import { AutoRunDeliveryPanels, AutoRunOutcomeMetrics } from "./auto-run-delivery-panels";
import type { AutoRunRecord, AutoRunSummary, DeploymentSummary } from "./auto-run-model";
import { AutoRunRoutingHealthPanel } from "./auto-run-routing-health-panel";

export { selectAutoRunCenterRows } from "./auto-run-activity-panel";

interface AutoRunDashboardProps {
  runs: AutoRunRecord[];
  summary: AutoRunSummary | null;
  deploymentSummary: DeploymentSummary | null;
  consoleState?: ConsoleSnapshot;
  onOpenRun: (runId: string) => void;
}

export function AutoRunDashboard({
  runs,
  summary,
  deploymentSummary,
  consoleState,
  onOpenRun,
}: AutoRunDashboardProps) {
  return (
    <>
      <AutoRunActivityPanel runs={runs} consoleState={consoleState} onOpenRun={onOpenRun} />

      {summary ? (
        <>
          <AutoRunOutcomeMetrics summary={summary} />
          {summary.routingHealth && summary.routingHealth.total > 0 ? (
            <AutoRunRoutingHealthPanel health={summary.routingHealth} projects={consoleState?.projects} />
          ) : null}
          <AutoRunDeliveryPanels
            runs={runs}
            summary={summary}
            deploymentSummary={deploymentSummary}
            deployments={consoleState?.deployments}
          />
        </>
      ) : null}
    </>
  );
}
