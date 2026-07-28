import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openControlPlaneEventStream } from "@/lib/api-client";
import { api } from "@/lib/api-client";
import { setControlPlaneStreamConnected } from "@/data/control-plane-stream";

export function useControlPlaneEvents() {
  const queryClient = useQueryClient();
  useEffect(() => {
    let stopped = false;
    let retryTimer: number | undefined;
    let attempt = 0;
    let controller: AbortController | null = null;
    let lastEventId = window.sessionStorage.getItem("myagenttool.event-stream.cursor");

    const connect = async () => {
      if (attempt > 0) void api.reportEventStreamReconnect().catch(() => {});
      controller = new AbortController();
      try {
        await openControlPlaneEventStream(({ id, event }) => {
          if (id) {
            lastEventId = id;
            window.sessionStorage.setItem("myagenttool.event-stream.cursor", id);
          }
          if (event === "ready") {
            attempt = 0;
            setControlPlaneStreamConnected(true);
          }
          if (event === "state") {
            void queryClient.invalidateQueries();
            window.dispatchEvent(new CustomEvent("myagenttool:state-change"));
          }
        }, controller.signal, lastEventId);
      } catch {
        // The bounded retry below hands control back to polling while offline.
      }
      if (stopped) return;
      setControlPlaneStreamConnected(false);
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt++, 5));
      retryTimer = window.setTimeout(connect, delay);
    };
    void connect();
    return () => {
      stopped = true;
      controller?.abort();
      if (retryTimer) window.clearTimeout(retryTimer);
      setControlPlaneStreamConnected(false);
    };
  }, [queryClient]);
}
