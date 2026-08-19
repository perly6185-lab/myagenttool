import { GitFork, GitMerge, CircleDot, CircleDashed, XCircle, Play, Loader2 } from "lucide-react";
import { api, useAsyncAction } from "@/data/use-console-actions";
import type { AutoRunRecord } from "./auto-run-model";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

// Epic S4: live rollup of a decomposed epic's children. Each child rolls up from its
// own auto-run once a human labels the child `auto`; until then it is "not started".
// S5.1: a redundant tag marks a child the judge blocked as already-covered.
const STATUS_ICON: Record<string, typeof CircleDot> = {
  merged: GitMerge,
  prOpen: CircleDot,
  inProgress: CircleDot,
  failed: XCircle,
  notStarted: CircleDashed,
};

function childState(item: { status?: string | null; prState?: string | null; issueState?: string | null; done?: boolean }): keyof typeof STATUS_ICON {
  // A closed issue is done however it merged (auto-run OR a human-override PR).
  if (item.done || item.issueState === "CLOSED" || item.prState === "MERGED") return "merged";
  if (item.status === "pr_open") return "prOpen";
  if (item.status === "failed" || item.status === "blocked") return "failed";
  if (item.status) return "inProgress";
  return "notStarted";
}

export function EpicRollup({ run, onDone }: { run: AutoRunRecord; onDone?: () => Promise<void> | void }) {
  const { t } = useAppTranslation();
  const { execute, pending } = useAsyncAction();
  const rollup = run.childRollup;
  const children = run.childIssues ?? [];
  if (!children.length) return null;

  // One-click start of a not-started child (S5.1 op optimization): reuses the
  // normal auto-run pipeline (its own approval gate + all brakes). The human picks
  // WHICH and WHEN — children are dependency-ordered, so a blanket "run all" would
  // conflict; this runs exactly the one you choose. Spends agent quota.
  const runChild = async (item: { number: number; title?: string | null }) => {
    if (!run.projectId) return;
    const ok = await execute(() => api.startAutoRun(run.projectId as string, {
      link: { type: "issue", number: item.number, title: item.title ?? `issue #${item.number}`, url: null, state: "open" },
      name: `child-${item.number}`,
    }));
    if (ok) void onDone?.();
  };
  const total = rollup?.total ?? children.length;
  const done = rollup?.done ?? rollup?.merged ?? 0;
  const started = rollup?.started ?? 0;

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-2">
      <span className="flex items-center gap-1 text-xs font-medium text-foreground/80">
        <GitFork className="size-3.5" /> {t("autoRunActions.epicChildren")} — {done}/{total} {t("autoRunActions.done")} · {started} {t("autoRunActions.started")}
        {rollup?.redundant ? <span className="text-amber-600 dark:text-amber-400"> · {rollup.redundant} {t("autoRunActions.redundant")}</span> : null}
      </span>
      <ul className="flex flex-col gap-0.5">
        {(rollup?.items ?? children.map((c) => ({ number: c.number, title: c.title, status: null, prState: null, issueState: null, done: false, redundant: false }))).map((item) => {
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
              {item.redundant ? <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] text-amber-700 dark:text-amber-300" title={t("autoRunActions.redundantHint")}>{t("autoRunActions.redundant")}</span> : null}
              {kind === "notStarted" && run.projectId ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void runChild(item)}
                  title={t("autoRunActions.runChildHint")}
                  className="ml-auto flex shrink-0 items-center gap-0.5 rounded border border-border px-1 text-[10px] text-foreground/70 hover:text-foreground disabled:opacity-50"
                >
                  {pending ? <Loader2 className="size-2.5 animate-spin" /> : <Play className="size-2.5" />} {t("autoRunActions.run")}
                </button>
              ) : (
                <span className="ml-auto shrink-0 text-muted-foreground">{item.done || item.issueState === "CLOSED" || item.prState === "MERGED" ? t("autoRunActions.done") : item.status ?? t("autoRunActions.notStarted")}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
