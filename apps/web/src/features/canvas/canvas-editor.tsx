import "@excalidraw/excalidraw/index.css";
import { Excalidraw, exportToBlob, exportToSvg, serializeAsJSON } from "@excalidraw/excalidraw";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { ConfirmModal } from "@/components/common/confirm-modal";
import { api, type CanvasScene } from "@/lib/api-client";
import { useCanvasScene, useCanvasScenes, useRefreshCanvas } from "@/data/use-canvas-scenes";
import { useUiStore } from "@/store/ui-store";
import { downloadBlob, parseImportedScene, sceneFilename } from "@/features/canvas/canvas-draft";
import {
  clearOfflineDraft,
  loadOfflineDraft,
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
}

const SAVE_DEBOUNCE_MS = 800;
const serialize = (elements: Elements, files: BinaryFiles = {}) =>
  serializeAsJSON(elements as never, {} as never, files as never, "local");

export function CanvasEditor() {
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
  const loadedSceneIdRef = useRef<string | null>(null);
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
    const elements = (elementsOverride ?? scene.elements) as unknown[];
    apiRef.current?.updateScene({ elements });
    localRevisionRef.current = scene.revision;
    setDisplayRevision(scene.revision);
    lastSyncedJsonRef.current = serialize(elements);
    suppressUntilRef.current = Date.now() + 600;
    dirtyRef.current = false;
    loadedSceneIdRef.current = scene.id;
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
          const draftElements = (JSON.parse(offline).elements ?? []) as unknown[];
          loadIntoEditor(serverScene, draftElements);
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
      // Network failure → keep the work as an offline draft, reconcile later.
      saveOfflineDraft(selectedSceneId, serialize(elements, files));
      setStatus("offline");
    }
  }, [selectedSceneId, refreshCanvas]);

  const handleChange = useCallback((elements: Elements, _appState: AppState, files: BinaryFiles) => {
    // Gate on the serialized scene actually differing so programmatic loads and
    // idle appState noise never mark the editor dirty (no save loop).
    const json = serialize(elements, files);
    // Absorb post-load normalization noise as the baseline; never a user edit.
    if (Date.now() < suppressUntilRef.current) {
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

  const createScene = useCallback(async (elements: unknown[] = [], name = "Untitled scene") => {
    try {
      const { scene } = await api.createCanvasScene({ name, elements });
      loadedSceneIdRef.current = null; // force a fresh load of the new scene
      setSelectedSceneId(scene.id);
      setStatus("saved");
      setError(null);
      await refreshCanvas(scene.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the scene.");
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
    await createScene(elements, `${nameDraft || "Scene"} (copy)`);
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
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete the scene.");
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
      setError(`Could not export ${format.toUpperCase()}.`);
    }
  }, []);

  const onImportFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const scene = parseImportedScene(await file.text());
      await createScene(scene.elements, file.name.replace(/\.excalidraw$/i, "") || "Imported scene");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Import failed.");
    }
  }, [createScene]);

  const statusLabel = useMemo(() => {
    switch (status) {
      case "saving": return "Saving…";
      case "saved": return `Saved · v${displayRevision}`;
      case "conflict": return "Newer version on server";
      case "offline": return "Offline · unsaved";
      case "error": return "Save failed";
      default: return "";
    }
  }, [status, displayRevision]);

  const hasScene = Boolean(selectedSceneId && serverScene);

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[480px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="场景"
          className="h-8 w-52"
          value={selectedSceneId ?? ""}
          onChange={(event) => {
            loadedSceneIdRef.current = null;
            setSelectedSceneId(event.target.value || null);
          }}
        >
          <option value="">{scenes.length ? "Select a scene…" : "No scenes yet"}</option>
          {scenes.map((scene) => (
            <option key={scene.id} value={scene.id}>{scene.name}</option>
          ))}
        </Select>
        <Button variant="secondary" size="sm" onClick={() => void createScene()}>New scene</Button>

        {hasScene ? (
          <>
            <input
              aria-label="场景名称"
              className="h-8 w-44 rounded-md border border-input bg-background px-2 text-sm"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => void renameScene()}
              onKeyDown={(event) => event.key === "Enter" && void renameScene()}
            />
            <input ref={fileInputRef} type="file" accept=".excalidraw,application/json" className="hidden" onChange={onImportFile} />
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>Import</Button>
            <Button variant="secondary" size="sm" onClick={() => void exportScene("excalidraw")}>Export</Button>
            <Button variant="secondary" size="sm" onClick={() => void exportScene("png")}>PNG</Button>
            <Button variant="secondary" size="sm" onClick={() => void exportScene("svg")}>SVG</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>
          </>
        ) : null}

        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          {serverScene?.lastModifiedBy ? <span className="hidden sm:inline">last edit · {serverScene.lastModifiedBy}</span> : null}
          <span data-testid="canvas-save-status">{statusLabel}</span>
        </span>
      </div>

      {status === "conflict" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs">
          <span className="text-foreground">A newer version of this scene is on the server. Choose how to keep your work:</span>
          <Button variant="secondary" size="sm" onClick={reloadNewer}>Reload newer</Button>
          <Button variant="secondary" size="sm" onClick={() => void saveAsCopy()}>Save my work as a copy</Button>
        </div>
      ) : null}

      {status === "offline" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted px-3 py-2 text-xs">
          <span className="text-foreground">You have unsaved offline edits for this scene.</span>
          <Button variant="secondary" size="sm" onClick={() => void runSave()}>Retry save</Button>
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
              ? "Select a scene above, or create a new one."
              : "No scenes yet. Create your first scene, or ask an agent to draw one."}
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmDelete}
        title="Delete this scene?"
        description="This permanently removes the scene for the whole team."
        confirmLabel="Delete scene"
        destructive
        onConfirm={() => void doDelete()}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
