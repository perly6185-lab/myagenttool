import {
  Boxes,
  LayoutDashboard,
  ListChecks,
  MonitorSmartphone,
  Puzzle,
  Radar,
  Receipt,
  ScrollText,
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
  { key: "invocations", label: "Invocations", icon: ListChecks, blurb: "Every call, status, and result" },
  { key: "agents", label: "Agents", icon: Boxes, blurb: "Registered agents and health" },
  { key: "devices", label: "Devices", icon: MonitorSmartphone, blurb: "Local bridges and platforms" },
  { key: "discovery", label: "Discovery", icon: Radar, blurb: "Find local agents conservatively" },
  { key: "integrations", label: "Integrations", icon: Puzzle, blurb: "Connect unsupported agents" },
  { key: "economics", label: "Economics", icon: Receipt, blurb: "Metered AI usage and cost ledger" },
  { key: "audit", label: "Audit", icon: ScrollText, blurb: "What was recorded and why" },
];
