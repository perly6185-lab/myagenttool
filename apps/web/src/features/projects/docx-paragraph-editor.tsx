import { useCallback, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";

// Paragraph-level inline editor for a .docx (#1391 follow-up). Reads the body's
// path-addressed paragraphs and lets a human edit each one's text like a document
// — full-document editing feel — while each save is a SURGICAL, governed
// `set <paragraph-path> --prop text=..` scoped to the worktree. Unlike a markdown
// round-trip (which regenerates the whole file and loses formatting), only the
// edited paragraph's text changes; everything else is preserved.

interface Para {
  path: string;
  type: string;
  text: string;
  style: string | null;
}

export function DocxParagraphEditor({ projectId, worktreeId, file, onChanged }: { projectId: string; worktreeId: string; file: string; onChanged?: () => void }) {
  const { data: state } = useConsoleState();
  const [paras, setParas] = useState<Para[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loadState, setLoadState] = useState<"loading" | "error" | "done">("loading");
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const [invId, setInvId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const r = (await api.officecliDocOutline(projectId, file, worktreeId)) as { paragraphs: Para[] };
      setParas(r.paragraphs);
      setDrafts({});
      setLoadState("done");
    } catch {
      setLoadState("error");
    }
  }, [projectId, worktreeId, file]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (para: Para) => {
    const text = drafts[para.path] ?? para.text;
    setSavingPath(para.path);
    setError(null);
    try {
      const grant = (await api.issueApprovalGrant("wrapper:set", "app_officecli")) as { token: string };
      const body: Record<string, unknown> = {
        projectId,
        worktreeId,
        file,
        path: para.path,
        props: { text },
        approvalToken: grant.token,
      };
      const res = (await api.invokeCapability("app.app_officecli.apply.set", body as Record<string, string>)) as { invocationId?: string };
      if (res?.invocationId) setInvId(res.invocationId);
      else throw new Error("The edit was not accepted.");
    } catch (e) {
      setSavingPath(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [drafts, projectId, worktreeId, file]);

  // Watch the write to completion (console state polls it), then reload the outline.
  useEffect(() => {
    if (!invId || !savingPath) return;
    const inv = (state?.invocations ?? []).find((i) => i.id === invId);
    if (!inv?.status) return;
    if (inv.status === "succeeded") {
      setInvId(null);
      setSavingPath(null);
      void load();
      onChanged?.();
    } else if (inv.status === "failed" || inv.status === "rejected") {
      setInvId(null);
      setSavingPath(null);
      setError("The edit was refused (approval, worktree, or an invalid value).");
    }
  }, [state?.invocations, invId, savingPath, load, onChanged]);

  if (loadState === "loading") {
    return <span className="flex items-center gap-1 px-2 py-6 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> loading paragraphs…</span>;
  }
  if (loadState === "error" || !paras) {
    return <span className="px-2 py-6 text-xs text-red-600 dark:text-red-400">Could not read the document — it may not render, or officecli is not installed.</span>;
  }
  if (paras.length === 0) {
    return <span className="px-2 py-6 text-xs text-muted-foreground">This document has no paragraphs yet.</span>;
  }

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
      {error ? <p className="px-1 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      {paras.map((para) => {
        const draft = drafts[para.path] ?? para.text;
        const dirty = draft !== para.text;
        const saving = savingPath === para.path;
        return (
          <div key={para.path} className="rounded-md border border-border bg-card p-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">{para.style ?? "Normal"}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground/60">{para.path}</span>
              {dirty ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save(para)}
                  className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium disabled:opacity-50"
                >
                  {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                  {saving ? "Saving…" : "Save"}
                </button>
              ) : null}
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDrafts((d) => ({ ...d, [para.path]: e.target.value }))}
              rows={Math.min(6, Math.max(1, Math.ceil(draft.length / 80)))}
              className="w-full resize-y rounded border border-border bg-background px-2 py-1 text-sm"
              spellCheck
            />
          </div>
        );
      })}
      <p className="px-1 pt-1 text-[11px] text-muted-foreground">
        Each save is a governed, worktree-scoped write (approval-gated). Only the edited paragraph's text changes — the document's formatting is preserved.
      </p>
    </div>
  );
}
