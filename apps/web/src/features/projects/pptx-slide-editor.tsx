import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

// pptx slide text editor (v0). Each slide's text shapes are shown as editable
// textareas, keyed on their stable @id path — so editing needs no alignment or
// ordering. A changed shape maps to a surgical, governed `set <shape-path> --prop
// text=`; "Save all" produces one worktree-scoped `apply.batch`. Non-text shapes
// are shown read-only. (Add/delete/reorder slides + shapes and formatting are
// follow-ups.)

interface Shape {
  path: string;
  type: string;
  text: string;
  editable: boolean;
}
interface Slide {
  path: string;
  shapes: Shape[];
}

export function PptxSlideEditor({ projectId, worktreeId, file, onChanged }: { projectId: string; worktreeId: string; file: string; onChanged?: () => void }) {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [base, setBase] = useState<Record<string, string>>({}); // shape path -> original text
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loadState, setLoadState] = useState<"loading" | "error" | "done">("loading");
  const [saving, setSaving] = useState(false);
  const [invId, setInvId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const r = await api.officecliDeck(projectId, file, worktreeId);
      const b: Record<string, string> = {};
      for (const slide of r.slides) for (const shape of slide.shapes) if (shape.editable) b[shape.path] = shape.text;
      setSlides(r.slides);
      setBase(b);
      setEdits({});
      setLoadState("done");
    } catch {
      setLoadState("error");
    }
  }, [projectId, worktreeId, file]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => Object.keys(edits).some((p) => edits[p] !== (base[p] ?? "")), [edits, base]);
  const textAt = (path: string) => (path in edits ? edits[path] : base[path] ?? "");
  const setShape = (path: string, v: string) => setEdits((e) => ({ ...e, [path]: v }));

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const shapes: Record<string, string> = {};
      for (const p of Object.keys(edits)) if (edits[p] !== (base[p] ?? "")) shapes[p] = edits[p];
      const { commands } = (await api.officecliDeckOps(projectId, { file, worktree: worktreeId, shapes })) as {
        commands: Record<string, unknown>[];
      };
      if (!commands.length) {
        setSaving(false);
        await load();
        return;
      }
      const grant = (await api.issueApprovalGrant("wrapper:batch", "app_officecli")) as { token: string };
      const res = (await api.invokeCapability("app.app_officecli.apply.batch", {
        projectId,
        worktreeId,
        file,
        commands,
        approvalToken: grant.token,
      } as unknown as Record<string, string>)) as { invocationId?: string };
      if (res?.invocationId) setInvId(res.invocationId);
      else throw new Error(t("officeEditors.editRejected"));
    } catch (e) {
      setSaving(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [edits, base, projectId, worktreeId, file, load]);

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
      setError(t("officeEditors.editRefused"));
    }
  }, [state?.invocations, invId, load, onChanged, t]);

  if (loadState === "loading") {
    return <span className="flex items-center gap-1 px-2 py-6 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> {t("officeEditors.loadingSlides")}</span>;
  }
  if (loadState === "error" || !slides) {
    return <span className="px-2 py-6 text-xs text-red-600 dark:text-red-400">{t("officeEditors.deckReadFailed")}</span>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {t("officeEditors.deckHint")}
        </span>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void save()}
          className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium disabled:opacity-40"
        >
          {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
          {t(saving ? "officeEditors.saving" : "officeEditors.saveAll")}
        </button>
      </div>
      {error ? <p className="px-2 pt-1 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        {slides.map((slide, i) => (
          <div key={slide.path} className="rounded-md border border-border bg-card p-2">
            <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Slide {i + 1}</div>
            {slide.shapes.length === 0 ? (
              <p className="px-1 text-[11px] text-muted-foreground/60">(no shapes)</p>
            ) : (
              <div className="space-y-1.5">
                {slide.shapes.map((shape) =>
                  shape.editable ? (
                    <textarea
                      key={shape.path}
                      value={textAt(shape.path)}
                      onChange={(e) => setShape(shape.path, e.target.value)}
                      rows={Math.min(5, Math.max(1, Math.ceil((textAt(shape.path).length || 1) / 60)))}
                      className={`w-full resize-y rounded border border-border bg-background px-2 py-1 text-sm ${textAt(shape.path) !== (base[shape.path] ?? "") ? "border-amber-400" : ""}`}
                      spellCheck
                    />
                  ) : (
                    <div key={shape.path} className="rounded border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground/60">
                      [{shape.type}] — not text, shown for context
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
