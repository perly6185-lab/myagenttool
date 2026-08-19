import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type { LocalContentKind } from "./local-content-types";
import type { LocalContentSearchQuery } from "./local-content-api";

const PAGE_SIZE = 30;

export function useLocalContentFilters() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [kind, setKind] = useState<"all" | LocalContentKind>("all");
  const [projectId, setProjectId] = useState("all");
  const [workItemId, setWorkItemId] = useState("all");
  const [sourceType, setSourceType] = useState("all");
  const [yearMonth, setYearMonth] = useState("all");
  const [availability, setAvailability] = useState<"all" | "available" | "unavailable">("all");
  const [indexStatus, setIndexStatus] = useState<"all" | "ready" | "partial" | "metadata_only" | "missing">("all");
  const [mailAccountId, setMailAccountId] = useState("all");
  const [mailFolderId, setMailFolderId] = useState("all");
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);

  const resetPage = useCallback(() => {
    setPage(0);
    setCursors([null]);
  }, []);

  const previousPage = useCallback(() => {
    setPage((value) => Math.max(0, value - 1));
  }, []);

  const nextPage = useCallback((nextCursor: string | null | undefined) => {
    if (!nextCursor) return;
    setCursors((value) => [...value.slice(0, page + 1), nextCursor]);
    setPage((value) => value + 1);
  }, [page]);

  const resetFilters = useCallback(() => {
    setQuery("");
    setKind("all");
    setProjectId("all");
    setWorkItemId("all");
    setSourceType("all");
    setYearMonth("all");
    setAvailability("all");
    setIndexStatus("all");
    setMailAccountId("all");
    setMailFolderId("all");
    resetPage();
  }, [resetPage]);

  const advancedFilterCount = [workItemId, sourceType, yearMonth, availability, indexStatus]
    .filter((value) => value !== "all").length;
  const activeFilterCount = advancedFilterCount
    + (kind === "all" ? 0 : 1)
    + (projectId === "all" ? 0 : 1)
    + (mailAccountId === "all" ? 0 : 1)
    + (mailFolderId === "all" ? 0 : 1)
    + (query.trim() ? 1 : 0);

  const searchQuery = useMemo<LocalContentSearchQuery>(() => ({
    q: deferredQuery || undefined,
    kinds: kind === "all" ? undefined : [kind],
    projectId: projectId === "all" ? undefined : projectId,
    workItemId: workItemId === "all" ? undefined : workItemId,
    sourceType: sourceType === "all" ? undefined : sourceType,
    yearMonth: yearMonth === "all" ? undefined : yearMonth,
    availability: availability === "all" ? undefined : availability,
    indexStatus: indexStatus === "all" ? undefined : indexStatus,
    mailAccountId: mailAccountId === "all" ? undefined : mailAccountId,
    mailFolderId: mailFolderId === "all" ? undefined : mailFolderId,
    limit: PAGE_SIZE,
    cursor: cursors[page] ?? undefined,
  }), [availability, cursors, deferredQuery, indexStatus, kind, mailAccountId, mailFolderId, page, projectId, sourceType, workItemId, yearMonth]);

  return {
    query,
    setQuery,
    kind,
    setKind,
    projectId,
    setProjectId,
    workItemId,
    setWorkItemId,
    sourceType,
    setSourceType,
    yearMonth,
    setYearMonth,
    availability,
    setAvailability,
    indexStatus,
    setIndexStatus,
    mailAccountId,
    setMailAccountId,
    mailFolderId,
    setMailFolderId,
    page,
    resetPage,
    previousPage,
    nextPage,
    resetFilters,
    advancedFilterCount,
    activeFilterCount,
    searchQuery,
  };
}
