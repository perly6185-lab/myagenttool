import "@excalidraw/excalidraw/index.css";
import { Excalidraw, exportToBlob, exportToSvg, serializeAsJSON } from "@excalidraw/excalidraw";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/common/confirm-modal";
import {
  clearDraft,
  downloadBlob,
  loadDraftJSON,
  parseImportedScene,
  saveDraftJSON,
  sceneFilename,
} from "@/features/canvas/canvas-draft";

// Excalidraw's element/appState/API types live behind deep type paths; the
// editor only needs a thin structural view of the imperative API.
type Elements = readonly unknown[];
type AppState = Record<string, unknown>;
type BinaryFiles = Record<string, unknown>;
interface ExcalidrawApi {
  getSceneElements: () => Elements;
  getAppState: () => AppState;
  getFiles: () => BinaryFiles;
  updateScene: (scene: { elements?: unknown[]; appState?: Record<string, unknown> }) => void;
}

type SaveStatus = "idle" | "saving" | "saved";

/** Hydrate the editor once from the local draft (or a blank scene). */
function loadInitialData(): { elements: unknown[]; appState: AppState; files: BinaryFiles } | null {
  const raw = loadDraftJSON();
  if (!raw) return null;
  try {
    const scene = JSON.parse(raw) as Record<string, unknown>;
    return {
      elements: Array.isArray(scene.elements) ? scene.elements : [],
      appState: (scene.appState as AppState) ?? {},
      files: (scene.files as BinaryFiles) ?? {},
    };
  } catch {
    return null;
  }
}

const SAVE_DEBOUNCE_MS = 600;

export function CanvasEditor() {
  const apiRef = useRef<ExcalidrawApi | null>(null);
  const lastSavedRef = useRef<string | null>(loadDraftJSON());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<SaveStatus>(lastSavedRef.current ? "saved" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Loaded once — the editor stays uncontrolled after this, so parent re-renders
  // (e.g. the save-status flip) never feed elements back in and loop onChange.
  const initialData = useMemo(loadInitialData, []);

  const handleChange = useCallback((elements: Elements, appState: AppState, files: BinaryFiles) => {
    // Excalidraw fires onChange continuously, including idle appState noise. Gate
    // on the *serialized scene* actually differing so no-op events are ignored —
    // otherwise the status never settles off "Saving…" (a render/save loop).
    const json = serializeAsJSON(elements as never, appState as never, files as never, "local");
    if (json === lastSavedRef.current) return;
    setStatus((prev) => (prev === "saving" ? prev : "saving"));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      lastSavedRef.current = json;
      saveDraftJSON(json);
      setStatus("saved");
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const exportScene = useCallback(async (format: "excalidraw" | "png" | "svg") => {
    const api = apiRef.current;
    if (!api) return;
    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const files = api.getFiles();
    const now = new Date();
    try {
      if (format === "excalidraw") {
        const json = serializeAsJSON(elements as never, appState as never, files as never, "local");
        downloadBlob(json, sceneFilename("excalidraw", now), "application/json");
      } else if (format === "png") {
        const blob = await exportToBlob({
          elements: elements as never,
          appState: appState as never,
          files: files as never,
          mimeType: "image/png",
        });
        downloadBlob(blob, sceneFilename("png", now), "image/png");
      } else {
        const svg = await exportToSvg({
          elements: elements as never,
          appState: appState as never,
          files: files as never,
        });
        downloadBlob(new XMLSerializer().serializeToString(svg), sceneFilename("svg", now), "image/svg+xml");
      }
      setError(null);
    } catch {
      setError(`Could not export ${format.toUpperCase()}.`);
    }
  }, []);

  const onImportFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-importing the same file
    if (!file) return;
    try {
      const scene = parseImportedScene(await file.text());
      apiRef.current?.updateScene({ elements: scene.elements, appState: scene.appState });
      setError(null);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Import failed.");
    }
  }, []);

  const doClear = useCallback(() => {
    apiRef.current?.updateScene({ elements: [] });
    clearDraft();
    lastSavedRef.current = null;
    setStatus("idle");
    setError(null);
    setConfirmClear(false);
  }, []);

  const statusLabel = status === "saving" ? "Saving…" : status === "saved" ? "Saved locally" : "Draft";

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[480px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".excalidraw,application/json"
          className="hidden"
          onChange={onImportFile}
        />
        <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
          Import .excalidraw
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void exportScene("excalidraw")}>
          Export scene
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void exportScene("png")}>
          PNG
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void exportScene("svg")}>
          SVG
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
          Clear
        </Button>
        <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
          {statusLabel}
        </span>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
        <Excalidraw
          initialData={initialData as never}
          excalidrawAPI={(api: unknown) => {
            apiRef.current = api as ExcalidrawApi;
          }}
          onChange={handleChange as never}
        />
      </div>

      <ConfirmModal
        open={confirmClear}
        title="Clear the canvas?"
        description="This removes every element and deletes the local draft. It cannot be undone."
        confirmLabel="Clear canvas"
        destructive
        onConfirm={doClear}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  );
}
