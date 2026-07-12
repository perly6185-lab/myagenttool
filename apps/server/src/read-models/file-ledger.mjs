// Agent file ledger — which files a coding agent READ vs WROTE during a run.
//
// Captured from the agent's tool_use stream by the Desktop Bridge
// (extractClaudeFileAccesses): Read → read; Edit/Write/MultiEdit/NotebookEdit →
// write. It is the read side that has no other trace — writes already show in the
// worktree git diff, but a file the agent only *read* leaves nothing behind. Bash
// file I/O is invisible to us (we can't parse an arbitrary shell command), so the
// ledger reflects the explicit file tools only; that limitation is surfaced, not
// hidden, via the diffOnly reconciliation below.
//
// mergeFileAccesses maintains the stored ledger (the bridge events handler calls it
// per streamed message). The display shaping + cross-check of writes against the
// worktree git diff lives client-side (reconcileFileLedger, apps/web), which already
// fetches the diff — so the server keeps only the accumulator.

const DEFAULT_CAP = 200;

/**
 * Merge new `{ tool, path, mode }` accesses into a ledger — deduped, capped, and
 * kept in first-seen order. Returns a fresh `{ reads, writes, truncated }` (never
 * mutates the input). `mode: "write"` lands in writes; anything else is a read.
 */
export function mergeFileAccesses(ledger, accesses, { cap = DEFAULT_CAP } = {}) {
  const reads = Array.isArray(ledger?.reads) ? [...ledger.reads] : [];
  const writes = Array.isArray(ledger?.writes) ? [...ledger.writes] : [];
  let truncated = Boolean(ledger?.truncated);
  const readSet = new Set(reads);
  const writeSet = new Set(writes);
  for (const access of Array.isArray(accesses) ? accesses : []) {
    const path = typeof access?.path === "string" ? access.path.trim() : "";
    if (!path) continue;
    if (access.mode === "write") {
      if (writeSet.has(path)) continue;
      if (writes.length >= cap) {
        truncated = true;
        continue;
      }
      writes.push(path);
      writeSet.add(path);
    } else {
      if (readSet.has(path)) continue;
      if (reads.length >= cap) {
        truncated = true;
        continue;
      }
      reads.push(path);
      readSet.add(path);
    }
  }
  return { reads, writes, truncated };
}
