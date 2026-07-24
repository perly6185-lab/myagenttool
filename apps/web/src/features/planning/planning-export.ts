export interface PlanningExportItem {
  id: string;
  localRef: string;
  title: string;
  body: string;
  type: string;
  status: string;
  priority: string;
  milestone: string;
  dueDate: string | null;
  labels: string[];
  assigneeIds: string[];
  dependencyIds?: string[];
  estimatePoints?: number;
}

export interface PlanningExportProject {
  id: string;
  name: string;
  description: string;
  color?: string;
  revision: number;
  capacityPoints?: number;
  startDate?: string | null;
  targetDate?: string | null;
  ownerId?: string | null;
  status?: "planned" | "active" | "on_hold" | "completed";
  savedViews?: unknown[];
  automationRules?: unknown[];
  activity?: unknown[];
  items?: { workItem: PlanningExportItem }[];
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function planningProjectCsv(project: PlanningExportProject) {
  const headers = [
    "id", "local_ref", "title", "type", "status", "priority", "milestone",
    "due_date", "labels", "assignees", "dependency_ids", "body",
  ];
  const rows = (project.items ?? []).map(({ workItem }) => [
    workItem.id,
    workItem.localRef,
    workItem.title,
    workItem.type,
    workItem.status,
    workItem.priority,
    workItem.milestone,
    workItem.dueDate ?? "",
    workItem.labels.join("|"),
    workItem.assigneeIds.join("|"),
    (workItem.dependencyIds ?? []).join("|"),
    workItem.body,
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function planningProjectJson(project: PlanningExportProject, exportedAt = new Date().toISOString()) {
  return JSON.stringify({
    schemaVersion: 1,
    exportedAt,
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      color: project.color,
      revision: project.revision,
      capacityPoints: project.capacityPoints ?? 0,
      startDate: project.startDate ?? null,
      targetDate: project.targetDate ?? null,
      ownerId: project.ownerId ?? null,
      status: project.status ?? "active",
      savedViews: project.savedViews ?? [],
      automationRules: project.automationRules ?? [],
      activity: project.activity ?? [],
    },
    workItems: (project.items ?? []).map(({ workItem }) => workItem),
  }, null, 2);
}

export function parsePlanningProjectSnapshot(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Invalid Planning snapshot JSON.");
  }
  if (!value || typeof value !== "object") throw new Error("Invalid Planning snapshot.");
  const snapshot = value as Record<string, unknown>;
  if (snapshot.schemaVersion !== 1) throw new Error("Unsupported Planning snapshot version.");
  if (!snapshot.project || typeof snapshot.project !== "object") throw new Error("Planning snapshot has no project.");
  const project = snapshot.project as Record<string, unknown>;
  const name = String(project.name ?? "").trim();
  const description = String(project.description ?? "");
  const savedViews = project.savedViews;
  const automationRules = project.automationRules;
  if (!name || name.length > 200 || description.length > 20_000
    || !Array.isArray(savedViews) || !Array.isArray(automationRules)) {
    throw new Error("Planning snapshot project configuration is invalid.");
  }
  return {
    name,
    description,
    color: typeof project.color === "string" ? project.color : undefined,
    capacityPoints: Number.isInteger(project.capacityPoints) ? Number(project.capacityPoints) : 0,
    startDate: typeof project.startDate === "string" ? project.startDate : null,
    targetDate: typeof project.targetDate === "string" ? project.targetDate : null,
    ownerId: typeof project.ownerId === "string" ? project.ownerId : null,
    status: ["planned", "active", "on_hold", "completed"].includes(String(project.status))
      ? project.status as "planned" | "active" | "on_hold" | "completed"
      : "active",
    savedViews,
    automationRules,
    workItemCount: Array.isArray(snapshot.workItems) ? snapshot.workItems.length : 0,
  };
}

export function planningExportFilename(name: string, extension: "csv" | "json") {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "planning-project";
  return `${slug}.${extension}`;
}

export function downloadPlanningExport(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
