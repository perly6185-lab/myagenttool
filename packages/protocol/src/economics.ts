import type {
  AgentEconomicRecordId,
  AgentId,
  AIProviderId,
  AIUsageRecordId,
  DecimalString,
  DeviceId,
  InvocationId,
  IsoDateTime,
  LedgerEntryId,
  QuotaDecisionId,
  TeamId,
  UserId,
} from "./common.js";

export type CurrencyCode = string;

export type AIProviderMode =
  | "byok"
  | "platform_managed"
  | "local_model"
  | "disabled";

export type AgentEconomicModel =
  | "free"
  | "external_billed"
  | "platform_billed"
  | "internal_chargeback"
  | "revenue_generating"
  | "rev_share"
  | "unknown";

export type PricingDimension =
  | "per_invocation"
  | "per_minute"
  | "per_token"
  | "per_request"
  | "per_success"
  | "per_artifact"
  | "per_seat"
  | "per_external_unit"
  | "fixed_monthly"
  | "custom_meter";

export interface AgentEconomicsMetadata {
  model: AgentEconomicModel;
  pricingDimensions: PricingDimension[];
  currency: CurrencyCode;
  costOwner: UserId | TeamId | "unknown";
  budgetPoolId: string | null;
  revenueOwner?: UserId | TeamId | "platform" | null;
  unknownCostPolicy?: "warn" | "require_approval" | "block";
}

export interface AIProvider {
  id: AIProviderId;
  ownerUserId: UserId;
  provider: string;
  mode: AIProviderMode;
  allowedModels: string[];
  status: "enabled" | "disabled";
  createdAt: IsoDateTime;
}

export interface AIUsageRecord {
  id: AIUsageRecordId;
  userId: UserId;
  agentId?: AgentId;
  invocationId?: InvocationId;
  deviceId?: DeviceId;
  provider: string;
  model: string;
  providerMode: AIProviderMode;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  requestCount?: number;
  estimatedCost: DecimalString;
  ledgerEntryIds: LedgerEntryId[];
  status: "succeeded" | "failed" | "cancelled";
  createdAt: IsoDateTime;
}

export type LedgerSourceType =
  | "ai_usage"
  | "agent_invocation"
  | "external_provider"
  | "manual_adjustment"
  | "subscription"
  | "marketplace"
  | "settlement";

export type LedgerEntryType =
  | "usage"
  | "cost"
  | "revenue"
  | "chargeback"
  | "credit"
  | "debit"
  | "reservation"
  | "release"
  | "settlement"
  | "adjustment"
  | "tax";

export type LedgerAmountDirection =
  | "payable"
  | "receivable"
  | "internal"
  | "informational";

export type LedgerEntryStatus =
  | "estimated"
  | "reserved"
  | "finalized"
  | "voided"
  | "adjusted"
  | "exported"
  | "settled";

export interface LedgerEntry {
  id: LedgerEntryId;
  workspaceId: TeamId;
  userId: UserId | null;
  teamId: TeamId | null;
  agentId: AgentId | null;
  invocationId: InvocationId | null;
  deviceId: DeviceId | null;
  sourceType: LedgerSourceType;
  sourceRecordId: string;
  entryType: LedgerEntryType;
  economicModel: AgentEconomicModel;
  meterName: PricingDimension | string;
  quantity: number;
  unitPrice: DecimalString;
  currency: CurrencyCode;
  amount: DecimalString;
  amountDirection: LedgerAmountDirection;
  costOwner: UserId | TeamId | "unknown" | null;
  revenueOwner: UserId | TeamId | "platform" | null;
  budgetPoolId: string | null;
  counterparty: string | null;
  provider: string | null;
  billable: boolean;
  status: LedgerEntryStatus;
  createdAt: IsoDateTime;
  finalizedAt: IsoDateTime | null;
}

export interface AgentEconomicRecord {
  id: AgentEconomicRecordId;
  agentId: AgentId;
  invocationId?: InvocationId;
  userId?: UserId;
  teamId?: TeamId | null;
  deviceId?: DeviceId;
  economicModel: AgentEconomicModel;
  ledgerEntryIds: LedgerEntryId[];
  sourceType: LedgerSourceType;
  sourceRecordId: string;
  meterName: PricingDimension | string;
  quantity: number;
  unitPrice: DecimalString;
  currency: CurrencyCode;
  costAmount: DecimalString;
  revenueAmount: DecimalString;
  chargebackAmount?: DecimalString;
  provider: string | null;
  billable: boolean;
  status: LedgerEntryStatus;
  finalizedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface QuotaDecision {
  id: QuotaDecisionId;
  subjectType: "user" | "team" | "agent";
  subjectId: string;
  resourceType: "ai_model" | "agent" | "budget_pool" | "provider";
  resourceId: string;
  decision:
    | "allowed"
    | "blocked_quota_exceeded"
    | "blocked_model_not_allowed"
    | "blocked_provider_disabled"
    | "blocked_missing_credential";
  reason: string;
  createdAt: IsoDateTime;
}
