import type { AgentId, BudgetId, IsoDateTime, ProjectId, TeamId } from "./common.js";

export type ProjectStatus = "active" | "archived";

// How invocations share the project's checkout. "shared": all runs use the main
// worktree. "worktree": each invocation gets its own ephemeral git worktree so
// concurrent runs can't collide (cleaned up when the invocation finishes).
export type ProjectIsolation = "shared" | "worktree";

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
  isolation: ProjectIsolation;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}
