import type { ApplicationSnapshot, ConsoleSnapshot } from "@/lib/console-state";
export type DependencyLifecycle = "declared" | "configured" | "verified" | "used" | "unavailable";
export function deriveApplicationDependencyState(application: ApplicationSnapshot | null, state: ConsoleSnapshot | undefined) {
  if (!application) return { lifecycle: "unavailable" as const, invocationIds: [], agentIds: [], capabilityNames: [], channelIds: [] };
  const invocations = (state?.invocations ?? []).filter((row) => row.options?.metadata?.applicationId === application.id
    || (state?.applicationResults ?? []).some((result) => result.applicationId === application.id && result.invocationId === row.id));
  const invocationIds = invocations.map((row) => row.id);
  const usedIds = new Set(invocationIds);
  const unavailable = application.status === "offline" || application.status === "failed"
    || ["repair_required", "bridge_offline"].includes(application.localReadiness?.state ?? "");
  const verified = application.localReadiness?.state === "ready" || application.probe?.status === "succeeded";
  const lifecycle: DependencyLifecycle = unavailable ? "unavailable" : invocationIds.length ? "used" : verified ? "verified" : application.status === "active" ? "configured" : "declared";
  return {
    lifecycle, invocationIds,
    agentIds: [...new Set(invocations.map((row) => row.agentId).filter((id): id is string => Boolean(id)))],
    capabilityNames: (application.probe?.capabilities ?? []).map((row) => row.name),
    channelIds: [...new Set((state?.channelDeliveries ?? []).filter((row) => row.invocationId && usedIds.has(row.invocationId)).map((row) => row.channelId))],
  };
}
