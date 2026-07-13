import type {
  AgentEconomicRecordId,
  AgentId,
  AIProviderId,
  AIUsageRecordId,
  ClaudeReviewFindingId,
  CodexReviewFindingId,
  DecimalString,
  DeviceId,
  ImportedUsageEstimateId,
  InvocationId,
  IsoDateTime,
  LedgerEntryId,
  ModelPriceId,
  QuotaPolicyId,
  QuotaDecisionId,
  TeamId,
  UserId,
} from "./common.js";
import type { AIUsageDerivation } from "./round-telemetry.js";

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

export interface AgentUsageSummary {
  agentId: AgentId;
  invocationCount: number;
  succeededCount: number;
  failedCount: number;
  cancelledCount: number;
  lastInvocationId: InvocationId | null;
  lastInvocationStatus: "succeeded" | "failed" | "cancelled" | "timed_out" | "expired" | "rejected" | null;
  costOwner: UserId | TeamId | "unknown";
  economicModel: AgentEconomicModel;
  currency: CurrencyCode;
  unknownCostVisible: boolean;
  updatedAt: IsoDateTime | null;
}

/**
 * A per-model price, in USD per 1M tokens (Epic #851). Rates are data, not code:
 * the runtime seeds a config/env-driven default table and matches an
 * `AIUsageRecord.model` to the most specific entry. An unmatched model is left
 * `unknown` rather than priced by a guess.
 */
export interface ModelPrice {
  id: ModelPriceId;
  provider: string;
  /** Lowercase model id or family prefix matched against the usage record's model. */
  model: string;
  currency: CurrencyCode;
  inputUsdPerMTok: DecimalString;
  outputUsdPerMTok: DecimalString;
  cachedInputUsdPerMTok: DecimalString;
  /** 0 when the provider already folds reasoning tokens into output. */
  reasoningOutputUsdPerMTok: DecimalString;
  source: "config" | "default" | "override";
  updatedAt: IsoDateTime;
}

export interface AIProvider {
  id: AIProviderId;
  ownerUserId: UserId;
  teamId?: TeamId | null;
  provider: string;
  mode: AIProviderMode;
  allowedModels: string[];
  status: "enabled" | "disabled";
  credentialState?: "configured" | "missing" | "external_reference" | "not_required";
  createdAt: IsoDateTime;
}

export interface AIUsageRecord {
  id: AIUsageRecordId;
  userId: UserId;
  teamId?: TeamId | null;
  agentId?: AgentId;
  invocationId?: InvocationId;
  deviceId?: DeviceId;
  quotaDecisionId?: QuotaDecisionId | null;
  provider: string;
  model: string;
  providerMode: AIProviderMode;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  requestCount?: number;
  latencyMs?: number | null;
  /** Number of model rounds this aggregate was summed from, when derived from rounds. */
  roundCount?: number;
  /** How the token counts were obtained. Absent on legacy records. */
  derivedFrom?: AIUsageDerivation;
  estimatedCost: DecimalString;
  ledgerEntryIds: LedgerEntryId[];
  status: "succeeded" | "failed" | "cancelled" | "blocked";
  errorCode?: string | null;
  createdAt: IsoDateTime;
}

export interface ImportedUsageEstimate {
  id: ImportedUsageEstimateId;
  source: "ccusage" | string;
  reportInvocationId: InvocationId;
  invocationId: InvocationId;
  projectId?: string | null;
  worktreeId?: string | null;
  requestedBy?: UserId | string | null;
  agentId?: AgentId | null;
  reportAgentName?: string | null;
  reportId: string;
  rowIndex: number;
  periodStart?: string | null;
  periodEnd?: string | null;
  date?: string | null;
  month?: string | null;
  week?: string | null;
  sessionId?: string | null;
  provider?: string | null;
  sourceAgent?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedCostUsd?: number | null;
  currency: CurrencyCode;
  amountSource: "imported_ccusage_report" | string;
  economicModel: "external_billed";
  authoritative: false;
  offline?: boolean | null;
  filters?: Record<string, unknown> | null;
  raw?: Record<string, unknown>;
  droppedRowCount?: number;
  createdAt: IsoDateTime;
}

