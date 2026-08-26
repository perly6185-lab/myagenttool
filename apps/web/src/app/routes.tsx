import { lazy, type ComponentType } from "react";
import type { SectionKey } from "@/store/ui-store";

const DashboardView = lazy(() => import("@/features/dashboard/dashboard-view").then((m) => ({ default: m.DashboardView })));
const PrivateTutorView = lazy(() => import("@/features/private-tutor/private-tutor-view").then((m) => ({ default: m.PrivateTutorView })));
const MailView = lazy(() => import("@/features/mail/mail-view").then((m) => ({ default: m.MailView })));
const LocalLibraryView = lazy(() => import("@/features/local-content/local-library-view").then((m) => ({ default: m.LocalLibraryView })));
const WorkBoardView = lazy(() => import("@/features/work-board/work-board-view").then((m) => ({ default: m.WorkBoardView })));
const WorkspaceView = lazy(() => import("@/features/workspace/workspace-view").then((m) => ({ default: m.WorkspaceView })));
const DocumentsView = lazy(() => import("@/features/documents/documents-view").then((m) => ({ default: m.DocumentsView })));
const MyTemplatesView = lazy(() => import("@/features/workflow-memory/my-templates-view").then((m) => ({ default: m.MyTemplatesView })));
const CanvasView = lazy(() => import("@/features/canvas/canvas-view").then((m) => ({ default: m.CanvasView })));
const CompareView = lazy(() => import("@/features/compare/compare-view").then((m) => ({ default: m.CompareView })));
const ProjectsView = lazy(() => import("@/features/projects/projects-view").then((m) => ({ default: m.ProjectsView })));
const LocalTasksView = lazy(() => import("@/features/tasks/local-tasks-view").then((m) => ({ default: m.LocalTasksView })));
const ExternalWorkView = lazy(() => import("@/features/tasks/external-work-view").then((m) => ({ default: m.ExternalWorkView })));
const PlanningProjectsView = lazy(() => import("@/features/planning/planning-projects-view").then((m) => ({ default: m.PlanningProjectsView })));
const AutoRunsView = lazy(() => import("@/features/auto-runs/auto-runs-view").then((m) => ({ default: m.AutoRunsView })));
const ApprovalsView = lazy(() => import("@/features/approvals/approvals-view").then((m) => ({ default: m.ApprovalsView })));
const EvidenceView = lazy(() => import("@/features/evidence/evidence-view").then((m) => ({ default: m.EvidenceView })));
const EvalTrendView = lazy(() => import("@/features/eval-trend/eval-trend-view").then((m) => ({ default: m.EvalTrendView })));
const AutomationView = lazy(() => import("@/features/automation/automation-view").then((m) => ({ default: m.AutomationView })));
const RoutinesView = lazy(() => import("@/features/routines/routines-view").then((m) => ({ default: m.RoutinesView })));
const AgentSkillsView = lazy(() => import("@/features/agent-skills/agent-skills-view").then((m) => ({ default: m.AgentSkillsView })));
const InvocationsView = lazy(() => import("@/features/invocations/invocations-view").then((m) => ({ default: m.InvocationsView })));
const AgentsView = lazy(() => import("@/features/agents/agents-view").then((m) => ({ default: m.AgentsView })));
const DevicesView = lazy(() => import("@/features/devices/devices-view").then((m) => ({ default: m.DevicesView })));
const DiscoveryView = lazy(() => import("@/features/discovery/discovery-view").then((m) => ({ default: m.DiscoveryView })));
const IntegrationsView = lazy(() => import("@/features/integrations/integrations-view").then((m) => ({ default: m.IntegrationsView })));
const ToolsView = lazy(() => import("@/features/tools/tools-view").then((m) => ({ default: m.ToolsView })));
const ReviewView = lazy(() => import("@/features/review/review-view").then((m) => ({ default: m.ReviewView })));
const ApplicationsView = lazy(() => import("@/features/applications/applications-view").then((m) => ({ default: m.ApplicationsView })));
const ChannelsView = lazy(() => import("@/features/channels/channels-view").then((m) => ({ default: m.ChannelsView })));
const SessionsView = lazy(() => import("@/features/sessions/sessions-view").then((m) => ({ default: m.SessionsView })));
const EconomicsView = lazy(() => import("@/features/economics/economics-view").then((m) => ({ default: m.EconomicsView })));
const AuditView = lazy(() => import("@/features/audit/audit-view").then((m) => ({ default: m.AuditView })));
const SettingsHomeView = lazy(() => import("@/features/settings/settings-home-view").then((m) => ({ default: m.SettingsHomeView })));
const MeView = lazy(() => import("@/features/me/me-view").then((m) => ({ default: m.MeView })));
const MySiteView = lazy(() => import("@/features/my-site/my-site-view").then((m) => ({ default: m.MySiteView })));
const SiteSettingsView = lazy(() => import("@/features/my-site/site-settings-view").then((m) => ({ default: m.SiteSettingsView })));
const MyHostsView = lazy(() => import("@/features/my-hosts/my-hosts-view").then((m) => ({ default: m.MyHostsView })));

/** Section → screen map. The lightweight URL sync lives above this table. */
export const SECTION_VIEWS: Record<SectionKey, ComponentType> = {
  settings: SettingsHomeView,
  dashboard: DashboardView,
  privateTutor: PrivateTutorView,
  mail: MailView,
  localLibrary: LocalLibraryView,
  mySite: MySiteView,
  me: MeView,
  workBoard: WorkBoardView,
  workspace: WorkspaceView,
  documents: DocumentsView,
  workflowMemory: MyTemplatesView,
  canvas: CanvasView,
  compare: CompareView,
  projects: ProjectsView,
  planning: PlanningProjectsView,
  task: LocalTasksView,
  externalWork: ExternalWorkView,
  autoRuns: AutoRunsView,
  approvals: ApprovalsView,
  evidence: EvidenceView,
  evalTrend: EvalTrendView,
  automation: AutomationView,
  routines: RoutinesView,
  agentSkills: AgentSkillsView,
  invocations: InvocationsView,
  agents: AgentsView,
  devices: DevicesView,
  discovery: DiscoveryView,
  integrations: IntegrationsView,
  tools: ToolsView,
  review: ReviewView,
  applications: ApplicationsView,
  channels: ChannelsView,
  sessions: SessionsView,
  economics: EconomicsView,
  audit: AuditView,
  myHosts: MyHostsView,
  siteSettings: SiteSettingsView,
};
