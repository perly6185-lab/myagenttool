export const invocationStatuses = [
  "created",
  "authorized",
  "rejected",
  "queued",
  "dispatching",
  "waiting_for_local_approval",
  "running",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "expired",
] as const;

export type InvocationStatus = (typeof invocationStatuses)[number];

export const deliveryStates = [
  "not_required",
  "queued",
  "dispatching",
  "delivered",
  "acknowledged",
  "redelivering",
  "delivery_failed",
  "expired",
] as const;

export type DeliveryState = (typeof deliveryStates)[number];

export const cancellationStates = [
  "none",
  "requested",
  "queued_cancelled",
  "dispatched",
  "acknowledged",
  "applied",
  "failed",
  "not_supported",
] as const;

export type CancellationState = (typeof cancellationStates)[number];

export const deviceUnlinkStates = [
  "linked",
  "unlink_requested",
  "unlinking",
  "unlinked",
  "archived",
  "deletion_requested",
  "deleted",
  "unlink_failed",
] as const;

export type DeviceUnlinkState = (typeof deviceUnlinkStates)[number];

export const agentLifecycleStates = [
  "discovered",
  "installing",
  "installed",
  "enabled",
  "disabled",
  "updating",
  "uninstalling",
  "uninstalled",
  "failed",
  "unknown",
] as const;

export type AgentLifecycleState = (typeof agentLifecycleStates)[number];

export const ideaSessionStates = [
  "draft",
  "clarifying",
  "planned",
  "needs_agent",
  "needs_approval",
  "running",
  "completed",
  "failed",
  "cancelled",
  "archived",
] as const;

export type IdeaSessionState = (typeof ideaSessionStates)[number];

export const integrationReviewStates = [
  "draft",
  "generated",
  "needs_review",
  "approved",
  "tested",
  "enabled",
  "rejected",
  "archived",
] as const;

export type IntegrationReviewState = (typeof integrationReviewStates)[number];