export interface CodexReviewFinding {
  id: CodexReviewFindingId;
  source: "codex" | string;
  reviewInvocationId: InvocationId;
  invocationId: InvocationId;
  projectId?: string | null;
  worktreeId?: string | null;
  requestedBy?: UserId | string | null;
  agentId?: AgentId | null;
  reviewAgentName?: string | null;
  tool: "codex.review.diff" | string;
  mode: string;
  severityFloor?: string | null;
  summary?: string | null;
  findingIndex: number;
  severity: "low" | "medium" | "high";
  file: string;
  line?: number | null;
  message: string;
  suggestion?: string | null;
  confidence: "low" | "medium" | "high";
  authoritative: false;
  raw?: Record<string, unknown>;
  createdAt: IsoDateTime;
}

export interface ClaudeReviewFinding {
  id: ClaudeReviewFindingId;
  source: "claude" | string;
  reviewInvocationId: InvocationId;
  invocationId: InvocationId;
  projectId?: string | null;
  worktreeId?: string | null;
  requestedBy?: UserId | string | null;
  agentId?: AgentId | null;
  reviewAgentName?: string | null;
  tool: "claude.review.diff" | string;
  mode: string;
  severityFloor?: string | null;
  summary?: string | null;
  findingIndex: number;
  severity: "low" | "medium" | "high";
  file: string;
  line?: number | null;
  message: string;
  suggestion?: string | null;
  confidence: "low" | "medium" | "high";
  authoritative: false;
  raw?: Record<string, unknown>;
  createdAt: IsoDateTime;
}

export interface ReviewFinding {
  id: CodexReviewFindingId | ClaudeReviewFindingId;
  source: "codex" | "claude" | string;
  reviewInvocationId: InvocationId;
  invocationId: InvocationId;
  projectId?: string | null;
  worktreeId?: string | null;
  requestedBy?: UserId | string | null;
  agentId?: AgentId | null;
  reviewAgentName?: string | null;
  tool: "codex.review.diff" | "claude.review.diff" | string;
  mode: string;
  severityFloor?: string | null;
  summary?: string | null;
  findingIndex: number;
  severity: "low" | "medium" | "high";
  file: string;
  line?: number | null;
  message: string;
  suggestion?: string | null;
  confidence: "low" | "medium" | "high";
  authoritative: false;
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
  policyId?: QuotaPolicyId | null;
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
  enforce: boolean;
  providerMode?: AIProviderMode;
  estimatedCost?: DecimalString | null;
  createdUsageRecordId?: AIUsageRecordId | null;
  createdLedgerEntryIds?: LedgerEntryId[];
  createdAt: IsoDateTime;
}

export type QuotaPolicyDimension =
  | "user"
  | "team"
  | "provider"
  | "model"
  | "agent"
  | "time_window";

export interface QuotaPolicy {
  id: QuotaPolicyId;
  name: string;
  status: "enabled" | "disabled";
  providerMode: AIProviderMode;
  dimensions: QuotaPolicyDimension[];
  subjectType: "user" | "team" | "agent";
  subjectId: string;
  provider: string;
  model: string;
  limit: number;
  used: number;
  /** What `limit`/`used` count (#856). Defaults to request-count for compatibility. */
  meter?: "requests" | "input_tokens" | "total_tokens" | "usd";
  /** Whether exceeding the window blocks the run or only warns. */
  enforcement?: "block" | "warn";
  window: "daily" | "monthly" | "custom";
  currency: CurrencyCode;
  costOwner: UserId | TeamId | "unknown";
  teamId: TeamId | null;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}

export interface ChargebackExportRow {
  ledgerEntryId: LedgerEntryId;
  userId: UserId | null;
  teamId: TeamId | null;
  agentId: AgentId | null;
  invocationId: InvocationId | null;
  provider: string | null;
  model?: string | null;
  costOwner: UserId | TeamId | "unknown" | null;
  amount: DecimalString;
  currency: CurrencyCode;
  billable: boolean;
  status: LedgerEntryStatus;
  createdAt: IsoDateTime;
}
