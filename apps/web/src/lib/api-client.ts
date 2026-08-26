/*
 * Typed client for the M0 server API. One unified invocation surface, mirrored
 * from the control-plane gateway: every action goes through `request()` so
 * error wording and the localhost-only API override stay consistent.
 */

import type {
  AssetDescriptor,
  ApplicationCapability,
  ApplicationInstallPlan,
  ApplicationInstallRun,
  ApplicationOrchestrationRecovery,
  ApplicationOrchestrationRecoveryAgentCandidate,
  ApplicationOrchestrationRun,
  ApplicationOrchestrationRunDetail,
  ApplicationRegisterRequest,
  ApplicationSnapshot,
  ConsoleSnapshot,
  ChannelInteraction,
  ChannelDiagnostics,
  InvocationEventSnapshot,
  KnownApplicationCatalogEntry,
  ProjectTreeResponse,
  ProjectDocumentsResponse,
  RefusalRow,
  ReviewFindingQueryResponse,
  ToolDescriptor,
  ToolInvocationRequest,
  ToolInvocationResponse,
} from "@/lib/console-state";
import type { BusinessLedgerRecordRef, LedgerPostingPlan, TaskRecordBinding, TaskTemplateContractV2 } from "@myagenttool/protocol/task-resources";
import {
  ApiError,
  apiBase,
  csrfHeaders,
  ensureSession,
  request,
  requestByteRange,
  requestBytes,
  requestRaw,
  REQUEST_TIMEOUT_MS,
  setSessionReady,
  setSessionAnonymous,
  setSessionUser,
  type SessionUser,
} from "@/lib/api/request";

export {
  ApiError,
  ensureSession,
  getSessionUser,
  openControlPlaneEventStream,
  request,
  requestRaw,
  resolveApiBase,
  SESSION_CHANGED_EVENT,
} from "@/lib/api/request";
export type { SessionUser } from "@/lib/api/request";
export type {
  LocalContentCatalogStats,
  LocalContentHealth,
  LocalContentKind,
  LocalContentPreview,
  LocalContentRecord,
  WorkItemContentReference,
} from "@/features/local-content/local-content-types";

export interface MailboxAccount {
  id: string;
  provider: string;
  accountId?: string | null;
  name: string;
  status: "connected" | "needs_attention";
  statusDetail: "ready" | "credential_not_authorized" | string;
  canReceive: boolean;
  canSend: boolean;
  canOrganize?: boolean;
  readApplicationId: string;
  sendApplicationId: string | null;
  organizeApplicationId?: string | null;
  fetchCapability: string | null;
  bodyPrefetchCapability?: string | null;
  incrementalSync: boolean;
  providerReadState: boolean;
}

export interface MailboxSync {
  status: "idle" | "syncing" | "succeeded" | "failed";
  invocationId: string | null;
  lastCompletedAt: string | null;
  lastSucceededAt: string | null;
}

export interface MailboxMessage {
  id: string;
  messageId: string;
  from: string;
  subject: string;
  date: string | null;
  body: string | null;
  bodyHtml: string;
  hasHtml: boolean;
  bodyTruncated: boolean;
  bodyContentVersion: number;
  preview: string;
  unread: boolean;
  folderId: string;
  folderPath: string;
  fetched: boolean;
  bodyFetch?: {
    status: "unavailable" | "queued" | "running" | "retry_wait" | "ready" | "failed";
    priority: "background" | "user";
    attempt: number;
    lastError: string | null;
  };
  inReplyTo: string | null;
  references: string[];
  attachments: Array<{ id: string; name: string; contentType: string; size: number; sha256: string | null; previewable: boolean; localAvailable?: boolean; contentId?: string }>;
  attachmentMetadataLoaded: boolean;
  archive: { version: 1; ref?: string; availability: "available" | "unavailable"; sha256?: string; size?: number; archivedAt?: string | null; reason?: string } | null;
  applicationId: string | null;
  issueNumber: number | null;
  task: {
    id: string;
    localRef: string;
    title: string;
    projectId: string;
    sourceStatus?: "current" | "update_pending";
    sourceRevision?: number;
    messageCount?: number;
  } | null;
  createdAt: string | null;
  classification?: MailClassification | null;
}

export interface MailClassification {
  attention: "action_required" | "reply_expected" | "important" | "routine" | "low_value" | "unknown";
  mailType: "human_conversation" | "customer_or_project" | "transaction" | "account_security" | "calendar" | "system_notification" | "newsletter" | "marketing" | "personal" | "other" | "unknown";
  suggestedAction: "reply" | "create_task" | "review_attachment" | "read" | "archive_candidate" | "none";
  label: string;
  explanation: string;
  uncertain: boolean;
  confirmationState: "proposed" | "confirmed" | "corrected" | "dismissed";
  revision: number;
  source?: "header" | "semantic" | "rule" | "manual";
  ruleId?: string;
}

export interface MailClassificationTarget {
  attention: MailClassification["attention"];
  mailType: MailClassification["mailType"];
  suggestedAction: MailClassification["suggestedAction"];
}

