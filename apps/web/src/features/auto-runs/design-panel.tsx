import { useCallback, useEffect, useState } from "react";
import { LayoutTemplate, Loader2 } from "lucide-react";
import { api } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";

// D3 (issue→UI-design plan): render a design run's mockup artifacts (design/*)
// in the console. HTML mockups render inside a FULLY sandboxed iframe —
// sandbox="" (no scripts, no same-origin, no forms/popups) — because the file
// was authored by an agent and must never become an XSS vector in the console.
// Non-HTML artifacts render as plain monospace text.

interface FileResponse {
  path: string;
  content: string;
  truncated: boolean;
  encoding?: "utf8" | "base64";
  mime?: string;
}

export function DesignPanel({ worktreeId, artifacts, title = "Design artifacts" }: { worktreeId: string; artifacts: string[]; title?: string }) {
  const [selected, setSelected] = useState(() => artifacts.find((p) => /\.html?$/i.test(p)) ?? artifacts.find((p) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(p)) ?? artifacts[0]);
  const [file, setFile] = useState<FileResponse | null>(null);
  const [state, setState] = useState<"loading" | "error" | "done">("loading");

  const load = useCallback(async (path: string) => {
    setState("loading");
    try {
      setFile((await api.readWorktreeFile(worktreeId, path)) as FileResponse);
      setState("done");
    } catch {
      setFile(null);
      setState("error");
    }
  }, [worktreeId]);

  useEffect(() => {
    if (selected) void load(selected);
  }, [selected, load]);

  if (!artifacts.length) return null;
  const isHtml = Boolean(selected && /\.html?$/i.test(selected));
  const isImage = file?.encoding === "base64" && Boolean(file?.mime?.startsWith("image/"));

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 text-xs font-medium text-foreground/80">
          <LayoutTemplate className="size-3.5" /> {title}
        </span>
        {artifacts.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setSelected(p)}
            className={cn(
              "rounded-md border px-2 py-0.5 text-[11px]",
              p === selected ? "border-primary/50 bg-primary/10 font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground",
            )}
            title={p}
          >
            {p.replace(/^design\//, "")}
          </button>
        ))}
      </div>
      {state === "loading" ? (
        <span className="flex items-center gap-1 px-1 py-6 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> loading mockup…</span>
      ) : state === "error" ? (
        <span className="px-1 py-2 text-xs text-red-600 dark:text-red-400">Artifact unavailable — the worktree may have been torn down.</span>
      ) : file ? (
        <>
          {isImage ? (
            // D5 (visual acceptance): screenshots / rendered mockups. Base64 data
            // URI — no network, no script; the console just paints the pixels.
            <img
              alt={file.path}
              src={`data:${file.mime};base64,${file.content}`}
              className="max-h-96 w-full rounded-md border border-border bg-white object-contain"
            />
          ) : isHtml ? (
            // sandbox="" blocks scripts / same-origin / forms / navigation, but
            // does NOT stop passive subresource loads (<img>, <link>, @font-face)
            // — an agent-authored mockup could beacon a secret to an external
            // host. Prepend a locked CSP (matches the prompt's "inline CSS only,
            // no external resources" contract) so the iframe is truly inert. We
            // inject it ourselves — never trust the agent to include it. (audit)
            <iframe
              title={file.path}
              sandbox=""
              srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">${file.content}`}
              className="h-96 w-full rounded-md border border-border bg-white"
            />
          ) : (
            <pre className="max-h-96 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[11px] leading-snug">{file.content}</pre>
          )}
          {file.truncated ? <span className="text-[11px] text-muted-foreground">Artifact truncated at 512KB.</span> : null}
        </>
      ) : null}
    </div>
  );
}
