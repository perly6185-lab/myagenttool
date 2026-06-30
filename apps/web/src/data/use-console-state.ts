import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { fetchState } from "@/lib/api-client";
import type { ConsoleSnapshot } from "@/lib/console-state";

const CONSOLE_STATE_KEY = ["console-state"] as const;

/**
 * Poll GET /api/state on the same 700ms cadence the M0 console used. React
 * Query gives us cached data, connection status, and a single invalidation
 * point that mutations can trigger for an immediate refresh.
 */
export function useConsoleState() {
  return useQuery<ConsoleSnapshot>({
    queryKey: CONSOLE_STATE_KEY,
    queryFn: fetchState,
    refetchInterval: 700,
    refetchIntervalInBackground: true,
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
