import type { TFunction } from "i18next";
import type {
  AgentAdapter,
  AgentEconomics,
  AgentSnapshot,
  AgentUsageSummary,
  ConsoleSnapshot,
} from "@/lib/console-state";
import { shortTime } from "@/lib/readable-labels";

export function agentStatus(t: TFunction, status?: string): string {
  if (status === "available") return t("labels.agentStatus.available");
  if (status === "unavailable") return t("labels.agentStatus.unavailable");
  if (status === "disabled") return t("labels.agentStatus.disabled");
  return status ?? "-";
}

export function healthLabel(t: TFunction, health?: AgentSnapshot["health"]): string {
  if (health?.status === "healthy") return t("labels.health.healthy");
  if (health?.status === "unhealthy") return t("labels.health.unhealthy");
  if (health?.status === "checking") return t("labels.health.checking");
  return t("labels.health.unknown");
}

export function healthText(t: TFunction, health?: AgentSnapshot["health"]): string {
  if (!health) return t("labels.health.unknown");
  if (health.status === "checking") return t("labels.health.checking");
  const label = healthLabel(t, health);
  const checkedAt = health.checkedAt
    ? t("labels.health.checkedAt", { label, time: shortTime(health.checkedAt) })
    : label;
  return health.message ? `${checkedAt} - ${health.message}` : checkedAt;
}

export function nextAction(
  t: TFunction,
  agent: AgentSnapshot | null,
  state: ConsoleSnapshot | null | undefined,
): string {
  if (!agent) return "-";
  if (agent.status === "disabled") return t("labels.nextAction.enable");
  if (agent.health?.status === "unhealthy")
    return agent.health.nextAction ?? t("labels.nextAction.recheck");
  if (agent.health?.status === "unknown" || !agent.health) return t("labels.nextAction.check");
  if (agent.location?.type === "local_device" && state?.device?.status !== "online")
    return t("labels.nextAction.startBridge");
  return t("labels.nextAction.ready");
}

export function lifecycle(t: TFunction, agent: AgentSnapshot | null): string {
  if (!agent) return "-";
  const state = agent.lifecycle?.state ?? "unknown";
  const installState = agent.lifecycle?.installState ?? "unknown";
  return `${enumValue(t, "lifecycle", state)} / ${enumValue(t, "lifecycle", installState)}`;
}

export function cost(t: TFunction, economics?: AgentEconomics): string {
  if (!economics) return t("labels.cost.unknown");
  if (economics.model === "unknown") return t("labels.cost.demo");
  return `${enumValue(t, "costModel", economics.model ?? "unknown")} (${enumValue(t, "costPolicy", economics.unknownCostPolicy ?? "unknown")})`;
}

export function costOwner(
  t: TFunction,
  economics?: AgentEconomics,
  usage?: AgentUsageSummary,
): string {
  const owner = usage?.costOwner ?? economics?.costOwner ?? "unknown";
  const model = usage?.economicModel ?? economics?.model ?? "unknown";
  if (owner === "unknown") return t("labels.cost.unknownOwner", { model: enumValue(t, "costModel", model) });
  return `${owner} (${enumValue(t, "costModel", model)})`;
}

export function usage(t: TFunction, value?: AgentUsageSummary): string {
  if (!value) return t("labels.usage.none");
  return t("labels.usage.summary", {
    total: value.invocationCount,
    succeeded: value.succeededCount,
    failed: value.failedCount,
    cancelled: value.cancelledCount,
  });
}

export function discoverySource(t: TFunction, source?: string): string {
  return enumValue(t, "discoverySource", source ?? "unknown");
}

export function adapterType(t: TFunction, type?: string): string {
  if (["cli", "http", "mcp", "a2a"].includes(type ?? "")) return (type ?? "").toUpperCase();
  if (type === "container") return t("labels.adapterType.container");
  return type ?? t("labels.adapterType.unknown");
}

export function adapter(t: TFunction, value?: AgentAdapter): string {
  if (!value) return "-";
  if (value.type === "cli") return t("labels.adapter.cli", { target: value.command ?? "-" });
  if (value.type === "http") return t("labels.adapter.http", { target: value.baseUrl ?? "-" });
  if (value.type === "mcp") {
    const target = value.transport === "http" ? value.url : value.command;
    return t("labels.adapter.mcp", {
      transport: value.transport ?? "stdio",
      target: target ?? t("discovery.unset"),
    });
  }
  if (value.type === "platform")
    return t("labels.adapter.platform", { name: value.name ?? t("labels.adapter.builtIn") });
  return value.type ?? "-";
}

function enumValue(t: TFunction, group: string, value: string): string {
  const key = `labels.${group}.${value}`;
  return t(key, { defaultValue: value.replaceAll("_", " ") });
}
