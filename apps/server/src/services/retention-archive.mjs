import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
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

  /**
   * The read half of the archive — the loop the audit trail was missing: what the
   * cap evicted is recoverable, not just greppable by hand. Reads the whole
   * append-only file, skips torn lines, applies an optional row filter, and returns
   * the most-recently-archived `limit` matches newest-first as `{ archivedAt, row }`.
   * Ordered by archivedAt, NOT file position: one eviction batch is written
   * newest-first, so raw file order would misrank within a batch; the sort is
   * stable, so a batch's own order is preserved when stamps tie. Best-effort: no
   * file yet → honest empty, never a throw. Reading the full file is fine for an
   * occasional audit; a tail-read is the follow-up if archives outgrow memory.
   */
  function readArchive(collection, { filter = null, limit = 50 } = {}) {
    let text;
    try {
      text = readFileSync(join(archiveDir, `${collection}.jsonl`), "utf8");
    } catch {
      return [];
    }
    const matches = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // a torn final line from a crash mid-append — skip, don't fail
      }
      if (filter && !filter(parsed.row)) continue;
      matches.push({ archivedAt: parsed.archivedAt ?? null, row: parsed.row });
    }
    matches.sort((a, b) => String(b.archivedAt ?? "").localeCompare(String(a.archivedAt ?? "")));
    return matches.slice(0, Math.max(1, limit));
  }

  return { archiveEvicted, capWithArchive, readArchive, archiveDir };
}
