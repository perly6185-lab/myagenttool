import { GitFork, GitMerge, CircleDot, CircleDashed, XCircle } from "lucide-react";
import type { AutoRunRecord } from "./auto-runs-view";

// Epic S4: live rollup of a decomposed epic's children. Each child rolls up from its
// own auto-run once a human labels the child `auto`; until then it is "not started".
const STATUS_ICON: Record<string, typeof CircleDot> = {
  merged: GitMerge,
  prOpen: CircleDot,
  inProgress: CircleDot,
  failed: XCircle,
  notStarted: CircleDashed,
};

function childState(item: { status?: string | null; prState?: string | null }): keyof typeof STATUS_ICON {
  if (item.prState === "MERGED") return "merged";
  if (item.status === "pr_open") return "prOpen";
  if (item.status === "failed" || item.status === "blocked") return "failed";
  if (item.status) return "inProgress";
  return "notStarted";
}

export function EpicRollup({ run }: { run: AutoRunRecord }) {
  const rollup = run.childRollup;
  const children = run.childIssues ?? [];
  if (!children.length) return null;
  const total = rollup?.total ?? children.length;
  const done = rollup?.merged ?? 0;
  const started = rollup?.started ?? 0;

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-2">
      <span className="flex items-center gap-1 text-xs font-medium text-foreground/80">
        <GitFork className="size-3.5" /> Epic children — {done}/{total} merged · {started} started
      </span>
      <ul className="flex flex-col gap-0.5">
        {(rollup?.items ?? children.map((c) => ({ number: c.number, title: c.title, status: null, prState: null }))).map((item) => {
          const kind = childState(item);
          const Icon = STATUS_ICON[kind];
          const tone =
            kind === "merged" ? "text-green-600 dark:text-green-400"
            : kind === "failed" ? "text-red-600 dark:text-red-400"
            : kind === "notStarted" ? "text-muted-foreground"
            : "text-foreground/80";
          return (
            <li key={item.number} className={`flex items-center gap-1.5 text-[11px] ${tone}`}>
              <Icon className="size-3 shrink-0" />
              <span className="shrink-0">#{item.number}</span>
              <span className="truncate" title={item.title ?? undefined}>{item.title ?? ""}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">{item.prState === "MERGED" ? "merged" : item.status ?? "not started"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
