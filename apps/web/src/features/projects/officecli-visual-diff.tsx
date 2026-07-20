import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/data/use-console-actions";

// Visual before/after review for an OfficeCLI write in a worktree (#1349 polish):
// render the document as it is in the project BASE (before) and in the WORKTREE
// (after), side by side, via the read-only officecli-preview route. This is the
// visual counterpart to the text file diff — reviewable before promotion. A
// newly-added document has no base version (the before render 404s → "new").

interface PreviewResponse {
  path: string;
  content: string;
  mime: string;
  encoding: string;
  bytes: number;
}

type Side = { state: "loading" | "done" | "error" | "absent"; html: string | null };

// The console injects the CSP itself — never trust the rendered document to. sandbox=""
// blocks scripts/same-origin/forms/navigation; default-src 'none' blocks subresources.
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`;

// Single-pane rendered view of ONE Office document (the worktree version) — the
// content view for a .docx/.xlsx/.pptx, so clicking it browses the rendered
// document instead of raw OOXML bytes (which read as garbage in a code view).
export function OfficecliFilePreview({ projectId, worktreeId, path }: { projectId: string; worktreeId: string; path: string }) {
  const [side, setSide] = useState<Side>({ state: "loading", html: null });
  const load = useCallback(async () => {
    setSide({ state: "loading", html: null });
    try {
      const r = (await api.officecliPreview(projectId, path, worktreeId)) as PreviewResponse;
      setSide({ state: "done", html: r.content });
    } catch {
      setSide({ state: "error", html: null });
    }
  }, [projectId, worktreeId, path]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="shrink-0 border-b border-border px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">{path} · rendered</div>
      {side.state === "loading" ? (
        <span className="flex items-center gap-1 px-2 py-6 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> rendering…</span>
      ) : side.state === "error" ? (
        <span className="px-2 py-6 text-xs text-red-600 dark:text-red-400">Preview unavailable — the document may not render, or officecli is not installed.</span>
      ) : (
        <iframe title={path} sandbox="" srcDoc={`${CSP}${side.html ?? ""}`} className="h-full min-h-[24rem] w-full bg-white" />
      )}
    </div>
  );
}

export function OfficecliVisualDiff({ projectId, worktreeId, path }: { projectId: string; worktreeId: string; path: string }) {
  const [before, setBefore] = useState<Side>({ state: "loading", html: null });
  const [after, setAfter] = useState<Side>({ state: "loading", html: null });

  const load = useCallback(async () => {
    // After = the worktree's rendered version.
    setAfter({ state: "loading", html: null });
    try {
      const r = (await api.officecliPreview(projectId, path, worktreeId)) as PreviewResponse;
      setAfter({ state: "done", html: r.content });
    } catch {
      setAfter({ state: "error", html: null });
    }
    // Before = the project base version — absent for a document newly added in the worktree.
    setBefore({ state: "loading", html: null });
    try {
      const r = (await api.officecliPreview(projectId, path)) as PreviewResponse;
      setBefore({ state: "done", html: r.content });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setBefore({ state: /not.?found|does not exist/i.test(msg) ? "absent" : "error", html: null });
    }
  }, [projectId, worktreeId, path]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
      <Pane title="Before · base" side={before} path={path} absentLabel="New document — no prior version to compare." />
      <Pane title="After · worktree" side={after} path={path} />
    </div>
  );
}

function Pane({ title, side, path, absentLabel }: { title: string; side: Side; path: string; absentLabel?: string }) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="shrink-0 border-b border-border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">{title}</div>
      {side.state === "loading" ? (
        <span className="flex items-center gap-1 px-2 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> rendering…
        </span>
      ) : side.state === "absent" ? (
        <span className="px-2 py-6 text-xs text-muted-foreground">{absentLabel ?? "No version."}</span>
      ) : side.state === "error" ? (
        <span className="px-2 py-6 text-xs text-red-600 dark:text-red-400">Preview unavailable — the document may not render, or officecli is not installed.</span>
      ) : (
        <iframe
          title={`${title}: ${path}`}
          sandbox=""
          srcDoc={`${CSP}${side.html ?? ""}`}
          className="h-full min-h-[24rem] w-full bg-white"
        />
      )}
    </div>
  );
}
