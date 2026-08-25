import type { LocalWorkItem } from "./task-view-types";

export function isLocalWorkItem(value: unknown): value is LocalWorkItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LocalWorkItem>;
  return typeof item.id === "string"
    && typeof item.localRef === "string"
    && typeof item.projectId === "string"
    && typeof item.title === "string"
    && typeof item.body === "string"
    && typeof item.type === "string"
    && typeof item.status === "string"
    && typeof item.priority === "string"
    && typeof item.state === "string"
    && Array.isArray(item.labels)
    && Array.isArray(item.assigneeIds)
    && Array.isArray(item.acceptanceCriteria)
    && typeof item.revision === "number";
}
