import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Save, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";

// L1 in-app markdown-style editor for a .docx. Two modes over the same document:
//  - Blocks: each <w:p> is a block (heading/text/**bold**/*italic*) with add/
//    delete/reorder controls, keyed on its native paraId — zero alignment risk.
//  - Markdown: the whole document as one markdown textarea; on save the server
//    re-aligns the edited blocks to their original paraIds by content.
// Either way, "Save all" produces ONE governed `apply.batch` — surgical
// set/remove/move/add/run-rebuild. The docx is never regenerated: content the
// projection can't express (tables, images, non-heading styles) is preserved by
// never being touched.

interface Block {
  key: string; // stable local key for React (new blocks have no paraId yet)
  path: string | null; // native OOXML paraId path, or null for a new block
  md: string;
  complex?: boolean; // holds an inline picture/link/field — read-only (editing would destroy it)
}

export function DocxBlockEditor({ projectId, worktreeId, file, onChanged }: { projectId: string; worktreeId: string; file: string; onChanged?: () => void }) {
  const { data: state } = useConsoleState();
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [original, setOriginal] = useState<{ path: string | null; md: string }[]>([]);
  const [mode, setMode] = useState<"blocks" | "markdown">("blocks");
  const [docMd, setDocMd] = useState("");
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
        paragraphs: { path: string; type: string; text: string; style: string | null; md: string; complex?: boolean }[];
      };
      const next = r.paragraphs.map((p) => ({ key: nextKey(), path: p.path, md: p.md, complex: p.complex }));
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

  const baselineMd = useMemo(() => original.map((o) => o.md).join("\n\n"), [original]);
  const dirty = useMemo(() => {
    if (!blocks) return false;
    if (mode === "markdown") return docMd !== baselineMd;
    const now = blocks.map((b) => ({ path: b.path, md: b.md }));
    return JSON.stringify(now) !== JSON.stringify(original);
  }, [blocks, original, mode, docMd, baselineMd]);

  // Blocks -> Markdown seeds the textarea from current blocks; Markdown -> Blocks
  // reloads (unsaved textarea edits are discarded rather than fuzzily re-split).
  const toMarkdown = () => {
    setDocMd((blocks ?? []).map((b) => b.md).join("\n\n"));
    setMode("markdown");
  };
  const toBlocks = () => {
    setMode("blocks");
    void load();
  };

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
      const payload =
        mode === "markdown"
          ? { file, worktree: worktreeId, text: docMd }
          : { file, worktree: worktreeId, blocks: blocks.map((b) => ({ path: b.path, md: b.md })) };
      const { commands } = (await api.officecliBlockOps(projectId, payload)) as {
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
  }, [blocks, projectId, worktreeId, file, load, mode, docMd]);

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
        <div className="flex items-center gap-1 rounded border border-border p-0.5 text-[11px]">
          <button type="button" onClick={toBlocks} className={`rounded px-1.5 py-0.5 ${mode === "blocks" ? "bg-accent font-medium" : "text-muted-foreground"}`}>Blocks</button>
          <button type="button" onClick={toMarkdown} className={`rounded px-1.5 py-0.5 ${mode === "markdown" ? "bg-accent font-medium" : "text-muted-foreground"}`}>Markdown</button>
        </div>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          <code className="font-mono"># </code> heading, <code className="font-mono">**bold**</code>, <code className="font-mono">*italic*</code>{mode === "markdown" ? " — blank line separates paragraphs" : ""}. One governed batch; unedited formatting preserved.
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
      {mode === "markdown" ? (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <textarea
            value={docMd}
            onChange={(e) => setDocMd(e.target.value)}
            className="h-full min-h-[24rem] w-full resize-none rounded border border-border bg-background px-3 py-2 font-mono text-sm leading-relaxed"
            spellCheck
            placeholder="# Heading&#10;&#10;Body paragraph with **bold** and *italic*."
          />
          <p className="px-1 pt-1 text-[11px] text-muted-foreground">
            Edited blocks are re-aligned to their original paragraphs by content, so unchanged paragraphs stay untouched. Review the before/after diff before promoting.
          </p>
        </div>
      ) : (
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
                readOnly={block.complex}
                title={block.complex ? "This paragraph contains an inline image or link and can't be edited as text here — editing would remove it." : undefined}
                className={`w-full resize-y rounded border border-border px-2 py-1 text-sm ${block.complex ? "bg-muted text-muted-foreground" : "bg-background"}`}
                spellCheck={!block.complex}
              />
              {block.complex ? <p className="mt-0.5 px-1 text-[10px] text-muted-foreground/70">contains an inline image or link — read-only (editing here would remove it)</p> : null}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
