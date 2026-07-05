import { useEffect, useRef } from "react";
import {
  searchFromNavigationState,
  urlNavigationPatchFromSearch,
  useUiStore,
} from "@/store/ui-store";

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

    applyLocationToStore();
    writeStoreToLocation();

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
