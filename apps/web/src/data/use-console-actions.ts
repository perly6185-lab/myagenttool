import { useCallback, useState } from "react";
import { api } from "@/lib/api-client";
import { useRefreshConsoleState } from "@/data/use-console-state";

/**
 * Bind the API actions to a state refresh. Every action triggers an immediate
 * `/api/state` refetch instead of waiting for the next poll, so the UI reacts
 * to the user's intent without lag.
 */
export function useConsoleActions() {
  const refresh = useRefreshConsoleState();
  return useCallback(
    function run<T>(action: () => Promise<T>): Promise<T> {
      return action().finally(() => {
        void refresh();
      });
    },
    [refresh],
  );
}

/** Track pending/error around a single async action (for button busy states). */
export function useAsyncAction() {
  const run = useConsoleActions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (action: () => Promise<unknown>) => {
      setPending(true);
      setError(null);
      try {
        await run(action);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Action failed.");
      } finally {
        setPending(false);
      }
    },
    [run],
  );

  return { execute, pending, error };
}

export { api };
