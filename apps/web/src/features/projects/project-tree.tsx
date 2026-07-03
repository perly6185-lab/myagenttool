import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, File, Folder, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useConsoleState } from "@/data/use-console-state";
import { api } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/readable-labels";

// Single-letter git-status marker + tone for a tree entry.
export function gitStatusMarker(status: string): { label: string; tone: Tone } | null {
  switch (status) {
    case "modified":
      return { label: "M", tone: "warning" };
    case "added":
      return { label: "A", tone: "success" };
    case "deleted":
      return { label: "D", tone: "danger" };
    case "untracked":
      return { label: "U", tone: "neutral" };
    case "ignored":
      return { label: "I", tone: "neutral" };
    default:
      return null;
  }
}

/** Read-only file browser for the current project, scoped to its registered root. */
export function ProjectTree() {
  const { data: state } = useConsoleState();
  const queryClient = useQueryClient();
  const projectId = state?.currentProjectId ?? null;
  const [search, setSearch] = useState("");

  if (!projectId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Select a current project to browse its files.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Files</CardTitle>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Refresh file tree"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["project-tree", projectId] })}
          >
            <RefreshCw />
          </Button>
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search this folder…"
          className="mt-1 h-8"
        />
      </CardHeader>
      <CardContent>
        <TreeLevel projectId={projectId} path="" search={search.trim()} depth={0} />
      </CardContent>
    </Card>
  );
}

function TreeLevel({
  projectId,
  path,
  search,
  depth,
}: {
  projectId: string;
  path: string;
  search: string;
  depth: number;
}) {
  // Search only applies at the root level (the API filters per-directory).
  const effectiveSearch = depth === 0 ? search : "";
  const { data, isLoading, error } = useQuery({
    queryKey: ["project-tree", projectId, path, effectiveSearch],
    queryFn: () => api.projectTree(projectId, { path, search: effectiveSearch }),
  });

  if (isLoading) return <p className="px-1 py-0.5 text-xs text-muted-foreground">Loading…</p>;
  if (error) {
    return <p className="px-1 py-0.5 text-xs text-destructive">{error instanceof Error ? error.message : "Failed to load."}</p>;
  }
  const entries = data?.entries ?? [];
  if (!entries.length) {
    return <p className="px-1 py-0.5 text-xs text-muted-foreground">{effectiveSearch ? "No matches." : "Empty."}</p>;
  }

  return (
    <ul className="space-y-0.5">
      {entries.map((entry) =>
        entry.kind === "directory" ? (
          <TreeNode key={entry.path} projectId={projectId} entry={entry} depth={depth} />
        ) : (
          <li key={entry.path}>
            <TreeRow entry={entry} depth={depth} />
          </li>
        ),
      )}
      {data?.truncated ? (
        <li className="px-1 py-0.5 text-xs text-muted-foreground" style={{ paddingLeft: depth * 12 + 4 }}>
          Showing the first 200 entries.
        </li>
      ) : null}
    </ul>
  );
}

function TreeNode({
  projectId,
  entry,
  depth,
}: {
  projectId: string;
  entry: { name: string; path: string; gitStatus: string };
  depth: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm hover:bg-accent"
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{entry.name}</span>
        <StatusDot status={entry.gitStatus} />
      </button>
      {open ? <TreeLevel projectId={projectId} path={entry.path} search="" depth={depth + 1} /> : null}
    </li>
  );
}

function TreeRow({ entry, depth }: { entry: { name: string; gitStatus: string }; depth: number }) {
  return (
    <div
      className="flex items-center gap-1 rounded px-1 py-0.5 text-sm"
      style={{ paddingLeft: depth * 12 + 4 + 18 }}
    >
      <File className="size-3.5 shrink-0 text-muted-foreground" />
      <span className={cn("truncate", entry.gitStatus !== "clean" && "text-foreground")}>{entry.name}</span>
      <StatusDot status={entry.gitStatus} />
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const marker = gitStatusMarker(status);
  if (!marker) return null;
  const toneClass =
    marker.tone === "warning"
      ? "text-warning"
      : marker.tone === "success"
        ? "text-success"
        : marker.tone === "danger"
          ? "text-destructive"
          : "text-muted-foreground";
  return <span className={cn("ml-auto shrink-0 font-mono text-xs", toneClass)} title={status}>{marker.label}</span>;
}
