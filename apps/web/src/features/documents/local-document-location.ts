export interface LocalOfficeDocumentSelection { selectionId: string; absolutePath: string; name: string; type: "docx" | "xlsx" | "pptx"; size: number }
export type LocalDocumentLocation =
  | { scope: "worktree"; projectId: string; worktreeId: string; relativePath: string }
  | { scope: "project"; projectId: string; relativePath: string }
  | { scope: "external" };

export function classifyLocalDocumentPath(absolutePath: string, projects: Array<{ id: string; git?: { repoPath?: string | null } }>, worktrees: Array<{ id: string; projectId: string; path: string }>): LocalDocumentLocation {
  const worktree = longestRootMatch(absolutePath, worktrees.map((item) => ({ ...item, root: item.path })));
  if (worktree) return { scope: "worktree", projectId: worktree.projectId, worktreeId: worktree.id, relativePath: relativeToRoot(absolutePath, worktree.root) };
  const project = longestRootMatch(absolutePath, projects.flatMap((item) => item.git?.repoPath ? [{ ...item, root: item.git.repoPath }] : []));
  if (project) return { scope: "project", projectId: project.id, relativePath: relativeToRoot(absolutePath, project.root) };
  return { scope: "external" };
}

export function directoryOfLocalPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return index === 0 ? "/" : ".";
  return normalized.slice(0, index);
}

function longestRootMatch<T extends { root: string }>(path: string, roots: T[]): T | undefined {
  return roots.filter((item) => isWithin(path, item.root)).sort((a, b) => normalize(b.root).length - normalize(a.root).length)[0];
}
function normalize(value: string) { const next = value.replaceAll("\\", "/").replace(/\/+$/, ""); return /^[A-Za-z]:\//.test(next) ? next.toLowerCase() : next; }
function isWithin(path: string, root: string) { const candidate = normalize(path); const base = normalize(root); return candidate === base || candidate.startsWith(`${base}/`); }
function relativeToRoot(path: string, root: string) { return normalize(path).slice(normalize(root).length).replace(/^\/+/, ""); }
