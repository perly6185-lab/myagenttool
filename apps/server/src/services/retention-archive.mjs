import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// On-disk archive for rows evicted by in-memory caps. The caps keep /api/state
// lean, but audit-critical collections (recovery actions, approval broker
// requests, consumed approval grants) must not lose history SILENTLY — an
// evicted row is appended as one JSONL line to
// <stateDir>/archive/<collection>.jsonl before the cap drops it. Append-only,
// best-effort (archival must never break the write path), greppable offline.

export function createRetentionArchive({ stateStorePath, enabled = true, now = () => new Date().toISOString() }) {
  const archiveDir = join(dirname(stateStorePath ?? "."), "archive");

  function archiveEvicted(collection, rows) {
    if (!enabled || !Array.isArray(rows) || rows.length === 0) return;
    try {
      mkdirSync(archiveDir, { recursive: true });
      const archivedAt = now();
      const lines = rows.map((row) => JSON.stringify({ archivedAt, collection, row }));
      appendFileSync(join(archiveDir, `${collection}.jsonl`), `${lines.join("\n")}\n`);
    } catch {
      // Disk full / permissions: the in-memory cap still applies; losing the
      // archive line is strictly no worse than the silent eviction it replaces.
    }
  }

  /** Cap a list, archiving (not dropping) the overflow. Returns the capped list. */
  function capWithArchive(list, max, collection) {
    if (!Array.isArray(list) || list.length <= max) return Array.isArray(list) ? list : [];
    archiveEvicted(collection, list.slice(max));
    return list.slice(0, max);
  }

  return { archiveEvicted, capWithArchive, archiveDir };
}
