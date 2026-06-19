import type {
  Architecture,
  DefaultShell,
  DeviceId,
  IsoDateTime,
  PathFormat,
  Platform,
  UserId,
} from "./common.js";
import type { DeviceUnlinkState } from "./states.js";

export type DeviceStatus = "online" | "offline" | "unknown";

export interface Device {
  id: DeviceId;
  ownerUserId: UserId;
  name: string;
  platform: Platform;
  architecture: Architecture;
  defaultShell: DefaultShell;
  pathFormat: PathFormat;
  bridgeVersion: string;
  status: DeviceStatus;
  unlinkState: DeviceUnlinkState;
  lastSeenAt: IsoDateTime | null;
  registeredCapabilities?: string[];
  credentialRevokedAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}

export type DeviceUnlinkDataDisposition =
  | "keep_history"
  | "archive_history"
  | "delete_operational_data"
  | "delete_all_possible";

export interface DeviceUnlinkOperation {
  operationId: string;
  deviceId: DeviceId;
  requestedBy: UserId;
  dataDisposition: DeviceUnlinkDataDisposition;
  localBridgeDisposition: "keep_local_config" | "remove_local_config" | "unknown";
  queuedInvocationCount: number;
  queuedCancellationResult: "not_started" | "succeeded" | "failed" | "partial";
  runningCancellationResult: "not_started" | "succeeded" | "failed" | "partial";
  credentialRevocationResult: "not_started" | "succeeded" | "failed";
  auditRetentionReason: string | null;
  status: DeviceUnlinkState;
  createdAt: IsoDateTime;
  completedAt: IsoDateTime | null;
}
