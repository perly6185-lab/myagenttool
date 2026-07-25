import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { fetchState } from "@/lib/api-client";
import type { ConsoleSnapshot } from "@/lib/console-state";
import { isControlPlaneStreamConnected } from "@/data/control-plane-stream";

const CONSOLE_STATE_KEY = ["console-state"] as const;

/**
 * Poll quickly only while work is active. Idle consoles back off and hidden
 * tabs pause entirely; mutations still invalidate immediately.
 */
export function useConsoleState() {
  return useQuery<ConsoleSnapshot>({
    queryKey: CONSOLE_STATE_KEY,
    queryFn: fetchState,
    refetchInterval: (query) => {
      if (isControlPlaneStreamConnected()) return 30_000;
      const snapshot = query.state.data;
      const active = snapshot?.invocations?.some((row) =>
        ["queued", "dispatching", "running", "awaiting_approval"].includes(String(row.status)));
      return active ? 1_000 : 5_000;
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

export function refreshConsoleState(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: CONSOLE_STATE_KEY });
}

/** Hook form for components that need to force a refresh after a mutation. */
export function useRefreshConsoleState(): () => Promise<void> {
  const client = useQueryClient();
  return () => refreshConsoleState(client);
}
