export type IsoDateTime = string;
export type DecimalString = string;

export type UserId = `usr_${string}`;
export type TeamId = `team_${string}`;
export type MembershipId = `mem_${string}`;
export type PolicyBindingId = `pol_${string}`;
export type DeviceId = `dev_${string}`;
export type AgentId = `agt_${string}`;
export type InvocationId = `inv_${string}`;
export type IdeaSessionId = `ids_${string}`;
export type LifecycleOperationId = `lco_${string}`;
export type ApprovalRequestId = `apr_${string}`;
export type PolicyDecisionId = `pdr_${string}`;
export type IntegrationArtifactId = `itg_${string}`;
export type InvocationEventId = `evt_${string}`;
export type TraceId = `trc_${string}`;
export type SpanId = `spn_${string}`;
export type ArtifactId = `art_${string}`;
export type LedgerEntryId = `led_${string}`;
export type AgentEconomicRecordId = `eco_${string}`;
export type AIProviderId = `aip_${string}`;
export type AIUsageRecordId = `aiu_${string}`;
export type QuotaDecisionId = `qtd_${string}`;

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type Platform = "macos" | "windows" | "linux";
export type Architecture = "x64" | "arm64";
export type PathFormat = "posix" | "windows";
export type DefaultShell =
  | "bash"
  | "zsh"
  | "powershell"
  | "cmd"
  | "fish"
  | "unknown";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface Timestamped {
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}
