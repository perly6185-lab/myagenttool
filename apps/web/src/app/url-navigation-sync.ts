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

function pushUrlSearch(search: string) {
  const nextUrl = `${window.location.pathname}${search}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.pushState(window.history.state, "", nextUrl);
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

    const unsubscribe = useUiStore.subscribe((state, previousState) => {
      if (applyingUrlRef.current) return;
      const search = searchFromNavigationState(window.location.search, state);
      if (
        state.section !== previousState.section
        || state.taskArea !== previousState.taskArea
        || state.settingsDialogOpen !== previousState.settingsDialogOpen
        || (state.selectedWorkItemId && !previousState.selectedWorkItemId)
      ) pushUrlSearch(search);
      else replaceUrlSearch(search);
    });
    window.addEventListener("popstate", applyLocationToStore);

    return () => {
      unsubscribe();
      window.removeEventListener("popstate", applyLocationToStore);
    };
  }, []);
}
