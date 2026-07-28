import type { ProjectDocumentEntry } from "@/lib/console-state";

const KEY = "myagenttool.document-templates";
export interface DocumentTemplate extends Pick<ProjectDocumentEntry, "projectId" | "worktreeId" | "path" | "type"> {
  id: string;
  name: string;
  fields: Array<{ key: string; label: string; defaultValue: string }>;
}

export function readDocumentTemplates(): DocumentTemplate[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item) => item?.id && item?.path && item?.worktreeId) : [];
  } catch { return []; }
}

export function saveDocumentTemplate(document: ProjectDocumentEntry, name: string, fieldNames: string[]): DocumentTemplate[] {
  if (!document.worktreeId) throw new Error("Templates must come from a worktree.");
  const id = `${document.projectId}:${document.worktreeId}:${document.path}`;
  const template: DocumentTemplate = { id, projectId: document.projectId, worktreeId: document.worktreeId, path: document.path, type: document.type, name: name.trim() || document.name, fields: fieldNames.map((key) => key.trim()).filter(Boolean).map((key) => ({ key, label: key.replaceAll("_", " "), defaultValue: "" })) };
  const next = [template, ...readDocumentTemplates().filter((item) => item.id !== id)];
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function removeDocumentTemplate(id: string): DocumentTemplate[] {
  const next = readDocumentTemplates().filter((item) => item.id !== id);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
