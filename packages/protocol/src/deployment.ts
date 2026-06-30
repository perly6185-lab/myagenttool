import type {
  AuditExportId,
  DeploymentConfigId,
  IsoDateTime,
  JsonObject,
  TeamId,
  UserId,
} from "./common.js";

export type DeploymentMode = "local_developer" | "self_hosted" | "saas" | "private_deployment";

export type AuditExportSubject =
  | "invocation"
  | "lifecycle"
  | "quota"
  | "usage"
  | "ledger"
  | "policy"
  | "audit";

export type AuditSinkType =
  | "local_file"
  | "object_storage"
  | "siem"
  | "webhook"
  | "immutable_store"
  | "disabled";

export interface AuditSinkConfig {
  id: string;
  type: AuditSinkType;
  enabled: boolean;
  displayName: string;
  destinationRef: string | null;
  immutable: boolean;
  externalDeliveryEnabled: boolean;
  retentionDays: number | null;
  metadata?: JsonObject;
}

export interface AlertSinkConfig {
  id: string;
  type: "email" | "webhook" | "siem" | "local_log" | "disabled";
  enabled: boolean;
  destinationRef: string | null;
  severityThreshold: "info" | "warn" | "error" | "critical";
  externalDeliveryEnabled: boolean;
}

export interface PrivateDeploymentConfig {
  id: DeploymentConfigId;
  mode: DeploymentMode;
  ownerTeamId: TeamId | null;
  auditExportEnabled: boolean;
  immutableAuditOption: "disabled" | "configured" | "required";
  capabilities: {
    privateCatalog: boolean;
    signedBundles: boolean;
    auditExport: boolean;
    siemExport: boolean;
    immutableAudit: boolean;
    platformManagedAi: boolean;
  };
  auditSinks: AuditSinkConfig[];
  alertSinks: AlertSinkConfig[];
  entitlementPolicy: {
    canBlockPaidFeatures: boolean;
    canBlockNewPlatformManagedAi: boolean;
    canBlockDataExport: false;
    canDeleteUserData: false;
    canRemoveLocalSoftware: false;
    canPreventDeviceUnlink: false;
  };
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface AuditExportRequest {
  id: AuditExportId;
  requestedBy: UserId;
  mode: DeploymentMode;
  subjects: AuditExportSubject[];
  status: "draft" | "validated" | "blocked" | "exported";
  dryRun: boolean;
  sinkId: string | null;
  recordCounts: Record<AuditExportSubject, number>;
  validation: {
    ok: boolean;
    findings: Array<{
      severity: "info" | "warn" | "error";
      code: string;
      message: string;
    }>;
  };
  createdAt: IsoDateTime;
}
