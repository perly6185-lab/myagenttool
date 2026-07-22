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
  label: string;
}

/** Group headers in the nav rail, in order. */
export const SECTION_GROUPS: SectionGroupDef[] = [
  { key: "work", label: "Work" },
  { key: "run", label: "Run" },
  { key: "oversee", label: "Oversee" },
  { key: "configure", label: "Configure" },
  { key: "ledgers", label: "Ledgers" },
];

export interface SectionDef {
  key: SectionKey;
  label: string;
  icon: LucideIcon;
  blurb: string;
  group: SectionGroupKey;
}

/** Top-level control-plane domains, grouped by intent and ordered within each. */
export const SECTIONS: SectionDef[] = [
  // Work — the daily home: start a task, live in a project.
  { key: "dashboard", label: "Overview", icon: LayoutDashboard, blurb: "Start a task and watch it run", group: "work" },
  { key: "workBoard", label: "Status", icon: KanbanSquare, blurb: "Every work item by state: to-decide, waiting, running, done, failed, follow-up", group: "work" },
  { key: "workspace", label: "Workspace", icon: PanelsTopLeft, blurb: "Project files, transcript, and history in one place", group: "work" },
  { key: "documents", label: "Documents", icon: Files, blurb: "Browse Word, Excel, and PowerPoint files", group: "work" },
  { key: "canvas", label: "Canvas", icon: Shapes, blurb: "Draw and edit diagrams; import and export Excalidraw scenes", group: "work" },
  // Run — the ways work executes.
  { key: "autoRuns", label: "Auto-runs", icon: Bot, blurb: "Autonomous issue → worktree → PR runs", group: "run" },
  { key: "task", label: "Task", icon: ListTodo, blurb: "GitHub issues and PRs as work items", group: "run" },
  { key: "compare", label: "Compare", icon: GitCompare, blurb: "Run one task on 2+ agents side by side", group: "run" },
  { key: "automation", label: "Automation", icon: Workflow, blurb: "Rules that run agents on a trigger", group: "run" },
  { key: "routines", label: "Routines", icon: Repeat, blurb: "Scheduled autonomous checks and their findings", group: "run" },
  // Oversee — decisions + trust.
  { key: "approvals", label: "Approvals", icon: Inbox, blurb: "Every pending human decision in one queue", group: "oversee" },
  { key: "evidence", label: "Evidence", icon: ClipboardCheck, blurb: "Per-run trust rollup: review, audit, troubleshooting", group: "oversee" },
  { key: "review", label: "Review", icon: ShieldCheck, blurb: "Codex and Claude diff-review findings", group: "oversee" },
  { key: "evalTrend", label: "Capability", icon: Gauge, blurb: "Scheduled real-agent eval trend and regressions", group: "oversee" },
  { key: "audit", label: "Audit", icon: ScrollText, blurb: "What was recorded and why", group: "oversee" },
  // Configure — the registry + setup.
  { key: "projects", label: "Projects", icon: FolderKanban, blurb: "Group work and own budgets", group: "configure" },
  { key: "agents", label: "Agents", icon: Boxes, blurb: "Registered agents and health", group: "configure" },
  { key: "agentSkills", label: "Agent Skills", icon: Wand2, blurb: "Instruction docs rendered into agent runs", group: "configure" },
  { key: "devices", label: "Devices", icon: MonitorSmartphone, blurb: "Local bridges and platforms", group: "configure" },
  { key: "discovery", label: "Discovery", icon: Radar, blurb: "Find local agents conservatively", group: "configure" },
  { key: "integrations", label: "Integrations", icon: Puzzle, blurb: "Connect unsupported agents", group: "configure" },
  { key: "tools", label: "Tools", icon: Wrench, blurb: "Governed tools you can discover and run", group: "configure" },
  { key: "applications", label: "Applications", icon: AppWindow, blurb: "Registered apps and their governed capabilities", group: "configure" },
  { key: "channels", label: "Channels", icon: MessagesSquare, blurb: "Bidirectional messaging channels (WeCom) and their deliveries", group: "configure" },
  // Ledgers — the metered record.
  { key: "invocations", label: "Invocations", icon: ListChecks, blurb: "Every call, status, and result", group: "ledgers" },
  { key: "economics", label: "Economics", icon: Receipt, blurb: "Metered AI usage and cost ledger", group: "ledgers" },
];
