import { useCallback, useEffect, useState } from "react";
import { Repeat, RefreshCw, ChevronRight, ChevronDown, Lightbulb } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { cn } from "@/lib/cn";
import { api } from "@/data/use-console-actions";
import type { Tone } from "@/lib/readable-labels";
import { useVisibleInterval } from "@/hooks/use-visible-interval";

// The Routines section: scheduled autonomous checks (the ai:loop-routine engine).
// The server read-model is fully built (GET /api/loop-routines + /:id/findings) but
// had no console surface — this composes it, like Approvals/Evidence. Empty until a
// routine runs; the CLI/cron produces the runs this reads.

interface RoutineRun {
  routineRunId: string;
  routineId: string;
  name?: string;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  findingCount?: number;
  suggestedRunCount?: number;
  failedCheckCount?: number;
}
interface RoutineFinding {
  id: string;
  severity: string;
  title: string;
  proposedAction?: string;
  suggestedRun?: unknown;
}

function severityTone(sev: string): Tone {
  if (sev === "high" || sev === "critical") return "danger";
  if (sev === "medium") return "warning";
  return "neutral";
}
function statusTone(status: string): Tone {
  if (["ok", "passed", "succeeded", "clean"].includes(status)) return "success";
  if (["failed", "error"].includes(status)) return "danger";
  return "neutral";
}
function fmtWhen(iso?: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export function RoutinesView() {
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [findings, setFindings] = useState<Record<string, RoutineFinding[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await api.loopRoutineRuns()) as { runs?: RoutineRun[] };
      setRuns(data.runs ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useVisibleInterval(() => void load(), 30_000);

  const toggle = async (runId: string) => {
    const next = expanded === runId ? null : runId;
    setExpanded(next);
    if (next && !findings[runId]) {
      try {
        const data = (await api.loopRoutineFindings(runId)) as { findings?: RoutineFinding[] };
        setFindings((f) => ({ ...f, [runId]: data.findings ?? [] }));
      } catch {
        setFindings((f) => ({ ...f, [runId]: [] }));
      }
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Repeat className="size-5" /> Routines
          </h1>
          <p className="text-sm text-muted-foreground">
            Scheduled autonomous checks — each run's findings and any follow-up runs it suggests. The loop engine (CLI/cron) produces these; this is a read-only view.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("mr-1 size-3.5", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {!runs.length ? (
        <EmptyState
          title="No routine runs yet"
          hint="Scheduled autonomous checks appear here once the loop engine runs (e.g. `pnpm ai:loop-routine-run`). Each run lists its findings and suggested follow-up work."
        />
      ) : (
        <div className="space-y-2">
          {runs.map((run) => {
            const isOpen = expanded === run.routineRunId;
            const runFindings = findings[run.routineRunId] ?? [];
            return (
              <Card key={run.routineRunId}>
                <CardContent className="p-0">
                  <button type="button" onClick={() => void toggle(run.routineRunId)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                    {isOpen ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{run.name || run.routineId}</span>
                        <StatusBadge tone={statusTone(run.status)}>{run.status}</StatusBadge>
                        <span className="text-xs text-muted-foreground">{fmtWhen(run.startedAt)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        {run.findingCount ? <Badge tone="neutral">{run.findingCount} finding(s)</Badge> : null}
                        {run.failedCheckCount ? <Badge tone="danger">{run.failedCheckCount} failed check(s)</Badge> : null}
                        {run.suggestedRunCount ? <Badge tone="warning">{run.suggestedRunCount} suggested run(s)</Badge> : null}
                        {!run.findingCount && !run.failedCheckCount ? <span className="text-muted-foreground">clean</span> : null}
                      </div>
                    </div>
                  </button>
                  {isOpen ? (
                    <div className="space-y-1.5 border-t border-border px-4 py-3">
                      {!runFindings.length ? (
                        <p className="text-xs text-muted-foreground">No findings recorded for this run.</p>
                      ) : (
                        runFindings.map((f) => (
                          <div key={f.id || f.title} className="rounded-md border border-border p-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge tone={severityTone(f.severity)}>{f.severity}</StatusBadge>
                              <span className="text-sm font-medium">{f.title || "(untitled finding)"}</span>
                            </div>
                            {f.proposedAction ? <p className="mt-1 text-xs text-muted-foreground">{f.proposedAction}</p> : null}
                            {f.suggestedRun ? (
                              <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                                <Lightbulb className="size-3" /> suggests a follow-up run
                              </p>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
