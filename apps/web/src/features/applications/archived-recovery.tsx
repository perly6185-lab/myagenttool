import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/data/use-console-actions";

// The read half of the retention archive (server: retention-archive.mjs): recovery
// actions the 200-row cap evicted from the live window, fetched on demand so an
// audit survives past the cap. Collapsed by default; only queries when opened.
export function ArchivedRecoveryActions({ applicationId }: { applicationId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["application-recovery-archive", applicationId],
    queryFn: () => api.getApplicationRecoveryArchive(applicationId, 100),
    enabled: open,
  });
  const entries = data?.entries ?? [];
  return (
    <details
      className="rounded-md border border-border bg-muted/40 p-2"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-xs font-medium">Archived recovery actions</summary>
      {isLoading ? <p className="mt-2 text-xs text-muted-foreground">Loading archive…</p> : null}
      {error ? <p className="mt-2 text-xs text-destructive">Could not read the recovery archive.</p> : null}
      {open && !isLoading && !error && !entries.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Nothing evicted yet — every recovery action is still in the live window.
        </p>
      ) : null}
      {entries.length ? (
        <ul className="mt-2 space-y-1">
          {entries.map((entry, i) => {
            const row = entry.row as {
              id?: string;
              actionType?: string;
              status?: string;
              invocationId?: string;
              routineId?: string;
            };
            return (
              <li key={row.id ?? i} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{String(row.actionType ?? "recovery").replaceAll("_", " ")}</span>
                {row.status ? <span className="text-muted-foreground">{String(row.status).replaceAll("_", " ")}</span> : null}
                {row.invocationId ? <span className="font-mono text-muted-foreground">{row.invocationId}</span> : null}
                {entry.archivedAt ? (
                  <span className="ml-auto font-mono text-muted-foreground">archived {String(entry.archivedAt).slice(0, 10)}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </details>
  );
}
