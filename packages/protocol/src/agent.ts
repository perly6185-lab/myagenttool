import type {
  AgentId,
  DeviceId,
  IntegrationArtifactId,
  IsoDateTime,
  JsonObject,
  JsonValue,
  LifecycleOperationId,
  RiskLevel,
  UserId,
} from "./common.js";
import type { AgentLifecycleState, IntegrationReviewState } from "./states.js";
import type { AgentEconomicsMetadata } from "./economics.js";
import type { LifecycleQueuedActionResult, LifecycleRecipeRollbackMetadata } from "./lifecycle.js";

export type AgentLocation =
  | { type: "local_device"; deviceId: DeviceId }
  | { type: "remote_http"; baseUrl: string }
  | { type: "cloud_service"; provider: string }
  | { type: "container"; image: string }
  | { type: "platform_agent" }
  | { type: "external"; reference: string };

export type AgentCancellationSupport = "supported" | "unsupported" | "unknown";
export type AgentEnvironmentPolicy = "inherit_safe" | "explicit_only" | "none";
export type AgentWorkingDirectoryPolicy = "bridge_default" | "explicit" | "none";
export type ClaudeRuntimeKind = "cli" | "agent_sdk";

export type AgentAdapter =
  | {
      type: "cli";
      command: string;
      args?: string[];
      workingDirectory?: string | null;
      workingDirectoryPolicy?: AgentWorkingDirectoryPolicy;
      environmentPolicy?: AgentEnvironmentPolicy;
      env?: Record<string, string>;
      timeoutSeconds?: number;
      cancellation?: AgentCancellationSupport;
      outputFormat?: string;
      sandbox?: string | null;
      permissionMode?: string | null;
      claudeRuntime?: ClaudeRuntimeKind;
    }
  | {
      type: "http";
      baseUrl: string;
      authMode?: "none" | "bearer" | "api_key" | "custom";
      requestPath?: string;
      healthPath?: string;
      method?: "POST";
      payloadShape?: JsonObject;
      timeoutSeconds?: number;
      streaming?: boolean;
      cancellation?: AgentCancellationSupport;
    }
  | { type: "mcp"; serverRef: string }
  | { type: "a2a"; endpoint: string }
  | { type: "platform"; name?: string }
  | { type: "external"; name: string; config?: JsonObject };

export type AgentStatus = "available" | "unavailable" | "disabled" | "unknown";
export type AgentHealthStatus = "unknown" | "checking" | "healthy" | "unhealthy";

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

export interface AgentHealth {
  status: AgentHealthStatus;
  checkedAt: IsoDateTime | null;
  message: string;
  nextAction: string | null;
}

export interface Agent {
  id: AgentId;
  name: string;
  description: string;
  ownerUserId: UserId | "system";
  /**
   * The external service this agent fronts (`google`, `netease`), as declared at
   * registration — the counterpart of an Application's
   * `source.credential.provider`. `null` means undeclared, which matches nobody:
   * discovery that resolves an agent by provider must refuse rather than adopt an
   * unmarked one (#1185).
   */
  provider?: string | null;
  location: AgentLocation;
  adapter: AgentAdapter;
  lifecycle: AgentLifecycleMetadata;
  economics: AgentEconomicsMetadata;
  capabilities: AgentCapability[];
  toolContract?: JsonObject | null;
  status: AgentStatus;
  health?: AgentHealth;
  registrationNotes?: {
    risk: string;
    data: string;
    cost: string;
    cancellation: string;
  };
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}

export interface AgentInvocationResult {
  summary: string;
  output?: JsonValue;
  touchedUserFiles?: boolean;
  cost?: JsonObject;
}

export type AgentLifecycleOperationType =
  | "discover"
  | "install"
  | "configure"
  | "enable"
  | "disable"
  | "update"
  | "uninstall"
  | "rollback"
  | "health_check";

export interface AgentLifecycleOperation {
  id: LifecycleOperationId;
  agentId: AgentId;
  deviceId?: DeviceId;
  requestedBy: UserId;
  operation: AgentLifecycleOperationType;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  reason: string | null;
  message?: string | null;
  result?: LifecycleQueuedActionResult | null;
  rollback?: LifecycleRecipeRollbackMetadata | null;
  createdAt: IsoDateTime;
  completedAt?: IsoDateTime | null;
}

export type AgentDiscoverySource =
  | "known_command_allowlist"
  | "user_provided_path"
  | "known_local_endpoint"
  | "user_provided_endpoint"
  | "bridge_managed_config";

export interface AgentDiscoveryCandidate {
  id: string;
  name: string;
  description: string;
  adapter: Extract<AgentAdapter, { type: "cli" | "http" }>;
  source: AgentDiscoverySource;
  confidence: "low" | "medium" | "high";
  riskLevel: RiskLevel;
  riskTags: CapabilityRiskTag[];
  riskHints: string[];
  healthProbeAvailable: boolean;
  healthPath?: string | null;
  registration: {
    agentId: AgentId;
    status: "candidate" | "registered";
    registeredAgentId?: AgentId | null;
  };
  createdAt: IsoDateTime;
}

export interface AgentDiscoveryRun {
  id: LifecycleOperationId;
  deviceId: DeviceId;
  requestedBy: UserId;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  scope: AgentDiscoverySource[];
  message: string;
  candidates: AgentDiscoveryCandidate[];
  createdAt: IsoDateTime;
  completedAt?: IsoDateTime | null;
}

export type IntegrationArtifactType =
  | "integration_plan"
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
  sourceArtifactId?: IntegrationArtifactId | null;
  payload?: JsonObject;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}

export interface IntegrationProbeRun {
  id: LifecycleOperationId;
  artifactId: IntegrationArtifactId;
  deviceId: DeviceId | null;
  requestedBy: UserId;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  adapter: Extract<AgentAdapter, { type: "cli" | "http" }>;
  summary: string;
  details: string[];
  createdAt: IsoDateTime;
  completedAt?: IsoDateTime | null;
}
