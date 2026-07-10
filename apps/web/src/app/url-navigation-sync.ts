import { useEffect, useRef } from "react";
import {
  searchFromNavigationState,
  urlNavigationPatchFromSearch,
  useUiStore,
} from "@/store/ui-store";

const NAVIGATION_SEARCH_KEYS = ["section", "invocation", "tool", "focus", "application", "routine", "run", "applicationResult", "eventLevel", "automation", "evidence"];

function replaceUrlSearch(search: string) {
  const nextUrl = `${window.location.pathname}${search}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, "", nextUrl);
  }
}

export function useUrlNavigationSync() {
  const applyingUrlRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    function applyLocationToStore() {
      applyingUrlRef.current = true;
      useUiStore.setState(urlNavigationPatchFromSearch(window.location.search));
      applyingUrlRef.current = false;
    }

    function writeStoreToLocation() {
      replaceUrlSearch(searchFromNavigationState(window.location.search, useUiStore.getState()));
    }

    const initialParams = new URLSearchParams(window.location.search);
    const hasInitialNavigation = NAVIGATION_SEARCH_KEYS.some((key) => initialParams.has(key));
    applyLocationToStore();
    if (!hasInitialNavigation) {
      writeStoreToLocation();
    }

    const unsubscribe = useUiStore.subscribe((state) => {
      if (applyingUrlRef.current) return;
      replaceUrlSearch(searchFromNavigationState(window.location.search, state));
    });
    window.addEventListener("popstate", applyLocationToStore);

    return () => {
      unsubscribe();
      window.removeEventListener("popstate", applyLocationToStore);
    };
  }, []);
}
