import { useState } from "react";
import { FilePen, FileText, FolderGit2, GitBranch, Eye, Loader2, ScrollText } from "lucide-react";

import { api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useUiStore } from "@/store/ui-store";
import { displayPath, reconcileFileLedger } from "./file-ledger";
import type { AutoRunRecord } from "./auto-run-model";

export interface WorktreeDiff {
  files: { path: string; untracked?: boolean }[];
  base: string;
  diff: string;
  truncated: boolean;
}
// A diff can be up to the server's ~1MB cap (tens of thousands of lines). Render
// at most DIFF_MAX_LINES DOM nodes — without a cap a big diff mounts 20k+ divs
// synchronously and freezes the tab the moment a human clicks "Show changes".
const DIFF_MAX_LINES = 800;

// Unified diff with minimal +/- colouring, scrollable so a big diff never blows
// out the dialog. Gives the human the actual change to review without leaving
// for GitHub.
export function AutoRunDiffLines({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  const shown = lines.slice(0, DIFF_MAX_LINES);
  const hidden = lines.length - shown.length;
  return (
    <div className="flex flex-col gap-1">
      <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-[11px] leading-relaxed">
        {shown.map((ln, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre",
              ln.startsWith("+") && !ln.startsWith("+++") && "text-emerald-600 dark:text-emerald-400",
              ln.startsWith("-") && !ln.startsWith("---") && "text-red-600 dark:text-red-400",
              (ln.startsWith("@@") || ln.startsWith("diff ") || ln.startsWith("index ")) && "text-muted-foreground",
            )}
          >
            {ln || " "}
          </div>
        ))}
      </pre>
      {hidden > 0 ? (
        <span className="text-xs text-muted-foreground">
          {hidden.toLocaleString()} more line{hidden === 1 ? "" : "s"} not shown — open the PR to see the full diff.
        </span>
      ) : null}
    </div>
  );
}

// Durable, status-independent diff peek for a run's worktree. MergeControl has an
// identical peek, but it unmounts the instant the PR merges — yet the auto-run
// worktree is preserved and GET /api/worktrees/:id/diff still serves it, so this
// keeps "what did this run change?" answerable AFTER merge too (browsability G1).
export function AutoRunWorktreeDiffPeek({ worktreeId }: { worktreeId: string }) {
  const { t } = useAppTranslation();
  const [show, setShow] = useState(false);
  const [diff, setDiff] = useState<WorktreeDiff | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error" | "done">("idle");
  async function toggle() {
    if (show) {
      setShow(false);
      return;
    }
    setShow(true);
    if (diff || state === "loading") return;
    setState("loading");
    try {
      setDiff((await api.worktreeDiff(worktreeId)) as WorktreeDiff);
      setState("done");
    } catch {
      setState("error");
    }
  }
  return (
    <div className="flex w-full flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
      >
        <GitBranch className="size-3" /> {t(show ? "autoRunDetail.hideChanges" : "autoRunDetail.showChanges")}
        {diff ? ` (${diff.files.length} file${diff.files.length === 1 ? "" : "s"}${diff.truncated ? ", truncated" : ""})` : ""}
      </button>
      {show ? (
        state === "loading" ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> {t("autoRunDetail.loadingDiff")}</span>
        ) : state === "error" ? (
          <span className="text-xs text-red-600 dark:text-red-400">{t("autoRunDetail.diffUnavailable")}</span>
        ) : diff && diff.diff ? (
          <AutoRunDiffLines diff={diff.diff} />
        ) : (
          <span className="text-xs text-muted-foreground">{t("autoRunDetail.noChanges")}</span>
        )
      ) : null}
    </div>
  );
}

