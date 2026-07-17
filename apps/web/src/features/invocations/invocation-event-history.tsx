import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { EventTimeline } from "@/features/invocations/event-timeline";
import { api, type InvocationEventsResponse } from "@/lib/api-client";
import type { InvocationEventSnapshot } from "@/lib/console-state";

const EVENT_PAGE_SIZE = 100;

/** Merge newest-window-first pages into one stable, lifecycle-ordered stream. */
export function mergeInvocationEventPages(
  pages: readonly Pick<InvocationEventsResponse, "events">[],
): InvocationEventSnapshot[] {
  const byId = new Map<string, InvocationEventSnapshot>();
  for (const page of pages) {
    for (const event of page.events) {
      // The first page is the freshest view of an event that straddles a page
      // boundary, so keep it when archived and hot rows overlap.
      if (!byId.has(event.id)) byId.set(event.id, event);
    }
  }
  return [...byId.values()].sort((left, right) => {
    const byOrdinal = compareEventOrdinals(left.id, right.id);
    if (byOrdinal !== 0) return byOrdinal;
    const byTime = left.createdAt.localeCompare(right.createdAt);
    return byTime || left.id.localeCompare(right.id);
  });
}

function compareEventOrdinals(left: string, right: string): number {
  const leftMatch = /([0-9]+)$/.exec(left);
  const rightMatch = /([0-9]+)$/.exec(right);
  if (leftMatch && rightMatch) {
    const leftOrdinal = BigInt(leftMatch[1]);
    const rightOrdinal = BigInt(rightMatch[1]);
    if (leftOrdinal < rightOrdinal) return -1;
    if (leftOrdinal > rightOrdinal) return 1;
    return 0;
  }
  if (leftMatch) return -1;
  if (rightMatch) return 1;
  return 0;
}

export function InvocationEventHistory({
  invocationId,
  live = false,
  renderAction,
}: {
  invocationId: string;
  live?: boolean;
  renderAction?: (event: InvocationEventSnapshot) => ReactNode;
}) {
  const query = useInfiniteQuery({
    queryKey: ["invocation-events", invocationId],
    queryFn: ({ pageParam }) =>
      api.listInvocationEvents(invocationId, {
        limit: EVENT_PAGE_SIZE,
        before: typeof pageParam === "string" ? pageParam : undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => (page.hasMore && page.nextCursor ? page.nextCursor : undefined),
    enabled: Boolean(invocationId),
    refetchInterval: live ? 700 : false,
  });

  // The state poll can observe the terminal invocation before this query's next
  // interval. Fetch once on that edge so the completion event is not missed.
  const previous = useRef({ invocationId, live });
  useEffect(() => {
    if (previous.current.invocationId === invocationId && previous.current.live && !live) {
      void query.refetch();
    }
    previous.current = { invocationId, live };
  }, [invocationId, live, query.refetch]);

  const pages = query.data?.pages ?? [];
  const events = useMemo(() => mergeInvocationEventPages(pages), [pages]);
  const retentionTruncated = pages.some((page) => page.retentionTruncated);

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">Loading session history…</p>;
  }

  if (query.isError && !query.data) {
    return (
      <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
        <p className="text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load session history."}
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {retentionTruncated ? (
        <div role="alert" className="rounded-md border border-warning/50 bg-warning/5 p-3 text-sm text-warning">
          {query.hasNextPage
            ? "History is retention-truncated. Load available older events; some earliest lifecycle events are unavailable."
            : "History is retention-truncated. Some earliest lifecycle events are unavailable."}
        </div>
      ) : null}

      {query.isRefetchError && !query.isFetchNextPageError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-warning/50 bg-warning/5 p-3 text-sm text-warning">
          <span>
            Session history refresh failed; showing previously loaded events.
            {query.error instanceof Error ? ` ${query.error.message}` : ""}
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={() => void query.refetch()}>
            Retry refresh
          </Button>
        </div>
      ) : null}

      {(query.hasNextPage || query.isFetchingNextPage) && !query.isFetchNextPageError ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "Loading older…" : "Load older"}
        </Button>
      ) : null}

      {query.isFetchNextPageError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>Failed to load older events.</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => void query.fetchNextPage()}>
            Retry older events
          </Button>
        </div>
      ) : null}

      {events.length > 0 ? (
        <EventTimeline events={events} renderAction={renderAction} />
      ) : (
        <EmptyState title="No session events" hint="No lifecycle events were recorded for this session." />
      )}
    </div>
  );
}
