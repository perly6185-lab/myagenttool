import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { EventTimeline } from "@/features/invocations/event-timeline";
import { DecisionAction } from "@/features/invocations/decision-action";
import { useConsoleState } from "@/data/use-console-state";
import { resolveInvocation } from "@/features/selection";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { readableDelivery, readableStatus, statusTone } from "@/lib/readable-labels";

export function InvocationsView() {
  const { data: state } = useConsoleState();
  const selectedInvocationId = useUiStore((s) => s.selectedInvocationId);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);

  const invocations = state?.invocations ?? [];
  const selected = resolveInvocation(state, selectedInvocationId);
  const events = selected
    ? (state?.events ?? []).filter((e) => e.invocationId === selected.id).slice(0, 40)
    : [];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Invocations</CardTitle>
        </CardHeader>
        <CardContent>
          {invocations.length === 0 ? (
            <EmptyState title="No invocations yet" hint="Start a task from Overview to see it here." />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Task</th>
                    <th className="px-3 py-2 text-left font-medium">Agent</th>
                    <th className="px-3 py-2 text-left font-medium">Delivery</th>
                    <th className="px-3 py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invocations.map((invocation) => {
                    const active = invocation.id === selected?.id;
                    return (
                      <tr
                        key={invocation.id}
                        onClick={() => setSelectedInvocationId(invocation.id)}
                        className={cn(
                          "cursor-pointer border-t border-border transition-colors hover:bg-accent/60",
                          active && "bg-accent",
                        )}
                      >
                        <td className="px-3 py-2 font-mono text-xs">{invocation.id}</td>
                        <td className="px-3 py-2 text-muted-foreground">{invocation.agentId ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {readableDelivery(invocation.delivery?.state)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <StatusBadge tone={statusTone(invocation.status)}>
                            {readableStatus(invocation.status)}
                          </StatusBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{selected ? `Timeline · ${selected.id}` : "Timeline"}</CardTitle>
        </CardHeader>
        <CardContent>
          <EventTimeline events={events} renderAction={(event) => <DecisionAction event={event} />} />
        </CardContent>
      </Card>
    </div>
  );
}
