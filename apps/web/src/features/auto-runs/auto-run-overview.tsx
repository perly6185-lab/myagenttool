import { useMemo, useState } from "react";
import { GitPullRequest, History, Rocket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { DeploymentSnapshot } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { shortTime } from "@/lib/readable-labels";
import { runLane, statusTone, type AutoRunLane, type AutoRunRecord } from "./auto-run-model";

export function AutoRunStatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const LANES: { key: AutoRunLane; label: string }[] = [
  { key: "attention", label: "Attention" },
  { key: "needs_you", label: "Needs you" },
  { key: "running", label: "Running" },
  { key: "pr_open", label: "PR open" },
  { key: "done", label: "Done" },
];

function RunChip({ run, onOpen }: { run: AutoRunRecord; onOpen: (runId: string) => void }) {
  const { t } = useAppTranslation();
  const label = run.link ? `#${run.link.number} ${run.link.title}` : run.id;
  return (
    <button
      type="button"
      onClick={() => onOpen(run.id)}
      className="flex flex-col gap-1 rounded-md border border-border bg-card p-2 text-left text-xs transition-colors hover:border-primary/50 hover:bg-muted/40"
    >
      <div className="flex items-center gap-1.5">
        <Badge tone={statusTone(run.status)}>{run.status === "done" ? t("executionUi.done") : t(`autoRuns.status.${run.status}` as never, { defaultValue: run.status })}</Badge>
        {(run.failoverAttempts ?? 0) > 0 ? <Badge tone="warning">failover {run.failoverAttempts}</Badge> : null}
        {run.prUrl ? (
          <a href={run.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
            <GitPullRequest className="size-3" />#{run.prNumber}
          </a>
        ) : null}
        {run.deployment ? (
          <span className={run.deployment.status === "deployed" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"} title={run.deployment.summary ?? undefined}>
            <Rocket className="inline size-3" />
          </span>
        ) : null}
      </div>
      <span className="truncate font-medium text-foreground" title={label}>{label}</span>
      {run.decision ? <span className="text-muted-foreground">{run.decision.path}</span> : null}
    </button>
  );
}

export function AutoRunBoard({ runs, onOpen }: { runs: AutoRunRecord[]; onOpen: (runId: string) => void }) {
  const byLane = useMemo(() => {
    const grouped: Record<AutoRunLane, AutoRunRecord[]> = { attention: [], needs_you: [], running: [], pr_open: [], done: [] };
    for (const run of runs) grouped[runLane(run)].push(run);
    return grouped;
  }, [runs]);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {LANES.map((lane) => (
        <div key={lane.key} className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-2">
          <div className="flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            <span>{lane.label}</span>
            <span className="rounded bg-muted px-1.5 tabular-nums">{byLane[lane.key].length}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {byLane[lane.key].map((run) => <RunChip key={run.id} run={run} onOpen={onOpen} />)}
            {byLane[lane.key].length === 0 ? <span className="px-1 py-2 text-[11px] text-muted-foreground/40">—</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AutoRunDeployList({ deployments, runs }: { deployments: DeploymentSnapshot[]; runs: AutoRunRecord[] }) {
  const [open, setOpen] = useState(false);
  const runsById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);
  const sorted = useMemo(
    () => deployments.slice().sort((a, b) => ((a.at ?? "") < (b.at ?? "") ? 1 : (a.at ?? "") > (b.at ?? "") ? -1 : 0)),
    [deployments],
  );
  if (sorted.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
      >
        <History className="size-3" /> {open ? "Hide deploy log" : `Deploy log (${sorted.length})`}
      </button>
      {open ? (
        <ul className="flex flex-col gap-1">
          {sorted.map((deployment) => {
            const run = deployment.autoRunId ? runsById.get(deployment.autoRunId) : undefined;
            const tone = deployment.status === "deployed" ? "success" : deployment.status === "rolled_back" ? "warning" : "danger";
            const label = deployment.status === "deployed" ? "deployed" : deployment.status === "rolled_back" ? "rolled back" : "deploy failed";
            return (
              <li key={deployment.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-border px-2.5 py-1.5 text-xs">
                <Badge tone={tone}>{label}</Badge>
                {deployment.at ? <span className="tabular-nums text-muted-foreground">{shortTime(deployment.at)}</span> : null}
                {deployment.prNumber ? (
                  run?.prUrl ? (
                    <a href={run.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                      <GitPullRequest className="size-3" />#{deployment.prNumber}
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-muted-foreground"><GitPullRequest className="size-3" />#{deployment.prNumber}</span>
                  )
                ) : null}
                {run?.link ? (
                  run.link.url ? (
                    <a href={run.link.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">→ issue #{run.link.number}</a>
                  ) : (
                    <span className="text-muted-foreground">→ issue #{run.link.number}</span>
                  )
                ) : null}
                {deployment.summary ? (
                  <span className="w-full truncate text-muted-foreground [overflow-wrap:anywhere]" title={deployment.summary}>{deployment.summary}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
