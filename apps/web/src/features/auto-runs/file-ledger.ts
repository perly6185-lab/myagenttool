// Reconcile a run's captured file ledger (reads/writes from the agent's tool_use
// stream) against the worktree git diff. Writes are absolute worktree paths; the
// diff lists repo-relative paths — a write matches a diff entry when it equals, or
// ends with `/`+, that entry.
//
//   - inDiff === false  → the agent wrote the file but nothing changed (a no-op edit)
//   - diffOnly          → files in the diff with NO tracked write; they changed from
//                         outside the explicit file tools (a Bash command, codegen),
//                         which the ledger can't see. Surfaced, not hidden.
//
// The server keeps only the accumulator (mergeFileAccesses); this cross-check lives
// client-side because the web already fetches the diff.

export interface FileLedger {
  reads?: string[];
  writes?: string[];
  truncated?: boolean;
}

export interface ReconciledLedger {
  reads: string[];
  writes: { path: string; inDiff: boolean | null }[];
  readCount: number;
  writeCount: number;
  truncated: boolean;
  diffOnly: string[];
}

function writeMatchesDiffEntry(writePath: string, diffEntry: string): boolean {
  return writePath === diffEntry || writePath.endsWith(`/${diffEntry}`);
}

export function reconcileFileLedger(
  ledger: FileLedger | null | undefined,
  changedPaths: string[] | null,
): ReconciledLedger {
  const reads = ledger?.reads ?? [];
  const writes = ledger?.writes ?? [];
  const diff = Array.isArray(changedPaths) ? changedPaths.filter(Boolean) : null;
  return {
    reads,
    writes: writes.map((path) => ({
      path,
      inDiff: diff == null ? null : diff.some((entry) => writeMatchesDiffEntry(path, entry)),
    })),
    readCount: reads.length,
    writeCount: writes.length,
    truncated: Boolean(ledger?.truncated),
    diffOnly: diff == null ? [] : diff.filter((entry) => !writes.some((w) => writeMatchesDiffEntry(w, entry))),
  };
}

// Trim a captured path for display: absolute worktree paths are long and noisy, so
// show the tail after the worktree segment when we can, else the last few segments.
export function displayPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 3) return path;
  return `…/${parts.slice(-3).join("/")}`;
}
