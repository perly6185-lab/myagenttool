import { useCallback } from "react";
import { api, useAsyncAction } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";

/**
 * Keep every project switch on the same server-backed path. Local selection is
 * updated immediately for focused controls, then restored if the server rejects
 * the switch so the shell never displays two competing project contexts.
 */
export function useCurrentProjectSelection() {
  const action = useAsyncAction();
  const setSelectedProjectId = useUiStore((state) => state.setSelectedProjectId);
  const setSelectedWorktreeId = useUiStore((state) => state.setSelectedWorktreeId);

  const selectProject = useCallback(async (projectId: string, currentProjectId?: string | null) => {
    if (!projectId || projectId === currentProjectId) return true;
    const previous = useUiStore.getState();
    setSelectedProjectId(projectId);
    setSelectedWorktreeId(null);
    const succeeded = await action.execute(() => api.selectProject(projectId));
    if (!succeeded) {
      setSelectedProjectId(previous.selectedProjectId ?? currentProjectId ?? null);
      setSelectedWorktreeId(previous.selectedWorktreeId);
    }
    return succeeded;
  }, [action.execute, setSelectedProjectId, setSelectedWorktreeId]);

  return { selectProject, pending: action.pending, error: action.error, reset: action.reset };
}
