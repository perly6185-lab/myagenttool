export type StarterTaskTemplate = {
  id: "inspect" | "fix" | "document";
  labelKey: "dashboard.templates.inspect" | "dashboard.templates.fix" | "dashboard.templates.document";
  taskKey: "dashboard.templateTasks.inspect" | "dashboard.templateTasks.fix" | "dashboard.templateTasks.document";
};

export const STARTER_TASK_TEMPLATES: StarterTaskTemplate[] = [
  { id: "inspect", labelKey: "dashboard.templates.inspect", taskKey: "dashboard.templateTasks.inspect" },
  { id: "fix", labelKey: "dashboard.templates.fix", taskKey: "dashboard.templateTasks.fix" },
  { id: "document", labelKey: "dashboard.templates.document", taskKey: "dashboard.templateTasks.document" },
];
