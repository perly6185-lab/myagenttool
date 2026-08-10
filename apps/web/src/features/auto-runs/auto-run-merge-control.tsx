import { useState } from "react";
import { Check, CircleAlert, GitBranch, GitMerge, Loader2, Minus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { api, useAsyncAction } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { Tone } from "@/lib/readable-labels";
import { AutoRunDiffLines, type WorktreeDiff } from "./auto-run-artifacts";
import { mergeRisk, postureRows, type AutoRunRecord, type PostureState } from "./auto-run-model";

const RISK_TONE: Record<"low" | "medium" | "high", Tone> = { low: "success", medium: "warning", high: "danger" };

function RiskBadge({ level, reasons }: { level: "low" | "medium" | "high"; reasons?: string[] }) {
  const { t } = useAppTranslation();
  return (
    <Badge tone={RISK_TONE[level]} title={reasons && reasons.length ? reasons.join("; ") : t("autoRuns.mergeRisk", { level: t(`labels.risk.${level}`) })}>
      {t("autoRuns.risk")}: {t(`labels.risk.${level}`)}
    </Badge>
  );
}
function checksChip(pc: AutoRunRecord["prChecks"]): { label: string; tone: Tone } {
  if (!pc || pc.total === 0) return { label: "no checks", tone: "neutral" };
  if (pc.state === "FAILURE") return { label: `checks ✗${pc.failed}`, tone: "danger" };
  if (pc.state === "PENDING") return { label: `checks ${pc.pending} pending`, tone: "warning" };
  return { label: `checks ${pc.passed}✓`, tone: "success" };
}

function PostureIcon({ state }: { state: PostureState }) {
  if (state === "ok") return <Check className="size-3.5" />;
  if (state === "bad") return <X className="size-3.5" />;
  if (state === "warn") return <CircleAlert className="size-3.5" />;
  return <Minus className="size-3.5" />;
}



// The merge moment — the one human decision in the autonomous loop. Replaces the
// blank window.confirm with an informed dialog: refreshes PR checks on open (so
// the shown posture matches the server's require-green gate), lets the human peek
// the diff, disables while the merge runs, and surfaces the REAL failure reason
// instead of swallowing it. Merge stays a human click.
export function AutoRunMergeControl({ run, onDone }: { run: AutoRunRecord; onDone: (refresh?: boolean) => Promise<void> | void }) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState<WorktreeDiff | null>(null);
  const [diffState, setDiffState] = useState<"idle" | "loading" | "error" | "done">("idle");
  const { execute, pending, error, reset } = useAsyncAction();
  const chip = checksChip(run.prChecks);
  // The server computes the authoritative risk level; fall back to the local
  // heuristic only if the field is absent (older payloads).
  const level = run.mergeRisk?.level ?? (mergeRisk(run).warn ? "medium" : "low");
  const risk = { warn: level !== "low" };

  const openDialog = async () => {
    // Fresh dialog each open: drop a stale merge error + a stale/expanded diff so
    // a reopen never shows last time's failure banner or an out-of-date diff.
    reset();
    setShowDiff(false);
    setDiff(null);
    setDiffState("idle");
    setOpen(true);
    setRefreshing(true);
    try {
      await onDone(true); // pull fresh checks so the posture matches the server gate
    } finally {
      setRefreshing(false);
    }
  };
  const toggleDiff = async () => {
    const next = !showDiff;
    setShowDiff(next);
    // Fetch on first expand, and allow a retry after a failed fetch.
    if (next && (diffState === "idle" || diffState === "error") && run.worktreeId) {
      setDiffState("loading");
      try {
        setDiff((await api.worktreeDiff(run.worktreeId)) as WorktreeDiff);
        setDiffState("done");
      } catch {
        setDiffState("error");
      }
    }
  };
  const doMerge = async () => {
    const ok = await execute(() => api.mergeAutoRunPr(run.id));
    if (ok) {
      setOpen(false);
      void onDone();
    }
  };

  const primaryVariant = risk.warn ? "secondary" : "primary";
  const colorFor = (s: PostureState) =>
    cn(
      "flex items-center gap-1 text-xs font-medium",
      s === "ok" && "text-emerald-600 dark:text-emerald-400",
      s === "bad" && "text-red-600 dark:text-red-400",
      s === "warn" && "text-amber-600 dark:text-amber-400",
      s === "muted" && "text-muted-foreground",
    );

  return (
    <>
      {run.mergeRisk ? <RiskBadge level={run.mergeRisk.level} reasons={run.mergeRisk.reasons} /> : null}
      <Badge tone={chip.tone} title={t("autoRunDetail.checksHint")}>{chip.label}</Badge>
      <Button
        variant={primaryVariant}
        size="sm"
        className="h-6 px-2 text-xs"
        title={t(risk.warn ? "autoRunDetail.mergeReviewHint" : "autoRunDetail.mergeGreenHint")}
        onClick={() => void openDialog()}
      >
        <GitMerge className={cn("mr-1 size-3", risk.warn && "text-amber-600 dark:text-amber-400")} /> {t("autoRunDetail.merge")}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("autoRunDetail.mergePr", { number: run.prNumber ?? "—" })}
        description={t("autoRunDetail.mergeDescription")}
        closeDisabled={pending}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="truncate">{run.link ? `#${run.link.number} ${run.link.title}` : ""}</span>
            {refreshing ? (
              <span className="flex shrink-0 items-center gap-1"><Loader2 className="size-3 animate-spin" /> {t("autoRunDetail.refreshingChecks")}</span>
            ) : null}
          </div>
          {run.mergeRisk ? (
            <div className="flex items-center gap-2 text-xs">
              <RiskBadge level={run.mergeRisk.level} reasons={run.mergeRisk.reasons} />
              {run.mergeRisk.reasons.length ? <span className="truncate text-muted-foreground">{run.mergeRisk.reasons.join("; ")}</span> : null}
            </div>
          ) : null}
          <ul className="flex flex-col gap-1.5">
            {postureRows(run).map((r) => (
              <li key={r.key} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm">
                <span>{r.label}</span>
                <span className={colorFor(r.state)}><PostureIcon state={r.state} /> {r.detail}</span>
              </li>
            ))}
          </ul>
          {run.worktreeId ? (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => void toggleDiff()}
                className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
              >
                <GitBranch className="size-3" /> {t(showDiff ? "autoRunDetail.hideChanges" : "autoRunDetail.showChanges")}
                {diff ? ` (${diff.files.length} file${diff.files.length === 1 ? "" : "s"}${diff.truncated ? ", truncated" : ""})` : ""}
              </button>
              {showDiff ? (
                diffState === "loading" ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> {t("autoRunDetail.loadingDiff")}</span>
                ) : diffState === "error" ? (
                  <span className="text-xs text-red-600 dark:text-red-400">{t("autoRunDetail.diffRetry")}</span>
                ) : diff && diff.diff ? (
                  <AutoRunDiffLines diff={diff.diff} />
                ) : (
                  <span className="text-xs text-muted-foreground">{t("autoRunDetail.noChanges")}</span>
                )
              ) : null}
            </div>
          ) : null}
          {risk.warn ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {t("autoRunDetail.notVerified")}
            </p>
          ) : (
            <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
              {t("autoRunDetail.verifiedGreen")}
            </p>
          )}
          {error ? (
            <p className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {t("autoRunDetail.mergeFailed")}: {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>{t("autoRunDetail.cancel")}</Button>
            <Button variant={primaryVariant} size="sm" onClick={() => void doMerge()} disabled={pending || refreshing}>
              {pending ? (
                <><Loader2 className="mr-1 size-3.5 animate-spin" /> {t("autoRunDetail.merging")}</>
              ) : (
                <><GitMerge className="mr-1 size-3.5" /> {t(risk.warn ? "autoRunDetail.mergeAnyway" : "autoRunDetail.mergeSquash")}</>
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
