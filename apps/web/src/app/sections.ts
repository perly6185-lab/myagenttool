import {
  AppWindow,
  Bot,
  Boxes,
  CalendarRange,
  ClipboardCheck,
  FolderKanban,
  Files,
  Gauge,
  HardDrive,
  GitCompare,
  KeyRound,
  GitPullRequest,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  MessagesSquare,
  MonitorSmartphone,
  PanelsTopLeft,
  UserRound,
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
  Settings,
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
  { key: "mail", labelKey: "sections.mail.label", icon: Inbox, blurbKey: "sections.mail.blurb", group: "work" },
  { key: "localLibrary", labelKey: "sections.localLibrary.label", icon: Files, blurbKey: "sections.localLibrary.blurb", group: "work" },
  { key: "me", labelKey: "sections.me.label", icon: UserRound, blurbKey: "sections.me.blurb", group: "work" },
  { key: "workBoard", labelKey: "sections.workBoard.label", icon: KanbanSquare, blurbKey: "sections.workBoard.blurb", group: "work" },
  { key: "planning", labelKey: "sections.planning.label", icon: CalendarRange, blurbKey: "sections.planning.blurb", group: "work" },
  { key: "workspace", labelKey: "sections.workspace.label", icon: PanelsTopLeft, blurbKey: "sections.workspace.blurb", group: "work" },
  { key: "documents", labelKey: "sections.documents.label", icon: Files, blurbKey: "sections.documents.blurb", group: "work" },
  { key: "workflowMemory", labelKey: "sections.workflowMemory.label", icon: Workflow, blurbKey: "sections.workflowMemory.blurb", group: "work" },
  { key: "canvas", labelKey: "sections.canvas.label", icon: Shapes, blurbKey: "sections.canvas.blurb", group: "work" },
  // Run — the ways work executes.
  { key: "autoRuns", labelKey: "sections.autoRuns.label", icon: Bot, blurbKey: "sections.autoRuns.blurb", group: "run" },
  { key: "task", labelKey: "sections.task.label", icon: ListTodo, blurbKey: "sections.task.blurb", group: "run" },
  { key: "externalWork", labelKey: "sections.externalWork.label", icon: GitPullRequest, blurbKey: "sections.externalWork.blurb", group: "run" },
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
  { key: "settings", labelKey: "sections.settings.label", icon: Settings, blurbKey: "sections.settings.blurb", group: "configure" },
  { key: "myHosts", labelKey: "sections.myHosts.label", icon: HardDrive, blurbKey: "sections.myHosts.blurb", group: "configure" },
  { key: "projects", labelKey: "sections.projects.label", icon: FolderKanban, blurbKey: "sections.projects.blurb", group: "configure" },
  { key: "agents", labelKey: "sections.agents.label", icon: Boxes, blurbKey: "sections.agents.blurb", group: "configure" },
  { key: "agentSkills", labelKey: "sections.agentSkills.label", icon: Wand2, blurbKey: "sections.agentSkills.blurb", group: "configure" },
  { key: "devices", labelKey: "sections.devices.label", icon: MonitorSmartphone, blurbKey: "sections.devices.blurb", group: "configure" },
  { key: "discovery", labelKey: "sections.discovery.label", icon: Radar, blurbKey: "sections.discovery.blurb", group: "configure" },
  { key: "integrations", labelKey: "sections.integrations.label", icon: Puzzle, blurbKey: "sections.integrations.blurb", group: "configure" },
  { key: "tools", labelKey: "sections.tools.label", icon: Wrench, blurbKey: "sections.tools.blurb", group: "configure" },
  { key: "applications", labelKey: "sections.applications.label", icon: AppWindow, blurbKey: "sections.applications.blurb", group: "configure" },
  { key: "channels", labelKey: "sections.channels.label", icon: MessagesSquare, blurbKey: "sections.channels.blurb", group: "configure" },
  { key: "sessions", labelKey: "sections.sessions.label", icon: KeyRound, blurbKey: "sections.sessions.blurb", group: "configure" },
  // Ledgers — the metered record.
  { key: "invocations", labelKey: "sections.invocations.label", icon: ListChecks, blurbKey: "sections.invocations.blurb", group: "ledgers" },
  { key: "economics", labelKey: "sections.economics.label", icon: Receipt, blurbKey: "sections.economics.blurb", group: "ledgers" },
];

