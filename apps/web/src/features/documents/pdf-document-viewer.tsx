import { useEffect, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, Loader2, Maximize2, Search, ZoomIn, ZoomOut } from "lucide-react";
import { api } from "@/data/use-console-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SearchHit = { page: number; occurrence: number };

export function PdfDocumentViewer({ projectId, path, worktreeId }: { projectId: string; path: string; worktreeId?: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const searchGeneration = useRef(0);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1.25);
  const [fitWidth, setFitWidth] = useState(true);
  const [containerWidth, setContainerWidth] = useState(0);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeHit, setActiveHit] = useState(-1);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setStatus("loading"); setError(""); setDocument(null); setPage(1); setHits([]); setActiveHit(-1);
    void (async () => {
      try {
        const [pdfjs, data] = await Promise.all([import("pdfjs-dist"), api.projectPdfData(projectId, path, worktreeId ?? undefined)]);
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });
        const loaded = await loadingTask.promise;
        if (!cancelled) setDocument(loaded);
      } catch (caught) {
        if (!cancelled) { setError(caught instanceof Error ? caught.message : "PDF preview failed."); setStatus("error"); }
      }
    })();
    return () => { cancelled = true; searchGeneration.current += 1; renderTaskRef.current?.cancel(); void loadingTask?.destroy(); };
  }, [projectId, path, worktreeId]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = () => setContainerWidth(element.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    renderTaskRef.current?.cancel();
    setStatus("loading"); setError("");
    void (async () => {
      try {
        const pdfPage = await document.getPage(page);
        if (cancelled) return;
        const natural = pdfPage.getViewport({ scale: 1 });
        const scale = fitWidth && containerWidth > 32 ? Math.max(0.25, (containerWidth - 32) / natural.width) : zoom;
        const viewport = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
        const task = pdfPage.render({ canvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
        renderTaskRef.current = task;
        await task.promise;
        if (!cancelled) setStatus("ready");
      } catch (caught) {
        if (!cancelled && (caught as { name?: string })?.name !== "RenderingCancelledException") {
          setError(caught instanceof Error ? caught.message : "PDF page rendering failed."); setStatus("error");
        }
      }
    })();
    return () => { cancelled = true; renderTaskRef.current?.cancel(); };
  }, [document, page, zoom, fitWidth, containerWidth]);

  const changeZoom = (next: number) => { setFitWidth(false); setZoom(Math.min(4, Math.max(0.25, next))); };
  const search = async () => {
    const needle = query.trim().toLocaleLowerCase();
    const generation = ++searchGeneration.current;
    setHits([]); setActiveHit(-1);
    if (!document || !needle) { setSearching(false); return; }
    setSearching(true);
    const found: SearchHit[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const pdfPage = await document.getPage(pageNumber);
        const content = await pdfPage.getTextContent();
        if (generation !== searchGeneration.current) return;
        const text = content.items.map((item) => "str" in item ? item.str : "").join(" ").toLocaleLowerCase();
        let offset = 0; let occurrence = 0;
        while ((offset = text.indexOf(needle, offset)) !== -1) { found.push({ page: pageNumber, occurrence: ++occurrence }); offset += Math.max(needle.length, 1); }
      }
      if (generation !== searchGeneration.current) return;
      setHits(found);
      if (found.length) { setActiveHit(0); setPage(found[0].page); }
    } finally { if (generation === searchGeneration.current) setSearching(false); }
  };
  const nextHit = () => {
    if (!hits.length) return;
    const next = (activeHit + 1) % hits.length;
    setActiveHit(next); setPage(hits[next].page);
  };

  const pageCount = document?.numPages ?? 0;
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1.5" aria-label="PDF controls">
      <Button size="icon" variant="ghost" aria-label="Previous page" disabled={!document || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft /></Button>
      <span className="min-w-20 text-center text-xs">{pageCount ? `${page} / ${pageCount}` : "– / –"}</span>
      <Button size="icon" variant="ghost" aria-label="Next page" disabled={!document || page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight /></Button>
      <span className="mx-1 h-5 w-px bg-border" />
      <Button size="icon" variant="ghost" aria-label="Zoom out" disabled={!document || (!fitWidth && zoom <= 0.25)} onClick={() => changeZoom((fitWidth ? 1 : zoom) - 0.25)}><ZoomOut /></Button>
      <span className="min-w-12 text-center text-xs">{fitWidth ? "Fit" : `${Math.round(zoom * 100)}%`}</span>
      <Button size="icon" variant="ghost" aria-label="Zoom in" disabled={!document || (!fitWidth && zoom >= 4)} onClick={() => changeZoom((fitWidth ? 1 : zoom) + 0.25)}><ZoomIn /></Button>
      <Button size="sm" variant={fitWidth ? "secondary" : "ghost"} aria-label="Fit width" disabled={!document} onClick={() => setFitWidth(true)}><Maximize2 className="mr-1 size-3.5" /> Fit width</Button>
      <form className="ml-auto flex min-w-48 items-center gap-1" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <label className="relative flex-1"><Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" /><Input aria-label="Search PDF text" value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 pl-7" placeholder="Search PDF…" /></label>
        <Button size="sm" variant="secondary" type="submit" disabled={!document || searching}>{searching ? "Searching…" : "Find"}</Button>
        <Button size="sm" variant="ghost" type="button" disabled={!hits.length} onClick={nextHit}>Next</Button>
        <span className="min-w-12 text-right text-[11px] text-muted-foreground">{hits.length ? `${activeHit + 1}/${hits.length}` : query.trim() && !searching ? "0 results" : ""}</span>
      </form>
    </div>
    <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-auto bg-muted/50 p-4" aria-label={`PDF preview ${path}`}>
      {status === "loading" ? <p className="absolute inset-x-0 top-4 flex items-center justify-center gap-1 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading PDF…</p> : null}
      {status === "error" ? <div role="alert" className="mx-auto max-w-lg rounded-md border border-destructive/30 bg-card p-4 text-sm"><p className="font-medium text-destructive">PDF preview unavailable</p><p className="mt-1 text-muted-foreground">{error}</p></div> : null}
      <canvas ref={canvasRef} className={`mx-auto bg-white shadow-sm ${status === "ready" ? "block" : "invisible"}`} aria-label={`Page ${page} of ${pageCount || 1}`} />
    </div>
  </div>;
}
