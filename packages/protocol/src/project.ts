import type { AgentId, BudgetId, IsoDateTime, ProjectId, TeamId } from "./common.js";

export type ProjectStatus = "active" | "archived";

// A Project is the mandatory attribution floor: every invocation belongs to one,
// and budgets/chargeback roll up by projectId. It is device-independent (the
// "where it runs" binding is a separate ProjectTarget concept, deferred to P1).
export interface Project {
  id: ProjectId;
  name: string;
  color: string; // hex badge color for sidebar grouping (mirrors orca badgeColor)
  ownerTeamId: TeamId;
  budgetPoolId: BudgetId | null;
  defaultAgentId: AgentId | null;
  status: ProjectStatus;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}
