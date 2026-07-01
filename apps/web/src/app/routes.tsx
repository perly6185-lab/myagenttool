import type { ComponentType } from "react";
import type { SectionKey } from "@/store/ui-store";
import { DashboardView } from "@/features/dashboard/dashboard-view";
import { ProjectsView } from "@/features/projects/projects-view";
import { TaskView } from "@/features/tasks/task-view";
import { AutomationView } from "@/features/automation/automation-view";
import { AgentSkillsView } from "@/features/agent-skills/agent-skills-view";
import { InvocationsView } from "@/features/invocations/invocations-view";
import { AgentsView } from "@/features/agents/agents-view";
import { DevicesView } from "@/features/devices/devices-view";
import { DiscoveryView } from "@/features/discovery/discovery-view";
import { IntegrationsView } from "@/features/integrations/integrations-view";
import { EconomicsView } from "@/features/economics/economics-view";
import { AuditView } from "@/features/audit/audit-view";

/**
 * Section → screen map. Store-driven instead of URL-driven for the M0 console;
 * swapping in react-router later only touches this table and NavRail.
 */
export const SECTION_VIEWS: Record<SectionKey, ComponentType> = {
  dashboard: DashboardView,
  projects: ProjectsView,
  task: TaskView,
  automation: AutomationView,
  agentSkills: AgentSkillsView,
  invocations: InvocationsView,
  agents: AgentsView,
  devices: DevicesView,
  discovery: DiscoveryView,
  integrations: IntegrationsView,
  economics: EconomicsView,
  audit: AuditView,
};
