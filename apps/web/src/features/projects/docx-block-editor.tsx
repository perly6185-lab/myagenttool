import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Save, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";

// L1 in-app markdown-style block editor for a .docx (Slice 3). Each block is one
// <w:p>, shown as its markdown source (a `#`-prefixed heading or plain text). A
// human edits block text, adds/deletes/reorders blocks; "Save all" sends the
// edited list to the server, which re-reads the current outline and returns the
// item list for ONE governed `apply.batch` — a surgical set/remove/move/add keyed
// on each block's native paraId path. The docx is never regenerated: content the
// projection can't express (tables, images, runs, non-heading styles) is preserved
// by never being touched.

interface Block {
  key: string; // stable local key for React (new blocks have no paraId yet)
  path: string | null; // native OOXML paraId path, or null for a new block
  md: string;
}

export function DocxBlockEditor({ projectId, worktreeId, file, onChanged }: { projectId: string; worktreeId: string; file: string; onChanged?: () => void }) {
  const { data: state } = useConsoleState();
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [original, setOriginal] = useState<{ path: string | null; md: string }[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "error" | "done">("loading");
  const [saving, setSaving] = useState(false);
  const [invId, setInvId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keySeq = useRef(0);
  const nextKey = () => `b${keySeq.current++}`;

  const load = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const r = (await api.officecliDocOutline(projectId, file, worktreeId)) as {
        paragraphs: { path: string; type: string; text: string; style: string | null; md: string }[];
      };
      const next = r.paragraphs.map((p) => ({ key: nextKey(), path: p.path, md: p.md }));
      setBlocks(next);
      setOriginal(next.map((b) => ({ path: b.path, md: b.md })));
      setLoadState("done");
    } catch {
      setLoadState("error");
    }
  }, [projectId, worktreeId, file]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => {
    if (!blocks) return false;
    const now = blocks.map((b) => ({ path: b.path, md: b.md }));
    return JSON.stringify(now) !== JSON.stringify(original);
  }, [blocks, original]);

  const setMd = (key: string, md: string) => setBlocks((bs) => (bs ? bs.map((b) => (b.key === key ? { ...b, md } : b)) : bs));
  const addBelow = (index: number) =>
    setBlocks((bs) => {
      if (!bs) return bs;
      const copy = [...bs];
      copy.splice(index + 1, 0, { key: nextKey(), path: null, md: "" });
      return copy;
    });
  const removeBlock = (key: string) => setBlocks((bs) => (bs ? bs.filter((b) => b.key !== key) : bs));
  const moveBlock = (index: number, dir: -1 | 1) =>
    setBlocks((bs) => {
      if (!bs) return bs;
      const j = index + dir;
      if (j < 0 || j >= bs.length) return bs;
      const copy = [...bs];
      [copy[index], copy[j]] = [copy[j], copy[index]];
      return copy;
    });

  const save = useCallback(async () => {
    if (!blocks) return;
    setSaving(true);
    setError(null);
    try {
      const edited = blocks.map((b) => ({ path: b.path, md: b.md }));
      const { commands } = (await api.officecliBlockOps(projectId, { file, worktree: worktreeId, blocks: edited })) as {
        commands: Record<string, unknown>[];
      };
      if (!commands.length) {
        // Nothing to apply (e.g. only whitespace touched) — just resync.
        setSaving(false);
        await load();
        return;
      }
      const grant = (await api.issueApprovalGrant("wrapper:batch", "app_officecli")) as { token: string };
      const body: Record<string, unknown> = {
        projectId,
        worktreeId,
        file,
        commands,
        approvalToken: grant.token,
      };
      const res = (await api.invokeCapability("app.app_officecli.apply.batch", body as Record<string, string>)) as { invocationId?: string };
      if (res?.invocationId) setInvId(res.invocationId);
      else throw new Error("The edit was not accepted.");
    } catch (e) {
      setSaving(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [blocks, projectId, worktreeId, file, load]);

  // Watch the batch to completion, then reload the outline (new blocks get real paraIds).
  useEffect(() => {
    if (!invId) return;
    const inv = (state?.invocations ?? []).find((i) => i.id === invId);
    if (!inv?.status) return;
    if (inv.status === "succeeded") {
      setInvId(null);
      setSaving(false);
      void load();
      onChanged?.();
    } else if (inv.status === "failed" || inv.status === "rejected") {
      setInvId(null);
      setSaving(false);
      setError("The edit was refused (approval, worktree, or an invalid value).");
    }
  }, [state?.invocations, invId, load, onChanged]);

  if (loadState === "loading") {
    return <span className="flex items-center gap-1 px-2 py-6 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> loading document…</span>;
  }
  if (loadState === "error" || !blocks) {
    return <span className="px-2 py-6 text-xs text-red-600 dark:text-red-400">Could not read the document — it may not render, or officecli is not installed.</span>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <span className="text-[11px] text-muted-foreground">
          Markdown-style editing — <code className="font-mono"># </code> heading, <code className="font-mono">**bold**</code>, <code className="font-mono">*italic*</code>. Each save is one governed, worktree-scoped batch; unedited formatting is preserved.
        </span>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void save()}
          className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium disabled:opacity-40"
        >
          {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
          {saving ? "Saving…" : "Save all"}
        </button>
      </div>
      {error ? <p className="px-2 pt-1 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-auto p-2">
        {blocks.length === 0 ? (
          <button type="button" onClick={() => addBelow(-1)} className="flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground">
            <Plus className="size-3" /> Add the first paragraph
          </button>
        ) : null}
        {blocks.map((block, index) => {
          const level = /^(#{1,6})\s/.exec(block.md)?.[1].length ?? 0;
          return (
            <div key={block.key} className="rounded-md border border-border bg-card p-1.5">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="font-mono text-[10px] text-muted-foreground">{level > 0 ? `H${level}` : block.path ? "¶" : "new"}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground/50">{block.path ?? "(unsaved)"}</span>
                <button type="button" title="Move up" disabled={index === 0} onClick={() => moveBlock(index, -1)} className="rounded p-0.5 disabled:opacity-30"><ChevronUp className="size-3" /></button>
                <button type="button" title="Move down" disabled={index === blocks.length - 1} onClick={() => moveBlock(index, 1)} className="rounded p-0.5 disabled:opacity-30"><ChevronDown className="size-3" /></button>
                <button type="button" title="Add block below" onClick={() => addBelow(index)} className="rounded p-0.5"><Plus className="size-3" /></button>
                <button type="button" title="Delete block" onClick={() => removeBlock(block.key)} className="rounded p-0.5 text-red-600 dark:text-red-400"><Trash2 className="size-3" /></button>
              </div>
              <textarea
                value={block.md}
                onChange={(e) => setMd(block.key, e.target.value)}
                rows={Math.min(6, Math.max(1, Math.ceil((block.md.length || 1) / 80)))}
                className="w-full resize-y rounded border border-border bg-background px-2 py-1 text-sm"
                spellCheck
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
