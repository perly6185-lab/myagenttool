import "@excalidraw/excalidraw/index.css";
import { Excalidraw, exportToBlob, exportToSvg, serializeAsJSON } from "@excalidraw/excalidraw";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { ConfirmModal } from "@/components/common/confirm-modal";
import { api, type CanvasScene } from "@/lib/api-client";
import { useCanvasScene, useCanvasScenes, useRefreshCanvas } from "@/data/use-canvas-scenes";
import { useUiStore } from "@/store/ui-store";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { downloadBlob, parseImportedScene, sceneFilename } from "@/features/canvas/canvas-draft";
import {
  clearOfflineDraft,
  heldImageElementIds,
  loadOfflineDraft,
  normalizeLoadedImageElements,
  reconcile,
  saveOfflineDraft,
  type CanvasSaveStatus,
} from "@/features/canvas/canvas-sync";

type Elements = readonly unknown[];
type AppState = Record<string, unknown>;
type BinaryFiles = Record<string, unknown>;
interface ExcalidrawApi {
  getSceneElements: () => Elements;
  getAppState: () => AppState;
  getFiles: () => BinaryFiles;
  updateScene: (scene: { elements?: unknown[] }) => void;
  addFiles: (files: unknown[]) => void;
}

const SAVE_DEBOUNCE_MS = 800;
const serialize = (elements: Elements, files: BinaryFiles = {}) =>
  serializeAsJSON(elements as never, {} as never, files as never, "local");

