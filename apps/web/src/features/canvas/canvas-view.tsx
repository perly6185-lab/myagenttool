import { lazy, Suspense } from "react";

// Route-level lazy load: the heavy Excalidraw bundle is fetched only when the
// Canvas section is opened, so every other console section stays lean (#1351).
const CanvasEditor = lazy(() =>
  import("@/features/canvas/canvas-editor").then((module) => ({ default: module.CanvasEditor })),
);

export function CanvasView() {
  return (
    <Suspense
      fallback={
        <div className="grid h-[calc(100vh-8rem)] min-h-[480px] place-items-center text-sm text-muted-foreground">
          Loading the canvas…
        </div>
      }
    >
      <CanvasEditor />
    </Suspense>
  );
}
