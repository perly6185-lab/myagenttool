import { useState } from "react";
import { GitCompare, Loader2, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { cn } from "@/lib/cn";
import { useConsoleState, useRefreshConsoleState } from "@/data/use-console-state";
import { api, useAsyncAction } from "@/data/use-console-actions";
import { Transcript } from "@/features/invocations/transcript";

// #128 Phase 4: run ONE task on 2+ agents and compare their transcripts side by side.
// The server (createCompareRun / POST /api/compare-runs) already fans out, tracks the
// group, and picks a preferred child; this view is the composer + the side-by-side.

export function CompareView() {
  const { data: state } = useConsoleState();
  const refresh = useRefreshConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const [task, setTask] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const agents = state?.agents ?? [];
  const compareRuns = state?.compareRuns ?? [];
  const invocations = state?.invocations ?? [];
  const events = state?.events ?? [];
  const active = compareRuns.find((c) => c.id === activeId) ?? compareRuns[0] ?? null;

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const agentName = (agentId?: string) => agents.find((a) => a.id === agentId)?.name ?? agentId ?? "agent";

  const start = async () => {
    if (!task.trim() || selected.length < 2) return;
    const ok = await execute(() => api.startCompareRun(task.trim(), selected));
    if (ok) {
      setActiveId(null); // fall back to the newest compare run (server unshifts it)
      setTask("");
      void refresh();
    }
  };

  const children = active
    ? active.childInvocationIds.map((id) => invocations.find((i) => i.id === id)).filter((x): x is NonNullable<typeof x> => Boolean(x))
    : [];

  return (
    <div className="flex h-full flex-col gap-3">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-1.5 text-base"><GitCompare className="size-4" /> Compare agents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            rows={2}
            placeholder="One task to run on every selected agent…"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
          <div className="flex flex-wrap gap-1.5">
            {agents.length === 0 ? (
              <span className="text-xs text-muted-foreground">No agents registered.</span>
            ) : agents.map((a) => (
              <label key={a.id} className={cn("flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs", selected.includes(a.id) ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground")}>
                <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} className="size-3" />
                {a.name ?? a.id}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => void start()} disabled={pending || !task.trim() || selected.length < 2}>
              {pending ? <Loader2 className="mr-1 size-4 animate-spin" /> : <GitCompare className="mr-1 size-4" />} Compare on {selected.length} agent(s)
            </Button>
            {selected.length < 2 ? <span className="text-xs text-muted-foreground">Select at least 2 agents.</span> : null}
          </div>
          {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
        </CardContent>
      </Card>

      {compareRuns.length ? (
        <div className="flex flex-wrap gap-1.5">
          {compareRuns.slice(0, 8).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveId(c.id)}
              title={c.task}
              className={cn("truncate rounded-md border px-2 py-1 text-xs", c.id === active?.id ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
            >
              {c.task.length > 34 ? `${c.task.slice(0, 34)}…` : c.task} · {c.status}
            </button>
          ))}
        </div>
      ) : null}

      {active ? (
        <div className="grid min-h-0 flex-1 gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, children.length)}, minmax(0, 1fr))` }}>
          {children.map((inv) => {
            const invEvents = events.filter((e) => e.invocationId === inv.id);
            const preferred = active.preferredInvocationId === inv.id;
            return (
              <Card key={inv.id} className={cn("flex min-h-0 flex-col", preferred && "ring-1 ring-primary")}>
                <CardHeader className="flex-row items-center justify-between gap-2 py-2">
                  <CardTitle className="truncate text-sm">{agentName(inv.agentId)}</CardTitle>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {preferred ? <Badge tone="success"><Trophy className="mr-1 size-3" />preferred</Badge> : null}
                    <span className="text-xs text-muted-foreground">{inv.status}</span>
                  </div>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 overflow-y-auto">
                  <Transcript events={invEvents} summary={inv.result?.summary ? { text: inv.result.summary, status: inv.status } : undefined} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No comparison yet" hint="Enter a task, pick 2+ agents, and Compare to run them side by side." />
      )}
    </div>
  );
}
