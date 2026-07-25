import { useEffect, useRef } from "react";

/**
 * Runs background refresh work only while the document is visible and performs
 * one catch-up refresh when the user returns to the tab.
 */
export function useVisibleInterval(
  callback: () => void,
  intervalMs: number,
  enabled = true,
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return undefined;

    const tick = () => {
      if (document.visibilityState === "visible") callbackRef.current();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") callbackRef.current();
    };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
