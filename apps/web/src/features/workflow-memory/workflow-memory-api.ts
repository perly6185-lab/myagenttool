import {
  request,
  requestRaw,
  type BusinessDocumentAnalysisJob,
  type BusinessDocumentClassification,
  type BusinessDocumentType,
  type BusinessFieldProposal,
  type BusinessCaseCandidate,
  type BusinessRoutineDiscoveryCandidate,
  type BusinessRoutineDefinition,
  type BusinessRoutineStep,
  type DeliveryCase,
  type SimilarWorkflowCase,
  type WorkflowArtifact,
  type WorkflowArtifactRole,
  type WorkflowFeedbackReason,
  type WorkflowProfile,
  type WorkflowProfileDraft,
  type WorkflowRequirementInspection,
  type WorkflowRetrievalEvaluation,
  type WorkflowRun,
  type WorkflowSource,
} from "@/lib/api-client";

export type TemplateLearningStage =
  | "collecting_cases" | "analyzing" | "needs_case_review" | "failed" | "completed";

export type ChannelObjectKind = "contact" | "order" | "quotation" | "shipment" | "after_sales" | "return" | "account" | "receivable" | "bank_transaction" | "publish_target";

export interface ChannelObjectRecord {
  id: string;
  kind: ChannelObjectKind;
  projectId: string;
  label: string;
  fields: Record<string, string>;
  status: "active" | "disabled";
  source: string;
  sourceRef: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelObjectImportPreview {
  id: string;
  projectId: string;
  kind: ChannelObjectKind;
  sourceKind?: "local_file" | string;
  format: "csv" | "json" | "xlsx";
  fileName: string;
  status: "preview" | "confirmed" | "expired" | string;
  totalRows: number;
  acceptedRows: number;
  errorRows: number;
  errors: Array<{ rowNumber: number; error: string }>;
  previewRows: Array<{ rowNumber: number; label: string; businessKey: string; fields: Record<string, string>; change?: "create" | "update" | "unchanged" | string }>;
  diff?: { created: number; updated: number; unchanged: number; removed: number };
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
}

export interface ChannelObjectFileSource {
  id: string;
  projectId: string;
  kind: ChannelObjectKind;
  fileName: string;
  sourceKind: "local_file" | string;
  status: "active" | "disabled" | string;
  rowCount: number;
  contentHash: string;
  revision: number;
  lastImportId: string | null;
  lastImportedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelMutationBinding {
  id: string;
  projectId: string;
  ownerTeamId?: string;
  fileSourceId: string;
  ledgerDefinitionId: string;
  status: "active" | "disabled" | string;
  fileName: string;
  format: string;
  fileSourceRevision: number;
  ledgerDefinitionRevision: number;
  stale: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerDefinitionSummary {
  id: string;
  projectId: string;
  name: string;
  state: "draft" | "active" | "disabled" | string;
  format: "csv" | "xlsx" | string;
  relativePath: string;
  revision: number;
}

export interface ChannelObjectConnector {
  id: string;
  name: string;
  mode: "read_only";
  kinds: ChannelObjectKind[];
  configured?: boolean;
}

export interface ChannelObjectConnectorConfig {
  id: string;
  projectId: string;
  connectorId: string;
  name: string;
  kinds: ChannelObjectKind[];
  status: "enabled" | "disabled";
  credentialConfigured: boolean;
  health: "unknown" | "ready" | "error" | string;
  lastTestAt: string | null;
  errorCode: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelObjectSyncPreview {
  id: string;
  projectId: string;
  connectorId: string;
  configId: string | null;
  kind: ChannelObjectKind;
  status: "preview" | "confirmed" | string;
  creates: number;
  updates: number;
  deletes: number;
  unchanged: number;
  effects: { readsExternal: true; writesExternal: false; upsertsLocal: true; deletesLocal: false };
  totalRows: number;
  sampleRows: Array<{ label: string; businessKey: string; change: "create" | "update" | "unchanged" | string }>;
  expiresAt: string;
  createdAt: string;
}

export interface TemplateLearningTask {
  id: string;
  templateId: string;
  sourceId: string;
  workItemId: string;
  name: string;
  nameSuggested?: boolean;
  stage: TemplateLearningStage;
  progress: number;
  lastError?: string | null;
  allowCloudOcr?: boolean;
  cases: Array<{
    id: string;
    files: Array<{
      id: string;
      role: "input" | "output" | "reference";
      name: string;
      extension: string;
      contentType: string;
      size: number;
      hash: string;
      relativePath: string;
      copiedAt: string;
    }>;
  }>;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface WorkflowIntakeObservation {
  id: string;
  projectId: string;
  sourceId: string;
  relativePath: string;
  name: string;
  state: "observing" | "waiting_stable" | "needs_review" | "duplicate" | "ready" | "triggered" | "blocked";
  reason: string | null;
  artifactId: string | null;
  canonicalArtifactId: string | null;
  artifactRevision: number | null;
  extraction: {
    state: "ready" | "needs_ocr" | "failed" | "limited" | "skipped";
    pageCount: number | null;
    characterCount: number;
    providerId: string | null;
    localOnly: boolean | null;
  } | null;
  receiptId?: string | null;
  receipt?: Pick<
    InquiryIntakeReceipt,
    "id" | "businessKey" | "routineDefinitionId" | "routineVersion" | "businessCaseId"
    | "workItemId" | "workItemLocalRef" | "routineRunId" | "state" | "triggeredAt"
  > | null;
  triggeredAt?: string | null;
  revision: number;
  updatedAt: string;
}

export interface InquiryIntakeRoutine {
  id: string;
  name: string;
  description: string;
  version: number;
  triggerDocumentTypes: string[];
}

export interface InquiryIntakeReceipt {
  id: string;
  projectId: string;
  sourceId: string;
  observationId: string;
  artifactId: string;
  supportingArtifactIds: string[];
  supportingObservationIds: string[];
  supportingBindings: Array<{
    observationId: string;
    artifactId: string;
    role: "reference" | "historical_output";
    documentType: "other_reference" | "inquiry_ledger";
    pairingEvidence: Array<{ kind: string; value: string }>;
  }>;
  businessKey: string;
  routineDefinitionId: string;
  routineVersion: number;
  businessCaseId: string;
  workItemId: string;
  workItemLocalRef: string;
  routineRunId: string;
  state: "triggered";
  triggeredAt: string;
  revision: number;
}

export interface InquiryIntakeInspection {
  state: "needs_confirmation";
  observation: {
    id: string;
    sourceId: string;
    artifactId: string;
    relativePath: string;
    revision: number;
    ocrEvidence: Array<{
      page: number;
      kind: "page" | "image";
      width: number | null;
      height: number | null;
      confidence: number | null;
      lineCount: number;
      preview: string;
    }>;
    supportingObservations: Array<{
      id: string;
      artifactId: string;
      relativePath: string;
      name: string;
      family: string;
      extractionState: string;
      role: "reference" | "historical_output";
      documentType: "other_reference" | "inquiry_ledger";
      pairingEvidence: Array<{ kind: string; value: string }>;
      classification?: Pick<
        BusinessDocumentClassification,
        "id" | "artifactId" | "documentType" | "confidence" | "confirmationState"
        | "analysisState" | "riskSignals" | "fieldProposals" | "revision"
      >;
    }>;
  };
  classification: Pick<
    BusinessDocumentClassification,
    "id" | "artifactId" | "documentType" | "confidence" | "confirmationState"
    | "analysisState" | "riskSignals" | "fieldProposals" | "revision"
  >;
  routines: InquiryIntakeRoutine[];
}

export type CommercialPilotDocumentRole =
  | "inquiry"
  | "quotation"
  | "order"
  | "inquiry_ledger"
  | "quotation_ledger"
  | "order_ledger"
  | "unknown";

export interface CommercialPilotCaseDraft {
  id: string;
  workItemId: string;
  templateId: string;
  traits: string[];
  expectedDocumentRole: CommercialPilotDocumentRole;
  relationshipExpected: boolean;
  relationshipArtifactId?: string;
  expectedOutcome: "ordered" | "no_order" | "rejected";
}

export interface CommercialPilotSafetyDraft {
  id: string;
  evidenceKind: "event" | "refusal" | "classification";
  evidenceId: string;
}

export interface CommercialPilotReleaseReview {
  confirmed: boolean;
  recordedAt?: string | null;
  reviewerRole: string;
  performance: boolean;
  security: boolean;
  privacy: boolean;
  accessibility: boolean;
  localization: boolean;
  migration: boolean;
  rollback: boolean;
  items?: Partial<Record<CommercialPilotReviewDimension, CommercialPilotReviewItem>>;
}

export type CommercialPilotReviewDimension =
  | "performance"
  | "security"
  | "privacy"
  | "accessibility"
  | "localization"
  | "migration"
  | "rollback";

export interface CommercialPilotReviewItem {
  status: "pending" | "passed" | "failed";
  reviewerRole: string;
  reviewerId?: string | null;
  reviewedAt?: string | null;
  note: string;
  evidenceIds: string[];
}

export interface CommercialPilotCollectionSummary {
  id: string;
  pilotId: string;
  draftRevision: number;
  evidenceReceiptId: string;
  collectedAt: string;
  evidenceState: "complete" | "incomplete";
  decision: "go" | "no_go";
  caseCount: number;
  safetyPassed: number;
  safetyTotal: number;
  current: boolean;
  revokedAt: string | null;
}

export interface CommercialPilotWorkbenchDraftInput {
  pilotId: string;
  description?: string;
  dataClassification: "deidentified" | "real";
  consent: {
    confirmed: boolean;
    recordedAt?: string | null;
    scope: string;
  };
  releaseReview: CommercialPilotReleaseReview;
  cases: CommercialPilotCaseDraft[];
  safetyScenarios: CommercialPilotSafetyDraft[];
}

export interface CommercialPilotWorkbench {
  draft: CommercialPilotWorkbenchDraftInput & {
    id: string | null;
    projectId: string;
    schemaVersion: 1;
    thresholds: {
      minimumFormalCases: number;
      documentRoleTop1: number;
      relationshipTop1: number;
    };
    revision: number;
    updatedAt: string | null;
    lastCollection: CommercialPilotCollection | null;
  };
  progress: {
    caseCount: number;
    requiredCaseCount: number;
    completeCaseCount: number;
    templateCount: number;
    requiredTemplateCount: number;
    outcomes: string[];
    traits: Array<{ id: string; complete: boolean }>;
    safety: Array<{ id: string; passed: boolean; reason?: string }>;
    releaseReview: Array<{
      id: string;
      complete: boolean;
      status?: "pending" | "passed" | "failed";
      reviewerRole?: string;
      reviewerId?: string | null;
      reviewedAt?: string | null;
      evidenceCount?: number;
    }>;
    cases: Array<{
      id: string;
      workItemId: string;
      state: "complete" | "incomplete" | "missing";
      missing: string[];
    }>;
    missing: string[];
    readyForCollection: boolean;
    validationErrors: string[];
  };
  eligible: {
    workItems: Array<{
      id: string;
      localRef: string | null;
      title: string | null;
      status: string;
      businessCaseId: string | null;
      suggestedTemplateId?: string;
      suggestedDocumentRole?: CommercialPilotDocumentRole;
      suggestedOutcome?: CommercialPilotCaseDraft["expectedOutcome"];
      suggestedTraits?: string[];
      evidenceState?: "complete" | "incomplete" | "missing";
      missing?: string[];
      nextAction?: "process" | "assets";
    }>;
    relationshipArtifacts: Array<{
      id: string;
      name: string | null;
      family: string;
    }>;
    safetyEvidence: CommercialPilotSafetyDraft[];
  };
  requiredSafetyScenarios: string[];
  history?: CommercialPilotCollectionSummary[];
  gaps?: Array<{
    key: string;
    title: string;
    reasons: string[];
    parentId: string | null;
    issue: { id: string; localRef: string; status: string } | null;
  }>;
  rollout?: {
    mode: "off" | "shadow" | "enabled";
    revision: number;
    updatedAt: string | null;
    updatedBy: string | null;
  };
  permissions?: { canManage: boolean; canReview: boolean };
}

export interface CommercialPilotCollection {
  evidence: {
    state: "complete" | "incomplete";
    missing: string[];
  };
  manifest: Record<string, unknown>;
  report: {
    metrics: {
      formalCaseCount: number;
      documents: {
        top1: number | null;
        unknownCoverage: number | null;
        forcedGuessCount: number;
      };
      relationships: { top1: number | null; top5: number | null };
      correction: { rate: number | null };
      completion: { rate: number | null };
      evidence: { coverage: number | null };
      outcomes: { accuracy: number | null };
      duplicates: { total: number };
      approvals: { coverage: number | null; incompleteCaseCount: number };
      recovery: { passRate: number | null };
      safety: { passRate: number | null };
    };
    gate: {
      decision: "go" | "no_go";
      reasons?: string[];
    };
  };
  verification?: { verified: true };
}

export type AdaptiveWorkPolicyMode = "observe" | "assist" | "execute";

export interface AdaptiveWorkMonitor {
  id: string | null;
  sourceId: string;
  enabled: boolean;
  intervalMinutes: number;
  revision: number;
  state: "disabled" | "scheduled" | "running" | "recoverable" | "backoff";
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  updatedAt: string | null;
}

export interface AdaptiveLearningEvaluation {
  evaluatedAt?: string;
  evidenceCount: number;
  accepted: number;
  rejected: number;
  acceptanceRate: number | null;
  rejectionRate?: number | null;
  trackedOutcomes?: number;
  completedOutcomes?: number;
  completionRate: number | null;
  representative: boolean;
  passed: boolean;
  reasons: string[];
  shadow?: {
    comparisonCount: number;
    preferenceCount: number;
    candidateWins: number;
    currentWins: number;
    neitherWins: number;
    candidateWinRate: number | null;
    regressionRate: number | null;
    representative: boolean;
    required: number;
  };
}

export interface AdaptiveShadowComparison {
  id: string;
  draftId: string;
  draftVersion: number;
  suggestionId: string;
  baseline: { documentType: string; actions: string[]; confidenceThreshold: number };
  candidate: { documentType: string; actions: string[]; confidenceThreshold: number };
  differences: {
    documentTypeChanged: boolean;
    actionsChanged: boolean;
    thresholdChanged: boolean;
  };
  preference: {
    preferred: "current" | "candidate" | "neither";
    reason: string;
    confirmed: true;
    decidedAt: string;
    decidedBy: string;
  } | null;
  evaluatedAt: string | null;
}

export interface AdaptiveLearningDraft {
  id: string;
  version: number;
  revision: number;
  status: "shadow" | "published";
  evaluation: AdaptiveLearningEvaluation;
  configuration: {
    documentTypes: Array<{
      documentType: string;
      evidenceCount: number;
      actions: string[];
      confidenceThreshold: number;
    }>;
    typeMappings?: Array<{
      fromDocumentType: string;
      toDocumentType: string;
      evidenceCount: number;
    }>;
  };
  shadowComparisons?: AdaptiveShadowComparison[];
  createdAt: string;
  updatedAt: string;
}

export interface AdaptiveLearningPublicationReview {
  draftId: string;
  draftVersion: number;
  draftRevision: number;
  fingerprint: string;
  gate: {
    passed: boolean;
    reasons: string[];
    evaluation: AdaptiveLearningEvaluation;
  };
  evidence: { count: number; ids: string[] };
  changes: Array<{
    documentType: string;
    before: { actions: string[]; confidenceThreshold: number } | null;
    after: { actions: string[]; confidenceThreshold: number };
    actionChanges: { added: string[]; removed: string[] };
  }>;
  typeMappings: Array<{
    fromDocumentType: string;
    toDocumentType: string;
    evidenceCount: number;
  }>;
  impact: {
    observedSuggestions: number;
    affectedSuggestions: number;
    automationEligible: number;
    executeMode: boolean;
  };
  rollback: { available: boolean; ruleId: string | null; version: number | null };
  boundary: {
    candidateAppliedBeforePublish: false;
    localIssueOnly: true;
    externalDelivery: false;
  };
}

export interface AdaptiveLearningRule {
  id: string;
  version: number;
  revision: number;
  status: "active" | "superseded" | "rolled_back";
  previousRuleId: string | null;
  evaluation: AdaptiveLearningEvaluation;
  configuration: AdaptiveLearningDraft["configuration"];
  publishedAt: string;
}

export interface AdaptiveWorkNotification {
  id: string;
  kind: "monitor_failed" | "monitor_recovered" | "automation_downgraded" | string;
  message: string;
  state: "unread" | "read";
  createdAt: string;
  readAt?: string;
}

export interface AdaptiveLearningReadiness {
  evidenceCount: number;
  accepted: number;
  rejected: number;
  draftRequired: number;
  evaluationRequired: number;
  canGenerate: boolean;
  canEvaluate: boolean;
}

export interface AdaptiveWorkSuggestion {
  id: string;
  projectId: string;
  sourceId: string;
  observationId: string;
  artifact: {
    id: string;
    name: string | null;
    family: string;
    extension: string | null;
  } | null;
  documentType: string;
  detectedDocumentType: string;
  confidence: number;
  confirmationState: string | null;
  readiness: "needs_analysis" | "needs_confirmation" | "ready";
  reasons: string[];
  riskSignals: string[];
  actions: string[];
  history: Array<{
    classificationId: string;
    documentType: string;
    artifact: { id: string; name: string | null; family: string; extension: string | null } | null;
    confirmationState: string;
  }>;
  automation: {
    eligible: boolean;
    confidenceThreshold: number;
    historyThreshold: number;
    reasons: string[];
  };
  issue: { id: string; localRef: string; title: string; status: string } | null;
  learnedRule: { id: string; version: number; applied: boolean } | null;
  outcome: {
    id: string;
    suggestionId: string;
    workItemId: string;
    status: "active" | "blocked" | "closed" | "completed";
    workItemStatus: string | null;
    completedAt: string | null;
    outputAssets: Array<{ id: string | null; family: string | null; name: string | null; path: string | null }>;
    verification: Array<{
      id: string;
      kind: string;
      status: string;
      summary: string | null;
      recordedAt: string;
    }>;
    updatedAt: string;
  } | null;
  shadow: AdaptiveShadowComparison | null;
  feedback: {
    decision: "accepted" | "rejected";
    reason: string;
    note: string | null;
    createdAt: string;
  } | null;
}

export interface AdaptiveWorkWorkbench {
  policy: {
    mode: AdaptiveWorkPolicyMode;
    revision: number;
    scope: "source" | "inherited" | "project";
    sourceId: string | null;
    inheritedMode: AdaptiveWorkPolicyMode | null;
    updatedAt: string | null;
    updatedBy: string | null;
    boundary: { localIssueOnly: true; externalDelivery: false; overwriteFiles: false };
  };
  monitor: AdaptiveWorkMonitor | null;
  suggestions: AdaptiveWorkSuggestion[];
  metrics: {
    total: number;
    ready: number;
    needsAttention: number;
    materialized: number;
    automationEligible: number;
    accepted: number;
    rejected: number;
    acceptanceRate: number | null;
    tracked: number;
    completed: number;
    completionRate: number | null;
  };
  permissions: { canUse: boolean; canManage: boolean };
}

export type WorkflowMemoryInsights = {
  pathGraph: {
    nodes: Array<{
      kind: "entry" | "reference" | "intermediate" | "final" | "ledger";
      state: "confirmed" | "unknown";
      paths: Array<{ path: string }>;
    }>;
    unknownKinds: string[];
  } | null;
  health: {
    score: number | null;
    status: "insufficient_data" | "healthy" | "watch" | "at_risk";
    reasons: string[];
    metrics: {
      sampleCount: number;
      duplicateRate: number | null;
      manualCorrectionRate: number | null;
      completionRate: number | null;
      anomalyRate: number | null;
    };
  } | null;
  memoryPackage: {
    version: number;
    summary: Record<string, { state: "confirmed" | "unknown"; value: unknown }>;
  } | null;
  previousMemoryPackage: { version: number } | null;
  packageDiff: {
    changes: Array<{ path: string; kind: string; before: unknown; after: unknown }>;
  } | null;
  routineSelection: { state: "matched" | "conflict" | "missing"; routineDefinitionId: string | null; count: number };
  resultSuggestions: Array<{
    id: string;
    documentType: string;
    evidenceCount: number;
    changes: { added: string[]; removed: string[]; thresholdChanged: boolean };
    evaluationPassed: boolean;
  }>;
  rollback: { available: boolean; ruleId: string | null; expectedRevision: number | null };
};

/**
 * Workflow Memory is route-lazy, so keep its sizeable API surface in the same
 * lazy chunk instead of charging every user for it during application boot.
 */
export const workflowMemoryApi = {
  listTemplateLearningTasks: () =>
    request<{ tasks: TemplateLearningTask[] }>("GET", "/api/workflow-memory/template-learning"),
  createTemplateLearningTask: (body: { name?: string; allowCloudOcr?: boolean }) =>
    request<{ task: TemplateLearningTask; source: WorkflowSource; workItem: { id: string; localRef: string; title: string } }>(
      "POST", "/api/workflow-memory/template-learning", body,
    ),
  uploadTemplateLearningFile: (
    taskId: string,
    caseId: string,
    role: "input" | "output" | "reference",
    file: File,
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams({ caseId, role, filename: file.name });
    return requestRaw<{ task: TemplateLearningTask }>(
      "POST",
      `/api/workflow-memory/template-learning/${encodeURIComponent(taskId)}/files?${query}`,
      file,
      file.type || "application/octet-stream",
      true,
      signal,
    );
  },
  startTemplateLearningTask: (taskId: string, body: { allowCloudOcr?: boolean } = {}) =>
    request<{ task: TemplateLearningTask; source?: WorkflowSource; accepted?: boolean }>(
      "POST", `/api/workflow-memory/template-learning/${encodeURIComponent(taskId)}/start`, body,
    ),
  completeTemplateLearningTask: (sourceId: string) =>
    request<{ task: TemplateLearningTask }>(
      "POST", "/api/workflow-memory/template-learning/complete", { sourceId },
    ),
  getWorkflowMemoryInsights: (projectId: string, sourceId: string, routineDefinitionId?: string) => {
    const query = new URLSearchParams({ projectId, sourceId });
    if (routineDefinitionId) query.set("routineDefinitionId", routineDefinitionId);
    return (
    request<WorkflowMemoryInsights>(
      "GET",
      `/api/workflow-memory/insights?${query}`,
    ));
  },
  getAdaptiveWorkWorkbench: (projectId: string, sourceId?: string) => {
    const query = new URLSearchParams({ projectId });
    if (sourceId) query.set("sourceId", sourceId);
    return request<AdaptiveWorkWorkbench>(
      "GET",
      `/api/workflow-memory/adaptive-workbench?${query}`,
    );
  },
  updateAdaptiveWorkPolicy: (body: {
    projectId: string;
    sourceId?: string;
    expectedRevision: number;
    mode: AdaptiveWorkPolicyMode;
    confirmed?: true;
  }) => request<{ policy: AdaptiveWorkWorkbench["policy"] }>(
    "PUT",
    "/api/workflow-memory/adaptive-workbench/policy",
    body,
  ),
  updateAdaptiveWorkMonitor: (body: {
    projectId: string;
    sourceId: string;
    expectedRevision: number;
    enabled: boolean;
    intervalMinutes: number;
    confirmed?: true;
  }) => request<{ monitor: AdaptiveWorkMonitor }>(
    "PUT",
    "/api/workflow-memory/adaptive-workbench/monitor",
    body,
  ),
  updateAdaptiveWorkAutomation: (body: {
    projectId: string;
    sourceId: string;
    expectedPolicyRevision: number;
    expectedMonitorRevision: number;
    enabled: boolean;
    intervalMinutes: number;
    confirmed?: true;
  }) => request<{
    enabled: boolean;
    policy: AdaptiveWorkWorkbench["policy"];
    monitor: AdaptiveWorkMonitor;
  }>(
    "PUT",
    "/api/workflow-memory/adaptive-workbench/automation",
    body,
  ),
  runAdaptiveWorkMonitorNow: (body: { projectId: string; sourceId: string }) =>
    request<{
      result: { monitorId: string; status: "succeeded" | "failed"; error?: string };
      monitor: AdaptiveWorkMonitor;
      workbench: AdaptiveWorkWorkbench;
    }>("POST", "/api/workflow-memory/adaptive-workbench/monitor/run", body),
  getAdaptiveLearning: (projectId: string, sourceId: string) =>
    request<{
      readiness: AdaptiveLearningReadiness;
      drafts: AdaptiveLearningDraft[];
      rules: AdaptiveLearningRule[];
    }>(
      "GET",
      `/api/workflow-memory/adaptive-workbench/learning?projectId=${encodeURIComponent(projectId)}&sourceId=${encodeURIComponent(sourceId)}`,
    ),
  generateAdaptiveLearningDraft: (body: { projectId: string; sourceId: string }) =>
    request<{ draft: AdaptiveLearningDraft }>(
      "POST", "/api/workflow-memory/adaptive-workbench/learning", body,
    ),
  evaluateAdaptiveLearning: (body: { projectId: string; sourceId: string }) =>
    request<{ evaluation: AdaptiveLearningEvaluation; governance: { downgraded: boolean; currentMode: AdaptiveWorkPolicyMode } }>(
      "POST", "/api/workflow-memory/adaptive-workbench/evaluate", body,
    ),
  recordAdaptiveShadowPreference: (
    draftId: string,
    suggestionId: string,
    body: {
      expectedRevision: number;
      preferred: "current" | "candidate" | "neither";
      reason: string;
      confirmed: true;
    },
  ) => request<{ comparison: AdaptiveShadowComparison; draftRevision: number }>(
    "POST",
    `/api/workflow-memory/adaptive-workbench/learning/drafts/${encodeURIComponent(draftId)}/shadow/${encodeURIComponent(suggestionId)}/preference`,
    body,
  ),
  previewAdaptiveLearningPublication: (draftId: string) =>
    request<{ review: AdaptiveLearningPublicationReview }>(
      "POST",
      `/api/workflow-memory/adaptive-workbench/learning/drafts/${encodeURIComponent(draftId)}/publication-preview`,
      {},
    ),
  publishAdaptiveLearningDraft: (draftId: string, body: {
    expectedRevision: number;
    reviewFingerprint: string;
    confirmed: true;
  }) =>
    request<{ rule: AdaptiveLearningRule }>(
      "POST",
      `/api/workflow-memory/adaptive-workbench/learning/drafts/${encodeURIComponent(draftId)}/publish`,
      body,
    ),
  rollbackAdaptiveLearningRule: (ruleId: string, body: { expectedRevision: number; confirmed: true }) =>
    request<{ rolledBackRuleId: string; activeRule: AdaptiveLearningRule }>(
      "POST",
      `/api/workflow-memory/adaptive-workbench/learning/rules/${encodeURIComponent(ruleId)}/rollback`,
      body,
    ),
  getAdaptiveNotifications: (projectId: string, sourceId: string) =>
    request<{ notifications: AdaptiveWorkNotification[]; unread: number }>(
      "GET",
      `/api/workflow-memory/adaptive-workbench/notifications?projectId=${encodeURIComponent(projectId)}&sourceId=${encodeURIComponent(sourceId)}`,
    ),
  readAdaptiveNotification: (notificationId: string) => request<{ notification: AdaptiveWorkNotification }>(
    "POST",
    `/api/workflow-memory/adaptive-workbench/notifications/${encodeURIComponent(notificationId)}/read`,
    {},
  ),
  materializeAdaptiveWorkSuggestion: (
    suggestionId: string,
    body: { projectId: string; sourceId: string; confirmed: true },
  ) => request<{
    workItem: { id: string; localRef: string; title: string; status: string };
    replayed: boolean;
    workbench: AdaptiveWorkWorkbench;
  }>(
    "POST",
    `/api/workflow-memory/adaptive-workbench/suggestions/${encodeURIComponent(suggestionId)}/materialize`,
    body,
  ),
  reconcileAdaptiveWork: (body: { projectId: string; sourceId: string }) =>
    request<{
      mode: AdaptiveWorkPolicyMode;
      observed: number;
      prepared: number;
      autoCreated: number;
      created: Array<{
        suggestionId: string;
        workItemId: string;
        localRef: string;
        replayed: boolean;
        routineRunId: string | null;
        executionStatus: string | null;
        advancedStepKeys: string[];
        assistance: {
          kind: string;
          reason: string;
          stepKey: string | null;
          stepLabel: string | null;
          action: string;
        } | null;
      }>;
      failures: Array<{
        suggestionId: string;
        error: string;
        assistance: {
          kind: string;
          reason: string;
          action: string;
        };
      }>;
      capped: boolean;
      workbench: AdaptiveWorkWorkbench;
    }>("POST", "/api/workflow-memory/adaptive-workbench/reconcile", body),
  recordAdaptiveWorkFeedback: (
    suggestionId: string,
    body: {
      projectId: string;
      sourceId: string;
      decision: "accepted" | "rejected";
      reason: string;
      note?: string;
      correctedDocumentType?: string;
      correctedActions?: string[];
      correctionConfirmed?: true;
    },
  ) => request<{ feedback: Record<string, unknown>; workbench: AdaptiveWorkWorkbench }>(
    "POST",
    `/api/workflow-memory/adaptive-workbench/suggestions/${encodeURIComponent(suggestionId)}/feedback`,
    body,
  ),
  getBusinessPilotWorkbench: (projectId: string) =>
    request<CommercialPilotWorkbench>(
      "GET",
      `/api/workflow-memory/commercial-pilot/workbench?projectId=${encodeURIComponent(projectId)}`,
    ),
  saveBusinessPilotWorkbench: (body: {
    projectId: string;
    expectedRevision: number;
    draft: CommercialPilotWorkbenchDraftInput;
  }) => request<CommercialPilotWorkbench>(
    "PUT",
    "/api/workflow-memory/commercial-pilot/workbench",
    body,
  ),
  collectBusinessPilotWorkbench: (body: {
    projectId: string;
    expectedRevision: number;
  }) => request<CommercialPilotWorkbench & {
    collection: CommercialPilotCollection;
    replayed: boolean;
  }>(
    "POST",
    "/api/workflow-memory/commercial-pilot/workbench/collect",
    body,
  ),
  prepareBusinessPilotWorkbench: (body: {
    projectId: string;
    expectedRevision: number;
    confirmed: true;
    dataClassification: "deidentified" | "real";
    consentScope: string;
    pilotId: string;
    description?: string;
  }) => request<CommercialPilotWorkbench & {
    automation: {
      selectedCaseCount: number;
      matchedSafetyCount: number;
      eligibleCaseCount: number;
      readyCaseCount: number;
    };
  }>("POST", "/api/workflow-memory/commercial-pilot/workbench/prepare", body),
  createBusinessPilotGapIssues: (body: {
    projectId: string;
    expectedRevision: number;
    confirmed: true;
  }) => request<CommercialPilotWorkbench & {
    issues: Array<{
      id: string;
      localRef: string;
      status: string;
      gapKey: string;
      replayed: boolean;
    }>;
  }>("POST", "/api/workflow-memory/commercial-pilot/workbench/gap-issues", body),
  submitBusinessPilotReview: (
    dimension: CommercialPilotReviewDimension,
    body: {
      projectId: string;
      expectedRevision: number;
      status: "passed" | "failed";
      note: string;
      evidenceIds: string[];
    },
  ) => request<CommercialPilotWorkbench & {
    review: {
      dimension: CommercialPilotReviewDimension;
      status: "passed" | "failed";
      reviewerId: string;
    };
  }>(
    "POST",
    `/api/workflow-memory/commercial-pilot/workbench/reviews/${encodeURIComponent(dimension)}`,
    body,
  ),
  updateBusinessPilotRollout: (body: {
    projectId: string;
    expectedRevision: number;
    mode: "off" | "shadow" | "enabled";
  }) => request<{ rollout: NonNullable<CommercialPilotWorkbench["rollout"]> }>(
    "PUT",
    "/api/workflow-memory/commercial-pilot/rollout",
    body,
  ),
  getBusinessPilotCollection: (projectId: string, collectionId: string) =>
    request<{
      collection: CommercialPilotCollectionSummary;
      report: CommercialPilotCollection["report"];
      verification: CommercialPilotCollection["verification"];
    }>(
      "GET",
      `/api/workflow-memory/commercial-pilot/collections/${encodeURIComponent(collectionId)}?projectId=${encodeURIComponent(projectId)}`,
    ),
  compareBusinessPilotCollections: (body: {
    projectId: string;
    fromId: string;
    toId: string;
  }) => request<{
    from: CommercialPilotCollectionSummary;
    to: CommercialPilotCollectionSummary;
    changes: {
      evidenceStateChanged: boolean;
      decisionChanged: boolean;
      caseCount: number;
      safetyPassed: number;
    };
  }>("POST", "/api/workflow-memory/commercial-pilot/collections/compare", body),
  exportBusinessPilotCollection: (
    projectId: string,
    collectionId: string,
    format: "markdown" | "json",
  ) => request<{ filename: string; mediaType: string; content: string }>(
    "GET",
    `/api/workflow-memory/commercial-pilot/collections/${encodeURIComponent(collectionId)}/export?projectId=${encodeURIComponent(projectId)}&format=${format}`,
  ),
  revokeBusinessPilotCollection: (projectId: string, collectionId: string) =>
    request<{ collection: CommercialPilotCollectionSummary; replayed: boolean }>(
      "POST",
      `/api/workflow-memory/commercial-pilot/collections/${encodeURIComponent(collectionId)}/revoke`,
      { projectId },
    ),
  listWorkflowSources: () =>
    request<{ sources: WorkflowSource[] }>("GET", "/api/workflow-memory/sources"),
  listChannelObjects: (params: { projectId?: string; kind?: ChannelObjectKind; status?: "active" | "disabled" } = {}) => {
    const query = new URLSearchParams();
    if (params.projectId) query.set("projectId", params.projectId);
    if (params.kind) query.set("kind", params.kind);
    if (params.status) query.set("status", params.status);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return request<{ objects: ChannelObjectRecord[]; count: number }>("GET", `/api/channel-objects${suffix}`);
  },
  upsertChannelObject: (body: {
    kind: ChannelObjectKind;
    projectId: string;
    label: string;
    businessKey?: string;
    fields: Record<string, string>;
  }) => request<{ object: ChannelObjectRecord }>("POST", "/api/channel-objects", body),
  setChannelObjectStatus: (id: string, body: { status: "active" | "disabled"; expectedRevision: number }) =>
    request<{ object: ChannelObjectRecord }>("PATCH", `/api/channel-objects/${encodeURIComponent(id)}/status`, body),
  previewChannelObjectImport: (body: {
    projectId: string;
    kind: ChannelObjectKind;
    format: "csv" | "json" | "xlsx";
    fileName: string;
    content: string;
  }) => request<{ import: ChannelObjectImportPreview; canConfirm: boolean }>("POST", "/api/channel-objects/import/preview", body),
  confirmChannelObjectImport: (importId: string, approvalToken: string) =>
    request<{ import: ChannelObjectImportPreview; objects?: ChannelObjectRecord[]; replayed: boolean }>("POST", "/api/channel-objects/import/confirm", { importId, approvalToken }),
  listChannelObjectConnectors: (projectId?: string) => request<{ connectors: ChannelObjectConnector[] }>("GET", `/api/channel-objects/connectors${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  listChannelObjectConnectorConfigs: (projectId?: string) => request<{ configs: ChannelObjectConnectorConfig[]; count: number }>("GET", `/api/channel-objects/connector-configs${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  listChannelObjectFileSources: (projectId?: string, kind?: ChannelObjectKind) => request<{ sources: ChannelObjectFileSource[]; count: number }>("GET", `/api/channel-objects/file-sources?${new URLSearchParams({ ...(projectId ? { projectId } : {}), ...(kind ? { kind } : {}) }).toString()}`),
  listChannelMutationBindings: (projectId?: string, fileSourceId?: string) => request<{ bindings: ChannelMutationBinding[]; count: number }>("GET", `/api/channel-objects/mutation-bindings?${new URLSearchParams({ ...(projectId ? { projectId } : {}), ...(fileSourceId ? { fileSourceId } : {}) }).toString()}`),
  upsertChannelMutationBinding: (body: { id?: string; projectId: string; fileSourceId: string; ledgerDefinitionId: string; expectedRevision?: number }) => request<{ binding: ChannelMutationBinding }>("POST", "/api/channel-objects/mutation-bindings", body),
  setChannelMutationBindingStatus: (id: string, body: { status: "active" | "disabled"; expectedRevision: number }) => request<{ binding: ChannelMutationBinding }>("PATCH", `/api/channel-objects/mutation-bindings/${encodeURIComponent(id)}/status`, body),
  listLedgerDefinitions: () => request<{ ledgerDefinitions: LedgerDefinitionSummary[]; count: number }>("GET", "/api/workflow-memory/ledger-definitions"),
  upsertChannelObjectConnectorConfig: (body: { id?: string; projectId: string; connectorId: string; name?: string; kinds: ChannelObjectKind[]; credentialRef?: string; status?: "enabled" | "disabled"; expectedRevision?: number }) =>
    request<{ config: ChannelObjectConnectorConfig }>("POST", "/api/channel-objects/connector-configs", body),
  setChannelObjectConnectorConfigStatus: (id: string, body: { status: "enabled" | "disabled"; expectedRevision: number }) =>
    request<{ config: ChannelObjectConnectorConfig }>("PATCH", `/api/channel-objects/connector-configs/${encodeURIComponent(id)}/status`, body),
  testChannelObjectConnectorConfig: (id: string) => request<{ config: ChannelObjectConnectorConfig; ok: boolean; error: string | null }>("POST", `/api/channel-objects/connector-configs/${encodeURIComponent(id)}/test`, {}),
  previewChannelObjectConnectorSync: (body: { configId?: string; connectorId?: string; projectId?: string; kind: ChannelObjectKind }) =>
    request<{ preview: ChannelObjectSyncPreview; canConfirm: boolean }>("POST", "/api/channel-objects/sync/preview", body),
  issueApprovalGrant: (action: string, targetId: string) =>
    request<{ grantId: string; token: string; expiresAt: string }>("POST", "/api/approvals/grants", { action, targetId }),
  confirmChannelObjectConnectorSync: (previewId: string, approvalToken: string) =>
    request<{ preview: ChannelObjectSyncPreview; sync: { id: string; status: string; imported: number; failed: number }; replayed: boolean }>("POST", "/api/channel-objects/sync/confirm", { previewId, approvalToken }),
  syncChannelObjectConnector: (body: { connectorId: string; projectId: string; kind?: ChannelObjectKind }) =>
    request<{ preview: ChannelObjectSyncPreview; canConfirm: boolean; approvalRequired: true; approval: { action: string; targetId: string } }>("POST", "/api/channel-objects/sync", body),
  createWorkflowSource: (body: {
    projectId: string;
    relativePath?: string;
    readMode?: WorkflowSource["readMode"];
    name?: string;
  }) => request<{ source: WorkflowSource }>("POST", "/api/workflow-memory/sources", body),
  scanWorkflowSource: (sourceId: string) =>
    request<{
      source: WorkflowSource;
      scan: {
        discovered: number;
        scannedEntries: number;
        skipped: number;
        parsed: number;
        parseFailed: number;
        reused: number;
        truncated: boolean;
        cancelled: boolean;
      };
    }>("POST", `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/scan`, {}),
  scanWorkflowIncrementalIntake: (sourceId: string) =>
    request<{
      source: WorkflowSource;
      intake: {
        scanRevision: number;
        scannedEntries: number;
        skipped: number;
        truncated: boolean;
        observed: number;
        waitingStable: number;
        ready: number;
        duplicate: number;
        blocked: number;
        unchanged: number;
      };
      observations: WorkflowIntakeObservation[];
      adaptiveAnalysis: { attempted: number; classified: number; failed: number; capped: boolean };
      adaptiveWork: {
        mode: AdaptiveWorkPolicyMode;
        observed: number;
        prepared: number;
        autoCreated: number;
      };
    }>("POST", `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/scan-intake`, {}),
  listWorkflowIntakeObservations: (sourceId: string) =>
    request<{ observations: WorkflowIntakeObservation[]; count: number }>(
      "GET",
      `/api/workflow-memory/intake-observations?sourceId=${encodeURIComponent(sourceId)}`,
    ),
  getWorkflowOcrReadiness: () =>
    request<{
      state: "ready" | "unavailable";
      providerId: string | null;
      reason: string | null;
      localOnly: boolean;
      requiresCloudConsent?: boolean;
      local?: { state: "ready" | "unavailable"; providerId: string | null; reason: string | null } | null;
      cloudFallback?: { state: "ready" | "unavailable"; providerId: string | null; reason: string | null } | null;
      supportedExtensions: string[];
    }>("GET", "/api/workflow-memory/ocr-readiness"),
  ocrWorkflowArtifact: (
    artifactId: string,
    body: { expectedRevision: number; confirmed: true; allowCloudOcr?: boolean },
  ) => request<{ artifact: WorkflowArtifact; replayed: boolean }>(
    "POST",
    `/api/workflow-memory/artifacts/${encodeURIComponent(artifactId)}/ocr`,
    body,
    true,
    190_000,
  ),
  cancelWorkflowOcrArtifact: (artifactId: string) =>
    request<{ artifactId: string; cancellationRequested: true }>(
      "DELETE",
      `/api/workflow-memory/artifacts/${encodeURIComponent(artifactId)}/ocr`,
    ),
  getWorkflowOcrStatus: (artifactId: string) =>
    request<{
      state: "idle" | "running" | "completed";
      completedPages: number;
      totalPages: number | null;
    }>(
      "GET",
      `/api/workflow-memory/artifacts/${encodeURIComponent(artifactId)}/ocr`,
    ),
  inspectWorkflowInquiryIntake: (
    observationId: string,
    supportingObservationIds: string[] = [],
    supportingObservationRoles: Record<string, "reference" | "historical_output"> = {},
  ) =>
    request<InquiryIntakeInspection | {
      state: "triggered";
      receipt: InquiryIntakeReceipt;
      replayed: true;
    }>(
      "POST",
      `/api/workflow-memory/intake-observations/${encodeURIComponent(observationId)}/inspect`,
      { supportingObservationIds, supportingObservationRoles },
    ),
  acceptWorkflowInquiryIntake: (
    observationId: string,
    body: {
      expectedRevision: number;
      idempotencyKey: string;
      routineDefinitionId: string;
      confirmed: true;
      fieldCorrections?: Partial<Record<BusinessFieldProposal["key"], string>>;
      excludedFieldKeys?: BusinessFieldProposal["key"][];
      supportingObservationIds?: string[];
      supportingObservationRoles?: Record<string, "reference" | "historical_output">;
    },
  ) => request<{
    state: "triggered";
    receipt: InquiryIntakeReceipt;
    replayed: boolean;
  }>(
    "POST",
    `/api/workflow-memory/intake-observations/${encodeURIComponent(observationId)}/accept`,
    body,
  ),
  cancelWorkflowSourceScan: (sourceId: string) =>
    request<{ sourceId: string; cancellationRequested: true }>(
      "POST",
      `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/cancel-scan`,
      {},
    ),
  revokeWorkflowSource: (sourceId: string, expectedRevision: number) =>
    request<{ source: WorkflowSource }>(
      "POST",
      `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/revoke`,
      { expectedRevision },
    ),
  deleteWorkflowSourceLearning: (sourceId: string, expectedRevision: number) =>
    request<{
      deleted: true;
      sourceId: string;
      counts: {
        artifacts: number;
        cases: number;
        profiles: number;
        profileDrafts: number;
        runs: number;
        businessDocumentClassifications: number;
        businessDocumentAnalysisJobs: number;
        businessEntities: number;
        businessCaseCandidates: number;
        businessCases: number;
        routineDiscoveryCandidates: number;
        routineDefinitions: number;
        routineRuns: number;
        ledgerDefinitions: number;
        adaptivePolicies: number;
        adaptiveFeedback: number;
        adaptiveMonitors: number;
        adaptiveOutcomes: number;
        adaptiveLearningDrafts: number;
        adaptiveRules: number;
        adaptiveNotifications: number;
      };
      originalFilesDeleted: false;
    }>(
      "POST",
      `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/delete-learning-data`,
      { expectedRevision, confirmed: true },
    ),
  listWorkflowArtifacts: (filters: {
    sourceId?: string;
    role?: WorkflowArtifactRole;
    availability?: "available" | "missing";
  } = {}) => {
    const query = new URLSearchParams();
    if (filters.sourceId) query.set("sourceId", filters.sourceId);
    if (filters.role) query.set("role", filters.role);
    if (filters.availability) query.set("availability", filters.availability);
    const suffix = query.toString() ? `?${query}` : "";
    return request<{ artifacts: WorkflowArtifact[]; count: number }>(
      "GET",
      `/api/workflow-memory/artifacts${suffix}`,
    );
  },
  confirmWorkflowArtifact: (
    artifactId: string,
    body: { role: WorkflowArtifactRole; expectedRevision: number },
  ) => request<{ artifact: WorkflowArtifact }>(
    "POST",
    `/api/workflow-memory/artifacts/${encodeURIComponent(artifactId)}/confirm`,
    body,
  ),
  retryWorkflowArtifactExtraction: (artifactId: string, expectedRevision: number) =>
    request<{ artifact: WorkflowArtifact }>(
      "POST",
      `/api/workflow-memory/artifacts/${encodeURIComponent(artifactId)}/retry-extraction`,
      { expectedRevision },
    ),
  setWorkflowArtifactExclusion: (
    artifactId: string,
    body: { expectedRevision: number; excluded: boolean; reason?: string },
  ) => request<{ artifact: WorkflowArtifact }>(
    "POST",
    `/api/workflow-memory/artifacts/${encodeURIComponent(artifactId)}/${body.excluded ? "exclude" : "include"}`,
    { expectedRevision: body.expectedRevision, reason: body.reason },
  ),
  analyzeBusinessDocuments: (sourceId: string) =>
    request<{ job: BusinessDocumentAnalysisJob }>(
      "POST",
      `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/analyze-business-documents`,
      {},
    ),
  cancelBusinessDocumentAnalysis: (sourceId: string) =>
    request<{ sourceId: string; jobId: string; cancellationRequested: true }>(
      "POST",
      `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/cancel-business-analysis`,
      {},
    ),
  analyzeBusinessDocument: (artifactId: string) =>
    request<{ classification: BusinessDocumentClassification; replayed: boolean }>(
      "POST",
      `/api/workflow-memory/artifacts/${encodeURIComponent(artifactId)}/analyze-business-document`,
      {},
    ),
  listBusinessDocumentClassifications: (filters: {
    sourceId?: string;
    confirmationState?: BusinessDocumentClassification["confirmationState"];
  } = {}) => {
    const query = new URLSearchParams();
    if (filters.sourceId) query.set("sourceId", filters.sourceId);
    if (filters.confirmationState) query.set("confirmationState", filters.confirmationState);
    const suffix = query.toString() ? `?${query}` : "";
    return request<{ classifications: BusinessDocumentClassification[]; count: number }>(
      "GET",
      `/api/workflow-memory/business-document-classifications${suffix}`,
    );
  },
  listBusinessDocumentAnalysisJobs: (sourceId?: string) =>
    request<{ jobs: BusinessDocumentAnalysisJob[]; count: number }>(
      "GET",
      `/api/workflow-memory/business-document-analysis-jobs${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`,
    ),
  confirmBusinessDocumentClassification: (
    classificationId: string,
    body: {
      expectedRevision: number;
      documentType?: BusinessDocumentType;
      fieldCorrections?: Partial<Record<BusinessFieldProposal["key"], string>>;
      excludedFieldKeys?: BusinessFieldProposal["key"][];
    },
  ) => request<{
    classification: BusinessDocumentClassification;
    entity: Record<string, unknown> | null;
    entityReason: string | null;
  }>(
    "POST",
    `/api/workflow-memory/business-document-classifications/${encodeURIComponent(classificationId)}/confirm`,
    body,
  ),
  discoverBusinessCases: (sourceId: string) =>
    request<{
      sourceId: string;
      candidates: Array<BusinessCaseCandidate & { replayed: boolean }>;
      count: number;
      analyzedClassificationCount: number;
      truncated: boolean;
    }>(
      "POST",
      `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/discover-business-cases`,
      {},
    ),
  listBusinessCaseCandidates: (filters: {
    sourceId?: string;
    state?: BusinessCaseCandidate["state"];
  } = {}) => {
    const query = new URLSearchParams();
    if (filters.sourceId) query.set("sourceId", filters.sourceId);
    if (filters.state) query.set("state", filters.state);
    const suffix = query.toString() ? `?${query}` : "";
    return request<{ candidates: BusinessCaseCandidate[]; count: number }>(
      "GET",
      `/api/workflow-memory/business-case-candidates${suffix}`,
    );
  },
  reviewBusinessCaseCandidate: (
    candidateId: string,
    body: {
      expectedRevision: number;
      action: "confirm" | "reject" | "correct";
      artifactIds?: string[];
      correctionReason?: string;
    },
  ) => request<{ candidate: BusinessCaseCandidate; businessCase?: Record<string, unknown> }>(
    "POST",
    `/api/workflow-memory/business-case-candidates/${encodeURIComponent(candidateId)}/review`,
    body,
  ),
  discoverBusinessRoutine: (sourceId: string) =>
    request<{ candidate: BusinessRoutineDiscoveryCandidate; replayed: boolean }>(
      "POST",
      `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/discover-business-routine`,
      {},
    ),
  listBusinessRoutineCandidates: (sourceId?: string) =>
    request<{ candidates: BusinessRoutineDiscoveryCandidate[]; count: number }>(
      "GET",
      `/api/workflow-memory/business-routine-candidates${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`,
    ),
  createBusinessRoutineDraft: (candidateId: string) =>
    request<{ routineDefinition: BusinessRoutineDefinition; replayed: boolean }>(
      "POST",
      `/api/workflow-memory/business-routine-candidates/${encodeURIComponent(candidateId)}/create-draft`,
      {},
    ),
  listBusinessRoutineDefinitions: (sourceId?: string) =>
    request<{ routineDefinitions: BusinessRoutineDefinition[]; count: number }>(
      "GET",
      `/api/workflow-memory/business-routine-definitions${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`,
    ),
  updateBusinessRoutineDefinition: (
    routineDefinitionId: string,
    body: {
      expectedRevision: number;
      name?: string;
      description?: string;
      triggerDocumentTypes?: BusinessDocumentType[];
      steps?: BusinessRoutineStep[];
      dataRequirements?: BusinessRoutineDefinition["dataRequirements"];
      relations?: BusinessRoutineDefinition["relations"];
      mutationPolicy?: BusinessRoutineDefinition["mutationPolicy"];
    },
  ) => request<{ routineDefinition: BusinessRoutineDefinition }>(
    "POST",
    `/api/workflow-memory/business-routine-definitions/${encodeURIComponent(routineDefinitionId)}/update`,
    body,
  ),
  publishBusinessRoutineDefinition: (
    routineDefinitionId: string,
    expectedRevision: number,
    confirmed: boolean,
  ) => request<{ routineDefinition: BusinessRoutineDefinition; superseded?: BusinessRoutineDefinition }>(
    "POST",
    `/api/workflow-memory/business-routine-definitions/${encodeURIComponent(routineDefinitionId)}/publish`,
    { expectedRevision, confirmed },
  ),
  createBusinessRoutineDefinitionVersion: (
    routineDefinitionId: string,
    expectedRevision: number,
  ) => request<{ routineDefinition: BusinessRoutineDefinition; replayed: boolean }>(
    "POST",
    `/api/workflow-memory/business-routine-definitions/${encodeURIComponent(routineDefinitionId)}/new-version`,
    { expectedRevision },
  ),
  disableBusinessRoutineDefinition: (
    routineDefinitionId: string,
    expectedRevision: number,
  ) => request<{ routineDefinition: BusinessRoutineDefinition }>(
    "POST",
    `/api/workflow-memory/business-routine-definitions/${encodeURIComponent(routineDefinitionId)}/disable`,
    { expectedRevision },
  ),
  workflowPairProposals: (sourceId: string) =>
    request<{ sourceId: string; proposals: import("@/lib/api-client").WorkflowPairProposal[] }>(
      "GET",
      `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/pair-proposals`,
    ),
  indexWorkflowSourceEmbeddings: (sourceId: string) =>
    request<{
      source: WorkflowSource;
      index: {
        providerId: string;
        model: string;
        modelVersion: string;
        eligible: number;
        indexed: number;
        reused: number;
        truncated: boolean;
      };
      evaluation: WorkflowRetrievalEvaluation;
    }>("POST", `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/index-embeddings`),
  listDeliveryCases: (sourceId?: string) =>
    request<{ cases: DeliveryCase[]; count: number }>(
      "GET",
      `/api/workflow-memory/cases${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`,
    ),
  createDeliveryCase: (body: {
    sourceId: string;
    requirementArtifactIds: string[];
    deliveryArtifactIds: string[];
    referenceArtifactIds?: string[];
    draftArtifactIds?: string[];
    note?: string;
  }) => request<{ deliveryCase: DeliveryCase }>("POST", "/api/workflow-memory/cases", body),
  changeDeliveryCaseState: (
    caseId: string,
    action: "archive" | "restore",
    body: { expectedRevision: number; reason?: string },
  ) => request<{ deliveryCase: DeliveryCase; replayed: boolean }>(
    "POST",
    `/api/workflow-memory/cases/${encodeURIComponent(caseId)}/${action}`,
    body,
  ),
  listWorkflowProfiles: () =>
    request<{ profiles: WorkflowProfile[]; count: number }>("GET", "/api/workflow-memory/profiles"),
  deriveWorkflowProfile: (body: { name?: string; caseIds: string[] }) =>
    request<{ profile: WorkflowProfile }>("POST", "/api/workflow-memory/profiles", body),
  reviseWorkflowProfile: (
    profileId: string,
    body: {
      expectedRevision: number;
      name?: string;
      state?: "trial" | "established" | "disabled";
      requirementSpec?: WorkflowProfile["requirementSpec"];
      outcomeSpec?: WorkflowProfile["outcomeSpec"];
      transformationMap?: WorkflowProfile["transformationMap"];
      taskRecipe?: WorkflowProfile["taskRecipe"];
    },
  ) => request<{ profile: WorkflowProfile; previousProfile: WorkflowProfile }>(
    "POST",
    `/api/workflow-memory/profiles/${encodeURIComponent(profileId)}/revisions`,
    body,
  ),
  listWorkflowProfileDrafts: (profileId?: string) =>
    request<{ drafts: WorkflowProfileDraft[]; count: number }>(
      "GET",
      `/api/workflow-memory/profile-drafts${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ""}`,
    ),
  createWorkflowProfileDraft: (
    profileId: string,
    body: { expectedRevision: number; name?: string },
  ) => request<{ draft: WorkflowProfileDraft; replayed: boolean }>(
    "POST",
    `/api/workflow-memory/profiles/${encodeURIComponent(profileId)}/drafts`,
    body,
  ),
  publishWorkflowProfileDraft: (draftId: string, expectedRevision: number) =>
    request<{
      draft: WorkflowProfileDraft;
      profile: WorkflowProfile;
      previousProfile: WorkflowProfile;
      replayed: boolean;
    }>(
      "POST",
      `/api/workflow-memory/profile-drafts/${encodeURIComponent(draftId)}/publish`,
      { expectedRevision },
    ),
  listWorkflowInbox: (sourceId?: string) =>
    request<{ artifacts: WorkflowArtifact[]; count: number }>(
      "GET",
      `/api/workflow-memory/inbox${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`,
    ),
  matchWorkflowProfiles: (artifactId: string) =>
    request<{
      artifact: WorkflowArtifact;
      matches: Array<{ profile: WorkflowProfile; score: number; reasons: string[] }>;
      similarCases: SimilarWorkflowCase[];
    }>("GET", `/api/workflow-memory/inbox/${encodeURIComponent(artifactId)}/matches`),
  findSimilarWorkflowCases: (artifactId: string, limit = 5) =>
    request<{
      artifact: WorkflowArtifact;
      cases: SimilarWorkflowCase[];
      count: number;
      retrieval: WorkflowRetrievalEvaluation["retrieval"];
    }>(
      "GET",
      `/api/workflow-memory/inbox/${encodeURIComponent(artifactId)}/similar-cases?limit=${limit}`,
    ),
  evaluateWorkflowRetrieval: (sourceId: string) =>
    request<WorkflowRetrievalEvaluation>(
      "GET",
      `/api/workflow-memory/retrieval-evaluation?sourceId=${encodeURIComponent(sourceId)}`,
    ),
  inspectWorkflowRequirement: (artifactId: string, profileId: string) =>
    request<WorkflowRequirementInspection>(
      "GET",
      `/api/workflow-memory/inbox/${encodeURIComponent(artifactId)}/inspect?profileId=${encodeURIComponent(profileId)}`,
    ),
  listWorkflowRuns: () =>
    request<{ runs: WorkflowRun[]; count: number }>("GET", "/api/workflow-memory/runs"),
  createWorkflowRun: (body: {
    artifactId: string;
    profileId: string;
    answers?: Record<string, string>;
  }) => request<{
    run: WorkflowRun;
    workItem: { id: string; localRef?: string };
    replayed: boolean;
  }>("POST", "/api/workflow-memory/runs", body),
  executeWorkflowRun: (
    runId: string,
    body: { expectedRevision: number; agentId?: string; baseBranch?: string },
  ) => request<{
    run: WorkflowRun;
    autoRun?: Record<string, unknown>;
    worktree?: Record<string, unknown> | null;
    replayed: boolean;
  }>("POST", `/api/workflow-memory/runs/${encodeURIComponent(runId)}/execute`, body),
  cancelWorkflowRunExecution: (runId: string, expectedRevision: number) =>
    request<{ run: WorkflowRun; autoRun: Record<string, unknown> }>(
      "POST",
      `/api/workflow-memory/runs/${encodeURIComponent(runId)}/cancel-execution`,
      { expectedRevision },
    ),
  retryWorkflowRunExecution: (runId: string, expectedRevision: number) =>
    request<{ run: WorkflowRun; autoRun: Record<string, unknown> }>(
      "POST",
      `/api/workflow-memory/runs/${encodeURIComponent(runId)}/retry-execution`,
      { expectedRevision },
    ),
  cleanupWorkflowRunAttemptWorktree: (
    runId: string,
    attemptNumber: number,
    expectedRevision: number,
  ) => request<{
    run: WorkflowRun;
    attempt: NonNullable<WorkflowRun["executionAttempts"]>[number];
    replayed: boolean;
  }>(
    "POST",
    `/api/workflow-memory/runs/${encodeURIComponent(runId)}/attempts/${attemptNumber}/cleanup`,
    { expectedRevision },
  ),
  selectWorkflowRunAttempt: (
    runId: string,
    attemptNumber: number,
    expectedRevision: number,
  ) => request<{
    run: WorkflowRun;
    attempt: NonNullable<WorkflowRun["executionAttempts"]>[number];
  }>(
    "POST",
    `/api/workflow-memory/runs/${encodeURIComponent(runId)}/attempts/${attemptNumber}/select`,
    { expectedRevision },
  ),
  validateWorkflowRun: (runId: string, expectedRevision: number) =>
    request<{ run: WorkflowRun; passed: boolean; results: WorkflowRun["validationResults"] }>(
      "POST",
      `/api/workflow-memory/runs/${encodeURIComponent(runId)}/validate`,
      { expectedRevision },
    ),
  recordWorkflowRunFeedback: (
    runId: string,
    body: {
      expectedRevision: number;
      feedback: "accepted" | "accepted_with_edits" | "rejected";
      note?: string;
      reasonCode?: WorkflowFeedbackReason;
    },
  ) => request<{
    run: WorkflowRun;
    deliveryCase: DeliveryCase | null;
    profileDraft: WorkflowProfileDraft | null;
    learning: NonNullable<WorkflowRun["feedback"]>["learning"];
  }>("POST", `/api/workflow-memory/runs/${encodeURIComponent(runId)}/feedback`, body),
  previewWorkflowRunPublication: (runId: string, expectedRevision: number) =>
    request<{
      run: WorkflowRun;
      publication: NonNullable<WorkflowRun["publication"]>;
      replayed: boolean;
    }>(
      "POST",
      `/api/workflow-memory/runs/${encodeURIComponent(runId)}/publication-preview`,
      { expectedRevision },
    ),
  publishWorkflowRunOutputs: (
    runId: string,
    body: { expectedRevision: number; publicationId: string; confirmed: true },
  ) => request<{
    run: WorkflowRun;
    publication: NonNullable<WorkflowRun["publication"]>;
    deliveryCase: DeliveryCase | null;
    profileDraft: WorkflowProfileDraft | null;
    replayed: boolean;
  }>("POST", `/api/workflow-memory/runs/${encodeURIComponent(runId)}/publish`, body),
};
