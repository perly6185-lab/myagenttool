import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import {
  routineWorkApi,
  useRoutineWorkLabels,
  type RoutineQueueItem,
} from "./routine-workflow";

function queueTone(item: RoutineQueueItem) {
  if (item.status === "failed") return "danger";
  if (item.waitingReason || ["awaiting_approval", "awaiting_condition"].includes(item.status)) {
    return "warning";
  }
  return item.status === "running" ? "running" : "neutral";
}

export function RoutineBatchQueue({
  projectId,
  onOpen,
}: {
  projectId?: string;
  onOpen: (workItemId: string) => void;
}) {
  const text = useRoutineWorkLabels();
  const [items, setItems] = useState<RoutineQueueItem[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    running: 0,
    waiting: 0,
    needsAction: 0,
  });

  const refresh = () => routineWorkApi.listQueue(projectId)
    .then((result) => {
      setItems(Array.isArray(result.items) ? result.items : []);
      if (result.summary) setSummary(result.summary);
    })
    .catch(() => {});

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  useVisibleInterval(() => void refresh(), 1_500, true);

  if (!items.length) return null;
  const next = items.find((item) =>
    !["wait_capacity", "wait_ledger"].includes(item.nextAction));

  return (
    <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
      aria-labelledby="routine-batch-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="routine-batch-title" className="text-sm font-semibold">{text.batchTitle}</h3>
          <p className="text-xs text-muted-foreground">{text.batchDescription}</p>
        </div>
        {next ? (
          <Button size="sm" onClick={() => onOpen(next.workItemId)}>
            {text.batchOpenNext}
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs" aria-live="polite">
        <div className="rounded bg-background p-2">
          <strong className="block text-sm">{summary.running}</strong>{text.batchRunning}
        </div>
        <div className="rounded bg-background p-2">
          <strong className="block text-sm">{summary.waiting}</strong>{text.batchWaiting}
        </div>
        <div className="rounded bg-background p-2">
          <strong className="block text-sm">{summary.needsAction}</strong>{text.batchNeedsAction}
        </div>
      </div>
      <ul className="grid gap-2 lg:grid-cols-2">
        {items.map((item) => {
          const progress = Math.round(
            (item.progress.completed / Math.max(item.progress.total, 1)) * 100,
          );
          return (
            <li key={item.workItemId} className="rounded-md border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    <span className="font-mono text-xs text-muted-foreground">{item.localRef}</span>
                    {" · "}
                    {item.businessKey}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.currentStep?.label ?? item.definitionName}
                  </p>
                </div>
                <Badge tone={queueTone(item)}>
                  {item.waitingReason
                    ? `${text.batchWaiting}${
                      (item.waitingReason === "ledger_reservation"
                        ? item.ledgerQueuePosition
                        : item.capacity.position)
                        ? ` ${item.waitingReason === "ledger_reservation"
                          ? item.ledgerQueuePosition
                          : item.capacity.position}`
                        : ""
                    }`
                    : text.states[item.status === "planned" ? "pending" : item.status]}
                </Badge>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar" aria-label={`${text.batchProgress} ${item.businessKey}`}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {item.progress.completed}/{item.progress.total}
                </span>
                <Button size="sm" variant="secondary" onClick={() => onOpen(item.workItemId)}>
                  {text.batchOpen}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
