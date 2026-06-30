import type {
  AgentId,
  ApprovalRequestId,
  DeviceId,
  IntegrationArtifactId,
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
export type LifecycleRollbackAction = "rollback";

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
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
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
  catalogEntryId?: string | null;
  bundleId?: string | null;
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

export interface PrivateCatalogEntry {
  id: string;
  packageName: string;
  displayName: string;
  description: string;
  ownerTeamId: string | null;
  visibility: "private" | "team" | "workspace";
  channel: "stable" | "beta" | "dev";
  version: string;
  agentId: AgentId | null;
  recipeIds: LifecycleRecipeId[];
  bundleIds: string[];
  status: "draft" | "published" | "archived";
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface SignedBundleManifest {
  id: string;
  catalogEntryId: string | null;
  artifactId?: IntegrationArtifactId | null;
  packageName: string;
  version: string;
  channel: "stable" | "beta" | "dev";
  sourceUri: string;
  checksum: string | null;
  signatureStatus: LifecycleRecipeSignatureStatus;
  provenance: {
    builder: string | null;
    sourceCommit: string | null;
    generatedByAi: boolean;
  };
  policy: {
    decision: "allowed" | "requires_local_approval" | "blocked";
    reason: string;
  };
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
  rollbackForActionId?: LifecycleOperationId | null;
  agentId: AgentId | null;
  deviceId: DeviceId | null;
  requestedBy: UserId;
  action: LifecycleRecipeAction | LifecycleRollbackAction;
  status: "queued" | "observed" | "running" | "succeeded" | "failed" | "cancelled";
  executionEnabled: boolean;
  command: LifecycleRecipeCommandDescriptor | null;
  summary: string;
  result?: LifecycleQueuedActionResult | null;
  createdAt: IsoDateTime;
  startedAt?: IsoDateTime | null;
  completedAt?: IsoDateTime | null;
}

export interface LifecycleRollbackRequest {
  id: LifecycleOperationId;
  recipeId: LifecycleRecipeId;
  failedActionId: LifecycleOperationId;
  agentId: AgentId | null;
  requestedBy: UserId;
  status: "available" | "queued" | "running" | "succeeded" | "failed" | "blocked";
  strategy: LifecycleRecipeRollbackMetadata["strategy"];
  command: LifecycleRecipeCommandDescriptor | null;
  summary: string;
  queuedActionId?: LifecycleOperationId | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface LifecycleQueuedActionResult {
  status: "succeeded" | "failed" | "cancelled";
  summary: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number | null;
  healthStatus: "healthy" | "unhealthy" | "unknown";
  rollbackAvailable: boolean;
}
