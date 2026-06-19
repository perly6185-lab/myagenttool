export type InvocationStatus =
  | "created"
  | "authorized"
  | "rejected"
  | "queued"
  | "dispatching"
  | "waiting_for_local_approval"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "expired";

export type DeliveryState =
  | "not_required"
  | "queued"
  | "dispatching"
  | "delivered"
  | "acknowledged"
  | "redelivering"
  | "delivery_failed"
  | "expired";

export type CancellationState =
  | "none"
  | "requested"
  | "queued_cancelled"
  | "dispatched"
  | "acknowledged"
  | "applied"
  | "failed"
  | "not_supported";

export type DeviceUnlinkState =
  | "linked"
  | "unlink_requested"
  | "unlinking"
  | "unlinked"
  | "archived"
  | "deletion_requested"
  | "deleted"
  | "unlink_failed";

export type AgentLifecycleState =
  | "discovered"
  | "installing"
  | "installed"
  | "enabled"
  | "disabled"
  | "updating"
  | "uninstalling"
  | "uninstalled"
  | "failed"
  | "unknown";

export type IdeaSessionState =
  | "draft"
  | "clarifying"
  | "planned"
  | "needs_agent"
  | "needs_approval"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "archived";

export type IntegrationReviewState =
  | "draft"
  | "generated"
  | "needs_review"
  | "approved"
  | "tested"
  | "enabled"
  | "rejected"
  | "archived";