export function CanvasEditor() {
  const { t } = useAppTranslation();
  const selectedSceneId = useUiStore((s) => s.selectedCanvasSceneId);
  const setSelectedSceneId = useUiStore((s) => s.setSelectedCanvasSceneId);
  const scenesQuery = useCanvasScenes();
  const sceneQuery = useCanvasScene(selectedSceneId);
  const refreshCanvas = useRefreshCanvas();
  const scenes = scenesQuery.data ?? [];
  const serverScene = sceneQuery.data ?? null;

  const apiRef = useRef<ExcalidrawApi | null>(null);
  const localRevisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const lastSyncedJsonRef = useRef<string | null>(null);
  // Excalidraw fires onChange while it normalizes freshly-loaded elements; treat
  // those as the new baseline (never a user edit) so a load can't spuriously save.
  const suppressUntilRef = useRef(0);
  // True while the reassert loop is re-applying a freshly-loaded scene. onChange is
  // suppressed on THIS flag (not just the wall-clock window) so a reassert that
  // outran the window — slow device, or a backgrounded tab where rAF pauses while
  // Date.now keeps advancing — can't be mis-read as a user edit.
  const reassertingRef = useRef(false);
  const loadedSceneIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<CanvasSaveStatus>("idle");
  const [displayRevision, setDisplayRevision] = useState(0);
  const [apiReady, setApiReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Load a scene's content into the editor; resets local revision + dirty. */
  const loadIntoEditor = useCallback((scene: CanvasScene, elementsOverride?: unknown[]) => {
    const files = scene.files ?? {};
    const haveFile = new Set(Object.keys(files));
    // Flip any image whose binary we hold from "pending" to "saved" — Excalidraw
    // only resolves a "saved" image against the file cache; a "pending" one (how a
    // freshly dropped image can persist) stays blank.
    const elements = normalizeLoadedImageElements(
      (elementsOverride ?? scene.elements) as Record<string, unknown>[],
      haveFile,
    );
    // Warm the file cache ONCE before adding the elements that reference it — the
    // file set never changes between frames, so re-adding (re-decoding) MBs of
    // base64 per reassert frame is wasted work. Only updateScene is re-asserted.
    if (haveFile.size) apiRef.current?.addFiles(Object.values(files));
    apiRef.current?.updateScene({ elements });
    // At first mount Excalidraw's image-file cache isn't ready, so it silently
    // prunes image elements whose binary hasn't decoded — a scene's images vanish
    // on load. Re-assert updateScene over a few animation frames until every image
    // we HOLD A FILE FOR sticks (an image with a missing file can never stick, so
    // it is excluded — else the loop would burn all 10 frames on every load).
    const wantImageIds = heldImageElementIds(elements, haveFile);
    reassertingRef.current = wantImageIds.length > 0;
    if (reassertingRef.current) {
      let tries = 0;
      const reassert = () => {
        // A newer load (scene switch) or unmount owns the flag now — stop silently.
        if (!mountedRef.current || loadedSceneIdRef.current !== scene.id) return;
        const have = new Set(((apiRef.current?.getSceneElements() ?? []) as Record<string, unknown>[]).map((e) => e.id));
        if (wantImageIds.some((id) => !have.has(id)) && tries < 10) {
          tries += 1;
          apiRef.current?.updateScene({ elements });
          requestAnimationFrame(reassert);
          return;
        }
        // Settled (images stuck, or the retry budget is spent). Close suppression on
        // the SAME clock the loop runs on: extend (never shrink) the window so the
        // final normalization onChange is absorbed even when the loop outran the
        // original wall-clock window.
        reassertingRef.current = false;
        suppressUntilRef.current = Math.max(suppressUntilRef.current, Date.now() + 300);
      };
      requestAnimationFrame(reassert);
    }
    localRevisionRef.current = scene.revision;
    setDisplayRevision(scene.revision);
    lastSyncedJsonRef.current = serialize(elements, files);
    suppressUntilRef.current = Date.now() + 600;
    dirtyRef.current = false;
    loadedSceneIdRef.current = scene.id;
  }, []);

  // On unmount, stop the reassert loop and cancel a pending debounced save so
  // neither reaches into a torn-down Excalidraw instance.
  useEffect(() => () => {
    mountedRef.current = false;
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  // First load / scene switch / background refresh — all driven by the polled
  // server scene. Offline drafts recover unsaved work; a newer server revision
  // either applies (no local edits) or raises a conflict (never overwrites).
  useEffect(() => {
    if (!serverScene || !apiReady || !apiRef.current) return;
    setNameDraft(serverScene.name);
    if (loadedSceneIdRef.current !== serverScene.id) {
      const offline = loadOfflineDraft(serverScene.id);
      if (offline) {
        try {
          const draft = JSON.parse(offline) as { elements?: unknown[]; baseRevision?: number };
          loadIntoEditor(serverScene, draft.elements ?? []);
          // Anchor the unsaved work to the revision it was BASED on, not the
          // current server one — a retry then conflicts if the server has moved.
          if (typeof draft.baseRevision === "number") localRevisionRef.current = draft.baseRevision;
          dirtyRef.current = true;
          setStatus("offline");
          return;
        } catch {
          /* fall through to a clean server load */
        }
      }
      loadIntoEditor(serverScene);
      setStatus("saved");
      return;
    }
    const action = reconcile({
      localRevision: localRevisionRef.current,
      dirty: dirtyRef.current,
      serverRevision: serverScene.revision,
    });
    if (action === "apply-server") {
      loadIntoEditor(serverScene);
      setStatus("saved");
    } else if (action === "conflict") {
      setStatus("conflict");
    }
  }, [serverScene, apiReady, loadIntoEditor]);

  const runSave = useCallback(async () => {
    const editor = apiRef.current;
    if (!editor || !selectedSceneId || !dirtyRef.current) return;
    const elements = editor.getSceneElements() as unknown[];
    const files = editor.getFiles();
    setStatus("saving");
    try {
      const result = await api.saveCanvasScene(selectedSceneId, {
        elements,
        files,
        expectedRevision: localRevisionRef.current,
      });
      if (result.ok) {
        localRevisionRef.current = result.scene.revision;
        setDisplayRevision(result.scene.revision);
        lastSyncedJsonRef.current = serialize(elements, files);
        dirtyRef.current = false;
        clearOfflineDraft(selectedSceneId);
        setStatus("saved");
        void refreshCanvas(selectedSceneId);
      } else if (result.conflict) {
        setStatus("conflict"); // the poll will fetch the newer scene for the banner
      } else {
        setError(result.error);
        setStatus("error");
      }
    } catch {
      // Network failure → keep the work as an offline draft WITH its base
      // revision, so a later retry re-checks against the server (a stale retry
      // must conflict, never silently overwrite a newer revision).
      saveOfflineDraft(selectedSceneId, JSON.stringify({ elements, files, baseRevision: localRevisionRef.current }));
      setStatus("offline");
    }
  }, [selectedSceneId, refreshCanvas]);

  const handleChange = useCallback((elements: Elements, _appState: AppState, files: BinaryFiles) => {
    // Gate on the serialized scene actually differing so programmatic loads and
    // idle appState noise never mark the editor dirty (no save loop).
    const json = serialize(elements, files);
    // Absorb post-load normalization noise as the baseline; never a user edit.
    // Gate on the reassert flag AND the wall-clock window: the flag covers the whole
    // (frame-paced) reassert, the window the brief tail after it settles.
    if (reassertingRef.current || Date.now() < suppressUntilRef.current) {
      lastSyncedJsonRef.current = json;
      return;
    }
    if (json === lastSyncedJsonRef.current) return;
    lastSyncedJsonRef.current = json;
    dirtyRef.current = true;
    setStatus((prev) => (prev === "conflict" || prev === "offline" ? prev : "saving"));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void runSave(), SAVE_DEBOUNCE_MS);
  }, [runSave]);

  const createScene = useCallback(async (elements: unknown[] = [], name: string = t("canvasPage.untitled")) => {
    try {
      const { scene } = await api.createCanvasScene({ name, elements });
      loadedSceneIdRef.current = null; // force a fresh load of the new scene
      setSelectedSceneId(scene.id);
      setStatus("saved");
      setError(null);
      await refreshCanvas(scene.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t("canvasPage.createFailed"));
    }
  }, [setSelectedSceneId, refreshCanvas]);

  // Discard local work and load the freshest server scene. Fetches directly so
  // it is correct whether the conflict came from the poll or a save 409.
  const reloadNewer = useCallback(async () => {
    if (!selectedSceneId) return;
    try {
      const { scene } = await api.getCanvasScene(selectedSceneId);
      loadIntoEditor(scene);
      clearOfflineDraft(selectedSceneId);
      setStatus("saved");
    } catch {
      /* transient — the poll will retry */
    }
  }, [selectedSceneId, loadIntoEditor]);

  const saveAsCopy = useCallback(async () => {
    const elements = (apiRef.current?.getSceneElements() ?? []) as unknown[];
    await createScene(elements, t("canvasPage.copyName", { name: nameDraft || t("canvasPage.scene") }));
  }, [createScene, nameDraft]);

  const renameScene = useCallback(async () => {
    if (!selectedSceneId || !nameDraft.trim() || nameDraft === serverScene?.name) return;
    try {
      const result = await api.saveCanvasScene(selectedSceneId, { name: nameDraft.trim(), expectedRevision: localRevisionRef.current });
      if (result.ok) {
        localRevisionRef.current = result.scene.revision;
        await refreshCanvas(selectedSceneId);
      }
    } catch {
      /* rename is best-effort; the name stays editable */
    }
  }, [selectedSceneId, nameDraft, serverScene, refreshCanvas]);

  const doDelete = useCallback(async () => {
    setConfirmDelete(false);
    if (!selectedSceneId) return;
    try {
      await api.deleteCanvasScene(selectedSceneId, localRevisionRef.current);
      clearOfflineDraft(selectedSceneId);
      loadedSceneIdRef.current = null;
      setSelectedSceneId(null);
      await refreshCanvas(selectedSceneId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("canvasPage.deleteFailed"));
    }
  }, [selectedSceneId, setSelectedSceneId, refreshCanvas]);

  const exportScene = useCallback(async (format: "excalidraw" | "png" | "svg") => {
    const editor = apiRef.current;
    if (!editor) return;
    const elements = editor.getSceneElements();
    const appState = editor.getAppState();
    const files = editor.getFiles();
    const now = new Date();
    try {
      if (format === "excalidraw") {
        downloadBlob(serialize(elements, files), sceneFilename("excalidraw", now), "application/json");
      } else if (format === "png") {
        const blob = await exportToBlob({ elements: elements as never, appState: appState as never, files: files as never, mimeType: "image/png" });
        downloadBlob(blob, sceneFilename("png", now), "image/png");
      } else {
        const svg = await exportToSvg({ elements: elements as never, appState: appState as never, files: files as never });
        downloadBlob(new XMLSerializer().serializeToString(svg), sceneFilename("svg", now), "image/svg+xml");
      }
    } catch {
      setError(t("canvasPage.exportFailed", { format: format.toUpperCase() }));
    }
  }, []);

  const onImportFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const scene = parseImportedScene(await file.text());
      await createScene(scene.elements, file.name.replace(/\.excalidraw$/i, "") || t("canvasPage.imported"));
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : t("canvasPage.importFailed"));
    }
  }, [createScene]);

  const statusLabel = useMemo(() => {
    switch (status) {
      case "saving": return t("canvasPage.saving");
      case "saved": return t("canvasPage.saved", { revision: displayRevision });
      case "conflict": return t("canvasPage.newer");
      case "offline": return t("canvasPage.offline");
      case "error": return t("canvasPage.saveFailed");
      default: return "";
    }
  }, [status, displayRevision]);

  const hasScene = Boolean(selectedSceneId && serverScene);

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[480px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={t("canvasPage.scene")}
          className="h-8 w-52"
          value={selectedSceneId ?? ""}
          onChange={(event) => {
            loadedSceneIdRef.current = null;
            setSelectedSceneId(event.target.value || null);
          }}
        >
          <option value="">{scenes.length ? t("canvasPage.selectScene") : t("canvasPage.noScenes")}</option>
          {scenes.map((scene) => (
            <option key={scene.id} value={scene.id}>{scene.name}</option>
          ))}
        </Select>
        <Button variant="secondary" size="sm" onClick={() => void createScene()}>{t("canvasPage.newScene")}</Button>

        {hasScene ? (
          <>
            <input
              aria-label={t("canvasPage.sceneName")}
              className="h-8 w-44 rounded-md border border-input bg-background px-2 text-sm"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => void renameScene()}
              onKeyDown={(event) => event.key === "Enter" && void renameScene()}
            />
            <input ref={fileInputRef} type="file" accept=".excalidraw,application/json" className="hidden" onChange={onImportFile} />
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>{t("canvasPage.import")}</Button>
            <Button variant="secondary" size="sm" onClick={() => void exportScene("excalidraw")}>{t("canvasPage.export")}</Button>
            <Button variant="secondary" size="sm" onClick={() => void exportScene("png")}>PNG</Button>
            <Button variant="secondary" size="sm" onClick={() => void exportScene("svg")}>SVG</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>{t("canvasPage.delete")}</Button>
          </>
        ) : null}

        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          {serverScene?.lastModifiedBy ? <span className="hidden sm:inline">{t("canvasPage.lastEdit")} · {serverScene.lastModifiedBy}</span> : null}
          <span data-testid="canvas-save-status">{statusLabel}</span>
        </span>
      </div>

      {status === "conflict" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs">
          <span className="text-foreground">{t("canvasPage.conflictHint")}</span>
          <Button variant="secondary" size="sm" onClick={reloadNewer}>{t("canvasPage.reload")}</Button>
          <Button variant="secondary" size="sm" onClick={() => void saveAsCopy()}>{t("canvasPage.saveCopy")}</Button>
        </div>
      ) : null}

      {status === "offline" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted px-3 py-2 text-xs">
          <span className="text-foreground">{t("canvasPage.offlineHint")}</span>
          <Button variant="secondary" size="sm" onClick={() => void runSave()}>{t("canvasPage.retrySave")}</Button>
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
        {hasScene ? (
          <Excalidraw
            excalidrawAPI={(instance: unknown) => { apiRef.current = instance as ExcalidrawApi; setApiReady(true); }}
            onChange={handleChange as never}
          />
        ) : (
          <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">
            {scenes.length
              ? t("canvasPage.selectHint")
              : t("canvasPage.emptyHint")}
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmDelete}
        title={t("canvasPage.deleteTitle")}
        description={t("canvasPage.deleteDescription")}
        confirmLabel={t("canvasPage.deleteScene")}
        destructive
        onConfirm={() => void doDelete()}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
