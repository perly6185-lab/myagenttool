import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Minus, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { api } from "@/data/use-console-actions";
import { ApiError } from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

export function CadDocumentViewer({ projectId, path, type, worktreeId }: { projectId: string; path: string; type: "dxf" | "dwg"; worktreeId?: string | null }) {
  const { t } = useAppTranslation();
  const [layout, setLayout] = useState("Model");
  const [visibleLayers, setVisibleLayers] = useState<string[]>([]);
  const [layersReady, setLayersReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [search, setSearch] = useState("");
  useEffect(() => { setLayout("Model"); setVisibleLayers([]); setLayersReady(false); setZoom(1); setSearch(""); }, [projectId, path, worktreeId]);

  const info = useQuery({
    queryKey: ["cad-document-info", projectId, worktreeId ?? null, path],
    queryFn: () => api.cadDocumentInfo(projectId, path, worktreeId ?? undefined),
  });
  useEffect(() => {
    if (!info.data || layersReady) return;
    setVisibleLayers(info.data.layers);
    setLayersReady(true);
    if (!info.data.layouts.includes(layout)) setLayout(info.data.layouts[0] ?? "Model");
  }, [info.data, layersReady, layout]);

  const render = useQuery({
    queryKey: ["cad-document-layout", projectId, worktreeId ?? null, path, layout, visibleLayers],
    queryFn: () => api.cadDocumentLayout(projectId, path, layout, visibleLayers, worktreeId ?? undefined),
    enabled: type === "dxf" && Boolean(info.data && layersReady),
  });
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? (info.data?.texts ?? []).filter((item) => item.text.toLowerCase().includes(needle)).slice(0, 100) : [];
  }, [info.data?.texts, search]);

  if (info.isLoading) return <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t("cad.inspecting")}</p>;
  if (info.error) return <CadFailure error={info.error} type={type} />;
  if (!info.data) return null;
  const srcDoc = render.data?.svg ? `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'"><style>html,body{margin:0;background:#111827;overflow:hidden}svg{width:100%;height:100vh}</style>${render.data.svg}` : "";
  return <div className="grid min-h-[34rem] grid-cols-[14rem_minmax(0,1fr)]">
    <aside className="space-y-4 overflow-auto border-r border-border p-3 text-xs">
      <div><p className="font-medium">{t("cad.details")}</p><dl className="mt-2 space-y-1 text-muted-foreground"><div>{t("cad.version")}: {info.data.version}</div><div>{t("cad.units")}: {info.data.units}</div><div>{t("cad.entities")}: {Object.values(info.data.entityCounts).reduce((sum, count) => sum + count, 0)}</div><div>{t("cad.audit", { errors: info.data.audit.errors, fixes: info.data.audit.fixes })}</div></dl></div>
      <div><p className="font-medium">{t("cad.layers")}</p><div className="mt-2 max-h-52 space-y-1 overflow-auto">{info.data.layers.map((name) => <label key={name} className="flex items-center gap-2"><input type="checkbox" checked={visibleLayers.includes(name)} onChange={(event) => setVisibleLayers((current) => event.target.checked ? [...current, name] : current.filter((item) => item !== name))} /><span className="truncate" title={name}>{name}</span></label>)}</div></div>
      {info.data.warnings.length ? <div className="rounded border border-warning/40 bg-warning/10 p-2"><p className="font-medium">{t("cad.warnings")}</p>{info.data.warnings.slice(0, 20).map((warning, index) => <p key={index} className="mt-1 text-muted-foreground">{warning}</p>)}</div> : null}
    </aside>
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
        <Select aria-label={t("cad.layout")} className="h-8 max-w-48" value={layout} onChange={(event) => setLayout(event.target.value)}>{info.data.layouts.map((name) => <option key={name} value={name}>{name}</option>)}</Select>
        <Button size="icon" variant="secondary" aria-label={t("cad.zoomOut")} onClick={() => setZoom((value) => Math.max(.25, value - .25))}><Minus /></Button><span className="w-12 text-center text-xs">{Math.round(zoom * 100)}%</span><Button size="icon" variant="secondary" aria-label={t("cad.zoomIn")} onClick={() => setZoom((value) => Math.min(4, value + .25))}><Plus /></Button><Button size="sm" variant="secondary" onClick={() => setZoom(1)}>{t("cad.fit")}</Button>
        <div className="ml-auto flex min-w-56 items-center gap-1"><Search className="size-4 text-muted-foreground" /><Input aria-label={t("cad.searchLabel")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("cad.searchPlaceholder")} /></div>
      </div>
      {search.trim() ? <div className="max-h-24 overflow-auto border-b border-border px-3 py-2 text-xs text-muted-foreground">{matches.length ? matches.map((item, index) => <span key={`${item.layer}:${index}`} className="mr-3">{item.text} <em>({item.layer})</em></span>) : t("cad.noMatches")}</div> : null}
      <div className="relative flex-1 overflow-auto bg-slate-950">
        {render.isLoading ? <p className="absolute inset-0 grid place-items-center text-sm text-slate-300">{t("cad.rendering")}</p> : render.error ? <CadFailure error={render.error} type={type} /> : render.data ? <iframe title={t("cad.frameTitle", { layout })} sandbox="" srcDoc={srcDoc} className="h-full min-h-[30rem] w-full border-0" style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: `${100 / zoom}%`, height: `${100 / zoom}%` }} /> : null}
      </div>
    </div>
  </div>;
}

function CadFailure({ error, type }: { error: Error; type: "dxf" | "dwg" }) {
  const { t } = useAppTranslation();
  const code = error instanceof ApiError ? error.code : "cad_processing_failed";
  const copy = code === "oda_unavailable" ? t("cad.failure.oda")
    : code === "ezdxf_unavailable" ? t("cad.failure.ezdxf")
      : code === "cad_file_too_large" || code === "cad_output_too_large" ? t("cad.failure.tooLarge")
        : code === "cad_invalid_signature" || code === "cad_corrupt_file" ? t("cad.failure.invalid", { type: type.toUpperCase() })
          : t("cad.failure.generic");
  return <div role="alert" className="m-4 rounded-md border border-destructive/30 bg-card p-4 text-sm"><p className="font-medium text-destructive">{t("cad.unavailable")}</p><p className="mt-1 text-muted-foreground">{copy}</p></div>;
}
