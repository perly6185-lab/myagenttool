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
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import {
  adapter,
  agentStatus,
  cost,
  costOwner,
  healthLabel,
  healthText,
  lifecycle,
  nextAction,
  usage as usageLabel,
} from "@/lib/i18n/readable-labels";
import { healthTone } from "@/lib/readable-labels";

export function AgentsView() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const selectedAgentId = useUiStore((s) => s.selectedAgentId);
  const setSelectedAgentId = useUiStore((s) => s.setSelectedAgentId);
  const setSection = useUiStore((s) => s.setSection);
  const { execute, pending } = useAsyncAction();

  const { agents, agent } = resolveAgents(state, selectedAgentId);
  const usage = usageFor(state, agent);

  if (agents.length === 0) {
    return (
      <EmptyState
        title={t("agents.emptyTitle")}
        hint={t("agents.emptyHint")}
        action={<Button size="sm" onClick={() => setSection("discovery")}>{t("agents.discover")}</Button>}
      />
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{t("agents.registered")}</CardTitle>
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
                    {agentStatus(t, item.status)} · {healthLabel(t, item.health)}
                  </span>
                </span>
                <StatusBadge tone={healthTone(item.health)}>{healthLabel(t, item.health)}</StatusBadge>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {agent ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{agent.name}</CardTitle>
            <StatusBadge tone={healthTone(agent.health)}>{healthLabel(t, agent.health)}</StatusBadge>
          </CardHeader>
          <CardContent className="space-y-4">
            <FactList
              facts={[
                { term: t("agents.status"), value: agentStatus(t, agent.status) },
                { term: t("agents.health"), value: healthText(t, agent.health) },
                { term: t("agents.adapter"), value: adapter(t, agent.adapter) },
                { term: t("agents.lifecycle"), value: lifecycle(t, agent) },
                { term: t("agents.capability"), value: agent.capabilities?.[0]?.description ?? t("agents.noCapability") },
                { term: t("agents.cost"), value: cost(t, agent.economics) },
                { term: t("agents.costOwner"), value: costOwner(t, agent.economics, usage) },
                { term: t("agents.usage"), value: usageLabel(t, usage) },
                { term: t("agents.nextAction"), value: agent.health?.nextAction ?? nextAction(t, agent, state) },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || agent.health?.status === "checking"}
                onClick={() => execute(() => api.healthCheckAgent(agent.id))}
              >
                {t("agents.checkHealth")}
              </Button>
              <Button
                size="sm"
                variant={agent.status === "disabled" ? "primary" : "secondary"}
                disabled={pending}
                onClick={() => execute(() => api.setAgentEnabled(agent.id, agent.status === "disabled"))}
              >
                {t(agent.status === "disabled" ? "agents.enable" : "agents.disable")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
