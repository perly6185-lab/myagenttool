import { useEffect } from "react";
import { applySkin, watchSystemMode } from "@/lib/skins";
import { useUiStore } from "@/store/ui-store";

/**
 * Keep the document (and the Electron shell) in sync with the store's skin +
 * mode. Applies on mount and on every change; while mode is `system`, also
 * re-applies when the OS light/dark preference flips. An inline script in
 * index.html paints the correct skin before React mounts, so this hook only
 * reconciles — it does not cause a flash.
 */
export function useSkinSync(): void {
  const skin = useUiStore((s) => s.skin);
  const mode = useUiStore((s) => s.mode);

  useEffect(() => {
    applySkin(skin, mode);
    if (mode !== "system") return;
    return watchSystemMode(() => applySkin(skin, mode));
  }, [skin, mode]);
}
