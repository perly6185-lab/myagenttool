import { useCallback, useEffect, useState } from "react";
import { LayoutTemplate, Loader2, Monitor, Tablet, Smartphone } from "lucide-react";
import { api } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

// D3 (issue→UI-design plan): render a design run's mockup artifacts (design/*) in
// the console as a resizable CANVAS. HTML mockups render inside a FULLY sandboxed
// iframe — sandbox="" (no scripts, same-origin, forms, or navigation) plus a
// locked CSP — because the file was authored by an agent and must never become an
// XSS/exfil vector. The viewport toggle resizes the frame so the mockup's
// responsive behaviour is visible; rendered PNGs / text render as-is.

interface FileResponse {
  path: string;
  content: string;
  truncated: boolean;
  encoding?: "utf8" | "base64";
  mime?: string;
}

type Viewport = "desktop" | "tablet" | "mobile";
const VIEWPORTS: { key: Viewport; label: string; width: string; icon: typeof Monitor }[] = [
  { key: "desktop", label: "Desktop", width: "100%", icon: Monitor },
  { key: "tablet", label: "Tablet", width: "768px", icon: Tablet },
  { key: "mobile", label: "Mobile", width: "375px", icon: Smartphone },
];

export function DesignPanel({ worktreeId, artifacts, title }: { worktreeId: string; artifacts: string[]; title?: string }) {
  const { t } = useAppTranslation();
  const [selected, setSelected] = useState(() => artifacts.find((p) => /\.html?$/i.test(p)) ?? artifacts.find((p) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(p)) ?? artifacts[0]);
  const [viewport, setViewport] = useState<Viewport>("desktop");
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
  // The viewport width only means anything for a responsive HTML mockup. A rendered
  // PNG / text artifact must stay full-width — otherwise a stale "Mobile" selection
  // (its toggle is hidden for non-HTML) would silently clamp the screenshot to 375px.
  const frameWidth = isHtml ? (VIEWPORTS.find((v) => v.key === viewport)?.width ?? "100%") : "100%";

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-xs font-medium text-foreground/80">
            <LayoutTemplate className="size-3.5" /> {title ?? t("autoRunActions.designArtifacts")}
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
        {isHtml ? (
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5" role="group" aria-label={t("autoRunActions.previewViewport")}>
            {VIEWPORTS.map((v) => {
              const Ico = v.icon;
              const on = viewport === v.key;
              return (
                <button
                  key={v.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setViewport(v.key)}
                  title={t(`autoRunActions.viewport.${v.key}` as never)}
                  className={cn("flex items-center gap-1 rounded px-2 py-1 text-[11px]", on ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  <Ico className="size-3.5" />
                  <span className="hidden sm:inline">{t(`autoRunActions.viewport.${v.key}` as never)}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {state === "loading" ? (
        <span className="flex items-center gap-1 px-1 py-6 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> {t("autoRunActions.loadingMockup")}</span>
      ) : state === "error" ? (
        <span className="px-1 py-2 text-xs text-red-600 dark:text-red-400">{t("autoRunActions.artifactUnavailable")}</span>
      ) : file ? (
        <>
          {/* A stage so the artboard reads as an artboard; the device frame resizes to the viewport. */}
          <div className="flex justify-center rounded-md border border-border bg-muted/40 p-3">
            <div
              className="w-full overflow-hidden rounded-md border border-border bg-white shadow-sm transition-[max-width] duration-300 motion-reduce:transition-none"
              style={{ maxWidth: frameWidth }}
            >
              {isImage ? (
                // D5 (visual acceptance): rendered PNG — base64 data URI, no network, no script.
                <img alt={file.path} src={`data:${file.mime};base64,${file.content}`} className="w-full bg-white object-contain" />
              ) : isHtml ? (
                <>
                  {/* browser chrome so the resized frame reads as a real viewport */}
                  <div className="flex items-center gap-1.5 border-b border-border bg-muted/40 px-2.5 py-1.5">
                    <span className="size-2 rounded-full bg-border" />
                    <span className="size-2 rounded-full bg-border" />
                    <span className="size-2 rounded-full bg-border" />
                    <span className="ml-1.5 flex-1 truncate rounded border border-border bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{selected?.replace(/^design\//, "")}</span>
                  </div>
                  {/* sandbox="" blocks scripts / same-origin / forms / navigation; the injected
                      CSP (default-src 'none') also blocks passive subresource beacons. We inject
                      it ourselves — never trust the agent to include it. (audit) */}
                  <iframe
                    title={file.path}
                    sandbox=""
                    srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">${file.content}`}
                    className="h-[30rem] w-full bg-white"
                  />
                </>
              ) : (
                <pre className="max-h-[30rem] overflow-auto bg-background p-2 font-mono text-[11px] leading-snug">{file.content}</pre>
              )}
            </div>
          </div>
          {file.truncated ? <span className="text-[11px] text-muted-foreground">{t("autoRunActions.artifactTruncated")}</span> : null}
        </>
      ) : null}
    </div>
  );
}
