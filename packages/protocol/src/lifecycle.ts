import type {
  AgentId,
  ApprovalRequestId,
  DeviceId,
  IsoDateTime,
  JsonObject,
  LifecycleOperationId,
  LifecycleRecipeId,
  Platform,
  PolicyDecisionId,
  RiskLevel,
  UserId,
} from "./common.js";
import type { CapabilityRiskTag } from "./agent.js";

export type LifecycleRecipeAction = "install" | "update" | "uninstall";

export type LifecycleRecipeSourceType =
  | "local_file"
  | "workspace_catalog"
  | "private_catalog"
  | "generated_artifact"
  | "manual_entry";

export type LifecycleRecipeReviewState =
  | "draft"
  | "needs_review"
  | "approved"
  | "rejected"
  | "archived";

export type LifecycleRecipeSignatureStatus =
  | "unsigned"
  | "signed_verified"
  | "signed_unverified"
  | "signature_missing"
  | "not_required";

export type LifecycleRecipeQueueState =
  | "not_queued"
  | "local_approval_required"
  | "queued"
  | "observed"
  | "blocked"
  | "expired";

export interface LifecycleRecipeCommandDescriptor {
  summary: string;
  commandId: string;
  executable: string;
  args: string[];
  shell: false;
  packageManager?: string | null;
}

export interface LifecycleRecipeHealthCheck {
  type: "cli" | "http" | "manual";
  summary: string;
  command?: LifecycleRecipeCommandDescriptor | null;
  url?: string | null;
  timeoutSeconds: number;
}

export interface LifecycleRecipeRollbackMetadata {
  available: boolean;
  strategy: "previous_version" | "restore_config" | "manual" | "not_supported" | "unknown";
  previousVersion?: string | null;
  summary: string;
}

export interface LifecycleRecipeUninstallPolicy {
  bridgeManagedOnly: boolean;
  deletesUnderlyingSoftware: boolean;
  requiresExtraConfirmation: boolean;
  manualAgentRegistryOnly: boolean;
  summary: string;
}

export interface LifecycleRecipePlainLanguageSummary {
  action: string;
  source: string;
  risk: string;
  rollback: string;
  localApproval: string;
  dataImpact: string;
}

export interface LifecycleRecipeArtifact {
  id: LifecycleRecipeId;
  agentId: AgentId | null;
  requestedBy: UserId;
  action: LifecycleRecipeAction;
  reviewState: LifecycleRecipeReviewState;
  queueState: LifecycleRecipeQueueState;
  name: string;
  description: string;
  source: {
    type: LifecycleRecipeSourceType;
    uri: string;
    author: string;
    version: string;
    checksum: string | null;
    signatureStatus: LifecycleRecipeSignatureStatus;
    compatibilityRange: string;
  };
  supportedPlatforms: Platform[];
  requiredPermissions: string[];
  riskLevel: RiskLevel;
  riskTags: CapabilityRiskTag[];
  expectedTarget: {
    binary?: string | null;
    endpoint?: string | null;
    mcpConfig?: string | null;
  };
  recipeCommand: LifecycleRecipeCommandDescriptor | null;
  healthCheck: LifecycleRecipeHealthCheck | null;
  rollback: LifecycleRecipeRollbackMetadata;
  uninstall: LifecycleRecipeUninstallPolicy;
  summary: LifecycleRecipePlainLanguageSummary;
  payload: JsonObject;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface LifecyclePolicyDecision {
  id: PolicyDecisionId;
  recipeId: LifecycleRecipeId;
  agentId: AgentId | null;
  action: LifecycleRecipeAction;
  decision: "allowed" | "requires_local_approval" | "blocked";
  reason: string;
  checks: Array<{
    name: string;
    status: "passed" | "warning" | "failed";
    summary: string;
  }>;
  createdAt: IsoDateTime;
}

export interface LifecycleLocalApprovalRequest {
  id: ApprovalRequestId;
  recipeId: LifecycleRecipeId;
  agentId: AgentId | null;
  deviceId: DeviceId | null;
  requestedBy: UserId;
  status: "pending" | "approved" | "denied" | "expired";
  riskLevel: RiskLevel;
  riskTags: CapabilityRiskTag[];
  summary: LifecycleRecipePlainLanguageSummary;
  createdAt: IsoDateTime;
  decidedAt?: IsoDateTime | null;
  decidedBy?: UserId | null;
  expiresAt?: IsoDateTime | null;
}

export interface LifecycleQueuedAction {
  id: LifecycleOperationId;
  recipeId: LifecycleRecipeId;
  agentId: AgentId | null;
  deviceId: DeviceId | null;
  requestedBy: UserId;
  action: LifecycleRecipeAction;
  status: "queued" | "observed";
  executionEnabled: false;
  command: null;
  summary: string;
  createdAt: IsoDateTime;
}
