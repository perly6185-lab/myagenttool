import { useEffect, useState } from "react";

interface WindowControlsOverlay {
  visible: boolean;
  addEventListener(type: "geometrychange", listener: () => void): void;
  removeEventListener(type: "geometrychange", listener: () => void): void;
}

function getOverlay(): WindowControlsOverlay | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlay }).windowControlsOverlay;
}

/**
 * Whether the Windows window-controls overlay is currently showing. True only in
 * the Electron desktop shell on Windows; false in browsers and on macOS/Linux —
 * so the topbar's caption-button spacer is in the DOM exactly when it's needed
 * and never eats layout (a zero-width flex spacer still consumes the row's gap).
 */
export function useWindowControlsOverlay(): boolean {
  const [visible, setVisible] = useState(() => getOverlay()?.visible ?? false);

  useEffect(() => {
    const overlay = getOverlay();
    if (!overlay) return;
    const update = () => setVisible(overlay.visible);
    update();
    overlay.addEventListener("geometrychange", update);
    return () => overlay.removeEventListener("geometrychange", update);
  }, []);

  return visible;
}
