import type {
  AgentId,
  DeviceId,
  InvocationId,
  IsoDateTime,
  JsonObject,
  TraceId,
  UserId,
} from "./common.js";
import type { InvocationStatus } from "./states.js";

export interface AuditSummary {
  invocationId: InvocationId;
  requesterId: UserId;
  agentId: AgentId;
  deviceId: DeviceId | null;
  status: InvocationStatus;
  permissionDecision: "allowed" | "denied" | "not_required";
  traceId: TraceId | null;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  resultSummary: string | null;
  errorSummary: string | null;
  dataStored: boolean;
  costSummary: string | null;
  metadata?: JsonObject;
}
