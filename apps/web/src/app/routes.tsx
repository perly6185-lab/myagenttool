import type { ComponentType } from "react";
import type { SectionKey } from "@/store/ui-store";
import { DashboardView } from "@/features/dashboard/dashboard-view";
import { ProjectsView } from "@/features/projects/projects-view";
import { TaskView } from "@/features/tasks/task-view";
import { AutoRunsView } from "@/features/auto-runs/auto-runs-view";
import { AutomationView } from "@/features/automation/automation-view";
import { AgentSkillsView } from "@/features/agent-skills/agent-skills-view";
import { InvocationsView } from "@/features/invocations/invocations-view";
import { AgentsView } from "@/features/agents/agents-view";
import { DevicesView } from "@/features/devices/devices-view";
import { DiscoveryView } from "@/features/discovery/discovery-view";
import { IntegrationsView } from "@/features/integrations/integrations-view";
import { ToolsView } from "@/features/tools/tools-view";
import { ReviewView } from "@/features/review/review-view";
import { ApplicationsView } from "@/features/applications/applications-view";
import { EconomicsView } from "@/features/economics/economics-view";
import { AuditView } from "@/features/audit/audit-view";

/** Section → screen map. The lightweight URL sync lives above this table. */
export const SECTION_VIEWS: Record<SectionKey, ComponentType> = {
  dashboard: DashboardView,
  projects: ProjectsView,
  task: TaskView,
  autoRuns: AutoRunsView,
  automation: AutomationView,
  agentSkills: AgentSkillsView,
  invocations: InvocationsView,
  agents: AgentsView,
  devices: DevicesView,
  discovery: DiscoveryView,
  integrations: IntegrationsView,
  tools: ToolsView,
  review: ReviewView,
  applications: ApplicationsView,
  economics: EconomicsView,
  audit: AuditView,
};
