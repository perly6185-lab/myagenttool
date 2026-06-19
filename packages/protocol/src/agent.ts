import type {
  AgentId,
  DeviceId,
  IntegrationArtifactId,
  IsoDateTime,
  JsonObject,
  LifecycleOperationId,
  RiskLevel,
  UserId,
} from "./common.js";
import type { AgentLifecycleState, IntegrationReviewState } from "./states.js";
import type { AgentEconomicsMetadata } from "./economics.js";

export type AgentLocation =
  | { type: "local_device"; deviceId: DeviceId }
  | { type: "remote_http"; baseUrl: string }
  | { type: "cloud_service"; provider: string }
  | { type: "container"; image: string }
  | { type: "platform_agent" }
  | { type: "external"; reference: string };

export type AgentAdapter =
  | { type: "cli"; command: string; args?: string[] }
  | { type: "http"; baseUrl: string; authMode?: "none" | "bearer" | "api_key" | "custom" }
  | { type: "mcp"; serverRef: string }
  | { type: "a2a"; endpoint: string }
  | { type: "platform"; name?: string }
  | { type: "external"; name: string; config?: JsonObject };

export type AgentStatus = "available" | "unavailable" | "disabled" | "unknown";

export type CapabilityRiskTag =
  | "read_only"
  | "read_local"
  | "write_local"
  | "network_access"
  | "credential_access"
  | "shell_exec"
  | "browser_control"
  | "desktop_control"
  | "destructive"
  | "budget_spending"
  | "policy_change"
  | "generated_code"
  | "secret_exposure"
  | "external_data_transfer";

export interface AgentCapability {
  name: string;
  description: string;
  riskLevel?: RiskLevel;
  riskTags?: CapabilityRiskTag[];
}

export interface AgentLifecycleMetadata {
  state: AgentLifecycleState;
  installState: AgentLifecycleState;
  version: string | null;
  managedBy: "bridge" | "platform" | "user" | "external" | "unknown";
}

export interface Agent {
  id: AgentId;
  name: string;
  description: string;
  ownerUserId: UserId | "system";
  location: AgentLocation;
  adapter: AgentAdapter;
  lifecycle: AgentLifecycleMetadata;
  economics: AgentEconomicsMetadata;
  capabilities: AgentCapability[];
  status: AgentStatus;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}

export type AgentLifecycleOperationType =
  | "discover"
  | "install"
  | "configure"
  | "enable"
  | "disable"
  | "update"
  | "uninstall"
  | "health_check";

export interface AgentLifecycleOperation {
  id: LifecycleOperationId;
  agentId: AgentId;
  deviceId?: DeviceId;
  requestedBy: UserId;
  operation: AgentLifecycleOperationType;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  reason: string | null;
  createdAt: IsoDateTime;
  completedAt?: IsoDateTime | null;
}

export type IntegrationArtifactType =
  | "adapter_config"
  | "install_recipe"
  | "health_check"
  | "schema"
  | "redaction_policy"
  | "permission_policy"
  | "test_case"
  | "adapter_plugin";

export interface IntegrationArtifact {
  id: IntegrationArtifactId;
  requestedBy: UserId;
  targetType: AgentAdapter["type"];
  artifactType: IntegrationArtifactType;
  reviewState: IntegrationReviewState;
  generatedByAi: boolean;
  summary: string;
  payload?: JsonObject;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}
