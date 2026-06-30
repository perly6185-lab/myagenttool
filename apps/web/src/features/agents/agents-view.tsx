import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { FactList } from "@/components/common/fact-list";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { resolveAgents, usageFor } from "@/features/selection";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import {
  adapterText,
  agentNextAction,
  costOwnerText,
  costText,
  healthTone,
  lifecycleText,
  readableAgentStatus,
  readableHealth,
  readableHealthLabel,
  usageText,
} from "@/lib/readable-labels";

export function AgentsView() {
  const { data: state } = useConsoleState();
  const selectedAgentId = useUiStore((s) => s.selectedAgentId);
  const setSelectedAgentId = useUiStore((s) => s.setSelectedAgentId);
  const { execute, pending } = useAsyncAction();

  const { agents, agent } = resolveAgents(state, selectedAgentId);
  const usage = usageFor(state, agent);

  if (agents.length === 0) {
    return <EmptyState title="No agents registered" hint="Register an agent from Discovery or Integrations." />;
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Registered agents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {agents.map((item) => {
            const active = item.id === agent?.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedAgentId(item.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  active ? "border-primary/40 bg-accent" : "border-border hover:bg-accent/60",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{item.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {readableAgentStatus(item.status)} · {readableHealthLabel(item.health)}
                  </span>
                </span>
                <StatusBadge tone={healthTone(item.health)}>{readableHealthLabel(item.health)}</StatusBadge>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {agent ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{agent.name}</CardTitle>
            <StatusBadge tone={healthTone(agent.health)}>{readableHealthLabel(agent.health)}</StatusBadge>
          </CardHeader>
          <CardContent className="space-y-4">
            <FactList
              facts={[
                { term: "Status", value: readableAgentStatus(agent.status) },
                { term: "Health", value: readableHealth(agent.health) },
                { term: "Adapter", value: adapterText(agent.adapter) },
                { term: "Lifecycle", value: lifecycleText(agent) },
                { term: "Capability", value: agent.capabilities?.[0]?.description ?? "No capability selected" },
                { term: "Cost", value: costText(agent.economics) },
                { term: "Cost owner", value: costOwnerText(agent.economics, usage) },
                { term: "Usage", value: usageText(usage) },
                { term: "Next action", value: agent.health?.nextAction ?? agentNextAction(agent, state) },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || agent.health?.status === "checking"}
                onClick={() => execute(() => api.healthCheckAgent(agent.id))}
              >
                Check health
              </Button>
              <Button
                size="sm"
                variant={agent.status === "disabled" ? "primary" : "secondary"}
                disabled={pending}
                onClick={() => execute(() => api.setAgentEnabled(agent.id, agent.status === "disabled"))}
              >
                {agent.status === "disabled" ? "Enable agent" : "Disable agent"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
