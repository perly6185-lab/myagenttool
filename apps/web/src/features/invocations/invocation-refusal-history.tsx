import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";

// Refusal category → badge tone. `human` (a person must decide/approve) is the
// most notable; policy/not_granted are warnings; state is neutral.
const CATEGORY_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  not_granted: "warning",
  policy: "warning",
  state: "neutral",
  human: "danger",
};

/**
 * An invocation's refusals, INCLUDING the ones the 200-row in-memory cap evicted
 * to the durable archive (server slice 1/3). Refusals are rare, so this renders
 * nothing when there are none — it only surfaces when a run was actually refused.
 */
export function InvocationRefusalHistory({ invocationId }: { invocationId: string }) {
  const { data, isError } = useQuery({
    queryKey: ["invocation-refusals", invocationId],
    queryFn: () => api.listInvocationRefusals(invocationId),
  });
  const refusals = data?.refusals ?? [];
  // A failed fetch must NOT read as "no refusals" — on a compliance surface those
  // are different states. Surface the failure explicitly instead of rendering null.
  if (isError) {
    return (
      <div className="mt-4" data-testid="invocation-refusals-error">
        <Badge tone="warning">Refusal history unavailable</Badge>
      </div>
    );
  }
  if (refusals.length === 0) return null;

  return (
    <div className="mt-4 space-y-2" data-testid="invocation-refusals">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Refusals ({refusals.length})
        </p>
        {data?.truncated ? <Badge tone="warning">history may be incomplete</Badge> : null}
      </div>
      {refusals.map((refusal) => (
        <div key={refusal.id} className="rounded-lg border border-border px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={CATEGORY_TONE[refusal.category] ?? "neutral"}>{refusal.category}</Badge>
            {refusal.code ? <span className="font-mono text-xs text-muted-foreground">{refusal.code}</span> : null}
            {refusal.piiRedacted ? <Badge tone="neutral">PII redacted</Badge> : null}
            {refusal.at ? <span className="ml-auto text-xs text-muted-foreground">{refusal.at}</span> : null}
          </div>
          {refusal.summary ? <p className="mt-1 [overflow-wrap:anywhere]">{refusal.summary}</p> : null}
          {refusal.remedy ? (
            <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">Remedy: {refusal.remedy}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
