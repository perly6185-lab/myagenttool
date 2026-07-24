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
}

export interface PlanningExportProject {
  id: string;
  name: string;
  description: string;
  color?: string;
  revision: number;
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
      savedViews: project.savedViews ?? [],
      automationRules: project.automationRules ?? [],
      activity: project.activity ?? [],
    },
    workItems: (project.items ?? []).map(({ workItem }) => workItem),
  }, null, 2);
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
