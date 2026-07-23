import {
  AppWindow,
  Bot,
  Boxes,
  ClipboardCheck,
  FolderKanban,
  Files,
  Gauge,
  GitCompare,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  MessagesSquare,
  MonitorSmartphone,
  PanelsTopLeft,
  Puzzle,
  Radar,
  Repeat,
  Receipt,
  ScrollText,
  Shapes,
  ShieldCheck,
  Wand2,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { SectionKey } from "@/store/ui-store";

/** Nav groups by intent — where you are in the workflow, not a flat wall of 22. */
export type SectionGroupKey = "work" | "run" | "oversee" | "configure" | "ledgers";

export interface SectionGroupDef {
  key: SectionGroupKey;
  labelKey: `sectionGroups.${SectionGroupKey}`;
}

/** Group headers in the nav rail, in order. */
export const SECTION_GROUPS: SectionGroupDef[] = [
  { key: "work", labelKey: "sectionGroups.work" },
  { key: "run", labelKey: "sectionGroups.run" },
  { key: "oversee", labelKey: "sectionGroups.oversee" },
  { key: "configure", labelKey: "sectionGroups.configure" },
  { key: "ledgers", labelKey: "sectionGroups.ledgers" },
];

export interface SectionDef {
  key: SectionKey;
  labelKey: `sections.${SectionKey}.label`;
  icon: LucideIcon;
  blurbKey: `sections.${SectionKey}.blurb`;
  group: SectionGroupKey;
}

/** Top-level control-plane domains, grouped by intent and ordered within each. */
export const SECTIONS: SectionDef[] = [
  // Work — the daily home: start a task, live in a project.
  { key: "dashboard", labelKey: "sections.dashboard.label", icon: LayoutDashboard, blurbKey: "sections.dashboard.blurb", group: "work" },
  { key: "workBoard", labelKey: "sections.workBoard.label", icon: KanbanSquare, blurbKey: "sections.workBoard.blurb", group: "work" },
  { key: "workspace", labelKey: "sections.workspace.label", icon: PanelsTopLeft, blurbKey: "sections.workspace.blurb", group: "work" },
  { key: "documents", labelKey: "sections.documents.label", icon: Files, blurbKey: "sections.documents.blurb", group: "work" },
  { key: "canvas", labelKey: "sections.canvas.label", icon: Shapes, blurbKey: "sections.canvas.blurb", group: "work" },
  // Run — the ways work executes.
  { key: "autoRuns", labelKey: "sections.autoRuns.label", icon: Bot, blurbKey: "sections.autoRuns.blurb", group: "run" },
  { key: "task", labelKey: "sections.task.label", icon: ListTodo, blurbKey: "sections.task.blurb", group: "run" },
  { key: "compare", labelKey: "sections.compare.label", icon: GitCompare, blurbKey: "sections.compare.blurb", group: "run" },
  { key: "automation", labelKey: "sections.automation.label", icon: Workflow, blurbKey: "sections.automation.blurb", group: "run" },
  { key: "routines", labelKey: "sections.routines.label", icon: Repeat, blurbKey: "sections.routines.blurb", group: "run" },
  // Oversee — decisions + trust.
  { key: "approvals", labelKey: "sections.approvals.label", icon: Inbox, blurbKey: "sections.approvals.blurb", group: "oversee" },
  { key: "evidence", labelKey: "sections.evidence.label", icon: ClipboardCheck, blurbKey: "sections.evidence.blurb", group: "oversee" },
  { key: "review", labelKey: "sections.review.label", icon: ShieldCheck, blurbKey: "sections.review.blurb", group: "oversee" },
  { key: "evalTrend", labelKey: "sections.evalTrend.label", icon: Gauge, blurbKey: "sections.evalTrend.blurb", group: "oversee" },
  { key: "audit", labelKey: "sections.audit.label", icon: ScrollText, blurbKey: "sections.audit.blurb", group: "oversee" },
  // Configure — the registry + setup.
  { key: "projects", labelKey: "sections.projects.label", icon: FolderKanban, blurbKey: "sections.projects.blurb", group: "configure" },
  { key: "agents", labelKey: "sections.agents.label", icon: Boxes, blurbKey: "sections.agents.blurb", group: "configure" },
  { key: "agentSkills", labelKey: "sections.agentSkills.label", icon: Wand2, blurbKey: "sections.agentSkills.blurb", group: "configure" },
  { key: "devices", labelKey: "sections.devices.label", icon: MonitorSmartphone, blurbKey: "sections.devices.blurb", group: "configure" },
  { key: "discovery", labelKey: "sections.discovery.label", icon: Radar, blurbKey: "sections.discovery.blurb", group: "configure" },
  { key: "integrations", labelKey: "sections.integrations.label", icon: Puzzle, blurbKey: "sections.integrations.blurb", group: "configure" },
  { key: "tools", labelKey: "sections.tools.label", icon: Wrench, blurbKey: "sections.tools.blurb", group: "configure" },
  { key: "applications", labelKey: "sections.applications.label", icon: AppWindow, blurbKey: "sections.applications.blurb", group: "configure" },
  { key: "channels", labelKey: "sections.channels.label", icon: MessagesSquare, blurbKey: "sections.channels.blurb", group: "configure" },
  // Ledgers — the metered record.
  { key: "invocations", labelKey: "sections.invocations.label", icon: ListChecks, blurbKey: "sections.invocations.blurb", group: "ledgers" },
  { key: "economics", labelKey: "sections.economics.label", icon: Receipt, blurbKey: "sections.economics.blurb", group: "ledgers" },
];
