import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CanvasScene, type CanvasSceneSummary } from "@/lib/api-client";
import { QUERY_POLLING, visiblePolling } from "@/lib/query-polling";

const SCENES_KEY = ["canvas-scenes"] as const;
const sceneKey = (id: string | null) => ["canvas-scene", id] as const;

/**
 * The project's scenes for the selector. Polled so an agent-created scene (#1353)
 * appears without a page reload.
 */
export function useCanvasScenes() {
  return useQuery<CanvasSceneSummary[]>({
    queryKey: SCENES_KEY,
    queryFn: async () => (await api.listCanvasScenes()).scenes,
    refetchInterval: () => visiblePolling(QUERY_POLLING.sharedStateFallback),
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

/**
 * The open scene. Polled so an agent's edits to it arrive as a background
 * refresh; the editor reconciles them against unsaved local work.
 */
export function useCanvasScene(sceneId: string | null) {
  return useQuery<CanvasScene | null>({
    queryKey: sceneKey(sceneId),
    enabled: Boolean(sceneId),
    queryFn: async () => (sceneId ? (await api.getCanvasScene(sceneId)).scene : null),
    refetchInterval: () => visiblePolling(QUERY_POLLING.sharedStateFallback),
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

/** Force-refresh the scene list + the open scene after a local mutation. */
export function useRefreshCanvas(): (sceneId?: string | null) => Promise<void> {
  const client = useQueryClient();
  return async (sceneId) => {
    await client.invalidateQueries({ queryKey: SCENES_KEY });
    if (sceneId !== undefined) await client.invalidateQueries({ queryKey: sceneKey(sceneId) });
  };
}