// Which files the agent READ vs WROTE this run. Writes already show in the git diff,
// but a file the agent only *read* leaves no other trace — captured from its tool_use
// stream (server accumulates invocation.fileLedger). On expand we fetch the diff once
// to cross-check writes: a write not in the diff was a no-op edit; a changed file with
// no tracked write came from outside the explicit file tools (e.g. a Bash command).
export function AutoRunFilesPeek({ invocationId, worktreeId }: { invocationId: string; worktreeId?: string | null }) {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const [show, setShow] = useState(false);
  const [changed, setChanged] = useState<string[] | null>(null);
  const invocation = (state?.invocations ?? []).find((i) => i.id === invocationId) ?? null;
  const ledger = invocation?.fileLedger ?? null;
  const total = (ledger?.reads?.length ?? 0) + (ledger?.writes?.length ?? 0);
  async function toggle() {
    if (show) {
      setShow(false);
      return;
    }
    setShow(true);
    if (changed != null || !worktreeId) return;
    try {
      const diff = (await api.worktreeDiff(worktreeId)) as { files?: { path: string }[] };
      setChanged((diff.files ?? []).map((f) => f.path));
    } catch {
      setChanged([]); // best-effort: no cross-check, still show the lists
    }
  }
  if (!ledger || total === 0) return null; // nothing captured (e.g. a non-Claude agent) → hide
  const view = reconcileFileLedger(ledger, changed);
  return (
    <div className="flex w-full flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
      >
        <FileText className="size-3" /> {t(show ? "autoRunDetail.hideFiles" : "autoRunDetail.files")} ({t("autoRunDetail.fileCounts", { written: view.writeCount, read: view.readCount })}
        {view.truncated ? "+" : ""})
      </button>
      {show ? (
        <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/30 p-2">
          {view.writeCount > 0 ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("autoRunDetail.wrote")}</span>
              <ul className="flex flex-col gap-0.5">
                {view.writes.map((w) => (
                  <li key={w.path} className="flex items-center gap-1.5 font-mono text-xs" title={w.path}>
                    <FilePen className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span className="truncate">{displayPath(w.path)}</span>
                    {w.inDiff === false ? <span className="shrink-0 text-[10px] text-muted-foreground">({t("autoRunDetail.noChange")})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {view.readCount > 0 ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("autoRunDetail.read")}</span>
              <ul className="flex flex-col gap-0.5">
                {view.reads.map((p) => (
                  <li key={p} className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground" title={p}>
                    <Eye className="size-3 shrink-0" />
                    <span className="truncate">{displayPath(p)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {view.diffOnly.length > 0 ? (
            <span className="text-[11px] text-muted-foreground">
              {t("autoRunDetail.outsideTools", { count: view.diffOnly.length })}
            </span>
          ) : null}
          {view.truncated ? <span className="text-[11px] text-muted-foreground">{t("autoRunDetail.listTruncated")}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// Inward traceability from a run: jump to its agent transcript (invocationId) and
// its worktree in the workspace (files + full diff). The IDs are already on the
// record + wire; the console previously only linked OUTWARD to GitHub.
export function AutoRunTraceLinks({ run }: { run: AutoRunRecord }) {
  const { t } = useAppTranslation();
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSelectedWorktreeId = useUiStore((s) => s.setSelectedWorktreeId);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  if (!run.invocationId && !run.worktreeId) return null;
  return (
    <>
      {run.invocationId ? (
        <button
          type="button"
          onClick={() => {
            setSelectedInvocationId(run.invocationId ?? null);
            setSection("invocations");
          }}
          className="inline-flex items-center gap-1 hover:text-foreground"
          title={t("autoRunDetail.transcriptHint")}
        >
          <ScrollText className="size-3" /> {t("autoRunDetail.transcript")}
        </button>
      ) : null}
      {run.worktreeId ? (
        <button
          type="button"
          onClick={() => {
            if (run.projectId) setSelectedProjectId(run.projectId);
            setSelectedWorktreeId(run.worktreeId ?? null);
            setSection("projects");
          }}
          className="inline-flex items-center gap-1 hover:text-foreground"
          title={t("autoRunDetail.workspaceHint")}
        >
          <FolderGit2 className="size-3" /> {t("autoRunDetail.workspace")}
        </button>
      ) : null}
    </>
  );
}