export interface MailClassificationRule {
  id: string;
  accountId: string;
  status: "active" | "paused" | "revoked";
  matchKind: "sender" | "domain";
  matchValue: string;
  target: MailClassificationTarget;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface MailClassificationRuleSuggestion {
  id: string;
  accountId: string;
  matchKind: "sender" | "domain";
  matchValue: string;
  target: MailClassificationTarget;
  evidenceCount: number;
  affectedCount: number;
  samples: Array<{ messageId: string; from: string; subject: string; date: string | null }>;
}

export interface MailFolderDestination {
  kind: "existing" | "new";
  folderId: string | null;
  folderPath: string | null;
  name: string | null;
  category: "subscriptions" | "notifications";
}

export interface MailFolderSuggestion {
  id: string;
  accountId: string;
  classificationRuleId: string;
  classificationRuleRevision: number;
  matchKind: "sender" | "domain";
  matchValue: string;
  destinationCategory: "subscriptions" | "notifications";
  affectedCount: number;
  protectedCount: number;
  proposedDestination: MailFolderDestination;
  folderOptions: MailFolderDestination[];
  samples: Array<{ messageId: string; from: string; subject: string; date: string | null; folderId: string }>;
}

export interface MailFolderMovePreview {
  id: string;
  accountId: string;
  suggestionId: string;
  destination: MailFolderDestination;
  totalMatched: number;
  selectedCount: number;
  remainingCount: number;
  status: "previewed";
  purpose?: "manual" | "automatic" | "recovery";
  recoveryOfJobId?: string | null;
  revision: number;
  expiresAt: string;
  samples: MailFolderSuggestion["samples"];
  approvalTarget: string;
  movesSupported: boolean;
}

export interface MailFolderMoveJob {
  id: string;
  accountId: string;
  previewId: string;
  destination: MailFolderDestination;
  requestedCount: number;
  movedCount: number;
  missingCount: number;
  conflictCount?: number;
  pendingCount?: number;
  unknownCount?: number;
  mode?: "manual" | "automatic" | "recovery";
  automationId?: string | null;
  recoveryOfJobId?: string | null;
  status: "moving" | "succeeded" | "unconfirmed" | "recoverable" | "conflict";
  conflictType?: string | null;
  revision: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  items?: Array<{ messageId: string; sourceFolderPath: string; status: "pending" | "moved" | "missing" | "conflict" | "unknown"; reason: string | null }>;
}

export interface MailFolderAutomation {
  id: string;
  accountId: string;
  classificationRuleId: string;
  classificationRuleRevision: number;
  suggestionId: string;
  destination: MailFolderDestination;
  status: "active" | "paused" | "revoked";
  pauseReason: string | null;
  batchSize: number;
  revision: number;
  enabledAt: string;
  lastRunAt: string | null;
  lastJobId: string | null;
  lastSuccessfulAt: string | null;
  consecutiveSuccessfulBatches: number;
  lastCheckedAt: string | null;
  nextAction: "none" | "resume_when_ready" | "sync_and_review" | "review_classification_quality" | "enable_rollout" | "reauthorize" | "create_new_authorization";
  createdAt: string;
  updatedAt: string;
}

export interface MailFolderAutomationDryRun {
  automationId: string;
  checkedAt: string;
  providerCalled: false;
  successCountersChanged: false;
  accountId?: string;
  destination?: MailFolderDestination;
  selectedCount: number;
  matchedCount: number;
  excludedCount: number;
  exclusions?: { protected: number; batchLimit: number };
  exclusionReasons: string[];
}

export type MailSmartView = "all" | "needs_attention" | "important" | "notifications" | "subscriptions" | "other";

export interface MailClassificationJob {
  id: string;
  scope: string;
  mode: "header" | "semantic";
  status: "queued" | "running" | "cancelling" | "succeeded" | "degraded" | "cancelled" | "interrupted";
  total: number;
  processed: number;
  classified: number;
  failed: number;
  cancelled?: number;
  provider?: string | null;
  model?: string | null;
}

export interface MailQualityMetric {
  numerator: number;
  denominator: number;
  value: number | null;
  target: number;
  direction: "at_least" | "at_most";
}

export interface MailClassificationQuality {
  status: "collecting" | "healthy" | "needs_attention";
  generatedAt: string;
  sampleSize: number;
  minimumSample: number;
  signals: Array<"insufficient_sample" | "low_coverage" | "high_unknown_rate" | "high_correction_rate" | "high_job_failure_rate" | "stale_classifier_results">;
  metrics: {
    coverage: MailQualityMetric;
    unknown: MailQualityMetric;
    corrections: MailQualityMetric;
    jobFailures: MailQualityMetric;
    semantic: { count: number };
    stale: { count: number };
  };
  organization: {
    status: "collecting" | "healthy" | "needs_attention";
    completedBatches: number;
    unconfirmedBatches: number;
    unconfirmedRate: number | null;
    minimumSample: number;
  };
  privacy: { localOnly: true; includesMessageContent: false; includesSenderIdentity: false };
}

export interface MailSemanticPreview {
  available: boolean;
  reason: "not_configured" | "circuit_open" | null;
  eligible: number;
  pending: number;
  limit: number;
  newestDate: string | null;
  oldestDate: string | null;
  readsUnopenedBodies: false;
  externalModel: false;
  provider: string | null;
  model: string | null;
  circuitRemainingMs: number;
}

export interface MailboxDraft {
  id: string;
  status: "draft" | "sending" | "sent" | "send_unconfirmed" | string;
  revision: number;
  origin: "user" | "reply" | "legacy" | string;
  to: string;
  subject: string;
  body: string;
  inReplyTo: string | null;
  references: string[];
  attachments: MailDraftAttachment[];
  createdAt: string | null;
  updatedAt: string | null;
  sentAt: string | null;
  sendError: string | null;
  approvalTarget: string;
  provenance?: { packageId: string; packageRevision: number; workItemId: string; sourceRevision: number } | null;
}

export interface MailDraftAttachment {
  ref: string;
  name: string;
  contentType: string;
  size: number;
}

export interface MailResponsePackage {
  id: string;
  workItemId: string;
  mailTaskLinkId: string;
  messageId: string;
  sourceRevision: number;
  revision: number;
  status: "ready_for_review" | "approved" | "changes_requested" | "draft_created" | "sent" | "send_failed" | "send_unconfirmed" | "superseded";
  analysis: string;
  requests: string[];
  deadlines: string[];
  risks: string[];
  uncertainties: string[];
  proposedReply: string;
  candidateAttachments: MailDraftAttachment[];
  candidateOutputAssets?: Array<{
    id: string | null;
    projectId: string;
    worktreeId: string | null;
    relativePath: string;
    name: string;
    contentType: string;
    size: number | null;
    sha256: string;
  }>;
  review: { decision: "approve" | "request_changes"; feedback: string; reviewedBy: string | null; reviewedAt: string } | null;
  draftId: string | null;
  supersededBy: string | null;
  sendReceipt?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface MailTaskPolicy {
  id: string;
  projectId: string;
  mode: "off" | "shadow" | "create_only" | "create_and_run";
  enabled: boolean;
  senderDomains: string[];
  maxPerDay: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface MailTaskOperations {
  generatedAt: string;
  killSwitchOpen: boolean;
  metrics: { linkedTasks: number; sourceUpdatesPending: number; awaitingReview: number; approved: number; draftsCreated: number; shadowMatches: number; automationCreated: number; recoveryRequired: number; knownCostUsd: number; unmeteredCostEntries: number };
  timeline: Array<{ kind: "link" | "package" | "policy_decision"; id: string; workItemId: string | null; status: string; revision: number | null; at: string }>;
}

export interface MailboxSnapshot {
  accounts: MailboxAccount[];
  connection: { status: "connected" | "not_connected" | "needs_attention"; message: string };
  sync: MailboxSync;
  folders: Array<{ id: string; name?: string; kind?: "provider"; specialUse?: string | null; count: number; unread?: number; cursorReset?: boolean; syncError?: boolean }>;
  messages: MailboxMessage[];
  query: string;
  selectedFolder: string;
  selectedView?: MailSmartView;
  classificationSummary?: {
    counts: Record<MailSmartView, number>;
    classified: number;
    pending: number;
    classifierVersion: number;
  } | null;
  pagination: { page: number; pageSize: number; total: number; totalPages: number; hasPrevious: boolean; hasNext: boolean };
  drafts: MailboxDraft[];
  updatedAt: string | null;
}

export interface LoopRefusalsResponse {
  refusals: RefusalRow[];
  scannedRuns: number;
  totalRuns: number;
  truncatedRuns: boolean;
}

export interface InvocationEventsResponse {
  invocationId: string;
  events: InvocationEventSnapshot[];
  nextCursor: string | null;
  hasMore: boolean;
  retentionTruncated: boolean;
}

export interface RefusalSnapshot {
  id: string;
  invocationId?: string;
  at?: string;
  category: string;
  code?: string;
  summary?: string;
  remedy?: string;
  piiRedacted?: boolean;
}

export interface InvocationRefusalsResponse {
  invocationId: string;
  refusals: RefusalSnapshot[];
  truncated: boolean;
}

export interface DispatchQueueItem {
  invocationId: string;
  task: string;
  projectId: string | null;
  worktreeId: string | null;
  agentId: string | null;
  agentName: string | null;
  deliveryState: string | null;
  dispatchAttempts: number;
  queuedForMs: number | null;
  blockedReason: string;
}

export interface InvocationDispatchHealthResponse {
  capacity: {
    maxConcurrency: number;
    inFlight: number;
    utilization: number | null;
    atCapacity: boolean;
  };
  queue: {
    depth: number;
    byReason: Record<string, number>;
    items: DispatchQueueItem[];
  };
  stats: {
    sampleSize: number;
    indeterminate: boolean;
    medianMsToDispatch: number | null;
    redeliveryRate: number | null;
    exhaustedCount: number;
  };
  reliability: {
    failover: { attempts: number; recovered: number; exhausted: number; latest: Array<Record<string, unknown>> };
    claims: { active: number; expired: number; nextExpiryAt: string | null };
    intervention: { required: number; items: Array<{ autoRunId: string; invocationId: string | null; reason: string; state: string }> };
  };
}

export interface LocalScheduleCapacityResponse {
  generatedAt: string;
  terminal: null | {
    id: string;
    name: string | null;
    status: string;
    unlinkState: string;
    bridgeAvailable: boolean;
    timeZone?: string;
  };
  capacity: {
    maxConcurrency: number;
    inFlight: number;
    utilization: number | null;
    atCapacity: boolean;
    availableSlots: number;
    queueDepth: number;
    worktreeLocks: number;
  };
  work: {
    total: number;
    executable: number;
    attention: number;
    backlog: number;
    items: Array<{
      workItemId: string;
      sourceKind: "work_item" | "auto_run";
      sourceId: string;
      localRef: string | null;
      title: string;
      projectId: string | null;
      status: string;
      runtimeState?: string | null;
      priority: string;
      dueDate: string | null;
      plannedDate: string | null;
      carriedFromDate: string | null;
      schedulePlanSource: "manual" | "auto_plan" | "rollover" | "urgent_insert" | null;
      scheduleReason: string | null;
      scheduleOrder: number | null;
      manuallyPinned: boolean;
      revision: number;
      createdAt: string | null;
      updatedAt: string | null;
      category: "executable" | "attention" | "backlog";
      estimate: {
        minutes: number;
        source: "history" | "estimate_points" | "default";
        confidence: "high" | "medium" | "low";
        sampleSize: number;
      };
      readiness: { state: string; reason: string };
      worktreeIds: string[];
    }>;
  };
  assumptions: {
    pointMinutes: number;
    defaultMinutes: number;
    estimateRangeMinutes: { min: number; max: number };
  };
}

export interface LocalSchedulePreviewResponse {
  generatedAt: string;
  planRevision: string;
  terminalId: string | null;
  horizon: { yesterday: string; today: string; tomorrow: string };
  assumptions: {
    workdayMinutes: number;
    utilization: number;
    urgentReserve: number;
    timeZone?: string;
    grossMinutes: number;
    allocatableMinutes: number;
  };
  days: Array<{
    date: string;
    capacityMinutes: number;
    plannedMinutes: number;
    availableMinutes: number;
    items: Array<{
      workItemId: string;
      sourceKind: "work_item" | "auto_run";
      sourceId: string;
      localRef: string | null;
      title: string;
      priority: string;
      status: string;
      runtimeState?: string | null;
      estimatedMinutes: number;
      estimateConfidence: "high" | "medium" | "low";
      previousPlannedDate: string | null;
      pinned: boolean;
      expectedRevision: number;
    }>;
  }>;
  attention: Array<{ workItemId: string; reason: string }>;
  unscheduled: Array<{ workItemId: string; reason: string; plannedDate?: string }>;
}

export interface LocalScheduleRolloverMove {
  workItemId: string;
  localRef: string | null;
  title: string;
  status: string;
  sourceDate: string;
  targetDate: string;
  expectedRevision: number;
  runningContextPreserved: boolean;
  previousPlanSource: string | null;
  reason: string;
}

export interface LocalScheduleRolloverResponse {
  generatedAt: string;
  rolloverRevision: string;
  terminalId: string | null;
  sourceDate: string;
  targetDate: string;
  moves: LocalScheduleRolloverMove[];
  confirmationRequired: LocalScheduleRolloverMove[];
  unscheduled: Array<{ workItemId: string; reason: string }>;
}

export interface LocalScheduleUrgentInsertion {
  workItemId: string;
  localRef: string | null;
  title: string;
  dueDate: string | null;
  createdAt: string | null;
  expectedRevision: number;
  targetDate: string;
  estimatedMinutes: number;
  queueOrder: number;
  activation: "immediate" | "next_eligible" | "head_after_worktree_unlock" | "waiting_terminal";
  requiresPinnedConfirmation: boolean;
  reason: string;
}

export interface LocalScheduleUrgentDisplacement {
  workItemId: string;
  localRef: string | null;
  title: string;
  priority: string;
  expectedRevision: number;
  sourceDate: string;
  targetDate: string;
  estimatedMinutes: number;
  manuallyPinned: boolean;
  forWorkItemId: string;
  reason: string;
}

export interface LocalScheduleUrgentResponse {
  generatedAt: string;
  urgentRevision: string;
  terminalId: string | null;
  date: string;
  capacity: {
    grossMinutes: number;
    routineMinutes: number;
    urgentReserveMinutes: number;
    availableSlots: number;
    inFlight: number;
  };
  insertions: LocalScheduleUrgentInsertion[];
  displacements: LocalScheduleUrgentDisplacement[];
  confirmationRequired: LocalScheduleUrgentDisplacement[];
  unscheduled: Array<{ workItemId: string; reason: string }>;
}

export type WorkflowArtifactRole = "requirement" | "delivery" | "reference" | "draft" | "unknown";

export interface WorkflowSource {
  id: string;
  projectId: string;
  name: string;
  purpose?: "template_learning" | string;
  templateId?: string;
  templateLearningTaskId?: string;
  selectedFileCount?: number;
  relativePath: string;
  readMode: "metadata" | "supported_text";
  state: "active" | "revoked";
  scanState: "idle" | "scanning" | "ready" | "failed";
  scanProgress?: {
    scannedEntries: number;
    discovered: number;
    skipped: number;
    parsed: number;
    parseFailed: number;
    reused: number;
  } | null;
  scanRevision: number;
  revision: number;
  fileCount: number;
  skippedCount: number;
  parsedCount?: number;
  parseFailedCount?: number;
  reusedCount?: number;
  truncated: boolean;
  lastScanAt: string | null;
  lastError: string | null;
  currentScanJobId?: string;
  recoveryAvailable?: boolean;
  embeddingEvaluation?: {
    providerId: string;
    model: string;
    modelVersion: string;
    gate: WorkflowRetrievalEvaluation["gate"];
    evaluatedAt: string;
  };
}

export interface WorkflowArtifact {
  id: string;
  projectId: string;
  sourceId: string;
  relativePath: string;
  name: string;
  extension: string;
  family: string;
  size: number;
  modifiedAt: string;
  fingerprint: string;
  role: WorkflowArtifactRole;
  roleInference: {
    role: WorkflowArtifactRole;
    confidence: number;
    reasons: string[];
    evidenceRefs: Array<{ kind: string; value: string }>;
    riskSignals: string[];
    classifierVersion: number;
  };
  confirmationState: "proposed" | "confirmed" | "changed";
  availability: "available" | "missing" | "checkpointed";
  exclusion?: { reason: string; at: string; by: string };
  extraction?: {
    state: "ready" | "needs_ocr" | "failed" | "limited" | "skipped";
    parserVersion: number;
    characterCount?: number;
    pageCount?: number | null;
    cellCount?: number | null;
    truncated?: boolean;
    needsOcr?: boolean;
    errorCode?: string;
    error?: string;
    reason?: string;
    blocks?: Array<{
      kind: string;
      text: string;
      location: Record<string, unknown> | null;
    }>;
  };
  revision: number;
}

export type BusinessDocumentType =
  | "inquiry"
  | "quotation"
  | "order"
  | "inquiry_ledger"
  | "quotation_ledger"
  | "order_ledger"
  | "price_list"
  | "customer_reference"
  | "other_reference"
  | "contract_review"
  | "purchase_request"
  | "customer_complaint"
  | "weekly_report"
  | "project_acceptance"
  | "unknown";

export interface BusinessFieldProposal {
  key:
    | "customer"
    | "product"
    | "quantity"
    | "unit_price"
    | "currency"
    | "tax_rate"
    | "delivery_terms"
    | "amount"
    | "document_date"
    | "inquiry_number"
    | "quotation_number"
    | "order_number";
  value: string;
  normalizedValue: string | null;
  confidence: number;
  evidenceRefs: Array<{
    artifactId: string;
    kind: string;
    field: string | null;
    location: string | null;
  }>;
  confirmationState: "proposed" | "confirmed" | "corrected";
}

export interface BusinessDocumentClassification {
  id: string;
  projectId: string;
  sourceId: string;
  artifactId: string;
  artifactFingerprint: string;
  documentType: BusinessDocumentType;
  confidence: number;
  reasons: string[];
  evidenceRefs: Array<{
    artifactId: string;
    kind: string;
    field: string | null;
    location: string | null;
  }>;
  fieldProposals: BusinessFieldProposal[];
  riskSignals: string[];
  confirmationState: "proposed" | "confirmed" | "corrected";
  analysisState: "deterministic" | "hybrid" | "degraded";
  degradedReason: string | null;
  classifierVersion: number;
  extractorVersion: number;
  provider: string | null;
  model: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessDocumentAnalysisJob {
  id: string;
  projectId: string;
  sourceId: string;
  status: "running" | "recoverable" | "succeeded" | "cancelled";
  attempt: number;
  total: number;
  processed: number;
  classified: number;
  replayed: number;
  failed: number;
  failures: Array<{ artifactId: string; error: string }>;
  lastError: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface BusinessCaseCandidateLink {
  fromArtifactId: string;
  toArtifactId: string;
  relationship: "precedes" | "uses_reference" | "registers" | "handoff";
  score: number;
  reasons: string[];
  evidenceRefs: BusinessDocumentClassification["evidenceRefs"];
  alternatives: Array<{ artifactId: string; score: number; reasons: string[] }>;
}

export interface BusinessCaseCandidate {
  id: string;
  familyId: string;
  projectId: string;
  sourceId: string;
  businessKey: string;
  version: number;
  state: "proposed" | "confirmed" | "rejected" | "superseded";
  anchorArtifactId: string;
  artifactBindings: Array<{
    artifactId: string;
    documentType: BusinessDocumentType;
    roles: Array<"trigger" | "input" | "output" | "reference">;
  }>;
  links: BusinessCaseCandidateLink[];
  confidence: number;
  correctionReason: string | null;
  supersedesId: string | null;
  supersededById: string | null;
  businessCaseId: string | null;
  evidenceHealth: {
    state: "valid" | "downgraded" | "blocked";
    issues: string[];
  };
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessRoutineDiscoveryStep {
  key: string;
  kind: "extract" | "retrieve" | "generate" | "ledger_upsert" | "human_approval" | "condition" | "create_issue";
  label: string;
  required: boolean;
  requirement: "mandatory" | "conditional";
  coverage: number;
  supportCaseIds: string[];
  exceptionCaseIds: string[];
  explanation: string;
  dependsOn: string[];
  evidenceRefs: BusinessDocumentClassification["evidenceRefs"];
  configuration: Record<string, unknown>;
}

export interface MyTemplateContract {
  version: number;
  inputSummary: string;
  inputFormats: string[];
  inputArtifactIds: string[];
  outputSummary: string;
  outputFormat: string;
  outputFileName: string;
  outputArtifactIds: string[];
  outputColumns: string[];
  fieldMappings: Array<{
    column: string;
    source: string;
    confidence: "supported" | "needs_confirmation";
  }>;
  uncertainFields: string[];
}

export interface BusinessRoutineDiscoveryCandidate {
  id: string;
  familyId: string;
  projectId: string;
  sourceId: string;
  name: string;
  description?: string | null;
  version: number;
  state: "candidate" | "superseded";
  triggerDocumentTypes: BusinessDocumentType[];
  confirmedCaseIds: string[];
  minimumCaseCount: number;
  templateMaturity?: "trial" | "stable";
  templateContract?: MyTemplateContract | null;
  mandatoryCoverageThreshold: number;
  steps: BusinessRoutineDiscoveryStep[];
  confidence: number;
  evidenceHealth: {
    state: "valid" | "downgraded" | "blocked";
    issues: string[];
    healthyCaseCount: number;
  };
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessRoutineStep {
  key: string;
  kind: "extract" | "retrieve" | "generate" | "ledger_upsert" | "human_approval" | "condition" | "create_issue";
  label: string;
  required: boolean;
  dependsOn: string[];
  evidenceRefs: BusinessDocumentClassification["evidenceRefs"];
  configuration: Record<string, unknown>;
}

export interface BusinessDataRequirement {
  id: string;
  kind: "contact" | "order" | "account" | "publish_target" | "file" | string;
  label: string;
  fields: string[];
  required: boolean;
  multiple: boolean;
  description: string | null;
}

export interface BusinessDataRelation {
  id: string;
  type: "lookup" | "join";
  fromRequirementId: string;
  fromField: string;
  toRequirementId: string;
  toField: string;
  required: boolean;
  description: string | null;
}

export interface BusinessMutationPolicy {
  operations: Array<"update" | "insert" | "delete" | string>;
  targetRequirementIds: string[];
  keyFields: string[];
  mutableFields: string[];
  allowMultipleSources: boolean;
  allowMultipleRows: boolean;
  maxRows: number;
  requireUserConfirmation: boolean;
  writeMode: "safe_copy_replace" | string;
}

export interface MyTemplateDraft {
  id: string;
  projectId: string;
  name: string;
  typicalInput: string;
  expectedOutput: string;
  applicability: string;
  steps: string[];
  state: "learning" | "needs_review" | "ready" | "rejected";
  caseCount: number;
  casesRequired: number;
  revision: number;
  origin: { kind: "work_item"; workItemId: string; localRef: string | null; title: string };
  activation?: {
    definitionId: string;
    familyId: string;
    version: number;
    confirmedAt: string;
    confirmedBy: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessRoutineDefinition {
  id: string;
  familyId: string;
  projectId: string;
  sourceId: string;
  name: string;
  description: string;
  version: number;
  state: "candidate" | "draft" | "published" | "disabled" | "superseded";
  discoveryCandidateId: string | null;
  historicalCaseIds: string[];
  triggerDocumentTypes: BusinessDocumentType[];
  steps: BusinessRoutineStep[];
  dataRequirements?: BusinessDataRequirement[];
  relations?: BusinessDataRelation[];
  mutationPolicy?: BusinessMutationPolicy | null;
  confidence: number;
  templateScope?: "team";
  templateMaturity?: "trial" | "stable";
  templateContract?: MyTemplateContract | null;
  templateLearningTaskId?: string;
  supersedesId: string | null;
  supersededById: string | null;
  evidenceHealth: {
    state: "valid" | "blocked";
    issues: string[];
    recovery: string | null;
  };
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowPairProposal {
  requirement: WorkflowArtifact;
  candidates: Array<{
    delivery: WorkflowArtifact;
    score: number;
    reasons: string[];
  }>;
}

export interface WorkflowLearningQuality {
  version: number;
  score: number;
  status: "trusted" | "review" | "blocked";
  metrics?: {
    evidenceIntegrity: number;
    pairingConfidence: number;
    parsingCoverage: number;
    roleConfidence: number;
  };
  totalCaseCount?: number;
  trustedCaseCount?: number;
  reviewCaseCount?: number;
  blockedCaseCount?: number;
  blockers: string[];
  warnings: string[];
}

export interface DeliveryCase {
  id: string;
  sourceId: string;
  projectId: string;
  requirementArtifactIds: string[];
  deliveryArtifactIds: string[];
  referenceArtifactIds: string[];
  draftArtifactIds: string[];
  note: string;
  satisfaction: "accepted";
  state: "confirmed" | "archived";
  archiveReason?: string;
  correctionHistory?: Array<{
    action: "archive" | "restore";
    reason: string;
    recordedAt: string;
    recordedBy: string;
  }>;
  evidenceSnapshots: Array<{
    artifactId: string;
    role: WorkflowArtifactRole;
    relativePath: string;
    fingerprint: string;
    modifiedAt: string;
    size: number;
  }>;
  workflowProfileId: string | null;
  workflowProfileVersion: number | null;
  qualityAssessment?: WorkflowLearningQuality;
  revision: number;
}

export interface WorkflowProfile {
  id: string;
  familyId: string;
  sourceId: string;
  projectId: string;
  name: string;
  profileVersion: number;
  revision: number;
  state: "trial" | "established" | "disabled" | "archived";
  evidenceCaseIds: string[];
  learningQuality?: WorkflowLearningQuality;
  requirementSpec: {
    acceptedExtensions: string[];
    fields: Array<Record<string, unknown>>;
    unresolved: string[];
  };
  outcomeSpec: {
    outputs: Array<{
      role: string;
      family: string;
      extension: string;
      examples: string[];
      minimumCount: number;
    }>;
    observedDirectories: string[];
    pathTemplate: string;
    overwritePolicy: "never";
    requiredSections?: Array<{
      key: string;
      label: string;
      required: boolean;
      coverage: number;
      evidenceArtifactIds: string[];
    }>;
    requiredFields?: Array<{
      key: string;
      label: string;
      required: boolean;
      coverage: number;
      evidenceArtifactIds: string[];
    }>;
  };
  transformationMap: {
    mappings: Array<Record<string, unknown>>;
    unresolved: string[];
  };
  taskRecipe: {
    steps: string[];
    requiresPlanConfirmation: boolean;
    requiresHumanAcceptance: boolean;
  };
  supersedesProfileId?: string | null;
  supersededByProfileId?: string | null;
}

export interface WorkflowProfileDraft {
  id: string;
  sourceId: string;
  projectId: string;
  familyId: string;
  baseProfileId: string;
  baseProfileVersion: number;
  baseProfileRevision: number;
  state: "draft" | "published";
  proposedProfile: Pick<
    WorkflowProfile,
    "name" | "state" | "evidenceCaseIds" | "learningQuality" | "requirementSpec" | "outcomeSpec" | "transformationMap" | "taskRecipe"
  >;
  changes: {
    requirementFields: { added: string[]; removed: string[] };
    requiredSections: { added: string[]; removed: string[] };
    requiredOutcomeFields?: { added: string[]; removed: string[] };
    outputs: { added: string[]; removed: string[] };
    pathTemplate: { before: string | null; after: string | null; changed: boolean };
    evidenceCases: { added: string[]; removed: string[] };
  };
  impact: {
    activeCaseCount: number;
    archivedCaseCount: number;
    pendingRequirementCount: number;
  };
  feedbackTriggers?: Array<{
    version: number;
    workflowRunId: string;
    feedback: "accepted_with_edits";
    reasonCode: WorkflowFeedbackReason;
    note: string;
    outputDiff: WorkflowFeedbackOutputDiff;
    recordedAt: string;
    recordedBy: string;
  }>;
  publishedProfileId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SimilarWorkflowCase {
  deliveryCase: DeliveryCase;
  profileFamilyId: string | null;
  score: number;
  reasons: string[];
  scoreBreakdown: {
    lexical: number;
    structuredFields: number;
    format: number;
    learningQuality: number;
    source: number;
    feedback: number;
    vector: number;
    vectorCandidate: number;
    baselineTotal: number;
    noVectorTotal: number;
    total: number;
    experimentalTotal: number;
  };
  evidence: {
    lexicalSimilarity: number;
    sharedFieldCount: number;
    sameFormat: boolean;
    sameSource: boolean;
  };
}

export interface WorkflowRetrievalEvaluation {
  sourceId: string;
  retrieval: {
    version: number;
    mode: "structured_lexical";
    vector: {
      state: "not_configured" | "index_required" | "indexed_gated" | "evaluated" | "rollout_active";
      used: boolean;
      providerId?: string | null;
      model?: string | null;
      modelVersion?: string | null;
      rolloutPercent?: number;
      coverage?: number;
    };
    deterministicFallback: true;
  };
  current: {
    sampleCount: number;
    top1: number | null;
    top5: number | null;
    mrr: number | null;
    noResultRate: number | null;
  };
  baseline: {
    sampleCount: number;
    top1: number | null;
    top5: number | null;
    mrr: number | null;
    noResultRate: number | null;
  };
  gate: {
    status: "insufficient_samples" | "passed" | "regressed";
    minimumSamples: number;
    embeddingEligible: boolean;
  };
  samples: Array<{
    artifactId: string;
    expectedFamilyId: string;
    currentRank: number | null;
    baselineRank: number | null;
  }>;
}

export interface WorkflowRequirementInspection {
  artifact: WorkflowArtifact;
  profile: WorkflowProfile;
  fields: Array<{
    key: string;
    label: string;
    required: boolean;
    value: string | null;
    status: "found" | "missing";
    evidenceArtifactId: string | null;
  }>;
  missingFields: Array<{
    key: string;
    label: string;
    required: true;
    value: null;
    status: "missing";
    evidenceArtifactId: null;
  }>;
  blockers: string[];
  executionReady: boolean;
  plannedOutputs: WorkflowProfile["outcomeSpec"]["outputs"];
  pathTemplate: string | null;
}

export interface WorkflowRun {
  id: string;
  projectId: string;
  sourceId: string;
  artifactId: string;
  requirementEvidence: {
    relativePath: string;
    fingerprint: string;
    modifiedAt: string;
    size: number;
  };
  profileId: string;
  profileFamilyId: string;
  profileVersion: number;
  workItemId: string;
  status:
    | "planned"
    | "executing"
    | "ready_for_validation"
    | "execution_failed"
    | "execution_attention"
    | "execution_cancelled"
    | "validation_failed"
    | "awaiting_acceptance"
    | "accepted"
    | "rejected";
  execution?: {
    autoRunId: string;
    status: string;
    error: string | null;
    errorCode: string | null;
    agentId: string | null;
    worktreeId: string | null;
    invocationId: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  } | null;
  executionAttempts?: Array<{
    number: number;
    autoRunId: string;
    status: string;
    agentId: string | null;
    worktreeId: string | null;
    invocationId: string | null;
    invocationIds: string[];
    trigger: "initial" | "restart_after_cancel" | "legacy" | string;
    retryCount: number;
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
    errorCode: string | null;
    cleanup: {
      state: "cleaned";
      cleanedAt: string | null;
      cleanedBy: string | null;
    } | null;
  }>;
  facts: WorkflowRequirementInspection["fields"];
  plannedOutputs: Array<{
    role: string;
    family: string;
    extension: string;
    relativePath: string;
    minimumCount: number;
    existedAtPlanning: false;
  }>;
  acceptanceCriteria: string[];
  validationResults: Array<{
    id?: string;
    validatorVersion?: number;
    rule?: string;
    criterion: string;
    severity?: "blocker" | "warning" | "info";
    status: "passed" | "failed" | "warning";
    file?: string | null;
    expected?: Record<string, unknown>;
    actual?: Record<string, unknown>;
    note: string;
  }>;
  validationSummary?: {
    validatorVersion: number;
    passed: boolean;
    blockerCount: number;
    warningCount: number;
    checkedAt: string;
  };
  validationSnapshot?: {
    version: number;
    attemptNumber: number | null;
    capturedAt: string;
    outputs: Array<{
      relativePath: string;
      extension: string;
      bytes: number;
      sha256: string;
      modifiedAt: string;
      headings: string[];
      fields: string[];
    }>;
  };
  feedback: {
    version?: number;
    state: "accepted" | "accepted_with_edits" | "rejected";
    note: string;
    reasonCode?: WorkflowFeedbackReason | null;
    deliveryCaseId: string | null;
    selectedAttemptNumber?: number | null;
    profileRevisionRecommended: boolean;
    outputDiff?: WorkflowFeedbackOutputDiff;
    validationFindings?: Array<{
      rule: string | null;
      severity: "blocker" | "warning" | "info" | null;
      status: "failed" | "warning";
      file: string | null;
      criterion: string;
      note: string;
    }>;
    learning?: {
      status: "incorporated" | "review_required" | "pending_publication" | "pending_source_scan" | "blocked" | "excluded";
      deliveryCaseId: string | null;
      profileDraftId: string | null;
      reason: string;
    };
  } | null;
  publication?: {
    version: number;
    id: string;
    state: "previewed" | "publishing" | "blocked" | "published";
    previewDigest: string;
    attemptNumber: number | null;
    worktreeId: string | null;
    targetProjectId: string;
    files: Array<{
      relativePath: string;
      extension: string;
      bytes: number;
      sha256: string;
      sourceModifiedAt: string;
      targetState: "available" | "conflict";
      conflictType: "file" | "directory" | "symlink" | null;
    }>;
    conflictCount: number;
    previewedAt: string;
    previewedBy: string;
    publishedAt?: string;
    publishedBy?: string;
    confirmation?: {
      publicationId: string;
      previewDigest: string;
      confirmedAt: string;
      confirmedBy: string;
    };
    publishedFiles?: Array<{
      relativePath: string;
      bytes: number;
      sha256: string;
    }>;
  };
  selectedAttemptNumber?: number | null;
  validationAttemptNumber?: number | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowFeedbackReason =
  | "content_corrected"
  | "structure_adjusted"
  | "format_adjusted"
  | "missing_information"
  | "quality_issue"
  | "wrong_workflow"
  | "other";

export interface WorkflowFeedbackOutputDiff {
  comparisonAvailable: boolean;
  changedFileCount: number;
  unchangedFileCount: number;
  files: Array<{
    relativePath: string;
    changed: boolean;
    before: { bytes: number; sha256: string } | null;
    after: { bytes: number; sha256: string };
    headingsAdded: string[];
    headingsRemoved: string[];
    fieldsAdded: string[];
    fieldsRemoved: string[];
  }>;
}

export interface WorktreeDiffSnapshot {
  files: Array<{
    path: string;
    index: string;
    work: string;
    untracked: boolean;
  }>;
  base: string;
  diff: string;
  truncated: boolean;
}


export interface SessionInfo {
  id: string;
  mode: "local" | "password" | "enterprise";
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  currentDevice: boolean;
}

export interface SessionResponse {
  user?: SessionUser;
  expiresAt?: string;
  session?: SessionInfo | null;
}

export interface IdentityProviderCapability {
  provider: "wecom" | "feishu" | "dingtalk";
  label: string;
  authorization: "redirect" | "device_code";
}

export interface IdentityOptions {
  protocolVersion: 1;
  localMode: boolean;
  passwordMode: boolean;
  providers: IdentityProviderCapability[];
}

export interface IdentityChallenge {
  id: string;
  provider: IdentityProviderCapability["provider"];
  state: "pending" | "authorized" | "consumed" | "expired" | "cancelled" | "rejected" | "failed";
  createdAt: string;
  expiresAt: string;
}

export interface IdentityChallengeResponse {
  challenge: IdentityChallenge;
  authorizationUri?: string;
}

export interface PasswordRecoveryGrant {
  id: string;
  purpose: "password_reset";
  teamId: string;
  userId: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface PasswordRecoveryGrantResponse {
  recoveryToken: string;
  grant: PasswordRecoveryGrant;
}

export interface IdentitySecurityAlert {
  id: string;
  type: "password_login_throttled" | "recovery_token_rejected";
  severity: "warning" | "high";
  status: "open" | "recovered";
  teamId: string;
  userId: string;
  failureCount: number;
  updatedAt: string;
}

async function postSession(credentials: Record<string, unknown>): Promise<SessionResponse | null> {
  const response = await fetch(`${apiBase}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(credentials),
  });
  if (!response.ok) return null;
  return (await response.json().catch(() => ({}))) as SessionResponse;
}


export async function getIdentityOptions(): Promise<IdentityOptions> {
  const response = await fetch(`${apiBase}/api/identity/options`, { credentials: "include" });
  if (!response.ok) throw new ApiError("identity_options_unavailable", "Sign-in options are unavailable.", response.status);
  const data = await response.json().catch(() => null) as Partial<IdentityOptions> | null;
  const providers = data?.providers;
  const validProviders = Array.isArray(providers) && providers.every((provider) =>
    provider
    && ["wecom", "feishu", "dingtalk"].includes(provider.provider)
    && typeof provider.label === "string"
    && ["redirect", "device_code"].includes(provider.authorization));
  if (
    data?.protocolVersion !== 1
    || typeof data.localMode !== "boolean"
    || typeof data.passwordMode !== "boolean"
    || !validProviders
  ) {
    throw new ApiError(
      "identity_options_invalid",
      "Sign-in options returned an invalid response.",
      response.status,
    );
  }
  return data as IdentityOptions;
}

export async function getCurrentSession(): Promise<SessionResponse | null> {
  const response = await fetch(`${apiBase}/api/session`, { credentials: "include" });
  if (response.status === 401) {
    setSessionAnonymous();
    setSessionUser(null);
    return null;
  }
  if (!response.ok) throw new ApiError("session_unavailable", "Session details are unavailable.", response.status);
  const data = await response.json() as SessionResponse;
  setSessionReady(Boolean(data.user));
  setSessionUser(data.user ?? null);
  return data;
}

export async function loginLocal(): Promise<SessionUser> {
  const data = await postSession({ mode: "local" });
  if (!data?.user) throw new ApiError("local_sign_in_failed", "Local sign-in failed.", 401);
  setSessionReady(true);
  setSessionUser(data.user);
  return data.user;
}

/**
 * Sign in as a specific user with a password (9B). Throws on bad credentials so
 * the login form can surface it. On success the token + user are stored and the
 * next state poll reflects the new identity.
 */
export async function loginWithCredentials(teamId: string, userId: string, password: string): Promise<SessionUser | null> {
  const data = await postSession({ mode: "password", teamId, userId, password });
  if (!data?.user) {
    throw new Error("Sign in failed — check the user id and password.");
  }
  setSessionReady(true);
  setSessionUser(data.user ?? { id: userId });
  return data.user ?? { id: userId };
}

export async function issuePasswordRecovery(userId: string): Promise<PasswordRecoveryGrantResponse> {
  const response = await fetch(`${apiBase}/api/identity/recovery-grants`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...csrfHeaders("POST"),
    },
    body: JSON.stringify({ userId, purpose: "password_reset" }),
  });
  const data = await response.json().catch(() => ({})) as Partial<PasswordRecoveryGrantResponse> & { error?: string };
  if (!response.ok || !data.recoveryToken || !data.grant) {
    throw new ApiError(data.error ?? "recovery_forbidden", "Recovery could not be authorized.", response.status);
  }
  return data as PasswordRecoveryGrantResponse;
}

export async function completePasswordRecovery(input: {
  teamId: string;
  userId: string;
  recoveryToken: string;
  newPassword: string;
}): Promise<void> {
  const response = await fetch(`${apiBase}/api/identity/recovery/complete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, purpose: "password_reset" }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new ApiError(data.error ?? "recovery_failed", "Recovery could not be completed.", response.status);
  }
}

export async function getIdentitySecurityAlerts(): Promise<IdentitySecurityAlert[]> {
  const response = await fetch(`${apiBase}/api/identity/security-alerts`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new ApiError("security_alerts_unavailable", "Security alerts are unavailable.", response.status);
  }
  const data = await response.json() as { alerts?: IdentitySecurityAlert[] };
  return data.alerts ?? [];
}

/** Sign out: revoke the server-side session and clear display-only local state. */
export async function logout(): Promise<void> {
  const response = await fetch(`${apiBase}/api/session`, {
    method: "DELETE",
    credentials: "include",
    headers: csrfHeaders("DELETE"),
  });
  if (!response.ok && response.status !== 204) {
    throw new ApiError("logout_failed", "Could not revoke this session.", response.status);
  }
  setSessionAnonymous();
  setSessionUser(null);
}

export async function logoutAllSessions(): Promise<void> {
  await fetch(`${apiBase}/api/sessions`, {
    method: "DELETE",
    credentials: "include",
    headers: csrfHeaders("DELETE"),
  }).then((response) => {
    if (!response.ok && response.status !== 204) {
      throw new ApiError("logout_all_failed", "Could not sign out all devices.", response.status);
    }
  });
  setSessionAnonymous();
  setSessionUser(null);
}

export async function beginIdentityChallenge(provider: IdentityProviderCapability["provider"]): Promise<IdentityChallengeResponse> {
  const response = await fetch(`${apiBase}/api/identity/challenges`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  });
  if (!response.ok) throw new ApiError("identity_provider_unavailable", "This sign-in provider is unavailable.", response.status);
  return response.json() as Promise<IdentityChallengeResponse>;
}

export async function getIdentityChallenge(challengeId: string): Promise<IdentityChallengeResponse> {
  const response = await fetch(`${apiBase}/api/identity/challenges/${encodeURIComponent(challengeId)}`, {
    credentials: "include",
  });
  if (!response.ok) throw new ApiError("identity_challenge_unavailable", "This sign-in request is no longer available.", response.status);
  return response.json() as Promise<IdentityChallengeResponse>;
}

export async function cancelIdentityChallenge(challengeId: string): Promise<void> {
  const response = await fetch(`${apiBase}/api/identity/challenges/${encodeURIComponent(challengeId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw new ApiError("identity_challenge_cancel_failed", "Could not cancel this sign-in request.", response.status);
}


export type TaskMaterialAsset = {
  id: string;
  clientFileId: string;
  originalName: string;
  family: string;
  mimeType: string | null;
  size: number;
  hash: string;
  resourceClass: "small" | "medium" | "large";
  activeContent: boolean;
  readiness: { state: string; reason: string };
};

export type TaskMaterialDraft = {
  id: string;
  projectId: string;
  status: "draft" | "claimed" | "expired" | "purged";
  revision: number;
  workItemId: string | null;
  assets: TaskMaterialAsset[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type TaskMaterialStorage = {
  usedBytes: number;
  limitBytes: number;
  reclaimableBytes: number;
  draftCount: number;
  fileCount: number;
  completedTaskCount: number;
  expiredDraftCount: number;
  retentionDays: number;
  previewToken: string;
};



export function fetchState(): Promise<ConsoleSnapshot> {
  return request<ConsoleSnapshot>("GET", "/api/state", undefined, true, REQUEST_TIMEOUT_MS, {
    Accept: "application/vnd.myagenttool.console-state+json",
  });
}

export type GuidedSetupCommand = "start" | "resume" | "recheck" | "cancel";

export function commandGuidedSetup(
  command: GuidedSetupCommand,
  runId?: string | null,
): Promise<{ guidedSetup: NonNullable<ConsoleSnapshot["guidedSetup"]> }> {
  return request("POST", `/api/guided-setup/${command}`, runId ? { runId } : {});
}

export interface DiscoveryPayload {
  scope: string[];
  userProvidedPaths?: string[];
  userProvidedEndpoints?: string[];
}

export interface IntegrationPayload {
  targetType: string;
  title: string;
  description: string;
  command?: string;
  baseUrl?: string;
  workingDirectory?: string;
  environmentNeeds?: string;
  cancellation?: string;
  streaming?: boolean;
  costOwner?: string;
  economicModel?: string;
  artifactType?: string;
  reviewState?: string;
  generatedByAi?: boolean;
}

// #1074 (Epic #1070): one block of a persisted run transcript. Payload fields
// (text/input/output) are absent on skeleton blocks (size budget or retention).
export interface RunTranscriptBlock {
  kind: "thinking" | "tool_use" | "tool_result" | "text";
  text?: string;
  input?: string;
  output?: string;
  toolName?: string;
  toolUseId?: string | null;
  description?: string;
  durationMs?: number;
  isError?: boolean;
  truncated?: boolean;
  droppedChars?: number;
  payloadDropped?: boolean;
  chars?: number;
}

export interface RunTranscriptRecord {
  id: string;
  invocationId: string;
  status?: string | null;
  blocks: RunTranscriptBlock[];
  totalChars?: number;
  droppedBlocks: number;
  unparsedLines: number;
  truncated: boolean;
  payloadReaped: boolean;
  reapedAt?: string;
  createdAt: string;
}

export interface ObservabilityDeletionResult {
  deleted: boolean;
  scope: string;
  subjectId: string;
  tier: string;
  invocationCount: number;
  counts: Record<string, number>;
}

// Canvas scenes (#1352 API, surfaced in the Web Canvas by #1354). The list
// returns summaries; the detail carries the full element/file bodies.
export interface CanvasSceneSummary {
  id: string;
  projectId: string | null;
  name: string;
  revision: number;
  elementCount: number;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
  lastModifiedBy: string;
}
export interface CanvasScene extends CanvasSceneSummary {
  elements: unknown[];
  files: Record<string, unknown>;
}
/** A revision-aware save outcome: success, a typed conflict, or another failure. */
export type CanvasSaveResult =
  | { ok: true; scene: CanvasScene }
  | { ok: false; conflict: true; currentRevision: number }
  | { ok: false; conflict: false; error: string };

// Structured variant of `request`: never throws on a non-2xx, so the Canvas save
// path can branch on a 409 revision conflict instead of losing it to an Error.
async function requestResult(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<{ status: number; ok: boolean; data: Record<string, unknown> }> {
  await ensureSession();
  const headers: Record<string, string> = { ...csrfHeaders(method) };
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401 && retry) {
    setSessionReady(false);
    await ensureSession();
    return requestResult(method, path, body, false);
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, ok: response.ok, data };
}

export const api = {
  syncMailbox: () => request<{ sync: MailboxSync; reused: boolean }>("POST", "/api/mailbox/sync"),
  createMailTask: (messageId: string, body: {
    projectId: string;
    title: string;
    description?: string;
    attachmentIds?: string[];
    materialDraftId?: string;
    materialDraftRevision?: number;
    executionMode?: "manual" | "auto";
  }) => request<{ task: { id: string; localRef: string; title: string; projectId: string }; replayed: boolean }>(
    "POST",
    `/api/mailbox/messages/${encodeURIComponent(messageId)}/task`,
    body,
  ),
  getMailResponsePackages: (workItemId?: string) => request<{ packages: MailResponsePackage[] }>(
    "GET",
    `/api/mail/response-packages${workItemId ? `?workItemId=${encodeURIComponent(workItemId)}` : ""}`,
  ),
  createMailResponsePackage: (body: {
    workItemId: string;
    expectedSourceRevision?: number;
    analysis: string;
    requests?: string[];
    deadlines?: string[];
    risks?: string[];
    uncertainties?: string[];
    proposedReply: string;
    candidateAttachments?: MailDraftAttachment[];
  }) => request<{ package: MailResponsePackage }>("POST", "/api/mail/response-packages", body),
  materializeMailResponsePackage: (workItemId: string, expectedSourceRevision?: number) => request<{ package: MailResponsePackage; replayed?: boolean }>(
    "POST", "/api/mail/response-packages/materialize", { workItemId, ...(expectedSourceRevision ? { expectedSourceRevision } : {}) },
  ),
  reviewMailResponsePackage: (packageId: string, body: { expectedRevision: number; decision: "approve" | "request_changes"; feedback?: string }) =>
    request<{ package: MailResponsePackage }>("POST", `/api/mail/response-packages/${encodeURIComponent(packageId)}/review`, body),
  attachMailResponsePackageFiles: (packageId: string, expectedRevision: number, attachments: MailDraftAttachment[]) =>
    request<{ package: MailResponsePackage }>("POST", `/api/mail/response-packages/${encodeURIComponent(packageId)}/attachments`, { expectedRevision, attachments }),
  createDraftFromMailResponsePackage: (packageId: string, expectedRevision: number) =>
    request<{ draft: MailboxDraft; package: MailResponsePackage; replayed: boolean }>("POST", `/api/mail/response-packages/${encodeURIComponent(packageId)}/draft`, { expectedRevision }),
  getMailTaskPolicies: () => request<{ killSwitchOpen: boolean; policies: MailTaskPolicy[] }>("GET", "/api/mail/task-policies"),
  upsertMailTaskPolicy: (body: { policyId?: string; projectId: string; mode: MailTaskPolicy["mode"]; enabled?: boolean; senderDomains?: string[]; maxPerDay?: number; expectedRevision?: number }) =>
    request<{ policy: MailTaskPolicy; killSwitchOpen: boolean }>("POST", "/api/mail/task-policies", body),
  evaluateMailTaskPolicies: (messageId: string) => request<{ decision: Record<string, unknown> }>("POST", "/api/mail/task-policies/evaluate", { messageId }),
  getMailTaskOperations: () => request<MailTaskOperations>("GET", "/api/mail/task-operations"),
  createMailDraft: (body: { to: string; subject: string; body: string; attachments?: MailDraftAttachment[]; inReplyTo?: string | null; references?: string[] }) =>
    request<{ draft: MailboxDraft }>("POST", "/api/mail/drafts", body),
  updateMailDraft: (id: string, body: { to: string; subject: string; body: string; attachments?: MailDraftAttachment[] }) =>
    request<{ draft: MailboxDraft }>("PATCH", `/api/mail/drafts/${encodeURIComponent(id)}`, body),
  deleteMailDraft: (id: string) =>
    request<{ deleted: boolean; draftId: string }>("DELETE", `/api/mail/drafts/${encodeURIComponent(id)}`),
  sendMailDraft: (id: string, approvalToken: string) =>
    request<{ status: string; draftId: string; sendInvocationId: string }>(
      "POST",
      `/api/mail/drafts/${encodeURIComponent(id)}/send`,
      { approvalToken },
    ),
  updateDevice: (payload: { maxConcurrency?: number }) => request("PATCH", "/api/device", payload),
  reportWebPerformance: (payload: {
    name: "CLS" | "FCP" | "INP" | "LCP";
    value: number;
    rating: "good" | "needs-improvement" | "poor";
    path: string;
    version: string;
  }) => request("POST", "/api/observability/web-performance", payload),
  webPerformanceTrend: (version?: string) =>
    request("GET", `/api/observability/web-performance${version ? `?version=${encodeURIComponent(version)}` : ""}`),
  reportEventStreamReconnect: () =>
    request("POST", "/api/observability/event-stream/reconnect", {}),
  operationalHealth: () =>
    request("GET", "/api/observability/operations"),
  actOnOperationalAlert: (alertId: string, action: "acknowledge" | "silence", silenceMinutes?: number) =>
    request("POST", `/api/observability/operations/alerts/${encodeURIComponent(alertId)}/actions`, { action, silenceMinutes }),
  // ADR 0018: owner/admin-only per-subject observability data deletion. Throws
  // with the server's message on 403 (non-owner) / 400 (invalid request).
  deleteObservabilityData: (payload: { scope: string; subjectId: string; tier: string }) =>
    request<ObservabilityDeletionResult>("POST", "/api/observability/delete", payload),
  fetchInvocationTranscript: (invocationId: string) =>
    request<{ invocationId: string; transcript: RunTranscriptRecord | null }>(
      "GET",
      `/api/invocations/${encodeURIComponent(invocationId)}/transcript`,
    ),
  listTools: () => request<{ tools: ToolDescriptor[] }>("GET", "/api/tools"),
  createToolInvocation: (name: string, input: ToolInvocationRequest) =>
    request<ToolInvocationResponse>(
      "POST",
      `/api/tools/${encodeURIComponent(name)}/invocations`,
      input,
    ),
  listReviewFindings: (filters: {
    projectId?: string;
    worktreeId?: string;
    invocationId?: string;
    source?: "codex" | "claude";
    severity?: "low" | "medium" | "high";
  } = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) query.set(key, value);
    }
    const suffix = query.toString() ? `?${query}` : "";
    return request<ReviewFindingQueryResponse>("GET", `/api/review-findings${suffix}`);
  },
  listApplicationCapabilities: (id: string) =>
    request<{ applicationId: string; capabilities: ApplicationCapability[] }>(
      "GET",
      `/api/applications/${encodeURIComponent(id)}/capabilities`,
    ),
  /**
   * Run an Application capability as a governed invocation (#800). The body carries
   * only the capability's DECLARED inputs (plus the project it runs in) — the flag
   * and argv each input becomes are decided server-side and never travel from here.
   */
  invokeCapability: (name: string, body: Record<string, string> = {}) =>
    request<{ capability: string; invocationId: string; status: string; agentId?: string }>(
      "POST",
      `/api/capabilities/${encodeURIComponent(name)}/invocations`,
      body,
    ),
  registerApplication: (body: ApplicationRegisterRequest) =>
    request<{ application: ApplicationSnapshot; capabilities: ApplicationCapability[] }>(
      "POST",
      "/api/applications/register",
      body,
    ),
  listKnownApplications: () =>
    request<{ applications: KnownApplicationCatalogEntry[] }>(
      "GET",
      "/api/applications/quick-register/catalog",
    ),
  quickRegisterApplication: (body: { name: string; projectId?: string | null }) =>
    request<{ application: ApplicationSnapshot; capabilities: ApplicationCapability[]; catalog: KnownApplicationCatalogEntry }>(
      "POST",
      "/api/applications/quick-register",
      body,
    ),
  createApplicationInstallPlan: (body: { name: string; projectId?: string | null; deviceId: string }) =>
    request<{ plan: ApplicationInstallPlan }>("POST", "/api/runtimes/install/plan", body),
  queueApplicationInstall: (body: { plan: ApplicationInstallPlan; approvalToken: string }) =>
    request<{ run: ApplicationInstallRun }>("POST", "/api/runtimes/install/runs", body),
  getApplicationInstallRun: (id: string) =>
    request<{ run: ApplicationInstallRun }>("GET", `/api/runtimes/install/runs/${encodeURIComponent(id)}`),
  cancelApplicationInstall: (id: string) =>
    request<{ run: ApplicationInstallRun }>("POST", `/api/runtimes/install/runs/${encodeURIComponent(id)}/cancel`, {}),
  applicationLifecycle: (
    id: string,
    action: "probe" | "online" | "offline" | "archive" | "refresh",
    body: { approvalToken?: string } = {},
  ) => request("POST", `/api/applications/${encodeURIComponent(id)}/${action}`, body),
  /** Mint a single-use, action-scoped approval grant — the real token behind approvalToken (APPROVAL_GRANTS.md). */
  issueApprovalGrant: (action: string, targetId: string) =>
    request<{ grantId: string; token: string; expiresAt: string }>("POST", "/api/approvals/grants", { action, targetId }),
  listArticleExtractorPlugins: () =>
    request<{ plugins: Array<{ id: string; pluginId: string; name: string; enabled: boolean; activeVersion: string; hosts: string[]; versions: Array<{ version: string; checksum: string; installedAt: string; installedBy: string }>; createdAt: string; updatedAt: string }> }>(
      "GET",
      "/api/article-extractor-plugins",
    ),
  planArticleExtractorPluginInstall: (manifest: Record<string, unknown>) =>
    request<{ manifest: Record<string, unknown>; checksum: string; approval: { action: string; targetId: string } }>(
      "POST",
      "/api/article-extractor-plugins/install-plan",
      { manifest },
    ),
  installArticleExtractorPlugin: (manifest: Record<string, unknown>, approvalToken: string) =>
    request<{ plugin: Record<string, unknown> }>("POST", "/api/article-extractor-plugins", { manifest, approvalToken }),
  disableArticleExtractorPlugin: (pluginId: string, approvalToken: string) =>
    request<{ plugin: Record<string, unknown> }>("POST", `/api/article-extractor-plugins/${encodeURIComponent(pluginId)}/disable`, { approvalToken }),
  activateArticleExtractorPluginVersion: (pluginId: string, version: string, approvalToken: string) =>
    request<{ plugin: Record<string, unknown> }>(
      "POST",
      `/api/article-extractor-plugins/${encodeURIComponent(pluginId)}/versions/${encodeURIComponent(version)}/activate`,
      { approvalToken },
    ),
  /** Governed rollback of an applied Claude patch authorization (#914): requires a
   * fresh single-use grant for (rollback_patch, authorizationId). */
  rollbackClaudeApply: (authorizationId: string, approvalToken: string) =>
    request<{ authorizationId: string; status: string; rollbackInvocationId: string }>(
      "POST",
      `/api/claude-apply/authorizations/${encodeURIComponent(authorizationId)}/rollback`,
      { approvalToken },
    ),
  /** Loop promotion refusals (tools/ai), for the console refusal lens (refusal model #758). */
  getLoopRefusals: () => request<LoopRefusalsResponse>("GET", "/api/loop-refusals"),
  getApplicationRecoveryArchive: (id: string, limit = 50) =>
    request<{ applicationId: string; entries: { archivedAt: string | null; row: Record<string, unknown> }[] }>(
      "GET",
      `/api/applications/${encodeURIComponent(id)}/recovery-archive?limit=${encodeURIComponent(limit)}`,
    ),
  setApplicationAutoRecovery: (id: string, body: { enabled?: boolean; maxAttempts?: number; routineId?: string; clearOverride?: boolean; approvalToken?: string }) =>
    request("POST", `/api/applications/${encodeURIComponent(id)}/auto-recovery`, body),
  setApplicationHealthProbe: (id: string, body: { enabled: boolean; intervalMinutes?: number; approvalToken?: string }) =>
    request("POST", `/api/applications/${encodeURIComponent(id)}/health-probe`, body),
  generateApplicationOrchestration: (id: string, body: { approvalToken?: string } = {}) =>
    request("POST", `/api/applications/${encodeURIComponent(id)}/orchestrations/generate`, body),
  runApplicationOrchestration: (
    id: string,
    routineId: string,
    body: { agentId?: string | null; timeoutSeconds?: number; retryOfInvocationId?: string | null; retryReason?: string | null } = {},
  ) =>
    request(
      "POST",
      `/api/applications/${encodeURIComponent(id)}/orchestrations/${encodeURIComponent(routineId)}/run`,
      body,
    ),
  listApplicationOrchestrationRuns: (id: string, routineId: string, limit = 3) =>
    request<{ applicationId: string; routineId: string; runs: ApplicationOrchestrationRun[] }>(
      "GET",
      `/api/applications/${encodeURIComponent(id)}/orchestrations/${encodeURIComponent(routineId)}/runs?limit=${encodeURIComponent(String(limit))}`,
    ),
  getApplicationOrchestrationRun: (id: string, routineId: string, invocationId: string) =>
    request<{ applicationId: string; routineId: string; run: ApplicationOrchestrationRunDetail }>(
      "GET",
      `/api/applications/${encodeURIComponent(id)}/orchestrations/${encodeURIComponent(routineId)}/runs/${encodeURIComponent(invocationId)}`,
    ),
  listApplicationOrchestrationRunEvents: (id: string, routineId: string, invocationId: string) =>
    request<{ applicationId: string; routineId: string; invocationId: string; events: InvocationEventSnapshot[] }>(
      "GET",
      `/api/applications/${encodeURIComponent(id)}/orchestrations/${encodeURIComponent(routineId)}/runs/${encodeURIComponent(invocationId)}/events`,
    ),
  getApplicationOrchestrationRunRecovery: (id: string, routineId: string, invocationId: string) =>
    request<{ applicationId: string; routineId: string; invocationId: string; recovery: ApplicationOrchestrationRecovery }>(
      "GET",
      `/api/applications/${encodeURIComponent(id)}/orchestrations/${encodeURIComponent(routineId)}/runs/${encodeURIComponent(invocationId)}/recovery`,
    ),
  listApplicationOrchestrationRecoveryAgentCandidates: (id: string, routineId: string, invocationId: string) =>
    request<{
      applicationId: string;
      routineId: string;
      invocationId: string;
      recoveryCategory: string;
      sourceAgentId: string | null;
      preferredAgentId: string | null;
      candidates: ApplicationOrchestrationRecoveryAgentCandidate[];
    }>(
      "GET",
      `/api/applications/${encodeURIComponent(id)}/orchestrations/${encodeURIComponent(routineId)}/runs/${encodeURIComponent(invocationId)}/recovery/agent-candidates`,
    ),
  requestApplicationOrchestrationRecoveryAction: (
    id: string,
    routineId: string,
    invocationId: string,
    body: { actionType: string; approvalToken?: string; reason?: string | null; agentId?: string | null } = { actionType: "" },
  ) =>
    request(
      "POST",
      `/api/applications/${encodeURIComponent(id)}/orchestrations/${encodeURIComponent(routineId)}/runs/${encodeURIComponent(invocationId)}/recovery/actions`,
      body,
    ),
  createInvocation: (
    task: string,
    agentId: string | null,
    projectId?: string | null,
    worktreeId?: string | null,
    options?: Record<string, unknown>,
    idempotencyKey?: string,
  ) => request("POST", "/api/invocations", { task, agentId, projectId, worktreeId, options, idempotencyKey }),
  listInvocationEvents: (
    id: string,
    options: { limit?: number; before?: string } = {},
  ) => {
    const query = new URLSearchParams({ limit: String(options.limit ?? 100) });
    if (options.before) query.set("before", options.before);
    return request<InvocationEventsResponse>(
      "GET",
      `/api/invocations/${encodeURIComponent(id)}/events?${query}`,
    );
  },
  // Refusals for one invocation, INCLUDING the ones the 200-row cap evicted to the
  // durable archive (server slice 1/3).
  listInvocationRefusals: (id: string, options: { limit?: number } = {}) => {
    const query = new URLSearchParams({ limit: String(options.limit ?? 200) });
    return request<InvocationRefusalsResponse>(
      "GET",
      `/api/invocations/${encodeURIComponent(id)}/refusals?${query}`,
    );
  },
  uploadWorktreeAttachments: (
    id: string,
    files: { name: string; dataBase64: string }[],
    batchId: string,
  ) => request("POST", `/api/worktrees/${encodeURIComponent(id)}/attachments`, { files, batchId }),
  manageOfficeDocument: (id: string, payload: { operation: "rename" | "move" | "copy" | "delete"; source: string; destination?: string }) =>
    request<{ operation: string; source: string; destination?: string }>(
      "POST",
      `/api/worktrees/${encodeURIComponent(id)}/office-document-manage`,
      payload,
    ),
  cancelInvocation: (id: string) =>
    request("POST", `/api/invocations/${encodeURIComponent(id)}/cancel`),
  // #128 Phase 4: run one task on 2+ agents and compare (server fans out + tracks).
  // projectId isolates each agent in its own worktree (P4.2) so diffs can be compared.
  startCompareRun: (task: string, agentIds: string[], projectId?: string | null) =>
    request("POST", "/api/compare-runs", { task, agentIds, projectId: projectId ?? null }),
  // P4.2c: pick the winner, then promote its worktree to a PR.
  setCompareRunPreferred: (id: string, invocationId: string) =>
    request("POST", `/api/compare-runs/${encodeURIComponent(id)}/prefer`, { invocationId }),
  promoteCompareRun: (id: string) =>
    request("POST", `/api/compare-runs/${encodeURIComponent(id)}/promote`),
  troubleshoot: (id: string) =>
    request("POST", `/api/invocations/${encodeURIComponent(id)}/troubleshoot`),

  healthCheckAgent: (id: string) =>
    request("POST", `/api/agents/${encodeURIComponent(id)}/health-check`),
  setAgentEnabled: (id: string, enabled: boolean) =>
    request("POST", `/api/agents/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`),

  registerAgent: (payload: Record<string, unknown>) => request("POST", "/api/agents", payload),

  // Pre-flight dry-probe of an unregistered MCP config (#137): queue a bridge
  // handshake + tools/list, then poll the run until it resolves.
  probeAgent: (config: Record<string, unknown>) => request("POST", "/api/agents/probe", config),
  getAgentProbe: (id: string) => request("GET", `/api/agents/probe/${encodeURIComponent(id)}`),

  createDiscovery: (payload: DiscoveryPayload) => request("POST", "/api/discovery", payload),
  registerCandidate: (runId: string, candidateId: string) =>
    request(
      "POST",
      `/api/discovery/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidateId)}/register`,
    ),

  createIntegrationArtifact: (payload: IntegrationPayload) =>
    request("POST", "/api/integration-artifacts", payload),
  artifactAction: (id: string, action: string) =>
    request("POST", `/api/integration-artifacts/${encodeURIComponent(id)}/${action}`),
  builderDraft: (payload: IntegrationPayload) =>
    request("POST", "/api/integration-builder/draft", payload),
  setBudget: (payload: { projectId: string; limitUsd: number; policy: string }) =>
    request("PUT", "/api/budgets", payload),
  setTeamBudget: (payload: { teamId: string; limitUsd: number; policy: string }) =>
    request("PUT", "/api/budgets", payload),

  createProject: (payload: { name: string; color?: string }) =>
    request("POST", "/api/projects", payload),
  cloneProject: (payload: { repoUrl: string; parentDir: string; name?: string; color?: string }) =>
    request("POST", "/api/projects", payload),
  bindProject: (payload: { repoPath: string; name?: string; color?: string }) =>
    request("POST", "/api/projects", payload),
  updateProject: (id: string, payload: Record<string, unknown>) =>
    request("PATCH", `/api/projects/${encodeURIComponent(id)}`, payload),
  selectProject: (id: string) =>
    request("POST", `/api/projects/${encodeURIComponent(id)}`),
  projectTree: (id: string, opts: { path?: string; search?: string } = {}) => {
    const query = new URLSearchParams();
    if (opts.path) query.set("path", opts.path);
    if (opts.search) query.set("search", opts.search);
    const suffix = query.toString() ? `?${query}` : "";
    return request<ProjectTreeResponse>("GET", `/api/projects/${encodeURIComponent(id)}/tree${suffix}`);
  },
  projectDocuments: (id: string, opts: { type?: "all" | "docx" | "xlsx" | "pptx" | "pdf" | "dxf" | "dwg" | "md" | "html" | "canvas" | "image" | "audio" | "video"; search?: string; limit?: number; worktreeId?: string } = {}) => {
    const query = new URLSearchParams();
    if (opts.type && opts.type !== "all") query.set("type", opts.type);
    if (opts.search) query.set("q", opts.search);
    if (opts.limit) query.set("limit", String(opts.limit));
    if (opts.worktreeId) query.set("worktree", opts.worktreeId);
    const suffix = query.toString() ? `?${query}` : "";
    return request<ProjectDocumentsResponse>("GET", `/api/projects/${encodeURIComponent(id)}/documents${suffix}`);
  },
  projectAssetDescriptor: (id: string, path: string, worktreeId?: string) =>
    request<{ descriptor: AssetDescriptor; matrixVersion: number }>(
      "GET",
      `/api/projects/${encodeURIComponent(id)}/asset-capabilities?path=${encodeURIComponent(path)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`,
    ),
  revealProjectAsset: (id: string, path: string, worktreeId?: string) =>
    request<{ revealed: true; path: string }>(
      "POST",
      `/api/projects/${encodeURIComponent(id)}/asset-reveal`,
      { path, ...(worktreeId ? { worktreeId } : {}) },
    ),
  openProjectAsset: (id: string, path: string, worktreeId?: string) =>
    request<{ opened: true; path: string }>(
      "POST",
      `/api/projects/${encodeURIComponent(id)}/asset-open`,
      { path, ...(worktreeId ? { worktreeId } : {}) },
    ),
  projectAssetPreview: (id: string, path: string, worktreeId?: string) =>
    request<{ path: string; family: "markdown" | "text"; text: string; size: number; truncated: boolean }>(
      "GET",
      `/api/projects/${encodeURIComponent(id)}/asset-preview?path=${encodeURIComponent(path)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`,
    ),
  projectAssetPreviewBytes: (id: string, path: string, worktreeId?: string) =>
    requestBytes(`/api/projects/${encodeURIComponent(id)}/asset-preview?path=${encodeURIComponent(path)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`),
  projectAssetVideoRange: (id: string, path: string, start: number, end: number, worktreeId?: string) =>
    requestByteRange(
      `/api/projects/${encodeURIComponent(id)}/asset-preview?path=${encodeURIComponent(path)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`,
      start,
      end,
    ),
  projectPdfData: (id: string, path: string, worktreeId?: string) =>
    requestBytes(`/api/projects/${encodeURIComponent(id)}/pdf-document?path=${encodeURIComponent(path)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`),
  projectPdfSource: async (id: string, path: string, worktreeId?: string) => {
    await ensureSession();
    const resource = `/api/projects/${encodeURIComponent(id)}/pdf-document?path=${encodeURIComponent(path)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`;
    return { url: `${apiBase}${resource}`, withCredentials: true };
  },
  projectPdfRange: (id: string, path: string, start: number, end: number, worktreeId?: string) =>
    requestByteRange(`/api/projects/${encodeURIComponent(id)}/pdf-document?path=${encodeURIComponent(path)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`, start, end),
  cadDocumentInfo: (id: string, path: string, worktreeId?: string) =>
    request<{ path: string; size: number; version: string; units: number; extents: { min: number[]; max: number[] } | null; layouts: string[]; layers: string[]; entityCounts: Record<string, number>; texts: Array<{ text: string; type: string; layer: string }>; warnings: string[]; audit: { errors: number; fixes: number } }>(
      "GET",
      `/api/projects/${encodeURIComponent(id)}/cad-document?path=${encodeURIComponent(path)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`,
    ),
  cadDocumentLayout: (id: string, path: string, layout: string, layers: string[], worktreeId?: string) => {
    const query = new URLSearchParams({ path, layout, layersMode: "selected" });
    if (worktreeId) query.set("worktree", worktreeId);
    for (const layer of layers) query.append("layers", layer);
    return request<{ path: string; size: number; svg: string }>("GET", `/api/projects/${encodeURIComponent(id)}/cad-document/layout?${query}`);
  },
  // Content search within a registered project root (Agent Workspace #161).
  projectSearch: (id: string, q: string) =>
    request<{ results: { path: string; line: number; preview: string }[] }>(
      "GET",
      `/api/projects/${encodeURIComponent(id)}/search?q=${encodeURIComponent(q)}`,
    ),
  createWorktree: (
    projectId: string,
    payload: {
      name?: string;
      ref?: string;
      prNumber?: number;
      agentId?: string;
      startPoint?: string;
      localIssueId?: string;
      link?: { type: "issue" | "pr"; number: number; title: string; url: string | null; state: string };
    },
  ) =>
    request("POST", `/api/projects/${encodeURIComponent(projectId)}/worktrees`, payload),
  // One-click Auto: materialize a worktree from the issue and start an
  // issue-seeded agent run in it. Merge stays human.
  startAutoRun: (
    projectId: string,
    payload: {
      link: { type: "issue" | "pr"; number: number; title: string; url: string | null; state: string };
      agentId?: string;
      name?: string;
      baseBranch?: string;
      localIssueId?: string;
    },
  ) => request("POST", `/api/projects/${encodeURIComponent(projectId)}/auto-runs`, payload),
  // Creates a platform-managed bare repo and points the project's origin at it —
  // somewhere to push, with no account anywhere (#1210).
  createLocalOrigin: (projectId: string) =>
    request("POST", `/api/projects/${encodeURIComponent(projectId)}/local-origin`),
  removeWorktree: (id: string) => request("DELETE", `/api/worktrees/${encodeURIComponent(id)}`),
  // `path` lists one directory (the route's ?path=); omitted, it lists the root.
  // The tree loads a level at a time — a worktree is too big to walk eagerly.
  listWorktreeFiles: (id: string, path?: string) =>
    request(
      "GET",
      `/api/worktrees/${encodeURIComponent(id)}/files${path ? `?path=${encodeURIComponent(path)}` : ""}`,
    ),
  searchWorktree: (id: string, q: string, mode: "name" | "content") =>
    request("GET", `/api/worktrees/${encodeURIComponent(id)}/search?mode=${mode}&q=${encodeURIComponent(q)}`),
  readWorktreeFile: (id: string, filePath: string) =>
    request("GET", `/api/worktrees/${encodeURIComponent(id)}/file?path=${encodeURIComponent(filePath)}`),
  // OfficeCLI preview (P2b): render a project .docx/.xlsx/.pptx to self-contained
  // HTML, server-side and read-only. Full-fidelity (no 20k cap), never persisted.
  officecliPreview: (projectId: string, filePath: string, worktreeId?: string) =>
    request<{ path: string; content: string; mime: string; encoding: string; bytes: number }>(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/officecli-preview?path=${encodeURIComponent(filePath)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`,
    ),
  // A .docx's body paragraphs (path-addressed) for the block editor: each carries
  // its server-computed markdown projection (`md`, heading + inline bold/italic).
  officecliDocOutline: (projectId: string, filePath: string, worktreeId?: string) =>
    request<{ path: string; paragraphs: { path: string; type: string; text: string; style: string | null; md: string; complex?: boolean }[] }>(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/officecli-doc-outline?path=${encodeURIComponent(filePath)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`,
    ),
  // L1 block editing: given the edited block list (block editor) OR whole-document
  // markdown text (textarea mode, re-aligned to paraIds server-side), the server
  // re-reads the current .docx outline and returns the batch item list for one
  // governed `apply.batch`.
  officecliBlockOps: (
    projectId: string,
    payload:
      | { file: string; worktree: string; blocks: { path: string | null; md: string }[] }
      | { file: string; worktree: string; text: string },
  ) =>
    request<{ commands: Record<string, unknown>[] }>(
      "POST",
      `/api/projects/${encodeURIComponent(projectId)}/officecli-block-ops`,
      payload,
    ),
  // xlsx grid: read a worksheet as a cell grid (each cell carries `edit` = its
  // editable text, a formula shown as `=…`).
  officecliSheet: (projectId: string, filePath: string, worktreeId?: string, sheet?: string) =>
    request<{
      path: string;
      sheet: string;
      sheets: string[];
      maxRow: number;
      maxCol: number;
      cells: Record<string, { text: string; formula: string | null; type: string | null; edit: string }>;
    }>(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/officecli-sheet?path=${encodeURIComponent(filePath)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}${sheet ? `&sheet=${encodeURIComponent(sheet)}` : ""}`,
    ),
  // Given the edited cell map, the server re-reads the sheet and returns the batch
  // item list for one governed `apply.batch`.
  officecliSheetOps: (
    projectId: string,
    payload: { file: string; worktree: string; sheet?: string; cells: Record<string, string> },
  ) =>
    request<{ commands: Record<string, unknown>[]; sheet: string }>(
      "POST",
      `/api/projects/${encodeURIComponent(projectId)}/officecli-sheet-ops`,
      payload,
    ),
  // pptx deck: read slides + shapes (text shapes are `editable`).
  officecliDeck: (projectId: string, filePath: string, worktreeId?: string) =>
    request<{
      path: string;
      slides: { path: string; shapes: { path: string; type: string; text: string; editable: boolean }[] }[];
    }>(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/officecli-deck?path=${encodeURIComponent(filePath)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`,
    ),
  // Given the edited shape-text map, the server re-reads the deck and returns the
  // batch item list for one governed `apply.batch`.
  officecliDeckOps: (
    projectId: string,
    payload: { file: string; worktree: string; shapes: Record<string, string> },
  ) =>
    request<{ commands: Record<string, unknown>[] }>(
      "POST",
      `/api/projects/${encodeURIComponent(projectId)}/officecli-deck-ops`,
      payload,
    ),
  worktreeGit: (id: string) => request("GET", `/api/worktrees/${encodeURIComponent(id)}/git`),
  worktreeDiff: (id: string) =>
    request<WorktreeDiffSnapshot>("GET", `/api/worktrees/${encodeURIComponent(id)}/diff`),
  reviewWorktree: (id: string, payload: { verdict: "approved" | "changes_requested"; summary?: string; comments?: { path: string | null; body: string }[] }) =>
    request("POST", `/api/worktrees/${encodeURIComponent(id)}/review`, payload),
  publishWorktreeBranch: (id: string) => request("POST", `/api/worktrees/${encodeURIComponent(id)}/push`),
  createWorktreePr: (id: string, payload: { title: string; body: string }) =>
    request("POST", `/api/worktrees/${encodeURIComponent(id)}/pr`, payload),
  listGithubItems: (projectId: string) =>
    request("GET", `/api/projects/${encodeURIComponent(projectId)}/github`),
  listWorkItems: (query: {
    projectId?: string; planningProjectId?: string; status?: string; type?: string; q?: string;
    assigneeId?: string; plannedDate?: string;
    limit?: string; cursor?: string; updatedSince?: string;
  } = {}) => {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => Boolean(value)) as [string, string][]);
    return request("GET", `/api/work-items${params.size ? `?${params}` : ""}`);
  },
  listWorkItemAttention: (query: {
    projectId?: string; kind?: string; severity?: string; sla?: string;
    handler?: "mine" | "unclaimed"; includeResolved?: "1";
    limit?: string; cursor?: string; updatedSince?: string;
  } = {}) => {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => Boolean(value)) as [string, string][]);
    return request("GET", `/api/work-items/attention${params.size ? `?${params}` : ""}`);
  },
  updateWorkItemAttention: (
    attentionIds: string[],
    action: "claim" | "renew" | "release" | "resolve" | "reopen",
    note = "",
    options: { leaseSeconds?: number; idempotencyKey?: string } = {},
  ) => request("POST", "/api/work-items/attention/actions", { attentionIds, action, note, ...options }),
  getWorkItemGithubDiagnostics: () =>
    request("GET", "/api/work-items/github/diagnostics"),
  getTaskMaterialStorage: () =>
    request<TaskMaterialStorage>("GET", "/api/task-materials/storage"),
  cleanupTaskMaterialStorage: (previewToken: string) =>
    request<{ reclaimedBytes: number; fileCount: number; draftCount: number; usage: TaskMaterialStorage }>(
      "POST",
      "/api/task-materials/storage/cleanup",
      { previewToken },
    ),
  createTaskMaterialDraft: (projectId: string) =>
    request<{ draft: TaskMaterialDraft }>("POST", `/api/projects/${encodeURIComponent(projectId)}/task-material-drafts`, {}),
  getTaskMaterialDraft: (projectId: string, draftId: string) =>
    request<{ draft: TaskMaterialDraft }>("GET", `/api/projects/${encodeURIComponent(projectId)}/task-material-drafts/${encodeURIComponent(draftId)}`),
  uploadTaskMaterialFile: (projectId: string, draftId: string, fileId: string, file: File, signal?: AbortSignal) =>
    requestRaw<{ draft: TaskMaterialDraft; asset: TaskMaterialAsset }>(
      "PUT",
      `/api/projects/${encodeURIComponent(projectId)}/task-material-drafts/${encodeURIComponent(draftId)}/files/${encodeURIComponent(fileId)}?name=${encodeURIComponent(file.name || "reference-file")}`,
      file,
      file.type || "application/octet-stream",
      true,
      signal,
    ),
  removeTaskMaterialFile: (projectId: string, draftId: string, assetId: string, revision: number) =>
    request<{ draft: TaskMaterialDraft }>("DELETE", `/api/projects/${encodeURIComponent(projectId)}/task-material-drafts/${encodeURIComponent(draftId)}/files/${encodeURIComponent(assetId)}?revision=${revision}`),
  addWorkItemMaterials: (workItemId: string, payload: { expectedRevision: number; materialDraftId: string; materialDraftRevision: number }) =>
    request("POST", `/api/work-items/${encodeURIComponent(workItemId)}/materials`, payload),
  removeWorkItemMaterial: (workItemId: string, assetId: string, expectedRevision: number) =>
    request("DELETE", `/api/work-items/${encodeURIComponent(workItemId)}/materials/${encodeURIComponent(assetId)}`, { expectedRevision }),
  restoreWorkItemMaterial: (workItemId: string, assetId: string, expectedRevision: number) =>
    request("POST", `/api/work-items/${encodeURIComponent(workItemId)}/materials/${encodeURIComponent(assetId)}/restore`, { expectedRevision }),
  taskMaterialContentUrl: (workItemId: string, assetId: string, download = false) =>
    `${apiBase}/api/work-items/${encodeURIComponent(workItemId)}/materials/${encodeURIComponent(assetId)}/content${download ? "?download=1" : ""}`,
  revealTaskMaterial: (workItemId: string, assetId: string) =>
    request<{ revealed: true; name: string | null }>(
      "POST",
      `/api/work-items/${encodeURIComponent(workItemId)}/materials/${encodeURIComponent(assetId)}/reveal`,
      {},
    ),
  previewTaskMaterialOffice: (workItemId: string, assetId: string) =>
    request<{ path: string; content: string; mime: string; encoding: string; bytes: number }>(
      "GET",
      `/api/work-items/${encodeURIComponent(workItemId)}/materials/${encodeURIComponent(assetId)}/office-preview`,
    ),
  replayWorkItemGithubDelivery: (deliveryId: string) =>
    request("POST", `/api/work-items/github/deliveries/${encodeURIComponent(deliveryId)}/replay`),
  createWorkItem: (payload: {
    projectId: string;
    title: string;
    body?: string;
    type?: "task" | "bug" | "feature" | "initiative";
    status?: "backlog" | "ready" | "in_progress" | "review" | "blocked" | "done";
    priority?: "p0" | "p1" | "p2" | "p3";
    executionPolicy?: "inherit" | "auto" | "manual" | "paused";
    labels?: string[];
    acceptanceCriteria?: string[];
    verificationSop?: string[];
    assigneeIds?: string[];
    requesterRelation?: "boss" | "manager" | "customer" | "child" | "colleague" | "self" | "unknown";
    requesterName?: string | null;
    requesterOrganization?: string | null;
    requesterUserId?: string | null;
    intakeChannel?: "manual" | "meeting" | "email" | "chat" | "phone" | "github" | "import" | "other" | "unknown";
    externalReference?: string | null;
    waitingOn?: "me" | "requester" | "internal" | "ai" | "none";
    commitmentDate?: string | null;
    nextFollowUpAt?: string | null;
    dueDate?: string | null;
    notBefore?: string | null;
    plannedDate?: string | null;
    carriedFromDate?: string | null;
    milestone?: string;
    estimatePoints?: number;
    intentId?: string | null;
    intentStatement?: string;
    taskKind?: string;
    workGoalId?: string | null;
    artifactContract?: { consumes: string[]; produces: string[] };
    platformTarget?: { id: string; label: string } | null;
    dependencyIds?: string[];
    creationBasis?: "explicit_user_intent" | "channel_ingest_rule" | "saved_automation" | "required_guard" | "imported";
    planningHorizon?: "committed";
    parentId?: string | null;
    idempotencyKey?: string;
    routineDefinitionId?: string;
    routineVersion?: number;
    businessCaseId?: string;
    businessKey?: string;
    triggerArtifactIds?: string[];
    myTemplateBinding?: {
      definitionId: string;
      familyId: string;
      version: number;
      matchReasons: string[];
      userConfirmedResult?: boolean;
    };
    inputAssets?: Array<{
      id: string | null;
      path: string;
      family: string;
      terminalId: string;
      size?: number | null;
      resourceClass?: "small" | "medium" | "large" | "unknown";
      hash: string | null;
      version: string | null;
      worktreeId?: string | null;
      capabilities: string[];
      readiness: { state: "ready" | "waiting_capability"; reason: string };
    }>;
    recordBindings?: TaskRecordBinding[];
    materialDraftId?: string;
    materialDraftRevision?: number;
  }) => request("POST", "/api/work-items", payload),
  createWorkItemFromExternal: (payload: {
    projectId: string;
    provider: "github" | "gitlab" | "gitea";
    issueNumber: number;
    repository?: string;
    relation?: "source" | "related" | "duplicate" | "parent" | "blocks";
    isPrimary?: boolean;
    syncPolicy?: "manual" | "webhook_pull" | "bidirectional";
    type?: "task" | "bug" | "feature" | "initiative";
    priority?: "p0" | "p1" | "p2" | "p3";
    plannedDate?: string | null;
    acceptanceCriteria?: string[];
  }) => request("POST", "/api/work-items/from-external", payload),
  getWorkItem: (id: string) => request("GET", `/api/work-items/${encodeURIComponent(id)}`),
  createWorkItemResultRepair: (id: string) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/result-repair`, {}),
  suggestWorkItemDraft: (payload: {
    projectId: string;
    title: string;
    body?: string;
    materialDraftId?: string;
    materialDraftRevision?: number;
  }) =>
    request("POST", "/api/work-items/assist/draft", payload),
  previewWorkItemIntentPlan: (payload: {
    projectId: string;
    title: string;
    body?: string;
    materialDraftId?: string;
    materialDraftRevision?: number;
    sourceWorkItemId?: string;
    sourceQuery?: string;
    excludeKinds?: string[];
    excludeTaskKeys?: string[];
    clarificationAnswer?: string;
  }) => request("POST", "/api/work-items/assist/intent-plan", payload),
  commitWorkItemIntentPlan: (payload: {
    projectId: string;
    title: string;
    body?: string;
    mode: "task" | "ai";
    idempotencyKey: string;
    dueDate?: string | null;
    acceptanceCriteria?: string[];
    verificationSop?: string[];
    myTemplateBinding?: {
      definitionId: string;
      familyId: string;
      version: number;
      matchReasons: string[];
      userConfirmedResult?: boolean;
    };
    materialDraftId?: string;
    materialDraftRevision?: number;
    sourceWorkItemId?: string;
    excludeKinds?: string[];
    excludeTaskKeys?: string[];
    clarificationAnswer?: string;
  }) => request("POST", "/api/work-items/assist/intent-plan/commit", payload),
  listMyTemplateDefinitions: () =>
    request("GET", "/api/workflow-memory/business-routine-definitions"),
  listTaskTemplates: (projectId?: string) =>
    request<{ taskTemplates: TaskTemplateContractV2[]; count: number }>(
      "GET",
      `/api/workflow-memory/task-templates${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
    ),
  getBusinessLedgerRecord: (ledgerDefinitionId: string, selector: { recordId?: string; businessKey?: string }) => {
    const query = new URLSearchParams();
    if (selector.recordId) query.set("recordId", selector.recordId);
    if (selector.businessKey) query.set("businessKey", selector.businessKey);
    return request<{
      record: BusinessLedgerRecordRef;
      fields: Record<string, string | number | boolean | null>;
      rowNumber: number;
      targetRevision: string;
    }>(
      "GET",
      `/api/workflow-memory/ledger-definitions/${encodeURIComponent(ledgerDefinitionId)}/records?${query.toString()}`,
    );
  },
  getWorkItemLedgerPostingPlan: (workItemId: string) =>
    request<{ plan: LedgerPostingPlan & { id: string; revision: number; status: string; previewId: string | null; batchPreviewId: string | null; previewIds: string[] }; preview: Record<string, unknown> | null; batchPreview: Record<string, unknown> | null }>(
      "GET",
      `/api/work-items/${encodeURIComponent(workItemId)}/ledger-posting-plan`,
    ),
  prepareWorkItemLedgerPostingPlan: (workItemId: string, payload: {
    expectedRevision: number;
    primary?: LedgerPostingPlan["primary"];
    related?: LedgerPostingPlan["related"];
  }) =>
    request<{ plan: LedgerPostingPlan & { id: string; revision: number; status: string; previewId: string | null; batchPreviewId: string | null; previewIds: string[] }; preview: Record<string, unknown> | null; batchPreview: Record<string, unknown> | null }>(
      "POST",
      `/api/work-items/${encodeURIComponent(workItemId)}/ledger-posting-plan`,
      payload,
    ),
  commitWorkItemLedgerPostingPlan: (workItemId: string, payload: { planId: string; expectedRevision: number; approvalToken: string }) =>
    request<{ plan: LedgerPostingPlan & { id: string; revision: number; status: string; previewId: string | null; batchPreviewId: string | null; previewIds: string[] } }>(
      "POST",
      `/api/work-items/${encodeURIComponent(workItemId)}/ledger-posting-plan/commit`,
      payload,
    ),
  listMyTemplateLearning: (projectId?: string) =>
    request("GET", `/api/work-items/my-template-learning${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  removeMyTemplateLearning: (feedbackId: string) =>
    request("DELETE", `/api/work-items/my-template-learning/${encodeURIComponent(feedbackId)}`),
  previewMyTemplateDraft: (workItemId: string) =>
    request("GET", `/api/work-items/${encodeURIComponent(workItemId)}/my-template-draft`),
  listMyTemplateDrafts: (projectId?: string) =>
    request("GET", `/api/work-items/my-template-drafts${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  listSimilarMyTemplateWorkItems: (draftId: string) =>
    request("GET", `/api/work-items/my-template-drafts/${encodeURIComponent(draftId)}/similar-work-items`),
  reviewMyTemplateDraft: (draftId: string) =>
    request("GET", `/api/work-items/my-template-drafts/${encodeURIComponent(draftId)}/review`),
  addMyTemplateLearningCase: (draftId: string, payload: {
    workItemId: string;
    expectedDraftRevision: number;
    expectedWorkItemRevision: number;
    confirm: true;
  }) => request("POST", `/api/work-items/my-template-drafts/${encodeURIComponent(draftId)}/cases`, payload),
  activateMyTemplateDraft: (draftId: string, payload: {
    expectedDraftRevision: number;
    confirm: boolean;
    name?: string;
    typicalInput?: string;
    expectedOutput?: string;
  }) => request("POST", `/api/work-items/my-template-drafts/${encodeURIComponent(draftId)}/activate`, payload),
  createMyTemplateDraft: (workItemId: string, payload: {
    expectedRevision: number;
    confirm: true;
    name: string;
    typicalInput: string;
    expectedOutput: string;
    idempotencyKey?: string;
  }) => request("POST", `/api/work-items/${encodeURIComponent(workItemId)}/my-template-draft`, payload),
  listMyTemplateOutcomes: (projectId?: string) =>
    request("GET", `/api/work-items/my-template-outcomes${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  recordMyTemplateOutcomeFeedback: (workItemId: string, payload: {
    outcome: "met_expectations" | "wrong_result" | "needs_quality_adjustment";
    note?: string;
  }) => request("POST", `/api/work-items/${encodeURIComponent(workItemId)}/my-template-outcome-feedback`, payload),
  resumeMyTemplateGovernanceObservation: (familyId: string, payload: { projectId: string; confirm: true }) =>
    request("POST", `/api/work-items/my-template-governance/${encodeURIComponent(familyId)}/resume-observation`, payload),
  updateWorkItem: (id: string, payload: Record<string, unknown>) =>
    request("PATCH", `/api/work-items/${encodeURIComponent(id)}`, payload),
  claimWorkItem: (id: string, payload: { agentId?: string; leaseMinutes?: number; idempotencyKey?: string } = {}) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/claim`, payload),
  releaseWorkItemClaim: (id: string, idempotencyKey?: string) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/release-claim`, { idempotencyKey }),
  bindWorkItemGithubIssue: (id: string, payload: Record<string, unknown>) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/github/link`, payload),
  listWorkItemExternalProviders: () =>
    request("GET", "/api/work-items/providers"),
  getWorkItemExternalIssueFunnel: (projectId?: string) =>
    request("GET", `/api/work-items/external-funnel${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  listWorkItemExternalIssues: (payload: { provider: "gitlab" | "gitea"; projectId: string; repository: string; query?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams({ provider: payload.provider, projectId: payload.projectId, repository: payload.repository });
    if (payload.query) query.set("q", payload.query);
    query.set("page", String(payload.page ?? 1));
    query.set("limit", String(payload.limit ?? 20));
    return request("GET", `/api/work-items/external-issues?${query}`);
  },
  bindWorkItemExternalIssue: (id: string, payload: Record<string, unknown>) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/external-bindings`, payload),
  syncWorkItemExternalIssue: (id: string, provider: string, payload: Record<string, unknown>) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/external-bindings/${encodeURIComponent(provider)}/sync`, payload),
  syncWorkItemGithubIssue: (id: string, payload: Record<string, unknown>) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/github/sync`, payload),
  recordWorkItemVerification: (id: string, payload: Record<string, unknown>) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/verifications`, payload),
  recordWorkItemAssetOperation: (id: string, payload: Record<string, unknown>) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/asset-operations`, payload),
  recordWorkItemProgress: (id: string, payload: {
    expectedRevision: number;
    idempotencyKey: string;
    summary: string;
    waitingOn?: "me" | "requester" | "internal" | "ai" | "none";
    nextFollowUpAt?: string | null;
  }) => request("POST", `/api/work-items/${encodeURIComponent(id)}/progress`, payload),
  startWorkItemApplication: (id: string, payload: {
    expectedRevision: number;
    intent?: string;
    assetVerb?: string;
    assetFamily?: string;
    resourceClass?: "small" | "medium" | "large" | "unknown";
    parameters?: Record<string, unknown>;
    approvalToken?: string;
  }) => request("POST", `/api/work-items/${encodeURIComponent(id)}/application-invocations`, payload),
  requestWorkItemApplicationApproval: (id: string, payload: {
    expectedRevision: number; intent?: string; assetVerb?: string; assetFamily?: string;
    resourceClass?: "small" | "medium" | "large" | "unknown";
  }) => request<{ approvalToken: string; expiresAt: string }>(
    "POST", `/api/work-items/${encodeURIComponent(id)}/application-approval`, payload,
  ),
  bulkUpdateWorkItems: (payload: {
    items: { id: string; expectedRevision: number }[];
    changes: Record<string, unknown>;
  }) => request("PATCH", "/api/work-items/bulk", payload),
  transitionWorkItem: (id: string, action: "close" | "reopen" | "archive" | "restore", expectedRevision: number) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/${action}`, { expectedRevision }),
  listWorkItemComments: (id: string) =>
    request("GET", `/api/work-items/${encodeURIComponent(id)}/comments`),
  createWorkItemComment: (id: string, body: string) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/comments`, { body }),
  updateWorkItemComment: (workItemId: string, commentId: string, payload: { expectedRevision: number; body: string }) =>
    request("PATCH", `/api/work-items/${encodeURIComponent(workItemId)}/comments/${encodeURIComponent(commentId)}`, payload),
  deleteWorkItemComment: (workItemId: string, commentId: string, expectedRevision: number) =>
    request("DELETE", `/api/work-items/${encodeURIComponent(workItemId)}/comments/${encodeURIComponent(commentId)}`, { expectedRevision }),
  listWorkItemActivity: (id: string) =>
    request("GET", `/api/work-items/${encodeURIComponent(id)}/activity`),
  createWorkItemWorktree: (id: string, payload: { agentId?: string; baseBranch?: string } = {}) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/worktrees`, payload),
  startWorkItemAutoRun: (id: string, payload: { agentId?: string; baseBranch?: string } = {}) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/auto-runs`, {
      ...payload,
      timezoneOffset: new Date().getTimezoneOffset(),
    }),
  deliverWorkItem: (id: string, mode: "local_merge" | "pull_request", expectedRevision: number) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/delivery/${mode === "local_merge" ? "local" : "pull-request"}`, {
      expectedRevision,
    }),
  retryWorkItemAlert: (workItemId: string, alertId: string) =>
    request("POST", `/api/work-items/${encodeURIComponent(workItemId)}/alerts/${encodeURIComponent(alertId)}/retry`),
  listPlanningProjects: (
    input: boolean | { includeArchived?: boolean; limit?: string; cursor?: string; updatedSince?: string } = false,
  ) => {
    const query = typeof input === "boolean" ? { includeArchived: input } : input;
    const params = new URLSearchParams();
    if (query.includeArchived) params.set("includeArchived", "1");
    if (query.limit) params.set("limit", query.limit);
    if (query.cursor) params.set("cursor", query.cursor);
    if (query.updatedSince) params.set("updatedSince", query.updatedSince);
    return request("GET", `/api/planning-projects${params.size ? `?${params}` : ""}`);
  },
  getPlanningProject: (id: string) =>
    request("GET", `/api/planning-projects/${encodeURIComponent(id)}`),
  createPlanningProject: (payload: {
    name: string;
    description?: string;
    color?: string;
    capacityPoints?: number;
    startDate?: string | null;
    targetDate?: string | null;
    ownerId?: string | null;
    status?: "planned" | "active" | "on_hold" | "completed";
    tags?: string[];
    statusSummary?: string;
    pinned?: boolean;
    watching?: boolean;
    templateProjectId?: string;
    savedViews?: unknown[];
    automationRules?: unknown[];
    autonomyProfile?: "cautious" | "standard" | "high";
  }) =>
    request("POST", "/api/planning-projects", payload),
  updatePlanningProject: (id: string, payload: Record<string, unknown>) =>
    request("PATCH", `/api/planning-projects/${encodeURIComponent(id)}`, payload),
  setPlanningProjectArchived: (id: string, expectedRevision: number, archived: boolean) =>
    request("POST", `/api/planning-projects/${encodeURIComponent(id)}/${archived ? "archive" : "restore"}`, { expectedRevision }),
  addPlanningProjectItem: (planningProjectId: string, workItemId: string) =>
    request("PUT", `/api/planning-projects/${encodeURIComponent(planningProjectId)}/items/${encodeURIComponent(workItemId)}`),
  removePlanningProjectItem: (planningProjectId: string, workItemId: string) =>
    request("DELETE", `/api/planning-projects/${encodeURIComponent(planningProjectId)}/items/${encodeURIComponent(workItemId)}`),
  reorderPlanningProjectItems: (planningProjectId: string, expectedRevision: number, workItemIds: string[]) =>
    request("PUT", `/api/planning-projects/${encodeURIComponent(planningProjectId)}/items`, { expectedRevision, workItemIds }),
  updatePlanningProjectItems: (planningProjectId: string, addWorkItemIds: string[], removeWorkItemIds: string[]) =>
    request("PATCH", `/api/planning-projects/${encodeURIComponent(planningProjectId)}/items`, { addWorkItemIds, removeWorkItemIds }),
  suggestPlanningProjectPlan: (planningProjectId: string) =>
    request("POST", `/api/planning-projects/${encodeURIComponent(planningProjectId)}/assist/plan`, {}),
  executePlanningRecommendedAction: (planningProjectId: string, code: string, payload: Record<string, unknown>) =>
    request("POST", `/api/planning-projects/${encodeURIComponent(planningProjectId)}/recommended-actions/${encodeURIComponent(code)}/execute`, payload),
  decidePlanningRecommendedAction: (
    planningProjectId: string,
    approvalRequestId: string,
    decision: "approve" | "deny",
    payload: { confirmed: boolean; note: string },
  ) => request("POST", `/api/planning-projects/${encodeURIComponent(planningProjectId)}/recommended-action-approvals/${encodeURIComponent(approvalRequestId)}/${decision}`, payload),
  // #1143 issue claims: take/hand back an issue's develop lease. A foreign
  // active develop claim answers 409 with the blocking claim.
  claimIssue: (projectId: string, payload: { issueNumber: number; mode?: "develop" | "review" }) =>
    request("POST", `/api/projects/${encodeURIComponent(projectId)}/issue-claims`, payload),
  releaseIssueClaim: (claimId: string) =>
    request("POST", `/api/issue-claims/${encodeURIComponent(claimId)}/release`),
  // #1151 decision soft-claims: advisory "I'm handling this" on an Approvals row.
  claimDecision: (decisionId: string) =>
    request("POST", `/api/pending-decisions/${encodeURIComponent(decisionId)}/claim`),
  releaseDecisionClaim: (decisionId: string) =>
    request("POST", `/api/pending-decisions/${encodeURIComponent(decisionId)}/release`),
  // Auto-run observability: the records plus an evaluation summary. refresh=true
  // also refreshes PR dispositions (bounded gh reads) for the routing evaluation.
  listAutoRuns: (refresh = false) => request("GET", `/api/auto-runs${refresh ? "?refresh=1" : ""}`),
  recordAutoRunRoutingOverride: (id: string, actualPath: string, reason: string, expectedRevision = 0) =>
    request("POST", `/api/auto-runs/${encodeURIComponent(id)}/routing-override`, {
      actualPath,
      reason,
      expectedRevision,
      idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    }),
  // U1: can this project run an auto-run, and what's missing?
  autoRunReadiness: (projectId: string) => request("GET", `/api/projects/${encodeURIComponent(projectId)}/auto-run-readiness`),
  // Retry a failed/blocked run, or revise a completed local delivery, in its existing worktree.
  retryAutoRun: (id: string, feedback?: string) => request("POST", `/api/auto-runs/${encodeURIComponent(id)}/retry`, {
    timezoneOffset: new Date().getTimezoneOffset(),
    ...(feedback?.trim() ? { feedback: feedback.trim() } : {}),
  }),
  cancelAutoRun: (id: string) => request("POST", `/api/auto-runs/${encodeURIComponent(id)}/cancel`),
  stopAutoRunDelivery: (id: string, reason?: string) => request("POST", `/api/auto-runs/${encodeURIComponent(id)}/stop-delivery`, { reason }),
  // Human-triggered PR merge for a pr_open auto-run (merge stays human — a person
  // clicks Merge in the console; runs `gh pr merge` server-side).
  mergeAutoRunPr: (id: string) => request("POST", `/api/auto-runs/${encodeURIComponent(id)}/merge`),
  // Scheduled work-report → channel push: edit the config, or post immediately.
  setReportSchedule: (patch: Record<string, unknown>) => request("PUT", "/api/report-schedule", patch),
  postReportNow: () => request("POST", "/api/report-schedule/post-now"),
  // D4: the human design gate — approve spawns the implementation child issue.
  designApproval: (id: string, action: "approve" | "reject", feedback?: string) =>
    request("POST", `/api/auto-runs/${encodeURIComponent(id)}/design-approval`, { action, feedback }),
  // E3: answer a clarify run's questions (posted back to the issue).
  answerClarify: (id: string, { answers, selectedAction, repoUrl, repoName }: { answers?: string; selectedAction?: string; repoUrl?: string; repoName?: string }) =>
    request("POST", `/api/auto-runs/${encodeURIComponent(id)}/clarify-answer`, { answers, selectedAction, repoUrl, repoName }),
  // Epic S3: the human decomposition gate — approve spawns the N governed child issues.
  decompositionApproval: (id: string, action: "approve" | "reject", feedback?: string) =>
    request("POST", `/api/auto-runs/${encodeURIComponent(id)}/decomposition-approval`, { action, feedback }),
  // Scheduled real-agent eval trend (#248): read-only view of the local
  // trend.jsonl so capability regressions surface in the console, not just cron.log.
  listEvalTrend: () => request("GET", "/api/eval-trend"),
  maturity: () => request("GET", "/api/maturity"),
  dora: () => request("GET", "/api/dora"),
  dispatchEvaluation: () => request("GET", "/api/dispatch-evaluation"),
  getInvocationDispatchHealth: () => request<InvocationDispatchHealthResponse>("GET", "/api/invocation-dispatch-health"),
  loopRoutineRuns: () => request("GET", "/api/loop-routines"),
  loopRoutineFindings: (runId: string) => request("GET", `/api/loop-routines/${encodeURIComponent(runId)}/findings`),
  // Auto-run effective configuration (safe knobs overlaid on env + per-command
  // configured flags; never the argv). Edits apply on the next server start.
  getAutoRunConfig: () => request("GET", "/api/auto-run-config"),
  updateAutoRunSettings: (patch: Record<string, unknown>) => request("PUT", "/api/auto-run-settings", patch),
  updateTeamAlertWebhook: (teamId: string, alertWebhookUrl: string | null) =>
    request("PATCH", `/api/teams/${encodeURIComponent(teamId)}/alert-webhook`, { alertWebhookUrl }),
  listBranches: (projectId: string) =>
    request("GET", `/api/projects/${encodeURIComponent(projectId)}/branches`),
  gitSummary: (projectId: string) =>
    request("GET", `/api/projects/${encodeURIComponent(projectId)}/git-summary`),
  suggestWorktreeName: (description: string) =>
    request("POST", "/api/worktree-name-suggestion", { description }),

  createAutomation: (payload: Record<string, unknown>) => request("POST", "/api/automations", payload),
  runAutomation: (id: string) => request("POST", `/api/automations/${encodeURIComponent(id)}/run`),
  updateAutomation: (id: string, patch: Record<string, unknown>) =>
    request("PATCH", `/api/automations/${encodeURIComponent(id)}`, patch),
  deleteAutomation: (id: string) => request("DELETE", `/api/automations/${encodeURIComponent(id)}`),

  createAgentSkill: (payload: Record<string, unknown>) => request("POST", "/api/agent-skills", payload),
  updateAgentSkill: (id: string, patch: Record<string, unknown>) =>
    request("PATCH", `/api/agent-skills/${encodeURIComponent(id)}`, patch),
  deleteAgentSkill: (id: string) => request("DELETE", `/api/agent-skills/${encodeURIComponent(id)}`),

  approveApproval: (id: string) =>
    request("POST", `/api/approvals/${encodeURIComponent(id)}/approve`),
  denyApproval: (id: string) => request("POST", `/api/approvals/${encodeURIComponent(id)}/deny`),
  approveLifecycleApproval: (id: string) =>
    request("POST", `/api/m3/lifecycle-approvals/${encodeURIComponent(id)}/approve`),
  denyLifecycleApproval: (id: string) =>
    request("POST", `/api/m3/lifecycle-approvals/${encodeURIComponent(id)}/deny`),
  queueLifecycleRollback: (id: string) =>
    request("POST", `/api/m3/lifecycle-rollbacks/${encodeURIComponent(id)}/queue`),
  /** Channel lifecycle (#1090). Enable/allowlist/delivery-retry are approval-gated. */
  registerChannel: (provider: string, name: string) =>
    request<{ channel: { id: string; provider: string; name: string } }>("POST", "/api/channels", { provider, name }),
  listChannelInteractions: (channelId: string, params: { direction?: string; type?: string; status?: string; query?: string; conversationId?: string; cursor?: string | null; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.direction && params.direction !== "all") search.set("direction", params.direction);
    if (params.type && params.type !== "all") search.set("type", params.type);
    if (params.status && params.status !== "all") search.set("status", params.status);
    if (params.query) search.set("q", params.query);
    if (params.conversationId) search.set("conversationId", params.conversationId);
    if (params.cursor) search.set("cursor", params.cursor);
    search.set("limit", String(params.limit ?? 50));
    const suffix = search.toString();
    return request<{ interactions: ChannelInteraction[]; nextCursor: string | null; count: number }>("GET", `/api/channels/${encodeURIComponent(channelId)}/interactions${suffix ? `?${suffix}` : ""}`);
  },
  getChannelDiagnostics: (channelId: string) =>
    request<ChannelDiagnostics>("GET", `/api/channels/${encodeURIComponent(channelId)}/diagnostics`),
  getChannelNotificationPolicy: (channelId: string, conversationId?: string, threadId?: string | null) => {
    const search = new URLSearchParams();
    if (conversationId) search.set("conversationId", conversationId);
    if (threadId) search.set("threadId", threadId);
    const suffix = search.toString();
    return request("GET", `/api/channels/${encodeURIComponent(channelId)}/notification-policy${suffix ? `?${suffix}` : ""}`);
  },
  setChannelNotificationPolicy: (channelId: string, payload: { conversationId: string; threadId?: string | null; patch: Record<string, unknown> }) =>
    request("PUT", `/api/channels/${encodeURIComponent(channelId)}/notification-policy`, payload),
  startIlinkLogin: (channelId: string) =>
    request("POST", `/api/channels/${encodeURIComponent(channelId)}/ilink/login`, {}),
  pollIlinkLogin: (channelId: string, verifyCode?: string) => {
    const query = verifyCode?.trim() ? `?verify_code=${encodeURIComponent(verifyCode.trim())}` : "";
    return request("GET", `/api/channels/${encodeURIComponent(channelId)}/ilink/login${query}`);
  },
  activateIlinkChannel: (channelId: string, approvalToken: string) =>
    request("POST", `/api/channels/${encodeURIComponent(channelId)}/ilink/activate`, { approvalToken }),
  disconnectIlinkChannel: (channelId: string) =>
    request("POST", `/api/channels/${encodeURIComponent(channelId)}/ilink/disconnect`, {}),
  enableChannel: (id: string, approvalToken: string) =>
    request("POST", `/api/channels/${encodeURIComponent(id)}/enable`, { approvalToken }),
  disableChannel: (id: string) =>
    request("POST", `/api/channels/${encodeURIComponent(id)}/disable`, {}),
  retryChannelDelivery: (channelId: string, deliveryId: string, approvalToken: string) =>
    request<{ deliveryId: string; status: string }>(
      "POST",
      `/api/channels/${encodeURIComponent(channelId)}/deliveries/${encodeURIComponent(deliveryId)}/retry`,
      { approvalToken },
    ),
  // Bind (projectId) or clear (null) the project /task files issues into, and the
  // auto-route mode. Approval-gated.
  setChannelTaskProject: (channelId: string, projectId: string | null, autoRoute: boolean, dailyLimit: number, approvalToken: string, operationMode: "personal" | "team" = "personal", terminalId: string | null = null) =>
    request("POST", `/api/channels/${encodeURIComponent(channelId)}/task-project`, { projectId, terminalId: projectId ? terminalId : null, autoRoute, dailyLimit, operationMode, approvalToken }),
  // Promote a captured /task request into a tracked auto-run, or dismiss it.
  routeChannelTask: (id: string) => request<{ ok: boolean; autoRunId: string | null }>("POST", `/api/channel-tasks/${encodeURIComponent(id)}/route`),
  dismissChannelTask: (id: string) => request("POST", `/api/channel-tasks/${encodeURIComponent(id)}/dismiss`),
  retryChannelTask: (id: string) => request("POST", `/api/channel-tasks/${encodeURIComponent(id)}/retry`),
  reconcileWechatDraftTask: (id: string, outcome: "confirmed_saved" | "confirmed_not_saved") =>
    request<{ ok: boolean; reconciled?: boolean; invocationId?: string }>(
      "POST",
      `/api/channel-tasks/${encodeURIComponent(id)}/wechat-draft-reconciliation`,
      { outcome },
    ),
  rerouteChannelTask: (id: string) => request("POST", `/api/channel-tasks/${encodeURIComponent(id)}/reroute`),
  takeoverChannelTask: (id: string) => request("POST", `/api/channel-tasks/${encodeURIComponent(id)}/takeover`),
  replyChannelTask: (id: string, content: string) => request<{ ok: boolean; deliveryId: string; threadId: string }>("POST", `/api/channel-tasks/${encodeURIComponent(id)}/reply`, { content }),
  // Opt a channel into in-channel /approve (default off). Approval-gated.
  setChannelApprovalPolicy: (channelId: string, allowSelfApprove: boolean, approvalToken: string) =>
    request("POST", `/api/channels/${encodeURIComponent(channelId)}/approval-policy`, { allowSelfApprove, approvalToken }),

  // Canvas scenes (#1354): server-authoritative, revision-aware.
  listCanvasScenes: () => request<{ scenes: CanvasSceneSummary[]; count: number }>("GET", "/api/canvas/scenes"),
  getCanvasScene: (id: string) =>
    request<{ scene: CanvasScene }>("GET", `/api/canvas/scenes/${encodeURIComponent(id)}`),
  createCanvasScene: (body: { name?: string; projectId?: string | null; elements?: unknown[]; files?: Record<string, unknown> }) =>
    request<{ scene: CanvasScene }>("POST", "/api/canvas/scenes", body),
  deleteCanvasScene: (id: string, expectedRevision: number) =>
    request("DELETE", `/api/canvas/scenes/${encodeURIComponent(id)}`, { expectedRevision }),
  // Revision-aware save: returns a typed conflict on 409 rather than throwing.
  saveCanvasScene: async (
    id: string,
    body: { name?: string; elements?: unknown[]; files?: Record<string, unknown>; expectedRevision: number },
  ): Promise<CanvasSaveResult> => {
    const { status, ok, data } = await requestResult("PUT", `/api/canvas/scenes/${encodeURIComponent(id)}`, body);
    if (ok) return { ok: true, scene: data.scene as CanvasScene };
    if (status === 409 && data.error === "canvas_scene_revision_conflict") {
      return { ok: false, conflict: true, currentRevision: Number(data.currentRevision) };
    }
    return { ok: false, conflict: false, error: String(data.message ?? data.error ?? "Save failed.") };
  },
};
