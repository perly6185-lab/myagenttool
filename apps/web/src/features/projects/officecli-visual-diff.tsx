import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, X } from "lucide-react";
import { api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { DocxParagraphEditor } from "@/features/projects/docx-paragraph-editor";

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
// With `editable`, an inline Edit panel runs a governed, worktree-scoped `set`
// (mint approval grant → invoke → re-render). The document render is a sandboxed
// static iframe, so editing is a small path+value form, not click-in-the-doc.
export function OfficecliFilePreview({ projectId, worktreeId, path, editable = false }: { projectId: string; worktreeId: string; path: string; editable?: boolean }) {
  const [side, setSide] = useState<Side>({ state: "loading", html: null });
  const [editing, setEditing] = useState(false);
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
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{path} · rendered</span>
        {editable ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] hover:bg-accent"
          >
            {editing ? <X className="size-3" /> : <Pencil className="size-3" />}
            {editing ? "Close" : "Edit"}
          </button>
        ) : null}
      </div>
      {editing && /\.docx$/i.test(path) ? (
        // A .docx gets the paragraph-level editor (full-document text editing that
        // maps to surgical, governed set — no formatting loss). It IS the edit
        // surface, so the static render below is hidden while editing.
        <DocxParagraphEditor projectId={projectId} worktreeId={worktreeId} file={path} onChanged={load} />
      ) : (
        <>
          {editing ? (
            <OfficecliInlineEdit projectId={projectId} worktreeId={worktreeId} file={path} onApplied={load} />
          ) : null}
          {side.state === "loading" ? (
            <span className="flex items-center gap-1 px-2 py-6 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> rendering…</span>
          ) : side.state === "error" ? (
            <span className="px-2 py-6 text-xs text-red-600 dark:text-red-400">Preview unavailable — the document may not render, or officecli is not installed.</span>
          ) : (
            <iframe title={path} sandbox="" srcDoc={`${CSP}${side.html ?? ""}`} className="h-full min-h-[24rem] w-full bg-white" />
          )}
        </>
      )}
    </div>
  );
}

// The inline edit form: a governed, worktree-scoped `officecli set` (mint a
// single-use approval grant → invoke the write → watch the invocation → re-render
// on success). No raw bytes, no argv — a path + property + value.
function OfficecliInlineEdit({ projectId, worktreeId, file, onApplied }: { projectId: string; worktreeId: string; file: string; onApplied: () => void }) {
  const { data: state } = useConsoleState();
  const [form, setForm] = useState({ elementPath: "", property: "value", value: "" });
  const [status, setStatus] = useState<"idle" | "applying" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [invId, setInvId] = useState<string | null>(null);

  const canApply = form.elementPath.trim() !== "" && form.property.trim() !== "" && status !== "applying";

  const apply = useCallback(async () => {
    setStatus("applying");
    setError(null);
    try {
      // A single-use grant for this write action, then the governed invoke.
      const grant = (await api.issueApprovalGrant("wrapper:set", "app_officecli")) as { token: string };
      const body: Record<string, unknown> = {
        projectId,
        worktreeId,
        file,
        path: form.elementPath.trim(),
        props: { [form.property.trim()]: form.value },
        approvalToken: grant.token,
      };
      const res = (await api.invokeCapability("app.app_officecli.apply.set", body as Record<string, string>)) as { invocationId?: string };
      if (res?.invocationId) setInvId(res.invocationId);
      else throw new Error("The write was not accepted.");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId, worktreeId, file, form]);

  // Watch the invocation to completion (console state polls it), then re-render.
  useEffect(() => {
    if (!invId || status !== "applying") return;
    const inv = (state?.invocations ?? []).find((i) => i.id === invId);
    if (!inv?.status) return;
    if (inv.status === "succeeded") {
      setStatus("idle");
      setInvId(null);
      setForm((f) => ({ ...f, value: "" }));
      onApplied();
    } else if (inv.status === "failed" || inv.status === "rejected") {
      setStatus("error");
      setInvId(null);
      setError("The write was refused (approval, worktree, or an invalid path/value).");
    }
  }, [state?.invocations, invId, status, onApplied]);

  return (
    <div className="shrink-0 space-y-2 border-b border-border bg-muted/30 p-2.5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_0.8fr_1.4fr]">
        <input
          value={form.elementPath}
          onChange={(e) => setForm((f) => ({ ...f, elementPath: e.target.value }))}
          placeholder="element path, e.g. /Sheet1/A1"
          className="min-w-0 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
          spellCheck={false}
        />
        <input
          value={form.property}
          onChange={(e) => setForm((f) => ({ ...f, property: e.target.value }))}
          placeholder="property (value / text / bold)"
          className="min-w-0 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
          spellCheck={false}
        />
        <input
          value={form.value}
          onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
          placeholder="new value"
          className="min-w-0 rounded-md border border-border bg-background px-2 py-1 text-xs"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canApply}
          onClick={() => void apply()}
          className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium disabled:opacity-50"
        >
          {status === "applying" ? "Applying…" : "Apply (governed write)"}
        </button>
        <span className="text-[11px] text-muted-foreground">
          {status === "error" ? <span className="text-red-600 dark:text-red-400">{error}</span> : "Approval-gated · lands in this worktree · review before promote."}
        </span>
      </div>
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
