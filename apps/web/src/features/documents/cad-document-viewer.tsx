import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Minus, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { api } from "@/data/use-console-actions";
import { ApiError } from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

const CANVAS_WIDTH = 1_000;
const MIN_ZOOM = .1;
const MAX_ZOOM = 8;
type Point = { x: number; y: number };
type CadText = { text: string; type: string; layer: string; layout: string; x: number | null; y: number | null };

export function CadDocumentViewer({ projectId, path, type, worktreeId }: { projectId: string; path: string; type: "dxf" | "dwg"; worktreeId?: string | null }) {
  const { t } = useAppTranslation();
  const [layout, setLayout] = useState("Model");
  const [visibleLayers, setVisibleLayers] = useState<string[]>([]);
  const [layersReady, setLayersReady] = useState(false);
  const [layerSearch, setLayerSearch] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [search, setSearch] = useState("");
  const [activeMatch, setActiveMatch] = useState<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; origin: Point; pan: Point } | null>(null);

  useEffect(() => { setLayout("Model"); setVisibleLayers([]); setLayersReady(false); setLayerSearch(""); setZoom(1); setPan({ x: 0, y: 0 }); setSearch(""); setActiveMatch(null); }, [projectId, path, worktreeId]);
  const info = useQuery({ queryKey: ["cad-document-info", projectId, worktreeId ?? null, path], queryFn: ({ signal }) => api.cadDocumentInfo(projectId, path, worktreeId ?? undefined, signal) });
  const readiness = useQuery({ queryKey: ["cad-runtime-readiness"], queryFn: () => api.cadRuntimeReadiness(), enabled: type === "dxf", retry: false });
  useEffect(() => {
    if (!info.data || layersReady) return;
    setVisibleLayers(info.data.layers); setLayersReady(true);
    if (!info.data.layouts.includes(layout)) setLayout(info.data.layouts[0] ?? "Model");
  }, [info.data, layersReady, layout]);
  const render = useQuery({
    queryKey: ["cad-document-layout", projectId, worktreeId ?? null, path, layout, visibleLayers],
    queryFn: ({ signal }) => api.cadDocumentLayout(projectId, path, layout, visibleLayers, worktreeId ?? undefined, signal),
    enabled: type === "dxf" && Boolean(info.data && layersReady), retry: false,
  });

  const extents = info.data?.layoutExtents?.[layout] ?? info.data?.extents ?? null;
  const drawingWidth = Math.max(1, (extents?.max[0] ?? 1) - (extents?.min[0] ?? 0));
  const drawingHeight = Math.max(1, (extents?.max[1] ?? 1) - (extents?.min[1] ?? 0));
  const canvasHeight = Math.min(3_000, Math.max(250, CANVAS_WIDTH * drawingHeight / drawingWidth));

  const fit = useCallback((mode: "page" | "width") => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const widthScale = Math.max(MIN_ZOOM, (viewport.clientWidth - 32) / CANVAS_WIDTH);
    const heightScale = Math.max(MIN_ZOOM, (viewport.clientHeight - 32) / canvasHeight);
    const next = Math.min(MAX_ZOOM, mode === "width" ? widthScale : Math.min(widthScale, heightScale));
    setZoom(next);
    setPan({ x: (viewport.clientWidth - CANVAS_WIDTH * next) / 2, y: mode === "width" ? 16 : (viewport.clientHeight - canvasHeight * next) / 2 });
  }, [canvasHeight]);
  useEffect(() => { if (render.data) requestAnimationFrame(() => fit("page")); }, [layout, render.data, fit]);

  const zoomAt = useCallback((nextZoom: number, screenPoint?: Point) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const point = screenPoint ?? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
    const bounded = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    setPan((current) => ({ x: point.x - ((point.x - current.x) / zoom) * bounded, y: point.y - ((point.y - current.y) / zoom) * bounded }));
    setZoom(bounded);
  }, [zoom]);
  const onWheel = (event: ReactWheelEvent) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    zoomAt(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { pointerId: event.pointerId, origin: { x: event.clientX, y: event.clientY }, pan };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({ x: drag.pan.x + event.clientX - drag.origin.x, y: drag.pan.y + event.clientY - drag.origin.y });
  };
  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => { if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null; };

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? (info.data?.texts ?? []).filter((item) => item.layout === layout && item.text.toLowerCase().includes(needle)).slice(0, 100) : [];
  }, [info.data?.texts, layout, search]);
  const filteredLayers = useMemo(() => { const needle = layerSearch.trim().toLowerCase(); return (info.data?.layers ?? []).filter((name) => !needle || name.toLowerCase().includes(needle)); }, [info.data?.layers, layerSearch]);
  const markerPosition = useCallback((item: CadText) => {
    if (!extents || item.x === null || item.y === null) return null;
    return { x: ((item.x - extents.min[0]) / drawingWidth) * CANVAS_WIDTH, y: (1 - (item.y - extents.min[1]) / drawingHeight) * canvasHeight };
  }, [canvasHeight, drawingHeight, drawingWidth, extents]);
  const locateMatch = (item: CadText, index: number) => {
    const point = markerPosition(item); const viewport = viewportRef.current;
    setActiveMatch(index);
    if (point && viewport) setPan({ x: viewport.clientWidth / 2 - point.x * zoom, y: viewport.clientHeight / 2 - point.y * zoom });
  };

  if (info.isLoading) return <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t("cad.inspecting")}</p>;
  if (info.error) return <CadFailure error={info.error} type={type} onRetry={() => void info.refetch()} />;
  if (!info.data) return null;
  const srcDoc = render.data?.svg ? `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'"><style>html,body{margin:0;width:100%;height:100%;background:#111827;overflow:hidden}svg{width:100%;height:100%;display:block}</style>${render.data.svg}` : "";
  return <div className="grid min-h-[34rem] grid-cols-[15rem_minmax(0,1fr)]">
    <aside className="space-y-4 overflow-auto border-r border-border p-3 text-xs">
      <div><p className="font-medium">{t("cad.details")}</p><dl className="mt-2 space-y-1 text-muted-foreground"><div>{t("cad.version")}: {info.data.version}</div><div>{t("cad.units")}: {info.data.units}</div><div>{t("cad.entities")}: {Object.values(info.data.entityCounts).reduce((sum, count) => sum + count, 0)}</div><div>{t("cad.audit", { errors: info.data.audit.errors, fixes: info.data.audit.fixes })}</div></dl></div>
      <div className="rounded border border-border p-2"><p className="font-medium">{t("cad.runtime")}</p><p className={readiness.data?.ready ? "mt-1 text-emerald-600" : "mt-1 text-muted-foreground"}>{readiness.isFetching ? t("cad.detecting") : readiness.data?.summary ?? t("cad.readinessUnknown")}</p><button type="button" className="mt-2 text-primary" onClick={() => void readiness.refetch()}>{t("cad.retryDetection")}</button></div>
      <div><div className="flex items-center justify-between"><p className="font-medium">{t("cad.layers")}</p><div className="flex gap-1"><button type="button" className="text-primary" onClick={() => setVisibleLayers(info.data.layers)}>{t("cad.all")}</button><span>·</span><button type="button" className="text-primary" onClick={() => setVisibleLayers([])}>{t("cad.none")}</button></div></div><Input aria-label={t("cad.layerSearchLabel")} className="mt-2 h-7" value={layerSearch} onChange={(event) => setLayerSearch(event.target.value)} placeholder={t("cad.layerSearchPlaceholder")} /><div className="mt-2 max-h-52 space-y-1 overflow-auto">{filteredLayers.map((name) => <label key={name} className="flex items-center gap-2"><input type="checkbox" checked={visibleLayers.includes(name)} onChange={(event) => setVisibleLayers((current) => event.target.checked ? [...current, name] : current.filter((item) => item !== name))} /><span className="truncate" title={name}>{name}</span></label>)}</div></div>
      {info.data.warnings.length ? <div className="rounded border border-warning/40 bg-warning/10 p-2"><p className="font-medium">{t("cad.warnings")}</p>{info.data.warnings.slice(0, 20).map((warning, index) => <p key={index} className="mt-1 text-muted-foreground">{warning}</p>)}</div> : null}
    </aside>
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
        <Select aria-label={t("cad.layout")} className="h-8 max-w-48" value={layout} onChange={(event) => { setLayout(event.target.value); setActiveMatch(null); }}>{info.data.layouts.map((name) => <option key={name} value={name}>{name}</option>)}</Select><span aria-live="polite" className="text-xs text-muted-foreground">{render.isFetching ? t("cad.switchingLayout") : t("cad.viewing", { layout })}</span>
        <Button size="icon" variant="secondary" aria-label={t("cad.zoomOut")} onClick={() => zoomAt(zoom / 1.25)}><Minus /></Button><span className="w-12 text-center text-xs">{Math.round(zoom * 100)}%</span><Button size="icon" variant="secondary" aria-label={t("cad.zoomIn")} onClick={() => zoomAt(zoom * 1.25)}><Plus /></Button><Button size="sm" variant="secondary" aria-label={t("cad.fitWidth")} onClick={() => fit("width")}>{t("cad.fitWidth")}</Button><Button size="sm" variant="secondary" aria-label={t("cad.fitPage")} onClick={() => fit("page")}>{t("cad.fitPage")}</Button>
        <div className="ml-auto flex min-w-56 items-center gap-1"><Search className="size-4 text-muted-foreground" /><Input aria-label={t("cad.searchLabel")} value={search} onChange={(event) => { setSearch(event.target.value); setActiveMatch(null); }} placeholder={t("cad.searchPlaceholder")} /></div>
      </div>
      {search.trim() ? <div className="max-h-28 overflow-auto border-b border-border px-3 py-2 text-xs text-muted-foreground">{matches.length ? matches.map((item, index) => <button type="button" key={`${item.layout}:${item.layer}:${index}`} className={`mr-2 rounded px-2 py-1 ${activeMatch === index ? "bg-primary text-primary-foreground" : "bg-muted"}`} onClick={() => locateMatch(item, index)}>{item.text} <em>({item.layer})</em></button>) : t("cad.noMatchesLayout")}</div> : null}
      <div ref={viewportRef} aria-label={t("cad.viewport")} className="relative flex-1 touch-none overflow-hidden bg-slate-950 cursor-grab active:cursor-grabbing" onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
        {render.isLoading ? <p className="absolute inset-0 grid place-items-center text-sm text-slate-300">{t("cad.rendering")}</p> : render.error ? <CadFailure error={render.error} type={type} onRetry={() => void render.refetch()} /> : render.data ? <div className="absolute left-0 top-0" style={{ width: CANVAS_WIDTH, height: canvasHeight, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "top left" }}><iframe title={t("cad.frameTitle", { layout })} sandbox="" srcDoc={srcDoc} className="pointer-events-none h-full w-full border-0" />{matches.map((item, index) => { const point = markerPosition(item); return point ? <span key={`marker:${index}`} aria-label={t("cad.highlight", { text: item.text })} className={`pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${activeMatch === index ? "border-orange-300 bg-orange-400/60 ring-4 ring-orange-400/30" : "border-yellow-200 bg-yellow-300/40"}`} style={{ left: point.x, top: point.y }} /> : null; })}</div> : null}
      </div>
    </div>
  </div>;
}

function CadFailure({ error, type, onRetry }: { error: Error; type: "dxf" | "dwg"; onRetry?: () => void }) {
  const { t } = useAppTranslation();
  const code = error instanceof ApiError ? error.code : "cad_processing_failed";
  const copy = code === "oda_unavailable" ? t("cad.failure.oda")
    : code === "ezdxf_unavailable" ? t("cad.failure.ezdxf")
      : code === "cad_file_too_large" || code === "cad_output_too_large" ? t("cad.failure.tooLarge")
        : code.endsWith("_limit_exceeded") ? t("cad.failure.limit")
          : code === "cad_processing_timeout" ? t("cad.failure.timeout")
            : code === "cad_svg_rejected" ? t("cad.failure.svgRejected")
              : code === "cad_invalid_signature" || code === "cad_corrupt_file" ? t("cad.failure.invalid", { type: type.toUpperCase() })
                : t("cad.failure.generic");
  return <div role="alert" className="m-4 rounded-md border border-destructive/30 bg-card p-4 text-sm"><p className="font-medium text-destructive">{t("cad.unavailable")}</p><p className="mt-1 text-muted-foreground">{copy}</p>{onRetry ? <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>{t("cad.retryPreview")}</Button> : null}</div>;
}
