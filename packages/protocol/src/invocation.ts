import type {
  AgentId,
  ApprovalRequestId,
  ArtifactId,
  DeviceId,
  IdeaSessionId,
  InvocationEventId,
  InvocationId,
  IsoDateTime,
  JsonObject,
  JsonValue,
  PolicyDecisionId,
  ProjectId,
  SpanId,
  TraceId,
  TroubleshootingReportId,
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
  appliedAt: IsoDateTime | null;
  message: string | null;
}

export interface InvocationOptions {
  timeoutSeconds?: number;
  requireLocalApproval?: boolean;
  metadata?: JsonObject;
}

export interface ApprovalRequest {
  id: ApprovalRequestId;
  invocationId: InvocationId;
  agentId: AgentId;
  requestedBy: UserId;
  status: "pending" | "approved" | "denied";
  riskLevel: "low" | "medium" | "high" | "critical";
  riskTags: string[];
  summary: {
    risk: string;
    data: string;
    cost: string;
    cancellation: string;
  };
  createdAt: IsoDateTime;
  decidedAt?: IsoDateTime | null;
  decidedBy?: UserId | null;
}

export interface PolicyDecisionRecord {
  id: PolicyDecisionId;
  invocationId: InvocationId;
  agentId: AgentId;
  action: "invoke";
  riskLevel: "low" | "medium" | "high" | "critical";
  riskTags: string[];
  decision: "allowed" | "requires_local_approval" | "denied";
  reason: string;
  approvalRequestId?: ApprovalRequestId | null;
  approver?: UserId | null;
  createdAt: IsoDateTime;
}

export interface InvocationTroubleshootingReport {
  id: TroubleshootingReportId;
  invocationId: InvocationId;
  troubleshooterInvocationId?: InvocationId | null;
  platformAgentId: AgentId;
  requestedBy: UserId;
  status: "generated";
  failedStatus: InvocationStatus;
  bridgeState: string;
  adapterError: string | null;
  logSummary: string;
  suggestedFixes: string[];
  remediationRequiresApproval: boolean;
  webLinks?: {
    failedInvocation?: WebNavigationLink | null;
    troubleshooterInvocation?: WebNavigationLink | null;
    applicationRun?: WebNavigationLink | null;
  };
  summary: string;
  createdAt: IsoDateTime;
}

export interface WebNavigationLink {
  label: string;
  query: string;
  target: JsonObject;
}

export interface Invocation {
  id: InvocationId;
  ideaSessionId: IdeaSessionId | null;
  projectId: ProjectId;
  // Resolved at creation from the project's main worktree, when repo-backed.
  // The bridge runs the agent here (overriding the agent adapter's cwd).
  workingDirectory?: string | null;
  agentId: AgentId;
  requestedBy: UserId;
  status: InvocationStatus;
  traceId: TraceId;
  rootSpanId: SpanId;
  delivery: InvocationDelivery;
  cancellation: InvocationCancellation;
  input: JsonObject;
  options: InvocationOptions;
  policyDecisionId?: PolicyDecisionId | null;
  approvalRequestId?: ApprovalRequestId | null;
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
  | "round_started"
  | "round_completed"
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
  | "ccusage_imported_estimates_recorded"
  | "codex_review_findings_recorded"
  | "claude_review_findings_recorded"
  | "claude_transport_selected"
  | "run_transcript_recorded"
  | "run_transcript_superseded"
  | "run_transcript_payloads_reaped"
  | "tool_invocation_created"
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
