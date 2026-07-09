import {
  AppWindow,
  Bot,
  Boxes,
  FolderKanban,
  Gauge,
  GitCompare,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  MonitorSmartphone,
  PanelsTopLeft,
  Puzzle,
  Radar,
  Receipt,
  ScrollText,
  ShieldCheck,
  Wand2,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { SectionKey } from "@/store/ui-store";

export interface SectionDef {
  key: SectionKey;
  label: string;
  icon: LucideIcon;
  blurb: string;
}

/** Top-level control-plane domains shown in the nav rail, in order. */
export const SECTIONS: SectionDef[] = [
  { key: "dashboard", label: "Overview", icon: LayoutDashboard, blurb: "Start a task and watch it run" },
  { key: "workspace", label: "Workspace", icon: PanelsTopLeft, blurb: "Project files, transcript, and history in one place" },
  { key: "compare", label: "Compare", icon: GitCompare, blurb: "Run one task on 2+ agents side by side" },
  { key: "projects", label: "Projects", icon: FolderKanban, blurb: "Group work and own budgets" },
  { key: "task", label: "Task", icon: ListTodo, blurb: "GitHub issues and PRs as work items" },
  { key: "autoRuns", label: "Auto-runs", icon: Bot, blurb: "Autonomous issue → worktree → PR runs" },
  { key: "evalTrend", label: "Capability", icon: Gauge, blurb: "Scheduled real-agent eval trend and regressions" },
  { key: "automation", label: "Automation", icon: Workflow, blurb: "Rules that run agents on a trigger" },
  { key: "agentSkills", label: "Agent Skills", icon: Wand2, blurb: "Instruction docs rendered into agent runs" },
  { key: "invocations", label: "Invocations", icon: ListChecks, blurb: "Every call, status, and result" },
  { key: "agents", label: "Agents", icon: Boxes, blurb: "Registered agents and health" },
  { key: "devices", label: "Devices", icon: MonitorSmartphone, blurb: "Local bridges and platforms" },
  { key: "discovery", label: "Discovery", icon: Radar, blurb: "Find local agents conservatively" },
  { key: "integrations", label: "Integrations", icon: Puzzle, blurb: "Connect unsupported agents" },
  { key: "tools", label: "Tools", icon: Wrench, blurb: "Governed tools you can discover and run" },
  { key: "review", label: "Review", icon: ShieldCheck, blurb: "Codex and Claude diff-review findings" },
  { key: "applications", label: "Applications", icon: AppWindow, blurb: "Registered apps and their governed capabilities" },
  { key: "economics", label: "Economics", icon: Receipt, blurb: "Metered AI usage and cost ledger" },
  { key: "audit", label: "Audit", icon: ScrollText, blurb: "What was recorded and why" },
];
