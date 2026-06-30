import type { ReactNode } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { readableEventType, shortTime } from "@/lib/readable-labels";
import type { InvocationEventSnapshot } from "@/lib/console-state";

export function EventTimeline({
  events,
  renderAction,
}: {
  events: InvocationEventSnapshot[];
  // Optional inline slot rendered under an event's message — used to anchor an
  // action (e.g. an approval's Approve/Deny) to the exact moment in the stream
  // it was requested, so multi-run sessions keep each decision in context.
  renderAction?: (event: InvocationEventSnapshot) => ReactNode;
}) {
  if (events.length === 0) {
    return <EmptyState title="No activity yet" hint="Run a task to watch local progress here." />;
  }

  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3">
          <time
            dateTime={event.createdAt}
            className="mt-0.5 w-20 shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
          >
            {shortTime(event.createdAt)}
          </time>
          <div className="min-w-0 flex-1 border-l border-border pl-3">
            <p className="text-sm font-medium">{readableEventType(event.type)}</p>
            <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {event.message ?? "Activity recorded."}
            </p>
            {renderAction?.(event)}
          </div>
        </li>
      ))}
    </ol>
  );
}