export type PageSurface = "entry" | "settings" | "trace";
export type PageOwnerContext = "global" | "task" | "project";
export type PageVisibility = "primary" | "secondary" | "contextual";
export type PageAuthority = "ordinary" | "manage" | "audit";
export type NavigationLabelKey = `shell.navigation.${"home" | "tasks" | "projects" | "todo" | "queue" | "attention"}`;
export type SurfaceLabelKey = `shell.navigation.${PageSurface}`;
export type SurfaceDescriptionKey = `shell.navigation.${PageSurface}Hint`;

export interface PageRegistration extends SectionDef {
  surface: PageSurface;
  ownerContext: PageOwnerContext;
  visibility: PageVisibility;
  /** Presentation requirement only; APIs remain the authorization boundary. */
  authority: PageAuthority;
  /** Canonical bookmark contract retained by URL synchronization. */
  deepLink: `?section=${SectionKey}`;
  /** Optional navigation copy; the underlying page title remains unchanged. */
  navigationLabelKey?: NavigationLabelKey;
  /** Legacy section keys remain canonical until their feature pages migrate. */
  legacyAliases: readonly string[];
}

const ENTRY_PRIMARY = new Set<SectionKey>(["dashboard", "mail", "localLibrary", "task", "workflowMemory", "projects", "me"]);
const ENTRY_CONTEXTUAL = new Set<SectionKey>([
  "workBoard", "externalWork", "autoRuns", "approvals", "planning", "workspace", "documents", "workflowMemory", "canvas",
]);
const TRACE_SECTIONS = new Set<SectionKey>([
  "compare", "evidence", "review", "evalTrend", "invocations", "audit",
]);

const NAVIGATION_LABEL_KEYS: Partial<Record<SectionKey, NavigationLabelKey>> = {
  dashboard: "shell.navigation.home",
  task: "shell.navigation.tasks",
  projects: "shell.navigation.projects",
  autoRuns: "shell.navigation.queue",
  approvals: "shell.navigation.attention",
};

/**
 * One ownership registry for every existing page. Feature work may add a view,
 * but it must declare where that view belongs instead of adding itself directly
 * to the ordinary user's global navigation.
 */
export const PAGE_REGISTRY: PageRegistration[] = SECTIONS.map((section) => {
  const surface: PageSurface = ENTRY_PRIMARY.has(section.key) || ENTRY_CONTEXTUAL.has(section.key)
    ? "entry"
    : TRACE_SECTIONS.has(section.key)
      ? "trace"
      : "settings";
  const ownerContext: PageOwnerContext = ENTRY_CONTEXTUAL.has(section.key)
    ? section.key === "me"
      ? "global"
      : section.key === "planning" || section.key === "workspace" || section.key === "documents" || section.key === "workflowMemory" || section.key === "canvas"
      ? "project"
      : "task"
    : surface === "trace"
      ? "task"
      : "global";
  return {
    ...section,
    surface,
    ownerContext,
    visibility: ENTRY_PRIMARY.has(section.key)
      ? "primary"
      : ENTRY_CONTEXTUAL.has(section.key)
        ? "contextual"
        : "secondary",
    authority: surface === "settings" ? "manage" : surface === "trace" ? "audit" : "ordinary",
    deepLink: `?section=${section.key}`,
    navigationLabelKey: NAVIGATION_LABEL_KEYS[section.key],
    legacyAliases: [],
  };
});

const ENTRY_ORDER: SectionKey[] = ["dashboard", "mail", "localLibrary", "task", "workflowMemory", "projects", "me"];
export const ENTRY_SECTIONS = ENTRY_ORDER.map((key) => pageRegistration(key));

export const SURFACE_GROUPS: Array<{
  key: PageSurface;
  labelKey: SurfaceLabelKey;
  descriptionKey: SurfaceDescriptionKey;
}> = [
  { key: "entry", labelKey: "shell.navigation.entry", descriptionKey: "shell.navigation.entryHint" },
  { key: "settings", labelKey: "shell.navigation.settings", descriptionKey: "shell.navigation.settingsHint" },
  { key: "trace", labelKey: "shell.navigation.trace", descriptionKey: "shell.navigation.traceHint" },
];

export function pageRegistration(section: SectionKey): PageRegistration {
  const page = PAGE_REGISTRY.find((item) => item.key === section);
  if (!page) throw new Error(`Unknown page registration: ${section}`);
  return page;
}

export function pageNavigationLabelKey(page: PageRegistration): SectionDef["labelKey"] | NavigationLabelKey {
  return page.navigationLabelKey ?? page.labelKey;
}
