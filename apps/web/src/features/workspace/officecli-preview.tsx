import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { OfficeDocumentFrame } from "@/components/common/office-document-frame";

// OfficeCLI preview (P2b): render a project .docx/.xlsx/.pptx to self-contained
// HTML and show it in a sandboxed iframe. The full HTML comes from the dedicated
// read-only route (GET /api/projects/:id/officecli-preview) — full fidelity, no
// 20k cap, never persisted. Self-contained: it takes a project id and a document
// path, so it does not depend on the file-tree's selection plumbing.

interface PreviewResponse {
  path: string;
  content: string;
  mime: string;
  encoding: string;
  bytes: number;
}

const OFFICE_EXT = /\.(docx|xlsx|pptx)$/i;

export function OfficecliPreview({ projectId }: { projectId: string | null }) {
  const [path, setPath] = useState("");
  const [file, setFile] = useState<PreviewResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  // Selecting an Office file in the project tree drives the preview here (#1347).
  const selectedPath = useUiStore((s) => s.officecliPreviewPath);

  const render = useCallback(async (target?: string) => {
    const trimmed = (target ?? path).trim();
    if (!projectId || !trimmed) return;
    setState("loading");
    setError(null);
    try {
      const result = (await api.officecliPreview(projectId, trimmed)) as PreviewResponse;
      setFile(result);
      setState("done");
    } catch (e) {
      setFile(null);
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, [projectId, path]);

  // When a document is chosen in the tree, mirror it into the input and render.
  useEffect(() => {
    if (!selectedPath) return;
    setPath(selectedPath);
    void render(selectedPath);
    // Render only when the selection changes, not on every render() identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, projectId]);

  const valid = OFFICE_EXT.test(path.trim());

  return (
    <section className="flex min-h-0 flex-col gap-2" aria-label="OfficeCLI preview">
      <div className="flex items-center gap-2">
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid) void render();
          }}
          placeholder="Document path, e.g. deck.pptx"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
          spellCheck={false}
        />
        <button
          type="button"
          disabled={!projectId || !valid || state === "loading"}
          onClick={() => void render()}
          className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium disabled:opacity-50"
        >
          Render
        </button>
      </div>
      {path.trim() && !valid ? (
        <p className="px-1 text-[11px] text-muted-foreground">Preview supports .docx, .xlsx, and .pptx.</p>
      ) : null}

      {state === "loading" ? (
        <span className="flex items-center gap-1 px-1 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> rendering…
        </span>
      ) : state === "error" ? (
        <span className="px-1 py-2 text-xs text-red-600 dark:text-red-400">{error ?? "Preview unavailable."}</span>
      ) : file ? (
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-white">
          <OfficeDocumentFrame title={file.path} content={file.content} />
        </div>
      ) : (
        <p className="px-1 py-2 text-[11px] text-muted-foreground">
          Enter a document path and Render to preview it here (rendered by OfficeCLI, read-only).
        </p>
      )}
    </section>
  );
}
