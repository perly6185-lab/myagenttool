import type { ProjectDocumentEntry } from "@/lib/console-state";

const KEY = "myagenttool.recent-documents";
const LIMIT = 8;
export type RecentDocument = Pick<ProjectDocumentEntry, "projectId" | "worktreeId" | "name" | "path" | "type"> & { openedAt: string; pinned?: boolean };

export function readRecentDocuments(): RecentDocument[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.path === "string").sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))).slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function recordRecentDocument(document: ProjectDocumentEntry): RecentDocument[] {
  const key = `${document.projectId}:${document.worktreeId ?? "base"}:${document.path}`;
  const existing = readRecentDocuments().find((item) => `${item.projectId}:${item.worktreeId ?? "base"}:${item.path}` === key);
  const next: RecentDocument = { projectId: document.projectId, worktreeId: document.worktreeId ?? null, name: document.name, path: document.path, type: document.type, openedAt: new Date().toISOString(), pinned: existing?.pinned };
  const list = sortAndWrite([next, ...readRecentDocuments().filter((item) => `${item.projectId}:${item.worktreeId ?? "base"}:${item.path}` !== key)]);
  return list;
}

export function toggleRecentDocumentPinned(target: RecentDocument): RecentDocument[] {
  return sortAndWrite(readRecentDocuments().map((item) => recentKey(item) === recentKey(target) ? { ...item, pinned: !item.pinned } : item));
}

export function removeRecentDocument(target: RecentDocument): RecentDocument[] {
  return sortAndWrite(readRecentDocuments().filter((item) => recentKey(item) !== recentKey(target)));
}

export function clearRecentDocuments(): RecentDocument[] { return sortAndWrite([]); }

function recentKey(item: Pick<RecentDocument, "projectId" | "worktreeId" | "path">) { return `${item.projectId}:${item.worktreeId ?? "base"}:${item.path}`; }
function sortAndWrite(items: RecentDocument[]): RecentDocument[] {
  const list = items.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))).slice(0, LIMIT);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
  return list;
}
