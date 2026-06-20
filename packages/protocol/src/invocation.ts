import type {
  AgentId,
  ArtifactId,
  DeviceId,
  IdeaSessionId,
  InvocationEventId,
  InvocationId,
  IsoDateTime,
  JsonObject,
  JsonValue,
  SpanId,
  TraceId,
  UserId,
} from "./common.js";
import type {
  CancellationState,
  DeliveryState,
  IdeaSessionState,
  InvocationStatus,
} from "./states.js";

export interface IdeaSession {
  id: IdeaSessionId;
  workspaceId: string;
  createdBy: UserId;
  title: string;
  originalIntent: string;
  clarifiedIntent: string | null;
  status: IdeaSessionState;
  selectedDeviceId: DeviceId | null;
  selectedAgentId: AgentId | null;
  planSummary: string | null;
  riskSummary: string | null;
  costSummary: string | null;
  dataSummary: string | null;
  invocationIds: InvocationId[];
  artifactIds: string[];
  approvalIds: string[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface InvocationDelivery {
  deliveryId?: string;
  deviceId: DeviceId | null;
  state: DeliveryState;
  idempotencyKey: string;
  leaseExpiresAt: IsoDateTime | null;
  dispatchAttempts: number;
  lastDispatchAt: IsoDateTime | null;
  acknowledgedAt: IsoDateTime | null;
  bridgeCursor?: string | null;
  expiresAt: IsoDateTime | null;
}

export interface InvocationCancellation {
  state: CancellationState;
  requestedBy: UserId | null;
  requestedAt: IsoDateTime | null;
  reason: string | null;
}

export interface InvocationOptions {
  timeoutSeconds?: number;
  requireLocalApproval?: boolean;
  metadata?: JsonObject;
}

export interface Invocation {
  id: InvocationId;
  ideaSessionId: IdeaSessionId | null;
  agentId: AgentId;
  requestedBy: UserId;
  status: InvocationStatus;
  traceId: TraceId;
  rootSpanId: SpanId;
  delivery: InvocationDelivery;
  cancellation: InvocationCancellation;
  input: JsonObject;
  options: InvocationOptions;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}

export type InvocationEventType =
  | "invocation_created"
  | "invocation_authorized"
  | "invocation_rejected"
  | "invocation_started"
  | "invocation_succeeded"
  | "invocation_failed"
  | "invocation_timed_out"
  | "invocation_expired"
  | "status_changed"
  | "log"
  | "agent_output"
  | "artifact_created"
  | "trace_created"
  | "span_started"
  | "span_completed"
  | "delivery_queued"
  | "delivery_dispatched"
  | "delivery_acknowledged"
  | "delivery_redelivered"
  | "cancel_requested"
  | "cancel_dispatched"
  | "cancel_acknowledged"
  | "cancel_applied"
  | "cancel_failed"
  | "permission_requested"
  | "permission_granted"
  | "permission_denied"
  | "local_approval_requested"
  | "local_approval_granted"
  | "local_approval_denied"
  | "policy_decision_recorded"
  | "risk_evaluated"
  | "alert_triggered"
  | "webhook_delivered"
  | "device_unlink_requested"
  | "device_dispatch_blocked"
  | "device_queue_cancelled"
  | "device_unlinked"
  | "error"
  | "heartbeat"
  | "lifecycle_requested"
  | "lifecycle_started"
  | "lifecycle_completed"
  | "lifecycle_failed"
  | "integration_generated"
  | "integration_reviewed"
  | "integration_tested"
  | "integration_enabled"
  | "platform_agent_started"
  | "platform_agent_recommended"
  | "platform_agent_action_requested"
  | "ai_usage_recorded"
  | "agent_economics_recorded"
  | "ledger_entry_recorded"
  | "budget_checked"
  | "settlement_recorded"
  | "quota_checked"
  | "billing_recorded";

export interface InvocationEvent {
  id: InvocationEventId;
  invocationId: InvocationId | null;
  type: InvocationEventType;
  level?: "debug" | "info" | "warn" | "error";
  message?: string;
  data?: JsonValue;
  createdAt: IsoDateTime;
}

export interface Trace {
  id: TraceId;
  subjectType: "invocation" | "lifecycle_operation" | "integration_artifact";
  subjectId: string;
  rootSpanId: SpanId;
  createdAt: IsoDateTime;
}

export interface Span {
  id: SpanId;
  traceId: TraceId;
  parentSpanId: SpanId | null;
  name: string;
  status: "started" | "succeeded" | "failed" | "cancelled";
  startedAt: IsoDateTime;
  endedAt: IsoDateTime | null;
  attributes: JsonObject;
}

export interface Artifact {
  id: ArtifactId;
  invocationId: InvocationId;
  kind: "text" | "json" | "file" | "link" | "unknown";
  name: string;
  storageRef: string;
  createdAt: IsoDateTime;
}
