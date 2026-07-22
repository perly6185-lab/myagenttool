import { useEffect, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, Download, Info, Loader2, Maximize2, PanelLeftClose, PanelLeftOpen, Printer, RotateCw, Search, ZoomIn, ZoomOut } from "lucide-react";
import { api } from "@/data/use-console-actions";
import { useConsoleState, useRefreshConsoleState } from "@/data/use-console-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SearchHit = { page: number; occurrence: number };

export function PdfDocumentViewer({ projectId, path, worktreeId }: { projectId: string; path: string; worktreeId?: string | null }) {
  const { data: consoleState } = useConsoleState();
  const refreshConsoleState = useRefreshConsoleState();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const textTaskRef = useRef<TextLayer | null>(null);
  const searchGeneration = useRef(0);
  const passwordCallbackRef = useRef<((password: string) => void) | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pageInputError, setPageInputError] = useState("");
  const [zoom, setZoom] = useState(1.25);
  const [fitWidth, setFitWidth] = useState(true);
  const [containerWidth, setContainerWidth] = useState(0);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeHit, setActiveHit] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [textLayerVersion, setTextLayerVersion] = useState(0);
  const [thumbnailsOpen, setThumbnailsOpen] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [toolInvocationId, setToolInvocationId] = useState("");
  const [toolAction, setToolAction] = useState<"validate" | "info" | "">("");
  const [toolError, setToolError] = useState("");
  const [passwordPrompt, setPasswordPrompt] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setStatus("loading"); setError(""); setDocument(null); setPage(1); setPageInput("1"); setHits([]); setActiveHit(-1);
    void (async () => {
      try {
        const [pdfjs, source] = await Promise.all([import("pdfjs-dist"), api.projectPdfSource(projectId, path, worktreeId ?? undefined)]);
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadingTask = pdfjs.getDocument({ ...source, rangeChunkSize: 64 * 1024 });
        loadingTask.onPassword = (updatePassword: (password: string) => void, reason: number) => {
          if (cancelled) return;
          passwordCallbackRef.current = updatePassword;
          setPassword(""); setPasswordError(reason === 2 ? "Incorrect password. Try again." : "This PDF is password protected."); setPasswordPrompt(true);
        };
        const loaded = await loadingTask.promise;
        if (!cancelled) {
          setDocument(loaded);
          void loaded.getDownloadInfo().then((value) => { if (!cancelled) setFileSize(value.length); }).catch(() => undefined);
          void loaded.getMetadata?.().then((value) => {
            if (cancelled) return;
            const info = (value?.info ?? {}) as Record<string, unknown>;
            setMetadata(Object.fromEntries(["PDFFormatVersion", "Title", "Author", "Subject", "Creator", "Producer"].flatMap((key) => typeof info[key] === "string" && info[key] ? [[key === "PDFFormatVersion" ? "PDF version" : key, info[key] as string]] : [])));
          }).catch(() => undefined);
          const linkedPage = readLinkedPdfPage();
          if (linkedPage) setPage(Math.min(loaded.numPages, linkedPage));
        }
      } catch (caught) {
        if (!cancelled) { setError(caught instanceof Error ? caught.message : "PDF preview failed."); setStatus("error"); }
      }
    })();
    return () => { cancelled = true; passwordCallbackRef.current = null; searchGeneration.current += 1; renderTaskRef.current?.cancel(); textTaskRef.current?.cancel(); void loadingTask?.destroy(); };
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
    textTaskRef.current?.cancel();
    setStatus("loading"); setError("");
    void (async () => {
      try {
        const pdfPage = await document.getPage(page);
        if (cancelled) return;
        const natural = pdfPage.getViewport({ scale: 1, rotation });
        const scale = fitWidth && containerWidth > 32 ? Math.max(0.25, (containerWidth - 32) / natural.width) : zoom;
        const viewport = pdfPage.getViewport({ scale, rotation });
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
        const textContainer = textLayerRef.current;
        if (textContainer) {
          textContainer.replaceChildren();
          textContainer.style.width = canvas.style.width;
          textContainer.style.height = canvas.style.height;
          const pdfjs = await import("pdfjs-dist");
          const textTask = new pdfjs.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: textContainer, viewport });
          textTaskRef.current = textTask;
          await textTask.render();
          setTextLayerVersion((value) => value + 1);
        }
        if (!cancelled) setStatus("ready");
      } catch (caught) {
        if (!cancelled && (caught as { name?: string })?.name !== "RenderingCancelledException") {
          setError(caught instanceof Error ? caught.message : "PDF page rendering failed."); setStatus("error");
        }
      }
    })();
    return () => { cancelled = true; renderTaskRef.current?.cancel(); textTaskRef.current?.cancel(); };
  }, [document, page, zoom, fitWidth, containerWidth, rotation]);

  useEffect(() => {
    const active = activeHit >= 0 && hits[activeHit]?.page === page ? hits[activeHit].occurrence : -1;
    highlightTextLayer(textLayerRef.current, query.trim(), active);
  }, [query, hits, activeHit, page, textLayerVersion]);

  useEffect(() => { setPageInput(String(page)); setPageInputError(""); }, [page]);
  useEffect(() => {
    if (!document || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (page > 1) url.searchParams.set("pdfPage", String(page)); else url.searchParams.delete("pdfPage");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [document, page]);

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
  const submitPage = () => {
    const requested = Number(pageInput);
    if (!Number.isInteger(requested) || requested < 1 || requested > pageCount) {
      setPageInputError(`Enter a page from 1 to ${pageCount}.`); return;
    }
    setPage(requested); setPageInputError("");
  };

  const pageCount = document?.numPages ?? 0;
  const invocation = consoleState?.invocations.find((item) => item.id === toolInvocationId);
  const importedResult = consoleState?.applicationResults?.find((item) => item.invocationId === toolInvocationId);
  const pdfcpu = consoleState?.applications?.find((item) => item.id === "app_pdfcpu");
  const runTool = async (action: "validate" | "info") => {
    setToolAction(action); setToolError("");
    try {
      const result = await api.invokeCapability(`app.app_pdfcpu.wrapper.${action}`, { projectId, file: path, ...(worktreeId ? { worktreeId } : {}) });
      setToolInvocationId(result.invocationId);
      await refreshConsoleState();
    } catch (caught) { setToolError(caught instanceof Error ? caught.message : `PDF ${action} failed.`); }
  };
  const withPdfUrl = async (callback: (url: string) => void) => {
    const bytes = pdfBytes ?? await api.projectPdfData(projectId, path, worktreeId ?? undefined);
    if (!pdfBytes) setPdfBytes(bytes);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    callback(url); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return <div ref={rootRef} className="flex min-h-0 flex-1 flex-col bg-background">
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1.5" aria-label="PDF controls">
      <Button size="icon" variant={thumbnailsOpen ? "secondary" : "ghost"} aria-label={thumbnailsOpen ? "Hide thumbnails" : "Show thumbnails"} disabled={!document} onClick={() => setThumbnailsOpen((value) => !value)}>{thumbnailsOpen ? <PanelLeftClose /> : <PanelLeftOpen />}</Button>
      <Button size="icon" variant="ghost" aria-label="Previous page" disabled={!document || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft /></Button>
      <form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); submitPage(); }}>
        <Input aria-label="Page number" aria-invalid={Boolean(pageInputError)} value={pageInput} onChange={(event) => setPageInput(event.target.value)} className="h-7 w-12 px-1 text-center text-xs" inputMode="numeric" />
        <span className="text-xs text-muted-foreground">/ {pageCount || "–"}</span>
      </form>
      <Button size="icon" variant="ghost" aria-label="Next page" disabled={!document || page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight /></Button>
      <span className="mx-1 h-5 w-px bg-border" />
      <Button size="icon" variant="ghost" aria-label="Zoom out" disabled={!document || (!fitWidth && zoom <= 0.25)} onClick={() => changeZoom((fitWidth ? 1 : zoom) - 0.25)}><ZoomOut /></Button>
      <span className="min-w-12 text-center text-xs">{fitWidth ? "Fit" : `${Math.round(zoom * 100)}%`}</span>
      <Button size="icon" variant="ghost" aria-label="Zoom in" disabled={!document || (!fitWidth && zoom >= 4)} onClick={() => changeZoom((fitWidth ? 1 : zoom) + 0.25)}><ZoomIn /></Button>
      <Button size="sm" variant={fitWidth ? "secondary" : "ghost"} aria-label="Fit width" disabled={!document} onClick={() => setFitWidth(true)}><Maximize2 className="mr-1 size-3.5" /> Fit width</Button>
      <Button size="icon" variant="ghost" aria-label="Rotate clockwise" disabled={!document} onClick={() => setRotation((value) => (value + 90) % 360)}><RotateCw /></Button>
      <Button size="icon" variant="ghost" aria-label="Download PDF" disabled={!document} onClick={() => void withPdfUrl((url) => { const link = window.document.createElement("a"); link.href = url; link.download = path.split("/").at(-1) || "document.pdf"; link.click(); })}><Download /></Button>
      <Button size="icon" variant="ghost" aria-label="Print PDF" disabled={!document} onClick={() => void withPdfUrl((url) => { const frame = window.open(url, "_blank", "noopener,noreferrer"); frame?.addEventListener("load", () => frame.print(), { once: true }); })}><Printer /></Button>
      <Button size="icon" variant="ghost" aria-label="Enter fullscreen" disabled={!document} onClick={() => void rootRef.current?.requestFullscreen?.()}><Maximize2 /></Button>
      <Button size="icon" variant={detailsOpen ? "secondary" : "ghost"} aria-label={detailsOpen ? "Hide PDF details" : "Show PDF details"} onClick={() => setDetailsOpen((value) => !value)}><Info /></Button>
      <form className="ml-auto flex min-w-48 items-center gap-1" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <label className="relative flex-1"><Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" /><Input aria-label="Search PDF text" value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 pl-7" placeholder="Search PDF…" /></label>
        <Button size="sm" variant="secondary" type="submit" disabled={!document || searching}>{searching ? "Searching…" : "Find"}</Button>
        <Button size="sm" variant="ghost" type="button" disabled={!hits.length} onClick={nextHit}>Next</Button>
        <span className="min-w-12 text-right text-[11px] text-muted-foreground">{hits.length ? `${activeHit + 1}/${hits.length}` : query.trim() && !searching ? "0 results" : ""}</span>
      </form>
    </div>
    {pageInputError ? <p role="alert" className="border-b border-destructive/30 bg-destructive/5 px-3 py-1 text-xs text-destructive">{pageInputError}</p> : null}
    {passwordPrompt ? <form className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2" aria-label="Unlock PDF" onSubmit={(event) => { event.preventDefault(); if (!password) return; const callback = passwordCallbackRef.current; passwordCallbackRef.current = null; setPasswordPrompt(false); callback?.(password); setPassword(""); }}>
      <div className="flex flex-wrap items-center gap-2"><label className="text-xs font-medium" htmlFor="pdf-password">PDF password</label><Input id="pdf-password" type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} className="h-8 max-w-64" autoComplete="off" /><Button size="sm" type="submit" disabled={!password}>Unlock</Button></div>
      <p role="status" className="mt-1 text-xs text-muted-foreground">{passwordError} The password is used only in memory and is not stored.</p>
    </form> : null}
    {detailsOpen ? <section className="border-b border-border bg-card px-3 py-2 text-xs" aria-label="PDF details">
      <div className="flex flex-wrap items-center gap-2"><strong>Local PDF</strong><span>{pageCount} pages</span><span>{fileSize === null ? "—" : formatBytes(fileSize)}</span><span>pdfcpu: {pdfcpu?.localReadiness?.state ?? pdfcpu?.status ?? "not registered"}</span>
        <Button size="sm" variant="secondary" disabled={!document || Boolean(toolInvocationId && !importedResult && invocation?.status !== "failed")} onClick={() => void runTool("validate")}>Validate</Button>
        <Button size="sm" variant="secondary" disabled={!document || Boolean(toolInvocationId && !importedResult && invocation?.status !== "failed")} onClick={() => void runTool("info")}>Read metadata</Button>
      </div>
      {Object.keys(metadata).length ? <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-2 gap-y-1">{Object.entries(metadata).map(([key, value]) => <div className="contents" key={key}><dt className="text-muted-foreground">{key}</dt><dd>{value}</dd></div>)}</dl> : null}
      {toolInvocationId ? <p className="mt-2">{toolAction === "validate" ? "Validation" : "Metadata inspection"}: {importedResult ? importedResult.status : invocation?.status ?? "queued"}</p> : null}
      {importedResult?.data ? <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">{JSON.stringify(importedResult.data, null, 2)}</pre> : importedResult?.text ? <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">{importedResult.text}</pre> : null}
      {toolError ? <p role="alert" className="mt-2 text-destructive">{toolError}</p> : null}
    </section> : null}
    <div className="flex min-h-0 flex-1">
      {thumbnailsOpen && document ? <aside className="w-36 shrink-0 overflow-y-auto border-r border-border bg-card p-2" aria-label="PDF thumbnails">{Array.from({ length: document.numPages }, (_, index) => <PdfThumbnail key={index + 1} document={document} page={index + 1} active={page === index + 1} onSelect={setPage} />)}</aside> : null}
    <div ref={viewportRef} tabIndex={0} onKeyDown={(event) => {
      if (!document || event.target instanceof HTMLInputElement) return;
      const next = event.key === "ArrowRight" || event.key === "PageDown" ? Math.min(pageCount, page + 1)
        : event.key === "ArrowLeft" || event.key === "PageUp" ? Math.max(1, page - 1)
          : event.key === "Home" ? 1 : event.key === "End" ? pageCount : page;
      if (next !== page) { event.preventDefault(); setPage(next); }
    }} className="relative min-h-0 flex-1 overflow-auto bg-muted/50 p-4 outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`PDF preview ${path}`}>
      {status === "loading" ? <p className="absolute inset-x-0 top-4 flex items-center justify-center gap-1 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading PDF…</p> : null}
      {status === "error" ? <div role="alert" className="mx-auto max-w-lg rounded-md border border-destructive/30 bg-card p-4 text-sm"><p className="font-medium text-destructive">PDF preview unavailable</p><p className="mt-1 text-muted-foreground">{error}</p></div> : null}
      <div className={`relative mx-auto w-fit bg-white shadow-sm ${status === "ready" ? "block" : "invisible"}`}>
        <canvas ref={canvasRef} className="block" aria-label={`Page ${page} of ${pageCount || 1}`} />
        <div ref={textLayerRef} className="textLayer pdf-selectable-text absolute inset-0 overflow-hidden opacity-100" aria-label={`Selectable text for page ${page}`} />
      </div>
    </div>
    </div>
  </div>;
}

function PdfThumbnail({ document, page, active, onSelect }: { document: PDFDocumentProxy; page: number; active: boolean; onSelect: (page: number) => void }) {
  const hostRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const host = hostRef.current;
    if (!host || visible || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setVisible(true); }, { rootMargin: "160px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false; let task: RenderTask | null = null;
    void document.getPage(page).then((pdfPage) => {
      if (cancelled) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: 108 / natural.width });
      const canvas = canvasRef.current; const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      task = pdfPage.render({ canvas, canvasContext: context, viewport });
      return task.promise;
    }).catch((error) => { if (!cancelled && error?.name !== "RenderingCancelledException") setVisible(false); });
    return () => { cancelled = true; task?.cancel(); };
  }, [document, page, visible]);
  return <button ref={hostRef} type="button" aria-label={`Go to page ${page}`} aria-current={active ? "page" : undefined} onClick={() => onSelect(page)} className={`mb-2 block w-full rounded border p-1 text-center text-[10px] ${active ? "border-primary bg-primary/10" : "border-border hover:border-muted-foreground"}`}>
    <canvas ref={canvasRef} className="mx-auto max-w-full bg-white" />
    <span>{page}</span>
  </button>;
}

function readLinkedPdfPage(): number | null {
  if (typeof window === "undefined") return null;
  const value = Number(new URLSearchParams(window.location.search).get("pdfPage"));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function highlightTextLayer(container: HTMLElement | null, query: string, activeOccurrence: number) {
  if (!container) return;
  for (const mark of container.querySelectorAll("mark[data-pdf-search]")) mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
  if (!query) return;
  const needle = query.toLocaleLowerCase();
  let occurrence = 0;
  for (const span of container.querySelectorAll("span")) {
    const text = span.textContent ?? "";
    const lower = text.toLocaleLowerCase();
    let offset = 0; const fragment = document.createDocumentFragment(); let matched = false;
    while (true) {
      const index = lower.indexOf(needle, offset);
      if (index < 0) break;
      matched = true;
      fragment.append(text.slice(offset, index));
      const mark = document.createElement("mark");
      mark.dataset.pdfSearch = "true";
      occurrence += 1;
      if (occurrence === activeOccurrence) mark.dataset.active = "true";
      mark.textContent = text.slice(index, index + query.length);
      fragment.append(mark);
      offset = index + Math.max(query.length, 1);
    }
    if (matched) { fragment.append(text.slice(offset)); span.replaceChildren(fragment); }
  }
}
